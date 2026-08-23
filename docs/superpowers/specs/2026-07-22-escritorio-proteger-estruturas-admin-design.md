# Design — Proteger estruturas do admin no escritório

Data: 2026-07-22
Branch: `feat/escritorio-proteger-estruturas-admin`

## Problema

No runtime do escritório existe a edição **"mobília livre"**: qualquer membro com a
feature `escritorio` entra em modo de edição e, pelas ferramentas do `OfficeEditDrawer`
(Mobília, Borracha, Colisão, Silêncio, Chamada, Link), **cria e apaga** objetos do mapa.
A rota que persiste isso é `member` (`requireFeature('escritorio')`), **não** `requireAdmin`.

A única barreira hoje é o guard `assertOnlyDecorationChanged`
(`packages/shared/src/office-map.ts`), que só trata como **estrutural** (intocável pelo
comum): metadados do mapa, topologia de layers, a tile layer `walls` (paredes) e os
objetos `spawn-point`.

Consequência: **um usuário comum consegue apagar piso, colisões, zonas, links e toda a
mobília — inclusive a que o admin criou.** Queremos impedir que o comum apague/altere as
**estruturas criadas pelo admin**, sem tirar dele a mobília livre.

## Decisões (fechadas no brainstorming)

1. **Ownership por objeto** (`createdBy`), não baseline-diff nem lockdown por categoria.
2. **Mobília livre segue para o comum** — ele continua criando/gerenciando o que é dele;
   só não toca no que é do admin. A edição **não** vira admin-only.
3. **Modelo comunal** — um comum pode apagar/editar mobília de **outro comum**; apenas o
   que o **admin** criou fica blindado.

## Regra de proteção (o coração)

Um ator **não-admin** só pode **remover ou modificar** um objeto do mapa se ele for
**member-tier**. Um objeto é **protegido** (intocável pelo comum) quando:

- foi criado por um **admin** (`createdBy.role === 'ADMIN'`), **ou**
- é **legado**: não tem `createdBy` (todo objeto já publicado hoje). Backfill
  conservador — não dá para saber quem criou o que já existe, então tratamos como do
  admin/protegido.

Formalmente: `protegido(obj) := obj.createdBy == null || obj.createdBy.role === 'ADMIN'`.

- **Admin** faz tudo (bypass de ownership).
- **Comum** **adiciona** objetos livremente; pode remover/modificar qualquer objeto
  **member-tier** (o próprio ou de outro comum); **não** pode remover/modificar objeto
  protegido.

`UserRole` = `LEGEND | LEAD | MANAGER | HEAD | ADMIN | THIRD_PARTY`; "admin" = `role === 'ADMIN'`.

## Arquitetura

Fluxo mantém as camadas do repo: **route (fina) → service → guard puro em `@legends/shared`**.

### 1. `packages/shared/src/office-map.ts`

- **`createdBy` no `ObjectBaseShape`** (base de todo objeto, **fora** do
  `properties.strict()` de cada tipo, para não editar os nove schemas por tipo):

  ```ts
  createdBy: z.object({ id: z.string().min(1), role: UserRoleSchema }).nullish()
  ```
  (`id` é o id de usuário — `z.string()`, não precisa casar com `MapIdentifierSchema`.)

  Opcional/nullable — mapas publicados antes desta feature continuam válidos (ausente =
  protegido). `UserRoleSchema` já existe/derivado do enum compartilhado; se não houver um
  schema Zod para `UserRole`, criar um `z.enum` com os valores do enum.

- **Piso vira estrutural:** `STRUCTURAL_LAYER_KEYS = ['walls', 'floor']`.
  A tile layer **`objects` fica de fora** — o eraser legado do membro
  (`useOfficeMapEditing.eraseAt`, caminho sem mobília empilhada) escreve nela via
  `stampTile(doc, 'objects', …)`. `floor` o eraser **nunca** toca, então torná-lo
  estrutural é seguro e cobre "piso" sem quebrar o eraser.

- **`assertOnlyDecorationChanged(previous, next, actor?)`** ganha o parâmetro
  `actor?: { isAdmin: boolean }`:
  - Checagens **estruturais** (metadata, topologia de layers, `walls`+`floor`,
    `spawn-point`) rodam **sempre**, para todos.
  - Se `actor` presente e `actor.isAdmin === false`, adiciona a checagem de **ownership**:
    para cada objeto que foi **removido** (id em `previous`, ausente em `next`) ou
    **modificado** (id em ambos, assinatura diferente), se `protegido(previous_obj)` →
    violação. Códigos: `PROTECTED_OBJECT_REMOVED` e `PROTECTED_OBJECT_MODIFIED`, com
    `path: objects.<id>`.
  - Sem `actor`, ou `actor.isAdmin === true` → **sem** checagem de ownership (preserva o
    admin editor e o caminho admin da rota member). Assinatura retrocompatível: os
    chamadores atuais que não passam `actor` mantêm o comportamento de hoje.
  - "Modificado" reusa a comparação por objeto já existente (ver `sameDecorObject`).

