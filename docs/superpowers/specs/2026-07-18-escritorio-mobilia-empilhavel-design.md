# Mobília empilhável no editor in-place + salvar sem fechar a paleta

**Data:** 2026-07-18
**Status:** aprovado (design)

## Objetivo

Duas mudanças no modo de edição de mapa do escritório (botão de pincel, drawer à
direita):

1. **Empilhar mobília.** Colocar uma peça sobre outra deve manter as duas, com a
   nova por cima. Hoje a de baixo é sobrescrita e desaparece ao salvar.
2. **Salvar sem sair.** Salvar deve publicar e manter o modo de edição ativo —
   drawer, paleta, ferramenta e tile selecionado permanecem. Hoje salvar encerra
   a sessão e fecha tudo.

Estende `docs/superpowers/specs/2026-07-17-escritorio-membros-editam-mapa-design.md`.

## Parte A — mobília empilhável

### Causa raiz

A mobília do pincel é gravada na **tile layer** `objects`: um array plano row-major
com **exatamente um slot por célula**. `stampTile` sobrescreve esse slot
(`apps/web/src/office/editing/decorationDoc.ts:42`), então o valor anterior é
perdido. Não é problema de z-order nem de render — o modelo de dados não comporta
duas peças na mesma célula.

O que se vê na tela reforça a confusão: durante a sessão a estampa nova é
desenhada em depth 21 **por cima** do sprite publicado (depth 20), que só é
destruído no `applyMap` pós-save (`OfficeScene.ts:521-545`). Parece empilhado até
salvar.

### Solução

O schema já tem `tile-object` (`packages/shared/src/office-map.ts:354`):
decoração posicionada em pixels, guardada no array `document.objects`. É
não-estrutural (o guard `assertOnlyDecorationChanged` permite), já é renderizada
(`OfficeScene.ts:719-742`) e o `pruneUnusedTilesets` já a considera. O pincel
simplesmente nunca a produziu.

**`paintAt` deixa de chamar `stampTile` e passa a acrescentar um `tile-object`
por célula do bloco selecionado:**

```ts
{ id, layerKey: 'objects', type: 'tile-object',
  geometry: { kind: 'rectangle', x: col * tw, y: row * th, width: tileW, height: tileH },
  properties: { tilesetId, tileIndex } }
```

A validação exige que `geometry.width/height` sejam iguais ao tile do **tileset**
(`office-map.ts:1017-1040`) e que `layerKey` aponte para uma tile layer existente —
`objects` atende.

**O empilhamento sai de graça.** `renderDecoration` desenha todas as tile layers
primeiro (`OfficeScene.ts:694`) e só então percorre `document.objects` na ordem do
array (`:719`). Todos ficam em depth 20; o desempate é a ordem de inserção no
display list do Phaser. Append no fim ⇒ desenhado por último ⇒ em cima. Nenhuma
mudança em `zIndex` ou `setDepth`.

**Compatibilidade:** mapas já publicados continuam válidos sem migration. Os tiles
existentes na layer `objects` viram a base, e o que for pintado daqui em diante
entra por cima deles.

### Borracha

Um clique remove **o último `tile-object` daquela célula** (o do topo). Se a
célula não tiver nenhum, cai no comportamento atual e limpa o tile legado da tile
layer. Arrastar a borracha aplica isso célula a célula, então uma passada tira uma
camada.

`removeDecorationObjectsInRect` (borracha em bloco de áreas/links) **não** passa a
incluir `tile-object` — a remoção de mobília continua pelo laço por célula, que é
o que preserva a semântica "só o de cima".

### Preview durante a edição

`applyTileStamp` é indexado por `layerKey:index` — um sprite por célula, e destrói
o anterior (`OfficeScene.ts:521-528`). Incompatível com pilha.

Entra uma API irmã indexada por **id do objeto**:

- `applyTileObjectStamp(objectId, x, y, w, h, textureKey, frameKey)` — depth 21,
  ordem de inserção preservada
- `removeTileObjectStamp(objectId)`

`applyTileStamp`/`eraseTileStamp` permanecem, servindo à borracha de tiles legados.
`discardLocalEdits` e `setEditing(false)` limpam também as estampas por id.

### Undo

