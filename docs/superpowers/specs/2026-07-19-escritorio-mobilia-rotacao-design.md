# Escritório — rotação de mobília no editor

**Data:** 2026-07-19
**Status:** aprovado
**Branch:** `feat/escritorio-mobilia-rotacao`

## Problema

O editor in-place de mobília (`/office` → botão pincel) só permite **colocar** e
**apagar o topo** de uma célula. Um móvel colocado na orientação errada — uma cadeira
virada para o lado oposto, um sofá em L que precisa virar de canto — só se corrige
apagando tudo e repintando com outros tiles do atlas, quando esses tiles existem.

Não há hoje nenhum campo de rotação ou espelhamento: `grep` por
`flipX|flipY|setRotation|setAngle` em `apps/web/src/office` e `packages/shared/src`
não retorna nada ligado a mobília.

## Escopo

Girar e espelhar mobília **já colocada**, em blocos, dentro do editor in-place.
Fora de escopo: rotação no momento da colocação (o carimbo da paleta continua sem
orientação), agrupamento de móveis multi-tile num objeto só, e colisão automática.

## Decisões

Quatro escolhas fecharam o desenho:

1. **Depois de colocado**, não antes — a dor é corrigir o que já está no mapa.
2. **Unidade = seleção retangular**, não tile solto. Um móvel 2×3 são seis
   `tile-object` independentes; girar um por vez produz fragmentos errados. O bloco
   gira como uma peça: cada tile roda *e* muda de posição dentro do retângulo.
3. **Girar 90° + espelhar**, não só espelhar.
4. **Gira em torno do centro da seleção**, com transbordo permitido.

O transbordo é inofensivo porque a mobília passou a ser empilhável (PR 10542): os
objetos vivem numa lista ordenada, não num slot por célula. Um bloco girado que caia
sobre vizinhos apenas fica por cima. O único limite duro é a borda do mapa.

## Modelo de dados

Dois campos **opcionais** em `TileObjectV1.properties`
(`packages/shared/src/office-map.ts:354`):

```ts
rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
flipX: z.boolean().optional(),
```

`rotation` + `flipX` cobrem as **oito** orientações possíveis de um tile (o grupo
diedral de ordem 8). Espelhar na vertical é "espelhar na horizontal + girar 180°",
então um terceiro campo seria redundante e abriria estados equivalentes representados
de formas diferentes. A UI expõe os quatro botões mesmo assim; a conversão é interna.

Sendo opcionais, os campos são retrocompatíveis: todo mapa já publicado continua
validando, sem migration.

A geometria não muda. Os tiles são 16×16 quadrados, então girar preserva
`width`/`height` e a validação de `office-map.ts:1039` (geometria de um `tile-object`
tem de ser exatamente `tileWidth × tileHeight`) continua passando intacta.

## Transformações

Duas camadas independentes, ambas funções puras.

### Orientação de um tile

Composição no grupo diedral, sobre o estado `(rotation, flipX)`:

| Operação | `rotation` | `flipX` |
|---|---|---|
| girar ↻ | `(rotation + 90) % 360` | inalterado |
| girar ↺ | `(rotation + 270) % 360` | inalterado |
| espelhar ⇄ | `(360 - rotation) % 360` | `!flipX` |
| espelhar ⇅ | espelhar ⇄, depois girar 180° | — |

A regra de ⇄ sai de `H ∘ R(θ) = R(-θ) ∘ H`: aplicar um espelhamento no espaço do
mundo sobre um sprite que já está rotacionado equivale a inverter o ângulo e alternar
o flip local.

### Posição dentro do bloco

Seleção de `N` colunas × `M` linhas com origem `(c0, r0)`. Girando ↻, um tile no
offset local `(dc, dr)` vai para `((M - 1) - dr, dc)`, e o bloco passa a ser `M × N`.

Para girar *no lugar*, a nova origem preserva o centro:

```
c0' = c0 + roundSymmetric((N - M) / 2)
r0' = r0 + roundSymmetric((M - N) / 2)
```

Com `N - M` ímpar o centro cai em meio tile. O arredondamento precisa ser
**simétrico em torno de zero** (`f(-x) === -f(x)`): como os dois eixos
arredondam valores de sinal oposto, só assim os deslocamentos de meio tile se
cancelam quando rotações são compostas (girar e desfazer, ou quatro giros
seguidos). `Math.round` **não serve** — `Math.round(-0.5)` é `-0`, não `-1` —,
então o erro acumula em vez de cancelar.

Espelhar não altera as dimensões: ⇄ leva `dc` para `(N - 1) - dc`, ⇅ leva `dr` para
`(M - 1) - dr`.

### Onde vive

`apps/web/src/office/editing/decorationDoc.ts`, ao lado de `addTileObject`:

```ts
rotateBlock(doc, rect, direction: 'cw' | 'ccw'): MapDocumentV1
flipBlock(doc, rect, axis: 'horizontal' | 'vertical'): MapDocumentV1
```

Puras, `doc → doc`, sem dependência de Phaser nem de React. São o alvo dos testes
unitários.

**Seleção de objetos:** entram na operação os `tile-object` cuja origem de geometria
cai dentro do retângulo. Como cada objeto ocupa exatamente um tile alinhado à grade,
origem contida equivale a tile contido.

**Recusa:** se o retângulo resultante sair da borda do mapa, a operação não acontece
e o documento não muda — a UI mostra um toast "Não há espaço para girar aqui."

## Ferramenta de seleção

