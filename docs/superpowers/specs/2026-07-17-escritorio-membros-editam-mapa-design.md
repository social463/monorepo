# Edição de mapa por membros + tilesets default bundled

**Data:** 2026-07-17
**Status:** aprovado (design)
**Branch:** `feat/escritorio-membros-editam-mapa`

## Objetivo

Permitir que **usuários normais** (não-admin) editem o escritório em decoração —
mobília e áreas (silêncio/`private-zone`, chamada/`meeting-room`, `link`,
`action-point`, `collision`, `door`) — direto na cena viva do escritório, via um
modo de edição com side drawer. Edição de **estrutura** (tamanho do mapa,
tileSize, `backgroundColor`, topologia de layers, tiles de `walls`, `spawn-point`)
continua exclusiva do admin.

Em paralelo, embutir os tilesets do LimeZu Modern Interiors como **tilesets
default por tema**, disponíveis globalmente nos dois editores (admin e membro).

O spec do editor admin existente é
`docs/superpowers/specs/2026-07-15-escritorio-editor-mapas-design.md`; este
estende aquele sistema sem quebrá-lo.

## Fronteira estrutura × decoração (segurança no servidor)

O cliente envia o **documento inteiro** no save. A UI apenas esconde ferramentas;
a trava real é um diff no servidor.

| Categoria | Itens |
|---|---|
| **Decoração** (membro + admin) | tiles nas layers `objects`/`floor`; `tile-object` (mobília); objetos `private-zone`, `meeting-room`, `link`, `action-point`, `collision`, `door` |
| **Estrutura** (só admin) | `map.width`, `map.height`, `map.tileWidth`, `map.tileHeight`, `map.backgroundColor`; add/remove/reorder/tipo/zIndex de layers; tiles na layer `walls`; objetos `spawn-point` |

`assertOnlyDecorationChanged(prevDoc, nextDoc)` vive em `@legends/shared`
(`packages/shared/src/office-map.ts`, junto às validações existentes). Compara:

- Todos os campos de `map.*` — qualquer delta ⇒ estrutural.
- Conjunto de layers por identidade/`key`/`type`/`zIndex`/ordem — qualquer
  add/remove/reorder/mudança ⇒ estrutural.
- `data[]` da layer `walls` — qualquer célula alterada ⇒ estrutural.
- Objetos `spawn-point` (por `key`/geometria/props) — qualquer delta ⇒ estrutural.

Objetos `collision` e `door` **não** entram no diff estrutural (viram decoração,
por decisão de produto). Retorna `{ ok: true }` ou
`{ ok: false, violations: MapStructuralViolation[] }` para o servidor traduzir em
403. Objetos e tiles de decoração podem mudar livremente.

## Onde se edita — modo edição na `OfficeScene`

Sem rota full-screen nova. Dentro do escritório (Phaser rodando):

- Botão **"Editar mapa"** na barra do escritório (`apps/web/src/office/…`),
  visível a **todo autenticado**.
- Ao ativar: adquire o **lock existente** do mapa ativo (`OfficeMapEditLock`,
  TTL 2 min + heartbeat de 30 s), a `OfficeScene` entra em **modo edição** e abre
  um **side drawer** à direita.
- **Side drawer** contém: palette de mobília por categoria (catálogo bundled +
  assets do mapa), botões de área (silêncio = `private-zone`, chamada =
  `meeting-room`), `link`, `action-point`, `collision`, `door`, e borracha.
- Edição **WYSIWYG local**: o membro pinta tiles / desenha retângulos (zonas,
  collision) / marca pontos (link, action-point, spawn não) e vê o resultado na
  cena real — **somente ele**, num documento em memória — até **Salvar**.
- **Salvar** publica (item “Propagação”) e sai do modo edição soltando o lock.
  **Cancelar** descarta o documento local e solta o lock.

### Reuso vs. novo

A `OfficeScene` (`apps/web/src/office/scenes/OfficeScene.ts`) ganha uma **camada
de edição** opcional: pointer handlers de stamp de tile (grid-snap na layer
`objects`), desenho de retângulo (zonas/collision) e ponto (link/action/door),
com preview. A geometria/serialização reaproveita helpers já usados por
`MapCanvas` e `@legends/shared` (conversão pixel↔tile, criação de objetos). Nada
de segunda instância Phaser: edita-se na cena viva.

O side drawer é um componente React novo (`OfficeEditDrawer`), montado ao lado do
overlay do escritório, dirigido por um hook de estado de edição
(`useOfficeMapEditing`) que mantém o documento local, undo/redo simples, dirty
flag e o ciclo de lock/heartbeat/save.

## Propagação no Salvar — refresh suave

O publish do admin faz `officeHub.configure(runtime, /*disconnect*/ true)` →
desconecta todos, reposiciona no spawn e reconecta LiveKit. Para decoração isso é
desnecessário (colisão andável, salas e spawn não mudaram em termos de
walkability). Save de membro é **decoração-only**, então:

