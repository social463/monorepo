# Design — Edição colaborativa do mapa do escritório

- **Data:** 2026-07-20
- **Branch:** `feat/mapa-colaborativo-tempo-real`
- **Escopo:** editor de **decoração in-office** (não o editor estrutural de admin)

## Objetivo

Permitir que **mais de uma pessoa edite o mapa do escritório ao mesmo tempo**. Hoje um
lock exclusivo (`OfficeMapEditLock` → `423 MAP_LOCKED`) garante um único editor por
mapa. A feature remove esse gargalo: vários membros editam em paralelo e as mudanças
de cada um se combinam por **merge no momento do save**, preservando o trabalho de todos.

## Decisões de produto (validadas no brainstorming)

1. **Nível de tempo real:** *sincroniza ao salvar* — não é multiplayer célula-a-célula.
   Cada editor trabalha no seu documento local; ao salvar/publicar, as mudanças se
   propagam para os demais (reusando o broadcast `map-decor-updated` que já existe).
2. **Conflito:** *mesclar (rebase das operações)* — os trabalhos coexistem; só há
   conflito real quando dois editam **o mesmo objeto**.
3. **Editor no escopo:** apenas o **editor de decoração in-office**.
4. **Presença:** mostrar uma **lista leve de quem mais está editando** (sem cursores ao vivo).

## Motor de merge: merge 3-vias por `id` (abordagem ①)

Escolhida sobre (② log de operações — exigiria camada de captura de ops e refatorar os
mutadores, hoje baseados em posição; ③ CRDT — overkill para "sincroniza ao salvar").

O documento (`MapDocumentV1`) já é imutável e cada objeto tem `id` estável
(`obj-<timestamp>-<contador>`, gerado no cliente). Ids de objetos novos **nunca colidem**
entre editores → adições sempre coexistem. Isso viabiliza um merge por conjunto, keyed
por `object.id`, reaproveitando o diff-por-id que o `repaintOverlays` já faz.

### Função pura `mergeDecoration(base, mine, theirs) → merged`

- `theirs` = documento publicado **mais recente** (ponto de partida do merge).
- diff do editor = `mine` vs `base`:
  - **adicionados** (id em `mine`, ausente em `base`) → acrescenta ao fim de `theirs`
    (preserva empilhamento; ids novos não colidem).
  - **removidos** (id em `base`, ausente em `mine`) → remove de `theirs` se ainda existir.
  - **alterados** (id em ambos, `geometry`/`properties` diferentes) → aplica minha versão
    sobre `theirs`. Se `theirs` também alterou o **mesmo** objeto → **último a salvar vence**
    (o que está salvando). Único caso de conflito real.
  - **intocados por mim** → mantém `theirs` (preserva o trabalho dos outros).
- Ordem final: objetos de `theirs` na ordem preservada + meus adicionados no fim.

Local proposto: `apps/api/src/lib/office-map-merge.ts` (puro, testável isolado).

## Backend

### Endpoint

Novo endpoint de membro, protegido por `requireFeature('escritorio')`, que substitui o
fluxo `draft → publish` para a decoração colaborativa:

```
POST /office/map/edit/merge-publish
body: { baseVersion: number, document: MapDocumentV1 }
resp: { version: number, document: MapDocumentV1 }   // documento já mesclado
```

Fluxo no service:

1. Carrega `theirs` = publicação ativa mais recente do mapa.
2. Carrega `base` = `OfficeMapPublication.mapData` da `baseVersion` informada.
   - Se a publicação-base foi **podada/não existe** → fallback para **merge 2-vias**
     (`base = theirs`; aplica só minhas adições/edições). Nunca falha o save por isso.
3. `merged = mergeDecoration(base, mine=document, theirs)`.
4. Reaplica `assertOnlyDecorationChanged(merged)` → `403 STRUCTURAL_EDIT_FORBIDDEN` se
   algo estrutural vazou; validação semântica + `MAP_DOCUMENT_V1_LIMITS` existentes → `400`.
5. Publica com **`soft: true`** (reusa `publishOfficeMap`): nova `OfficeMapPublication`
   (version++), dentro da transação **Serializable** já existente — o segundo save
   concorrente enxerga a publicação do primeiro como `theirs`. Dispara
   `broadcastMapDecorUpdated` (já existe).
6. Retorna `{ version, document: merged }`.

### Lock e draft

- O **lock exclusivo** deixa de ser exigido neste fluxo (some o `423 MAP_LOCKED`). A
  presença de editores passa a ser via WS (abaixo).
- O **draft compartilhado** (`OfficeMapDraft`) **não é mais tocado** pela decoração
  colaborativa — evita o `409 DRAFT_REVISION_CONFLICT` entre editores concorrentes.
- As rotas/lógica de lock e draft permanecem para o **editor estrutural de admin**, que
  está fora do escopo desta feature.

## Presença de editores (via WS existente)

Reaproveita `/office/ws` + `office-hub` (sem socket novo; estado efêmero em memória).

### Contrato (`packages/shared/src/office.ts`)

