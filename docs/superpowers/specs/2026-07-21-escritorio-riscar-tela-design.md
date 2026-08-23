# Riscar a tela compartilhada — design

- **Data:** 2026-07-21
- **Branch:** `feat/escritorio-riscar-tela`
- **Área:** escritório virtual (`apps/web/src/office`, `apps/api` office-hub/ws, `@legends/shared`)

## Problema

Hoje, quando alguém compartilha a tela no escritório, apontar para um trecho
específico só dá para fazer por voz ("ali no canto de cima, o terceiro item").
Em revisão de código, de design ou de planilha isso custa tempo e gera engano.
Falta um jeito de apontar visualmente, na hora, sem sair do compartilhamento.

## Solução

Um overlay de desenho sobre a tela compartilhada em destaque, na grade em tela
cheia. Quem está vendo a tela pode riscar; o traço aparece para todos os outros
que veem aquela mesma tela, na cor de quem desenhou, e some sozinho depois de
alguns segundos — comportamento de apontador, não de quadro branco.

### Decisões

| Decisão | Escolha | Por quê |
| --- | --- | --- |
| Quem risca | Todos que veem a tela | É o que faz a feature valer em revisão a várias mãos; o dono da tela apontando sozinho seria quase só um cursor. |
| Tempo de vida | Some sozinho, ~3 s de fade | Sem estado acumulado, sem botão de limpar, e não suja a tela de quem apresenta enquanto ele rola a página. |
| Ativação | Botão "Riscar" + atalho `P` | Descobrível pelo botão; o atalho permite vários traços sem segurar tecla. `Segurar tecla` (estilo confete) ninguém descobre sozinho. |
| Transporte | WebSocket do escritório | Mesmo vocabulário de `room-chat-message`/`confetti`/`raise-hand`, com testes de hub já estabelecidos e comportamento idêntico para convidados. O volume é modesto perto do `move`, que já flui continuamente pelo mesmo socket. |

Alternativa descartada no transporte: data channel do LiveKit (`publishData`
lossy). Casaria o público exatamente com quem está na sala LiveKit e não custaria
nada ao backend, mas introduz um padrão novo — hoje o LiveKit carrega só mídia —
e acoplaria a anotação ao ciclo de vida do `Room`.

## Experiência

Na grade em tela cheia (`MediaTiles` expandido), quando o tile em destaque é uma
tela compartilhada (`kind === 'screen'`), aparece um botão **"Riscar"** no canto
superior direito, ao lado de "Recolher câmeras".

- **Ligar/desligar:** botão ou tecla `P`. As teclas `D`, `F`, `R` e `WASD` já
  pertencem ao mapa (mesa, confete, girar, andar), por isso `P`.
- **Desenhar:** com o modo ligado, o cursor vira mira sobre o vídeo e arrastar
  desenha um traço. Solta e desenha de novo quantas vezes quiser; o modo só sai
  quando a pessoa manda sair.
- **`Esc`:** com o modo ligado, o primeiro `Esc` desliga o modo — não fecha a
  grade. O segundo fecha, como já fecha hoje.
- **Cor:** derivada do `userId` a partir de uma paleta fixa, legível sobre
  qualquer conteúdo. Ninguém escolhe cor.
- **Fim do traço:** ~3 s depois de terminado, o traço some com fade. Não existe
  "limpar" porque não existe acúmulo.

Sem rótulo de autor sobre o traço em v1: a cor já diferencia e o traço vive
pouco tempo.

## Coordenadas

O vídeo é renderizado com `object-contain`, então sobra letterbox dentro do
elemento. Os pontos trafegam **normalizados 0–1 relativos ao conteúdo do vídeo**,
não ao elemento: a área útil sai de `videoWidth`/`videoHeight` contra o tamanho
do elemento. Assim o traço cai no mesmo pixel do conteúdo para todo mundo,
independentemente do tamanho da janela de cada um.

Pontos fora da área útil são fixados na borda (clamp), nunca enviados negativos
ou acima de 1.

## Arquitetura — web

Diretório novo `apps/web/src/office/annotation/`, unidades pequenas, cada uma
testável isoladamente:

| Arquivo | Responsabilidade | Depende de |
| --- | --- | --- |
| `annotation-geometry.ts` | Puro: área útil do vídeo, normalizar, desnormalizar, clamp | nada |
| `annotation-color.ts` | Cor determinística por `userId` | nada |
| `useScreenAnnotations.ts` | Traços vivos (meus e dos outros), TTL/fade, envio em lote, integração com o socket | geometry, shared |
| `AnnotationCanvas.tsx` | `<canvas>` sobre o vídeo, pointer events, redesenho em rAF | geometry, color, hook |

`AnnotationCanvas` é o único que toca DOM/Canvas; o hook não conhece elementos.

`MediaTiles.tsx` já tem ~680 linhas e recebe só o mínimo: o botão de alternar e
o `<AnnotationCanvas>` posicionado sobre o tile em destaque quando ele é
`kind === 'screen'`. Nenhuma lógica de desenho, geometria ou rede entra ali.

## Contrato — `packages/shared/src/office.ts`

```ts
/** Ponto de um traço, normalizado 0–1 sobre o conteúdo do vídeo. */
export interface OfficeAnnotationPoint {
  x: number;
  y: number;
}

// OfficeClientMessage
| {
    type: "screen-annotation";
    /** De quem é a tela anotada. */
    sharerId: string;
    /** Agrupa os lotes de um mesmo traço. */
    strokeId: string;
    points: OfficeAnnotationPoint[];
    /** Último lote do traço — dispara a contagem do TTL. */
    done?: boolean;
  }

// OfficeServerMessage — igual, acrescido do autor
| {
    type: "screen-annotation";
    userId: string;
    sharerId: string;
    strokeId: string;
    points: OfficeAnnotationPoint[];
    done?: boolean;
  }
```

Constantes compartilhadas:

- `OFFICE_ANNOTATION_STROKE_TTL_MS = 3000` — tempo de vida após `done`.
- `OFFICE_ANNOTATION_BATCH_MS = 60` — intervalo de envio dos lotes.
- `OFFICE_ANNOTATION_MAX_POINTS = 64` — teto de pontos por mensagem.

`sharerId` é a chave de agrupamento: quem vê a tela de A e não a de B descarta
as anotações que citam B.

## Arquitetura — API

`apps/api/src/lib/office-hub.ts` ganha `screenAnnotation(userId, message)`:

1. Valida formato e faixa (`x`/`y` em 0–1, contagem de pontos dentro do teto).
   Mensagem inválida é ignorada em silêncio, padrão do hub.
2. Difunde: `broadcastToRoom` quando o remetente está numa zona
   (`raiseHandZoneId`), `broadcast` global fora dela. O filtro fino é do cliente
   — mesmo desenho já usado por `nearby-message`.

`apps/api/src/routes/office-ws.ts` apenas despacha a mensagem para o hub, rota
fina como as demais.

O servidor **não guarda** traços: nada entra no snapshot de `welcome`. Quem
chega no meio de um traço simplesmente não o vê — coerente com um apontador.

## Bordas

- Compartilhamento termina, destaque muda ou grade recolhe → traços daquele
  sharer são descartados e o modo de riscar desliga.
- Nenhum traço vive além do TTL, então aba em background não acumula memória:
  o rAF pausa e os traços expiram na volta.
- Traço em andamento quando o modo desliga: o último lote sai com `done`, o
  traço some normalmente.
- Anotação sobre uma tela que o receptor não vê é descartada na chegada.

## Testes

- `annotation-geometry.test.ts` — letterbox horizontal e vertical, clamp nas
  bordas, ida e volta normalizar/desnormalizar.
- `useScreenAnnotations.test.ts` — lote respeitando o intervalo, expiração por
  TTL, descarte quando o sharer some.
- `AnnotationCanvas.test.tsx` — `pointerdown`/`move`/`up` produz um traço e
  emite os lotes.
- `MediaTiles.test.tsx` — botão só aparece com tela em destaque; alternar
  monta/desmonta o overlay; `Esc` sai do modo antes de fechar a grade.
- `office-hub.test.ts` — difusão por zona, validação de faixa, autor correto.
- `office-ws.test.ts` — mensagem roteada para o hub.

## Fora do escopo (v1)

Picture-in-picture, tiles pequenos da barra, formas (seta, retângulo, texto),
desfazer, salvar print anotado e permissão controlada pelo dono da tela.
