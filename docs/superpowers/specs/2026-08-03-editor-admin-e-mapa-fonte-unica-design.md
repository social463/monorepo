# Escritório — editor do admin e mapa param de se sobrescrever

**Data:** 2026-08-03
**Status:** aprovado

## Problema

O mesmo mapa tem **dois documentos independentes** e nada propaga um para o outro:

| Onde | Fonte | Quem escreve |
|---|---|---|
| Editor do admin (`MapEditor`) | `OfficeMapDraft.document` + `revision` | `saveOfficeMapDraft` → `publishOfficeMap` |
| Edição no mapa (`useOfficeMapEditing`) | `OfficeMapPublication.mapData` + `decorRevision` | `mergeAndPublishDecoration` |

O merge 3-vias que existe (`mergeDecoration`) protege **decorador contra
decorador**. O admin está fora dele — o que o spec de 2026-07-30 registrou como
fora de escopo. Resultado: quem grava por último apaga o trabalho do outro, nas
duas direções.

**A. O publish do admin apaga a decoração.** O editor abre o draft congelado no
último publish; toda decoração feita desde então só existe em `mapData`.
`publishOfficeMap` materializa o draft cru como novo `mapData` e a decoração
some. Não exige simultaneidade — basta o admin publicar depois de alguém decorar.

**B. O save no mapa reverte o publish.** Publicação nova nasce com o anel de
revisões vazio e `decorRevision = 0`. O editor in-map ancorado na publicação
ANTERIOR não acha a base (ou pior: bate por coincidência numérica em `0`) e cai
no 2-vias com `base = theirs`. Em `mergeDecoration`, todo objeto de `theirs`
ausente de `mine` entra em `removedByMe` — tudo que o admin publicou é apagado.

## Decisão

O draft do mapa ativo passa a ser uma **rebase sobre o `mapData` vivo**, e o
publish do admin **mescla** em vez de sobrescrever. O merge de decoração ganha um
modo **aditivo** para quando a base é desconhecida.

### Âncora no draft

`OfficeMapDraft` ganha `basePublicationId String?` e `baseDecorRevision Int?`:
de onde aquele documento foi semeado. É o análogo, do lado do admin, do
`baseRevision` que o editor in-map já carrega.

### Rebase

`rebaseDraftOnActive(draft, companyId)` — `base` = snapshot do anel em
(`basePublicationId`, `baseDecorRevision`), com fallback para o próprio draft
quando não há âncora ou o anel já podou; `mine` = documento do draft; `theirs` =
`mapData` da publicação ativa. Roda em dois pontos:

1. **Ao abrir o draft** (`getOfficeMapDraft`), quando o mapa é o da publicação
   ativa: o admin passa a ver a decoração real em vez de um mapa congelado.
2. **No publish** (`publishOfficeMap`): pega o que foi decorado durante a sessão.

Estrutura (`map`, topologia de `layers`, `schemaVersion`) vem de `mine` — o admin
é a autoridade estrutural, ao contrário do merge de decoração, que herda de
`theirs`. É a diferença entre `mergeAdminDraft` e `mergeDecoration`; o núcleo de
objetos (`mergeObjectsById`) é o mesmo nos dois.

Redimensionar o mapa muda o tamanho de `data` das tile layers e cai no fallback
"mantém a layer de `mine`": o admin ganha e a pintura in-map daquela camada se
perde. É inevitável ao redimensionar e é o lado seguro (o admin vê o que fez).

### Publish devolve o documento

`publishOfficeMap` passa a devolver `document` (o mesclado). O `MapEditor` adota
o resultado e re-ancora. Sem isso, o próximo autosave do editor aberto — que
manda o documento local inteiro — apagaria de novo o que a rebase acabou de
trazer.

### Merge aditivo

`mergeDecoration(base, mine, theirs, { additive })`. Com `additive: true`,
`removedByMe` fica vazio: o save adiciona e atualiza, nunca remove.

`mergeAndPublishDecoration` passa a receber `basePublicationId` e usa o modo
aditivo quando a âncora do cliente **não é** a publicação ativa, ou quando o
snapshot do anel não existe. Cobre os dois caminhos da direção B, inclusive a
colisão numérica em `decorRevision = 0` entre publicações diferentes.

O preço do aditivo é uma peça que o decorador apagou localmente reaparecer —
perda de um clique, recuperável. O 409 alternativo faria ele perder a sessão de
edição inteira, e o 2-vias atual destrói o mapa publicado.

## Contrato

- `OfficeMapDraftDTO` ganha `basePublicationId`/`baseDecorRevision` (informativo).
- `POST /office/map/edit/merge-publish` aceita `basePublicationId` opcional;
  ausente = trata como âncora desconhecida (aditivo).
- `POST /admin/office-maps/:id/publications` devolve `document`.

## Testes

- `office-map.test.ts` (shared): `mergeAdminDraft` mantém estrutura de `mine` e
  preserva objeto exclusivo de `theirs`; `mergeDecoration` aditivo não remove.
- `office-map-service.merge.test.ts`: publish do admin preserva decoração feita
  depois que o draft foi aberto (direção A); save in-map ancorado em publicação
  antiga não apaga o que o admin publicou (direção B); abrir o draft do mapa
  ativo traz a decoração vinda do `mapData`.