- **`mergeDecoration`** preserva `createdBy` (herda do objeto vencedor; nenhum caminho do
  merge deve zerar o campo).

### 2. `apps/api`

Rotas finas em `apps/api/src/routes/office-maps.ts` (bloco `member`) passam o ator ao
service: `{ id: request.user.sub, role: request.user.role }`.

Service `apps/api/src/services/office-map-service.ts`
(`saveOfficeDecorationDraft`, `publishOfficeDecoration`, `mergeAndPublishDecoration`):

- **Carimba `createdBy`** (`{ id, role }` do ator) em todo objeto **novo** (id ausente no
  documento ativo/base). O **server é a autoridade**: sobrescreve `createdBy` dos objetos
  novos com o ator real e **ignora** o valor vindo do cliente — impede um comum forjar
  `role: 'ADMIN'` ou a identidade de outro.
- Chama `assertOnlyDecorationChanged(prev, next, { isAdmin: role === 'ADMIN' })`. Violação
  → **erro de domínio tipado** com `status: 403` (padrão `VoteError` do repo), com
  `message` em pt-BR e as `violations`; a rota faz `instanceof` e responde `err.status`.
- Admin na rota member: `isAdmin === true` → bypass de ownership (estrutural continua
  responsabilidade do admin editor).

Nota: o role já vem no JWT (`request.user.role`), então o service não precisa de lookup
extra no banco.

### 3. `apps/web`

Objetivo: **não deixar o comum construir uma edição que o server vai recusar** (senão ele
perde trabalho num publish 403).

- `useOfficeMapEditing.ts` / `decorationDoc.ts`: para ator **não-admin**, **pular objetos
  protegidos** nas operações destrutivas/de mudança:
  - eraser (`eraseAt` → `removeTopTileObjectAt`, `topErasableObjectAtPixel`),
  - select/mover (ferramenta "Girar"/drag),
  - `clearAllFurniture` e apagar em retângulo (`removeDecorationObjectsInRect`) — não
    remover objetos protegidos.
  O objeto do admin fica "travado" para o comum.
- **Carimbo otimista**: objetos novos criados pelo comum recebem `createdBy` local
  (`{ id, role }` do usuário logado) para consistência de UI; o server reescreve na
  publicação (autoridade).
- Ator (id + `isAdmin`) vem do `AuthContext`.
- **Feedback visual leve** no objeto protegido para o comum (ex.: cadeadinho ao passar a
  borracha / rejeitar a borrachada sem erro barulhento) — refinamento a detalhar no plan.

### 4. Testes (Vitest, colocados ao lado)

- **shared** (`office-map.*.test.ts`): comum remove objeto protegido → viola; remove
  objeto member-tier → ok; admin → ok; modificar protegido → viola; adicionar → ok; piso
  na layer estrutural bloqueia edição de `floor` pelo comum.
- **api** (`office-map-service.test.ts`): comum apaga objeto do admin → 403; comum apaga
  objeto de **outro comum** → ok; admin apaga qualquer coisa → ok; objeto novo publicado
  por comum nasce com `createdBy = { id: comum, role }`; tentativa de forjar
  `role: 'ADMIN'` no objeto novo é sobrescrita pelo server.
- **web** (`useOfficeMapEditing.test.ts`): eraser/mover pula objeto protegido para comum;
  passa para admin.

## Fora de escopo

- **Reclassificar mobília já publicada**: todo objeto legado (sem `createdBy`) fica
  protegido. Não há migração de dados reatribuindo autoria.
- **Admin editor**: objetos novos criados lá nascem sem `createdBy` = já protegidos; não
  precisamos alterar o editor admin. (Opcional futuro: carimbar `role: 'ADMIN'` explícito.)
- **Tile layer `objects`**: permanece editável pelo comum (caminho legado do eraser); não
  entra no conjunto estrutural.

## Riscos / notas

- **Perda de trabalho no 403**: mitigado pelo espelhamento client-side da regra (o comum
  nem chega a montar a remoção proibida). O guard do server é a rede de segurança.
- **`createdBy` fora de `properties`**: fica no nível do objeto (base), então cada
  `MapObjectV1Schema` por tipo herda o campo sem tocar nos `properties.strict()`
  individuais. Conferir que a serialização/`canonicalDocument` não descarta o campo.
- **Contrato primeiro**: alterar o tipo em `@legends/shared` antes de api/web (fonte única).
