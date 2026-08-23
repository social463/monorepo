# High-five (bater mão) no Escritório

**Data:** 2026-07-20
**Status:** Aprovado
**Card:** [21916](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/21916) — "Adcionar acesar e 'bater mão'"
**Depende de:** [21907](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/21907) — atalhos de emoji (Gabriel Serrano)
**Base:** branch `feat/emoji` (commit `80e11291`), não a `main`

## Objetivo

Referência: Gather Town. Duas pessoas acenando (👋), adjacentes e viradas uma pra
outra, disparam uma **batida de mão**: os dois emotes que já estão sobre as cabeças
viajam até o ponto médio, dão um pop de escala no impacto e somem, com um som curto
de palma.

## Escopo

Só o **high-five**. O gesto de acenar em si (tecla → emote sobre a cabeça) é entregue
pela 21907; esta feature reage a esse estado. Só o Escritório
(`OfficePage` / `OfficeScene`), autenticado.

Toda a arte é código — tween sobre o overlay que a 21907 renderiza. Nenhum sprite
novo entra no repo. Assets de terceiros seguem a regra do `AGENTS.md`
(CC-BY-SA/OGA-BY/CC-BY/CC0 com crédito em `/lpc/CREDITS.txt`); vale também pro som
(ver abaixo).

## O que a `feat/emoji` entrega (base desta feature)

Levantado do commit `80e11291`, porque o design depende diretamente do formato dela:

- **Protocolo:** o emote é um terceiro `kind` de `nearby-message` —
  `OfficeNearbyMessageKind = "speech" | "thought" | "reaction"`. É **relay puro,
  fire-and-forget**: o `OfficeHub` não guarda nada sobre reações.
- **Atalhos:** teclas **1–8** (`MediaBar.tsx`), e a lista de 8 emojis é
  **customizável pelo usuário**, persistida em `localStorage`
  (`legends.office.reactions.v1`). A posição 1 **não** é garantidamente 👋.
- **Render:** `showNearbyBubble` com `kind: "reaction"` — só o emoji, sem fundo de
  balão, ancorado em `REACTION_REST_Y = -70` acima do personagem. Guardado em
  `view.bubble` + `view.bubbleKind`; `clearBubble` destrói o anterior (um por
  pessoa).
- **Duração:** entrada 350ms → 3 pulinhos (~2700ms) → saída 350ms de delay + 500ms.
  Total ~3.9s, dos quais ~3.05s antes de começar a desaparecer.

### Consequências para esta feature

1. **A condição é sobre o emoji, não sobre a tecla.** Como cada pessoa customiza suas
   reações, a detecção compara o emoji recebido com uma constante
   `HIGH_FIVE_EMOJI = "👋"` no `shared`. Quem tirou o 👋 da lista não dispara
   high-five — correto, o gesto é o 👋, não a posição da tecla.
2. **O hub precisa passar a guardar a última reação por `userId`**, com timestamp —
   hoje `nearbyMessage` não guarda nada. É o estado novo que esta feature introduz.
3. **Os dois balões podem estar em fases diferentes** da animação (A acenou há 2s, B
   agora). No disparo, o cliente para os tweens em curso e assume o controle dos dois.

## Protocolo (`packages/shared/src/office.ts`)

Nenhuma `OfficeClientMessage` nova — quem acena já manda `nearby-message` com
`kind: "reaction"` pela 21907. Entram um membro novo na união de servidor e duas
constantes compartilhadas:

```ts
// OfficeServerMessage
| { type: "high-five"; userIds: [string, string] }

/** O gesto que dispara o high-five. Comparado com o texto da reação. */
export const HIGH_FIVE_EMOJI = "👋";

/**
 * Por quanto tempo uma reação conta como "ativa" para efeito de high-five.
 * Casado com a fase visível do balão no cliente (~3.05s até começar a sumir) —
 * se for maior, o servidor dispara com as mãos já saindo da tela.
 */
export const REACTION_ACTIVE_WINDOW_MS = 3000;
```

O servidor é a autoridade sobre "aconteceu ou não", igual ao `celebration` do
confete — dois clientes nunca divergem. O cliente deriva o ponto médio das posições
que já conhece, então a mensagem não carrega coordenadas (evita estado duplicado e
desalinhado com o `moved`).