Sem mudança estrutural: continua por snapshot do documento inteiro. O
`repaintOverlays` já faz diff de `document.objects` por id
(`useOfficeMapEditing.ts:397-408`); passa a despachar `type === 'tile-object'`
para `applyTileObjectStamp` em vez de `addEditZoneOverlay`.

### Teto de objetos

`maxObjects` é **2000** por documento (`office-map.ts:14`), compartilhado com
áreas, links e colisões — enquanto a tile layer aguenta 40.000 células. Cada
célula pintada passa a custar um objeto.

`paintAt` recusa a pincelada e exibe aviso quando
`doc.objects.length + célulasDoBloco > MAP_DOCUMENT_V1_LIMITS.maxObjects`, em vez
de deixar o save estourar na validação do servidor.

## Parte B — salvar sem fechar a paleta

### Causa

`save()` termina com `active: false` (`useOfficeMapEditing.ts:551`), o que
desmonta o drawer inteiro — e a paleta junto. Salvar hoje é "salvar e sair".

### Solução

`save()` publica e **re-ancora a sessão** em vez de encerrá-la:

| Hoje | Depois |
|---|---|
| `exitScene()` (para heartbeat + `setEditing(false)`) | mantém heartbeat e `setEditing(true)` |
| `releaseLock()` | mantém o lock |
| `documentRef = null`, `baseDocRef = null` | `baseDocRef = doc publicado` (nova base do diff) |
| `revisionRef = 0` | `revisionRef = saved.revision` |
| `active: false` | `active: true` |
| `dirty: false`, `canUndo: false`, `resetHistory()` | idem — salvar é um marco |

Ferramenta e tile selecionado vivem em `state.tool`/`state.selectedTile` e não são
tocados, então a paleta reabre já no mesmo estado.

**Por que saves sucessivos não quebram na concorrência otimista:**
`saveOfficeMapDraft` incrementa `draft.revision` e devolve `input.revision + 1`
(`office-map-service.ts:370-390`); `publishOfficeDecoration` apenas **lê** essa
revisão para detectar conflito, sem incrementá-la (`:559-572`). Logo
`revisionRef = saved.revision` continua sendo a revisão corrente do draft depois
de publicar, e o save seguinte passa. O guard `assertOnlyDecorationChanged` do
segundo save compara contra o documento recém-publicado, que é exatamente a nova
`baseDocRef` do cliente.

`applyMap` **não** desliga o modo de edição (`OfficeScene.ts:787-796` só chama
`discardLocalEdits` + `renderDecoration`), então o broadcast suave de publicação
converte as estampas locais em sprites permanentes sem remonte nem piscada.

Sair da edição continua sendo pelo X do drawer ou por Cancelar.

**Undo pós-save:** o histórico zera a cada save e o botão Desfazer volta a ficar
cinza. O que já foi publicado e visto pelo escritório não volta atrás com um
Ctrl+Z local.

## Testes

`apps/web/src/office/editing/decorationDoc.test.ts`:

- acrescentar mobília numa célula ocupada mantém as duas, na ordem de inserção
- remover o topo preserva a peça de baixo
- remover numa célula sem `tile-object` limpa o tile legado da tile layer
- `pruneUnusedTilesets` preserva tileset referenciado só por `tile-object`

`apps/web/src/office/editing/useOfficeMapEditing.test.ts`:

- `save()` mantém `active: true` e zera `dirty`/`canUndo`
- `save()` não libera o lock nem para o heartbeat
- `paintAt` recusa a pincelada que passaria de `maxObjects`

## Riscos

**Lock retido por mais tempo.** Quem edita e salva agora segue segurando o mapa
até fechar o drawer. Mitigado pelo heartbeat de 30s já existente e pelo cleanup de
unmount (`useOfficeMapEditing.ts:568-579`), que libera o lock se a tela for
fechada sem Cancelar. O comportamento é equivalente ao de quem hoje demora para
salvar.

**Consumo do teto de 2000.** Pintura arrastada consome objetos rápido. Coberto
pelo aviso em `paintAt`; se virar atrito real, o passo seguinte é agrupar o bloco
`cols × rows` num objeto só — o que hoje a validação de `tile-object` não permite
(largura fixa em 1 tile) e ficaria para uma mudança de schema.