- Publicação materializa a nova publicação ativa normalmente (snapshot + assets +
  `OfficeRoom` por `externalKey`, reaproveitando `publishOfficeMap`/rooms).
- Em vez do caminho pesado, usa `officeHub.configure(runtime, /*disconnect*/ false)`
  **+ um evento novo `map-decor-updated`** no socket do escritório
  (`apps/api/src/lib/office-hub.ts`, `apps/api/src/routes/office-ws.ts`).
- Clientes reagem ao `map-decor-updated` **refazendo só as tile layers e os
  overlays de zona** (refetch `/office/map`, rebuild em `OfficeScene`), **sem**
  desconectar do LiveKit nem teleportar.
- Publicação do admin que **contém** delta estrutural continua no caminho pesado
  atual (`map-changed` + reload). A escolha do caminho é decidida no servidor
  comparando a publicação nova com a ativa (decoração-only ⇒ suave).

## Tilesets default bundled (por tema)

Padrão do `scripts/vendor-lpc.mjs` → catálogo gerado em `@legends/shared`.

- **`scripts/vendor-tilesets.mjs`**: lê os zips do LimeZu Modern Interiors
  (**versão full**), seleciona os spritesheets de interiores/escritório e fatia os
  “singles” por tema; escreve PNGs em
  `apps/web/public/office/tilesets/<tema>/…` e gera
  `packages/shared/src/office-tileset-catalog.json` com, por tileset:
  `id` (`builtin:office/<slug>`), `url`, `name`, `category`/tema, `tileWidth`,
  `tileHeight`, `columns`, `tileCount`, `credits`. Um
  `packages/shared/src/office-tileset-catalog.ts` re-exporta tipado (barril em
  `index.ts`).
- **Licença/créditos:** só a **versão full** (asset-1/3/4). A **versão free
  (asset-2) fica de fora** (licença não-comercial). Créditos obrigatórios
  gerados em `apps/web/public/office/tilesets/CREDITS.txt` (limezu.itch.io).
- **Assets globais (fora do escopo por-mapId):** builtin ganham `assetId`
  `builtin:office/<slug>`. `assetUrl()`
  (`apps/api/src/services/office-map-service.ts`) e a checagem de dimensões em
  `validateDocument` reconhecem `assetId` do catálogo **sem** exigir linha em
  `OfficeMapAsset`. Uploads por-mapId continuam iguais. Nenhuma migração de dados
  necessária para os builtin (resolução em memória a partir do catálogo).
- **Palette (admin + membro):** mescla catálogo bundled + assets do mapa,
  agrupado por categoria/tema (grupos colapsáveis).

## API & concorrência

- Rotas admin `/admin/office-maps/*` **intactas**.
- Nova superfície enxuta de membro, mirando **sempre o mapa ativo**, só
  `app.authenticate` (`apps/api/src/routes/office-maps.ts` ou arquivo dedicado):
  - `POST /office/map/edit/lock` (+ `…/heartbeat`, + `DELETE …/lock`) — reaproveita
    `acquireOfficeMapLock` no mapa ativo.
  - `PUT /office/map/edit/draft` — salva draft **após** `assertOnlyDecorationChanged`
    (403 `STRUCTURAL_EDIT_FORBIDDEN` se violar); demais erros idênticos ao admin
    (423 lock, 409 revisão, 422 documento inválido).
  - `POST /office/map/edit/publish` — publica decoração-only (caminho suave).
- **Lock único por mapa** (`OfficeMapEditLock.mapId @unique`) já garante
  serialização: enquanto um membro/admin edita, outro recebe 423 com dono +
  `expiresAt`. Sem edição colaborativa simultânea (CRDT segue fora de escopo).
- Serviço: funções dedicadas (`saveOfficeDecorationDraft`,
  `publishOfficeDecoration`) que resolvem o mapa ativo, chamam o guard e
  reaproveitam publish/rooms existentes.

## Testes

- **Shared** (`assertOnlyDecorationChanged`): aceita mobília/`private-zone`/
  `meeting-room`/`link`/`action-point`/`collision`/`door`; rejeita `walls` data,
  `spawn-point`, dims, `backgroundColor`, add/remove/reorder de layers.
- **API**: membro publica decoração e vira publicação ativa; delta estrutural ⇒
  403; respeita lock ⇒ 423; catálogo bundled valida sem linha em `OfficeMapAsset`.
- **Web**: botão "Editar mapa" abre drawer para membro; toolbar sem ferramentas
  estruturais; stamp/erase e desenho de zona/collision atualizam o doc local;
  Salvar chama publish; palette agrupa catálogo + assets do mapa.

## Fora de escopo

- Colaboração simultânea / CRDT.
- Edição estrutural por membro (dims, tileSize, walls, spawn, layers,
  backgroundColor).
- Upload de tileset próprio por membro (usa só bundled + assets já no mapa).
- Assets de personagem do asset-4 e a versão free (asset-2).
- Broadcast por-pincelada (edição é local até Salvar).