## Detecção (`apps/api/src/lib/office-hub.ts`)

Estado novo: `private lastReaction = new Map<string, { emoji: string; at: number }>()`,
alimentado no `nearbyMessage()` quando `kind === 'reaction'`. É o que falta hoje —
o relay atual não guarda nada.

Diferente do `confettiActive`, **não** precisa de um `Map` de socket paralelo
(`confettiSocket`): aquele existe porque confete é estado liga/desliga e só a aba dona
pode desligar. Reação é evento pontual com timestamp — expira sozinha pela janela,
sem "desligar".

Reavaliar pares em **três** entradas, todas as que mudam a condição:

- `nearbyMessage()` com `kind === 'reaction'` — alguém acenou;
- `move()` — andou até ficar de frente com quem já acena;
- `face()` (`office-hub.ts:282`) — **virou sem andar**. Fácil de esquecer e é o caso
  mais comum na prática: dois lado a lado, um vira pro outro.

Condição, os três juntos:

1. ambos com uma reação `HIGH_FIVE_EMOJI` registrada há menos de
   `REACTION_ACTIVE_WINDOW_MS`;
2. `A` de frente pra `B`: `A.x + DIRECTION_DELTAS[A.dir].x === B.x` e o mesmo em `y`;
3. `B` de frente pra `A`, simétrico.

A checagem (2) **já implica adjacência** (o delta tem norma 1), então não é preciso
um teste de Manhattan separado. `DIRECTION_DELTAS` já é exportado do `shared`
(`office.ts:74`) e é o mesmo dado que o `findPath` usa — sem geometria nova.

- Novo estado: `private lastHighFiveAt = new Map<string, number>()`, chaveado pelo
  par ordenado (`[a, b].sort().join('|')` — a chave não pode depender de quem
  disparou).
- **A reação é consumida no disparo** (`lastReaction.delete` nos dois) — é o
  regulador principal da cadência. Dá a semântica "bateu, agora acenem de novo pra
  bater de novo". Sem ele, dois acenos ainda dentro da janela de 3s ficariam
  redisparando a cada reavaliação.