- Client → server: `{ type: 'set-editing', editing: boolean }`.
- Server → clients: `{ type: 'editors-changed', editors: Array<{ id, name }> }`.

### Hub (`apps/api/src/lib/office-hub.ts`)

- Mantém um `Set` de `userId` em modo de edição.
- Ao receber `set-editing` → adiciona/remove o ocupante e faz broadcast `editors-changed`.
- Na desconexão (`left`) → remove do set automaticamente.
- Sem heartbeat próprio (piggyback no heartbeat de presença existente).

### Frontend

- `useOfficeMapEditing.enter()` → envia `set-editing: true`; `exit()` / `save()`-sem-sair
  encerrado / unmount → `set-editing: false`.
- `useOfficeSocket` / `OfficeBridge` expõem a lista `editors`; indicador leve (no
  `OfficeEditDrawer` ou `SelectionToolbar`): "Fulano e Ciclana também estão editando".
  Não conta o próprio usuário.

## Frontend — fluxo de edição

Muda em: `useOfficeMapEditing.ts`, `decorationApi.ts`, `session/mapMessage.ts` /
`OfficeSessionContext.tsx`.

- **`enter()`** — não adquire mais o lock exclusivo. Carrega o mapa ativo, guarda
  `baseVersion` (a `version` da publicação carregada) em `baseVersionRef`, emite
  `set-editing: true`. Undo, `repaintOverlays`, atalhos (girar/espelhar/apagar/empilhar)
  seguem **iguais**, operando no `documentRef` local.
- **`save()`** — troca `saveDecorationDraft` + `publishDecoration` por **um** round-trip
  `mergePublish({ baseVersion, document })`. Na resposta:
  - `documentRef.current = merged`, `baseDocRef = merged`, `baseVersionRef = version`.
  - Recalcula overlays/cena a partir de `merged` — o canvas passa a refletir o trabalho
    de todos após salvar.
- **`decorationApi.ts`** — nova função `mergePublish`; aposenta lock +
  `saveDecorationDraft`/`publishDecoration` **deste fluxo** (mantidas se o editor
  estrutural ainda as usa).
- **Reação a `map-decor-updated`** (`mapMessageEffect`):
  - Ocupante **sem editar** → `refetch` (como hoje).
  - Ocupante **editando com alterações locais (`dirty`)** → **não** faz refetch/reload
    (apagaria trabalho não salvo). Registra aviso leve ("o mapa foi atualizado; suas
    mudanças serão mescladas ao salvar"); o merge do próximo `save()` reconcilia via
    `baseVersion`. `mapMessageEffect` recebe `isEditing/dirty` e retorna `ignore-notify`
    nesse caso. O save é HTTP e não depende do WS.

## Casos de borda

- **Dois estampam a mesma célula** → ids distintos, ambos empilhados. Sem conflito.
- **Um apaga o objeto que o outro move (mesmo `id`)** → conflito real; último a salvar
  vence. Aceitável no modelo.
- **Save simultâneo** → `theirs` lido na transação Serializable; o segundo mescla sobre
  a publicação do primeiro. Sem clobber.
- **`baseVersion` podada/inexistente** → fallback merge 2-vias.
- **Vazou estrutural** → `403 STRUCTURAL_EDIT_FORBIDDEN`; cliente não perde o rascunho.
- **Doc inválido / excede limites** → `400` com `issues`.
- **WS cai editando** → presença some para os outros (`left`); ao reconectar reemite
  `set-editing: true`. Save (HTTP) continua funcionando.
- **Convidado/terceirizado** → mesmas restrições de feature/guest já aplicadas por
  `/office/ws` e pelas rotas de decoração.

## Testes

- **API (Vitest + Postgres real):**
  - `office-map-merge.test.ts` — unitário puro de `mergeDecoration`: adições coexistem,
    remoções, alterado-vs-alterado (last-write), ordem/empilhamento, fallback 2-vias.
  - Rota `merge-publish` — dois editores concorrentes (ambos os trabalhos na publicação
    final); guarda estrutural `403`; base podada → fallback.
  - `office-hub` — `set-editing`/`editors-changed` (add/remove, remoção no disconnect).
- **Web (jsdom + Testing Library):**
  - `mapMessage.test.ts` — editor `dirty` → `ignore-notify`; não-editor → `refetch`.
  - `useOfficeMapEditing` — novo `save()` chama `mergePublish`, re-ancora
    `baseVersion`/`baseDoc`.
  - Render do indicador de editores.

Testes escritos/atualizados junto da implementação; arquivos afetados rodados durante o
trabalho; suíte completa (`pnpm db:up` + `pnpm test`) como verificação final.

## Contrato compartilhado a alterar (`packages/shared`)

- `packages/shared/src/office.ts` — novas mensagens WS `set-editing` (client) e
  `editors-changed` (server).
- Tipos do payload de `merge-publish` (request/response), se convier expô-los no shared.

## Fora de escopo

- Multiplayer célula-a-célula / cursores ao vivo.
- Editor estrutural de admin (mantém lock exclusivo + fluxo draft/publish).
- CRDT / resolução de conflito a nível de sub-objeto.