`EditTool` ganha `'select'` (`apps/web/src/office/editing/useOfficeMapEditing.ts:23`),
no grupo Pintura do drawer, ao lado de Mobília e Borracha.

Diferente do pincel — cujo documento vive em refs para não re-renderizar a cada célula
pintada — a **seleção é React state**. Ela muda uma vez por arrasto, não por célula, e
tanto o drawer quanto a barra de ações precisam re-renderizar com ela. Não há risco de
tempestade de render.

Fluxo:

1. Arrasta no mapa → retângulo destacado (um `Graphics` novo na `OfficeScene`, depth
   23, acima dos previews de edição em 21/22).
2. Barra flutuante ancorada na seleção: ↺ ↻ ⇄ ⇅.
3. Cada clique muta o documento e redesenha imediatamente.
4. A seleção **permanece ativa** — gira de novo, vê o resultado. `Esc` limpa.

Atalhos com seleção ativa: `R` (↻), `Shift+R` (↺), `H` (⇄), `V` (⇅).

A barra é HTML posicionado sobre o canvas, convertendo mundo→tela pela câmera do
Phaser, e reposiciona quando a câmera se move.

## Renderização

Nos dois pontos de desenho da `OfficeScene`:

- publicado — `renderDecoration`, `OfficeScene.ts:811`
- preview de edição — `applyTileObjectStamp`, `OfficeScene.ts:629`

aplicar `.setAngle(rotation ?? 0)` e `.setFlipX(flipX ?? false)` sobre a `Image` já
criada. Ordem importa: o flip é local ao sprite e o ângulo é aplicado depois, que é
exatamente o modelo assumido pela tabela de composição acima.

## Redesenho e undo

A rotação muta o documento e reaproveita `repaintOverlays` (diff por id), que o undo
já usa. **Esse diff hoje compara apenas presença de id** — `useOfficeMapEditing.ts:513`
faz `if (pristineIds.has(object.id)) continue`, e o laço seguinte só trata ids
removidos. Um objeto que existe nos dois lados é ignorado, então uma mutação
*in-place* como a rotação não seria redesenhada. Isso é a maior tarefa não-óbvia da
implementação, e se divide em dois casos:

**Objeto criado nesta sessão** (só existe em `doc`, não em `base`): já cai no laço de
adicionados, que chama `applyTileObjectStamp`. Basta o stamp passar a receber
`rotation`/`flipX`. Sem mudança estrutural.

**Objeto publicado** (existe em `base` e em `doc`, com properties diferentes): não é
redesenhado por nenhum dos dois laços, *e* o sprite publicado original continua na
cena em depth 20, desenhado por `renderDecoration`. Cobrir com um preview em depth 21
não basta: tiles de mobília têm transparência, e o sprite antigo vazaria por baixo. A
solução é esconder o publicado. `renderDecoration` (`OfficeScene.ts:811`) hoje empurra
as imagens num array `mapObjects` sem índice por id; precisa manter também um
`Map<objectId, Image>` para que a edição possa chamar algo como
`setPublishedObjectVisible(id, false)`. Com isso, `repaintOverlays` ganha um terceiro
laço: ids presentes nos dois lados cujas `properties` diferem → esconde o publicado e
aplica um stamp de preview.

Esse terceiro laço é genérico — serve para qualquer edição futura in-place de um
objeto publicado (mover, trocar tile), não só rotação.

Undo sai de graça: cada operação empurra um snapshot do documento no histórico
existente, então `Ctrl+Z` desfaz um giro como desfaz uma pincelada.

Salvar continua idêntico — `lock → PUT draft → publish`, sem mudança.

## Backend

**Nenhuma mudança.** O schema compartilhado é o mesmo que a API valida, então os
campos novos passam sozinhos. O guard `assertOnlyDecorationChanged`
(`packages/shared/src/office-map.ts:1460`) já libera alterações em `objects` do tipo
`tile-object`.

O teto de 2.000 objetos não é afetado: girar não cria nem remove objetos.

## Testes

- **`decorationDoc.test.ts`** — composição das oito orientações (girar 4× volta ao
  original; ⇄ duas vezes idem; ⇅ equivale a ⇄ + 180°); coordenadas do bloco em casos
  quadrado e N×M; recusa quando o resultado sai da borda, deixando o documento
  intacto.
- **`office-map.test.ts`** (shared) — documento antigo, sem os campos, ainda valida;
  `rotation: 45` é rejeitado; `rotation: 90` sobrevive a um round-trip de parse.
- **Renderização** — `rotation`/`flipX` chegam como `setAngle`/`setFlipX` nos dois
  pontos de desenho.

## Riscos

- **Indexar os sprites publicados por id na `OfficeScene`** é a mudança mais invasiva
  do trabalho — mexe no caminho de render usado também fora do modo de edição. Merece
  cuidado com o ciclo de vida: o `Map` precisa ser limpo junto com `mapObjects` a cada
  `applyMap`, sob pena de vazar referências a sprites destruídos.
- A barra flutuante acompanhando a câmera é o ponto mais frágil da UI; se custar
  demais, o fallback é mover os botões para o drawer (decisão já considerada e
  descartada por ergonomia, mas reversível).
- Girar mobília publicada e **salvar** faz o `applyMap` republicar tudo; se o
  `Map<id, Image>` não for reconstruído nesse momento, objetos escondidos durante a
  edição podem continuar invisíveis depois do save.

## Próximos passos possíveis

Fora de escopo aqui, mas habilitados por esta ferramenta de seleção: mover um bloco,
apagar um bloco, e reordenar a pilha (trazer para frente / mandar para trás).