- Cooldown por par: `HIGH_FIVE_COOLDOWN_MS = 700`, calibrado pela **duração da
  animação** no cliente (250 de aproximação + 120 de pop ida/volta + 200 de fade
  ≈ 690ms). A única coisa que ele precisa evitar é a animação empilhar sobre si
  mesma.

  > **Calibragem corrigida na verificação manual.** O valor inicial era `3000`,
  > espelhando o `CELEBRATION_COOLDOWN_MS = 4000` do confete — analogia errada:
  > aquilo é comemoração global com banner e som alto, aqui é interação de dois.
  > Com 3000 o cooldown **somava** ao consumo das reações e o segundo high-five
  > levava ~7s: o aceno de um caía no vazio (reação do outro já consumida) e o
  > próximo esbarrava no cooldown ainda vigente. Efeito percebido: "só na terceira
  > vez que bate". Como efeito colateral, `REACTION_ACTIVE_WINDOW_MS ===
  > HIGH_FIVE_COOLDOWN_MS` tornava o consumo **código morto** (removê-lo não
  > quebrava teste nenhum); com 700 o consumo passa a ser load-bearing e coberto.
- 3+ pessoas alinhadas: cada `userId` entra em **no máximo um** high-five por
  reavaliação (marca os já pareados no ciclo). Evita que uma fileira de três vire
  dois high-fives simultâneos no mesmo personagem do meio.
- `leave()` e `reset()` limpam `lastReaction` e as entradas de par daquele `userId`.

## Cliente — animação (`apps/web/src/office/scenes/OfficeScene.ts`)

Ao receber `{ type: 'high-five', userIds: [a, b] }`:

- Resolve os dois `characters.get(userId)`. Se algum não existir (dessincronizado,
  acabou de sair), ignora silenciosamente — mesmo padrão dos outros handlers.
- Exige `view.bubble` presente e `view.bubbleKind === 'reaction'` nos dois. Se o
  balão já sumiu (borda da janela de 3s), ignora — melhor perder um high-five do que
  animar mãos que não estão na tela.
- **Para os tweens em curso** (`view.bubbleTween?.stop()`) nos dois balões antes de
  animar. Eles podem estar em fases diferentes da corrente (entrada, pulinho, saída)
  — a partir daqui esta feature assume o controle.
- **Força `bubble.alpha = 1`** antes de animar. O `stop()` do Phaser não faz snap pros
  valores finais do tween interrompido: quem acabou de acenar (servidor manda
  `nearby-message` e `high-five` no mesmo tick) tem o balão ainda em `alpha: 0`,
  esperando o primeiro tween da reação revelá-lo. Sem isso, essa mão voa invisível.
- Ponto médio entre os dois containers **nos dois eixos** — `midX` e `midY`,
  deslocado de `REACTION_REST_Y` (a altura em que o emote paira sobre a cabeça).
  O `midY` não é opcional: o par válido é sempre adjacente e alinhado num eixo, e
  **metade dos casos é vertical** (mesma coluna, um tile de distância em `y`) —
  só com `midX` esses balões dariam pop a ~32px um do outro sem nunca se encontrarem.
  No caso horizontal (mesmo `y`) o alvo continua sendo exatamente `REACTION_REST_Y`.
  Como os balões são filhos de cada `view.container`, o alvo é convertido para
  coordenadas locais de cada um (os containers estão em posições diferentes do mundo).
- Tween de ~250ms levando os dois balões até esse ponto (`Back.easeIn`, dá a
  antecipação de "puxar o braço antes de bater").
- No impacto: pop de escala pra 1.4 e volta (~120ms), e o som.
- Fade out dos dois em ~200ms e então `clearBubble(view)` nos dois — reusa a limpeza
  que a 21907 já tem, em vez de restaurar posição/escala na mão e correr o risco de
  deixar o balão num estado sujo pra próxima reação.
- Se chegar outra reação no meio da animação, o `clearBubble` da 21907 destrói o
  balão e o tween morre junto; o guard de `view.bubble` no `onComplete` evita mexer
  em objeto destruído.

## Cliente — som (`apps/web/src/office/media/high-five-sound.ts`)

Módulo novo espelhando `applause-sound.ts`, com função exportada única
`playHighFiveSound(): void`.

Sample **mp3 CC0** de palma única — não o aplauso existente, que é multidão e dura
~1.5s; aqui é um tapa seco. Mesmo padrão dos commits `b20d0446` (troca de som
sintetizado por sample CC0) e `8f4c8ec3` (volume baixo), com volume ~0.25.

Crédito do sample vai no `CREDITS.txt`, como o resto dos assets de terceiros.

## Fora de escopo

- O gesto de acenar (tecla, balão, broadcast da reação) — é a 21907.
- Tornar o 👋 obrigatório na lista de reações de quem customizou. Quem tirou o 👋
  perde o high-five; não vamos forçar a lista nem migrar `localStorage`.
- High-five entre 3+ pessoas como um evento único ("todo mundo junto") — pareamento
  simples só.
- Persistência ou histórico de high-fives (contador, badge, perfil). Tudo efêmero,
  como o resto do `OfficeHub`.
- Mobile/touch — desktop-only, como o resto do controle do Escritório.
- Rate-limit além do cooldown por par.

## Testes

- `office-hub.test.ts` — dispara no par válido; **não** dispara com só um acenando,
  com os dois acenando mas de costas/lado, ou não adjacentes; **não** dispara com
  outro emoji que não o 👋; **não** dispara se a reação de um expirou
  (`REACTION_ACTIVE_WINDOW_MS`); reação consumida não redispara; cooldown segura o
  re-disparo dentro de 3s; reavaliação no `move()` (andar até ficar de frente com
  alguém que já acena dispara); limpeza no `leave()`; numa fileira de três, o do
  meio entra em só um par.
- `office-ws.test.ts` — broadcast do `high-five` chega nos dois envolvidos e nos
  demais conectados.
- `OfficeScene.test.ts` — handler do `high-five` (tween disparado, `clearBubble` nos
  dois ao fim); ignora `userId` desconhecido sem lançar; ignora quando o balão já
  sumiu ou não é `kind: 'reaction'`.
- `packages/shared/src/office.test.ts` — união do protocolo aceita o novo membro.
