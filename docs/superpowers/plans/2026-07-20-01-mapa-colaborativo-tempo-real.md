# Edição colaborativa do mapa do escritório — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que vários membros editem a decoração do mapa do escritório ao mesmo tempo, mesclando as mudanças de cada um no momento do save.

**Architecture:** Remove o lock exclusivo do editor de decoração. O save deixa de passar pelo draft compartilhado e passa por um novo endpoint `merge-publish` que, dentro da transação Serializable de publicação, mescla (3-vias por `id` de objeto) o documento do editor contra a publicação mais recente. A presença de "quem está editando" reaproveita o WebSocket de presença já existente.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite + React 18 + Phaser (web), `@legends/shared` (contrato), Vitest.

## Global Constraints

- TypeScript **strict**, ESM puro, Node ≥ 20 (dev usa o binário do Node 20 — ver memória do projeto).
- Mensagens ao usuário em **português**.
- Contrato api⇄web muda **primeiro** em `@legends/shared`, depois os dois lados.
- Route fina → service (regra de negócio) → Prisma. DTO em `serialize.ts`/schemas do shared.
- Testes colocados ao lado do código (`*.test.ts(x)`). API testa contra Postgres real (`pnpm db:up` antes).
- Erros de domínio do office usam `OfficeMapError` (classe com `status`/`code`); a rota deixa propagar (há error handler global).
- **Nunca** editar migration já aplicada. (Esta feature **não** exige migration — todo estado novo é efêmero, em memória.)
- Rodar só o(s) arquivo(s) de teste alterados durante o trabalho; suíte completa (`pnpm test`) só na verificação final.

---

## Estrutura de arquivos

**Criar:**
- (nenhum arquivo novo de produção — as funções novas entram em arquivos existentes)

**Modificar:**
- `packages/shared/src/office-map.ts` — nova função pura `mergeDecoration`.
- `packages/shared/src/office.ts` — mensagens WS `set-editing` (client) e `editors-changed` (server); campo `editorUserIds` em `welcome`.
- `apps/api/src/services/office-map-service.ts` — extrai helper `materializePublication`; nova função `mergeAndPublishDecoration`.
- `apps/api/src/routes/office-maps.ts` — nova rota `POST /office/map/edit/merge-publish`.
- `apps/api/src/lib/office-hub.ts` — presença de edição (`setEditing`, set `editingActive`, `welcome`, `leave`, `configure`).
- `apps/api/src/routes/office-ws.ts` — dispatch de `set-editing`.
- `apps/web/src/office/OfficeBridge.ts` — `editingActiveIds`, flag `editingDirty`, snapshot.
- `apps/web/src/office/useOfficeSocket.ts` — expõe `editorUserIds`.
- `apps/web/src/office/editing/decorationApi.ts` — `getActiveMapForEditing`, `mergePublish`.
- `apps/web/src/office/editing/useOfficeMapEditing.ts` — `enter()`/`save()` sem lock, com `baseVersion`.
- `apps/web/src/office/session/mapMessage.ts` — efeito ciente de edição-suja.
- `apps/web/src/office/session/OfficeSessionContext.tsx` — passa `bridge.isEditingDirty()` ao efeito.
- `apps/web/src/pages/OfficePage.tsx` — envia `set-editing`, seta `editingDirty`, indicador de editores + aviso.
- `apps/web/src/office/editing/EditorsPresence.tsx` (**criar**) — indicador leve de quem está editando.

**Arquivos de teste:**
- `packages/shared/src/office-map-decoration.test.ts` (adicionar casos de `mergeDecoration`)
- `apps/api/src/services/office-map-service.merge.test.ts` (**criar**)
- `apps/api/src/lib/office-hub.test.ts` (adicionar casos de `set-editing`)
- `apps/web/src/office/OfficeBridge.test.ts` (adicionar casos de `editors-changed`)
- `apps/web/src/office/session/mapMessage.test.ts` (adicionar casos edição-suja)
- `apps/web/src/office/editing/EditorsPresence.test.tsx` (**criar**)

---

## Task 1: `mergeDecoration` (merge 3-vias por id) — `@legends/shared`

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Test: `packages/shared/src/office-map-decoration.test.ts`

**Interfaces:**
- Consumes: `MapDocumentV1`, `MapObjectV1`, `MapTilesetV1` (já exportados do mesmo arquivo).
- Produces: `mergeDecoration(base: MapDocumentV1, mine: MapDocumentV1, theirs: MapDocumentV1): MapDocumentV1`.

Regras (documentadas no spec): parte de `theirs`; aplica minhas remoções e alterações por `id`; acrescenta meus objetos novos ao fim (empilhamento); `theirs` vence em conflito no mesmo objeto **exceto** quando eu alterei (último a salvar = eu). Estrutura (`map`/`layers`/`schemaVersion`) sempre de `theirs`; `tilesets` = união por id.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `packages/shared/src/office-map-decoration.test.ts`:

```ts
import { mergeDecoration } from './office-map'
import type { MapDocumentV1, MapObjectV1 } from './office-map'

function tileObj(id: string, x: number, y: number, tileIndex = 0): MapObjectV1 {
  return {
    id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: { kind: 'rectangle', x, y, width: 32, height: 32 },
    properties: { tilesetId: 'builtin', tileIndex },
  } as MapObjectV1
}

function doc(objects: MapObjectV1[]): MapDocumentV1 {
  return {
    schemaVersion: '1',
    map: { width: 10, height: 10, tileWidth: 32, tileHeight: 32 },
    tilesets: [{ id: 'builtin', name: 'builtin', tileWidth: 32, tileHeight: 32, columns: 1, tileCount: 1, source: { kind: 'builtin', key: 'builtin' } }],
    layers: [],
    objects,
  } as unknown as MapDocumentV1
}

describe('mergeDecoration', () => {
  it('mantém adições de ambos os editores (ids distintos coexistem)', () => {
    const base = doc([tileObj('a', 0, 0)])
    const mine = doc([tileObj('a', 0, 0), tileObj('mine-1', 32, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('their-1', 64, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    const ids = merged.objects.map((o) => o.id)
    expect(ids).toEqual(['a', 'their-1', 'mine-1'])
  })

  it('aplica minha remoção sobre theirs', () => {
    const base = doc([tileObj('a', 0, 0), tileObj('b', 32, 0)])
    const mine = doc([tileObj('a', 0, 0)]) // removi 'b'
    const theirs = doc([tileObj('a', 0, 0), tileObj('b', 32, 0), tileObj('c', 64, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.objects.map((o) => o.id)).toEqual(['a', 'c'])
  })

  it('minha alteração vence quando eu alterei o mesmo objeto (último a salvar)', () => {
    const base = doc([tileObj('a', 0, 0, 0)])
    const mine = doc([tileObj('a', 96, 0, 0)]) // movi 'a'
    const theirs = doc([tileObj('a', 0, 0, 5)]) // outro mudou o tileIndex de 'a'
    const merged = mergeDecoration(base, mine, theirs)
    const a = merged.objects.find((o) => o.id === 'a')!
    expect(a.geometry).toMatchObject({ x: 96 })
  })

  it('preserva objetos intocados por mim vindos de theirs', () => {
    const base = doc([tileObj('a', 0, 0)])
    const mine = doc([tileObj('a', 0, 0)])
    const theirs = doc([tileObj('a', 0, 0), tileObj('their-1', 32, 0)])
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.objects.map((o) => o.id)).toContain('their-1')
  })

  it('usa estrutura (map/layers) de theirs e une tilesets', () => {
    const base = doc([])
    const mine = { ...doc([]), tilesets: [...doc([]).tilesets, { id: 'extra', name: 'extra', tileWidth: 32, tileHeight: 32, columns: 1, tileCount: 1, source: { kind: 'builtin', key: 'extra' } }] } as MapDocumentV1
    const theirs = { ...doc([]), map: { width: 20, height: 20, tileWidth: 32, tileHeight: 32 } } as MapDocumentV1
    const merged = mergeDecoration(base, mine, theirs)
    expect(merged.map.width).toBe(20)
    expect(merged.tilesets.map((t) => t.id).sort()).toEqual(['builtin', 'extra'])
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map-decoration.test.ts`
Expected: FAIL — `mergeDecoration is not a function` / import não resolvido.

- [ ] **Step 3: Implementar `mergeDecoration`**

Adicionar em `packages/shared/src/office-map.ts` (perto de `assertOnlyDecorationChanged`, ~linha 1517):

```ts
function sameDecorObject(a: MapObjectV1, b: MapObjectV1): boolean {
  return (
    a.layerKey === b.layerKey &&
    JSON.stringify((a as { geometry?: unknown }).geometry) === JSON.stringify((b as { geometry?: unknown }).geometry) &&
    JSON.stringify((a as { properties?: unknown }).properties) === JSON.stringify((b as { properties?: unknown }).properties)
  );
}

function unionTilesetsById(...groups: MapTilesetV1[][]): MapTilesetV1[] {
  const byId = new Map<string, MapTilesetV1>();
  for (const group of groups) for (const t of group) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()];
}

/**
 * Merge 3-vias por `id` de objeto para decoração colaborativa.
 * `base`   = mapa que o editor abriu; `mine` = doc do editor; `theirs` = publicação mais recente.
 * Estrutura (map/layers/schemaVersion) vem de `theirs`. Ver spec 2026-07-20.
 */
export function mergeDecoration(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  theirs: MapDocumentV1,
): MapDocumentV1 {
  const baseById = new Map(base.objects.map((o) => [o.id, o]));
  const mineById = new Map(mine.objects.map((o) => [o.id, o]));

  const removedByMe = new Set<string>();
  for (const o of base.objects) if (!mineById.has(o.id)) removedByMe.add(o.id);

  const changedByMe = new Map<string, MapObjectV1>();
  for (const o of mine.objects) {
    const prev = baseById.get(o.id);
    if (prev && !sameDecorObject(prev, o)) changedByMe.set(o.id, o);
  }

  const theirsIds = new Set(theirs.objects.map((o) => o.id));
  const merged: MapObjectV1[] = [];
  for (const o of theirs.objects) {
    if (removedByMe.has(o.id)) continue;
    merged.push(changedByMe.get(o.id) ?? o);
  }
  // Meus objetos novos: em mine, ausentes em base E em theirs → topo da pilha.
  for (const o of mine.objects) {
    if (!baseById.has(o.id) && !theirsIds.has(o.id)) merged.push(o);
  }

  return {
    ...theirs,
    tilesets: unionTilesetsById(theirs.tilesets, mine.tilesets),
    objects: merged,
  };
}
```

Garantir que `mergeDecoration` está reexportado pelo barril `packages/shared/src/index.ts` (o arquivo já reexporta `./office-map`; nenhum ajuste se usa `export *`).

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map-decoration.test.ts`
Expected: PASS (todos os casos de `mergeDecoration`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map-decoration.test.ts
git commit -m "feat(shared): mergeDecoration — merge 3-vias por id para decoração colaborativa"
```

---

## Task 2: Extrair helper `materializePublication` (refactor sem mudança de comportamento) — api

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts:559-682`
- Test: (nenhum novo — a suíte existente de publicação deve continuar verde)

**Interfaces:**
- Produces: `materializePublication(tx, mapId, map, userId, activate, validation)` — encapsula version++, criação da publicação, assets, salas/mesas e ativação. Retorna o mesmo objeto que hoje o `$transaction` de `publishOfficeMap` retorna (`{ publication, version, roomsCreated, desksCreated, activated, map }`).
- Consumes: `validateDocument`'s result shape (`{ document, assets }`), `asPublication`, `publicationSelect`, `Prisma`.

- [ ] **Step 1: Extrair o corpo transacional para um helper**

Em `apps/api/src/services/office-map-service.ts`, criar a função (logo antes de `publishOfficeMap`). Copiar **verbatim** as linhas 577–669 atuais para dentro dela (aggregate/version, `officeSetting`, previousRooms/Desks, `create` da publicação, assets, loop de meeting-room/desk, ativação, `return`). Assinatura:

```ts
type PublicationValidation = Awaited<ReturnType<typeof validateDocument>>

async function materializePublication(
  tx: Prisma.TransactionClient,
  mapId: string,
  map: Awaited<ReturnType<typeof requireMap>>,
  userId: string,
  activate: boolean,
  validation: PublicationValidation,
) {
  // <<< colar aqui as linhas 577–669 atuais (de `const latest = ...` até o `return { ... }`) >>>
}
```

Observação: dentro do corpo colado, `validation.document` e `validation.assets` já são referenciados exatamente como hoje — não renomear nada.

- [ ] **Step 2: Fazer `publishOfficeMap` chamar o helper**

Substituir, no `$transaction` de `publishOfficeMap` (linhas 567–670), o trecho **após** a validação (linhas 577–669) por uma única chamada, mantendo o que vem antes (leitura do draft, checagem de revision, `validateDocument`) intacto:

```ts
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.officeMapDraft.findUnique({ where: { mapId } })
    if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
    if (draft.revision !== revision) {
      fail('A revisão informada não é a atual', 409, 'DRAFT_REVISION_CONFLICT', { currentRevision: draft.revision })
    }
    const validation = await validateDocument(mapId, draft.document, tx)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }
    return materializePublication(tx, mapId, map, userId, activate, validation)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
```

O bloco pós-transação (linhas 671–681, `officeHub.configure`/`broadcastMapDecorUpdated`) permanece **inalterado**.

- [ ] **Step 3: Rodar a suíte de publicação existente**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/office-map-service`
Expected: PASS (nenhuma regressão; comportamento idêntico).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/office-map-service.ts
git commit -m "refactor(api): extrai materializePublication de publishOfficeMap"
```

---

## Task 3: Serviço + rota `merge-publish` — api

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts` (nova função `mergeAndPublishDecoration`)
- Modify: `apps/api/src/routes/office-maps.ts:218-250` (nova rota)
- Test: `apps/api/src/services/office-map-service.merge.test.ts` (criar)

**Interfaces:**
- Consumes: `materializePublication` (Task 2), `mergeDecoration` (Task 1), `getActiveMapIdForEditing`, `requireMap`, `validateDocument`, `canonicalDocument`, `assertOnlyDecorationChanged`, `getActiveOfficeMap`, `officeHub`, `fail`, `OfficeMapError`.
- Produces:
  - `mergeAndPublishDecoration(input: { baseVersion: number; document: unknown }, userId: string): Promise<{ version: number; document: MapDocumentV1 }>`
  - Rota `POST /office/map/edit/merge-publish` → mesmo retorno.

- [ ] **Step 1: Escrever o teste de serviço que falha**

Criar `apps/api/src/services/office-map-service.merge.test.ts`. Seguir o padrão dos testes existentes de office-map (usam Postgres real; `test/setup.ts` trunca tabelas por teste). Estrutura mínima:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '../lib/prisma'
import { mergeAndPublishDecoration } from './office-map-service'
// helpers de fixture existentes no pacote (criar mapa ativo + publicação base).
// Reusar utilitários do próprio arquivo de testes de office-map se houver;
// senão montar via prisma direto como os outros testes fazem.

describe('mergeAndPublishDecoration', () => {
  it('mescla o trabalho de dois editores concorrentes na publicação final', async () => {
    const { mapId, baseVersion, baseDoc, userId } = await seedActiveMap() // helper local

    // Editor A adiciona 'a-1' e publica.
    const aDoc = withObject(baseDoc, tileObj('a-1', 32, 0))
    const a = await mergeAndPublishDecoration({ baseVersion, document: aDoc }, userId)

    // Editor B (partiu da MESMA baseVersion) adiciona 'b-1' e publica depois.
    const bDoc = withObject(baseDoc, tileObj('b-1', 64, 0))
    const b = await mergeAndPublishDecoration({ baseVersion, document: bDoc }, userId)

    expect(b.version).toBe(a.version + 1)
    const ids = b.document.objects.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['a-1', 'b-1'])) // ambos sobrevivem
  })

  it('faz fallback 2-vias quando baseVersion não existe', async () => {
    const { baseDoc, userId } = await seedActiveMap()
    const doc = withObject(baseDoc, tileObj('novo', 32, 0))
    const res = await mergeAndPublishDecoration({ baseVersion: 9999, document: doc }, userId)
    expect(res.document.objects.map((o) => o.id)).toContain('novo')
  })

  it('rejeita mudança estrutural com STRUCTURAL_EDIT_FORBIDDEN', async () => {
    const { baseVersion, baseDoc, userId } = await seedActiveMap()
    const structural = { ...baseDoc, map: { ...baseDoc.map, width: baseDoc.map.width + 5 } }
    await expect(mergeAndPublishDecoration({ baseVersion, document: structural }, userId))
      .rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })
})
```

> Nota ao implementador: `seedActiveMap`/`withObject`/`tileObj` são helpers locais deste arquivo — implemente-os replicando como os testes de `office-map-service` existentes criam um `OfficeMap` + `OfficeMapDraft` + `OfficeMapPublication` ativos. Leia um teste vizinho de publicação antes de escrever, para reusar exatamente os mesmos helpers de fixture.

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/office-map-service.merge.test.ts`
Expected: FAIL — `mergeAndPublishDecoration` não exportada.

- [ ] **Step 3: Implementar `mergeAndPublishDecoration`**

Adicionar em `apps/api/src/services/office-map-service.ts` (após `publishOfficeDecoration`). Importar `mergeDecoration` de `@legends/shared` (junto aos imports de `assertOnlyDecorationChanged`/tipos já vindos de lá):

```ts
export async function mergeAndPublishDecoration(
  input: { baseVersion: number; document: unknown },
  userId: string,
): Promise<{ version: number; document: MapDocumentV1 }> {
  const mapId = await getActiveMapIdForEditing()
  const map = await requireMap(mapId)

  let mine: MapDocumentV1
  try {
    mine = canonicalDocument(input.document)
  } catch {
    fail('Documento inválido', 400, 'MAP_DOCUMENT_MALFORMED')
  }

  const result = await prisma.$transaction(async (tx) => {
    const latestPub = await tx.officeMapPublication.findFirst({
      where: { mapId }, orderBy: { version: 'desc' }, select: { mapData: true },
    })
    const theirs = (latestPub ? (latestPub.mapData as unknown as MapDocumentV1) : mine)
    const basePub = await tx.officeMapPublication.findFirst({
      where: { mapId, version: input.baseVersion }, select: { mapData: true },
    })
    const base = basePub ? (basePub.mapData as unknown as MapDocumentV1) : theirs

    const merged = mergeDecoration(base, mine, theirs)

    const guard = assertOnlyDecorationChanged(theirs, merged)
    if (!guard.ok) {
      fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
    }

    const validation = await validateDocument(mapId, merged, tx)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }

    const core = await materializePublication(tx, mapId, map, userId, true, validation)
    return { ...core, document: validation.document as MapDocumentV1 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  // Publicação suave: mantém presença e faz refresh suave em todos (inclusive editores sem alterações locais).
  officeHub.configure(await getActiveOfficeMap(), false, true)
  officeHub.broadcastMapDecorUpdated(result.publication.id)

  return { version: result.version, document: result.document }
}
```

- [ ] **Step 4: Adicionar a rota**

Em `apps/api/src/routes/office-maps.ts`, junto aos schemas de decoração (após `decorPublishSchema`, ~linha 220):

```ts
const decorMergeSchema = z.object({ baseVersion: z.number().int().nonnegative(), document: z.unknown() })
```

E registrar a rota junto às demais de decoração (após o handler de `publish`, ~linha 250). Importar `mergeAndPublishDecoration` do service no topo do arquivo:

```ts
app.post('/office/map/edit/merge-publish', member, async (request, reply) => {
  const body = decorMergeSchema.safeParse(request.body)
  if (!body.success) return badInput(reply, body.error)
  return mergeAndPublishDecoration(
    { baseVersion: body.data.baseVersion, document: (request.body as { document: unknown }).document },
    request.user.sub,
  )
})
```

- [ ] **Step 5: Rodar os testes de serviço + escrever/rodar teste de rota**

Adicionar ao arquivo de teste um caso de rota (usando o helper `buildApp`/`inject` como as outras rotas de office testam), OU cobrir via o teste de serviço acima se o padrão do repo concentrar em service. Rode:

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.merge.test.ts`
Expected: PASS (merge concorrente, fallback, guard estrutural).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/routes/office-maps.ts apps/api/src/services/office-map-service.merge.test.ts
git commit -m "feat(api): endpoint merge-publish de decoração colaborativa"
```

---

## Task 4: Contrato WS de presença de edição — `@legends/shared`

**Files:**
- Modify: `packages/shared/src/office.ts:135-173,252-341`
- Test: `packages/shared/src/office.test.ts` (adicionar asserção de tipo/round-trip se o arquivo já testa as uniões; senão pular teste e confiar no typecheck)

**Interfaces:**
- Produces:
  - `OfficeClientMessage` ganha `{ type: 'set-editing'; editing: boolean }`.
  - `OfficeServerMessage` ganha `{ type: 'editors-changed'; userIds: string[] }`.
  - `welcome` ganha `editorUserIds?: string[]` (nomes resolvidos pelos `occupants`).

- [ ] **Step 1: Adicionar as variantes**

Em `packages/shared/src/office.ts`, na união `OfficeClientMessage` (linha 158-173) adicionar:

```ts
  | { type: "set-editing"; editing: boolean }
```

Na união `OfficeServerMessage` (linha 252-341) adicionar:

```ts
  | { type: "editors-changed"; userIds: string[] }
```

Na variante `welcome` (linha 257), acrescentar o campo opcional:

```ts
  | {
      type: "welcome";
      youId: string;
      occupants: OfficeOccupant[];
      publicationId?: string;
      confettiUserIds?: string[];
      handRaisedUserIds?: string[];
      editorUserIds?: string[];   // <-- novo
    }
```

- [ ] **Step 2: Typecheck do shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
(Usar o binário direto — `npx tsc` é interceptado pelo rtk e mente; ver memória do projeto.)
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/office.ts
git commit -m "feat(shared): mensagens WS set-editing e editors-changed"
```

---

## Task 5: Presença de edição no hub — api

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts` (campo + método + welcome + leave + configure)
- Test: `apps/api/src/lib/office-hub.test.ts`

**Interfaces:**
- Consumes: `OfficeSocket`, `socketOwner`, `broadcast`, padrão de `confettiActive`/`confettiSocket`.
- Produces: `setEditing(socket, userId, editing: boolean): void`; set interno `editingActive: Set<string>`; `welcome.editorUserIds` preenchido; limpeza em `leave`/`configure`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `apps/api/src/lib/office-hub.test.ts` (seguir o setup existente que cria sockets fake e faz `hub.join`). Casos:

```ts
it('broadcasta editors-changed ao entrar/sair de edição', () => {
  // dois usuários conectados (join)
  const sentTo = (socket) => socket.sent.map((s) => JSON.parse(s)) // conforme o fake do arquivo
  hub.setEditing(socketA, 'user-a', true)
  const msg = lastMessageOfType(socketB, 'editors-changed')
  expect(msg.userIds).toEqual(['user-a'])
  hub.setEditing(socketA, 'user-a', false)
  expect(lastMessageOfType(socketB, 'editors-changed').userIds).toEqual([])
})

it('remove o usuário de editingActive ao desconectar', () => {
  hub.setEditing(socketA, 'user-a', true)
  hub.leave(socketA, 'user-a')
  // reentra e olha o welcome
  hub.join(socketA2, userA)
  const welcome = lastMessageOfType(socketA2, 'welcome')
  expect(welcome.editorUserIds ?? []).toEqual([])
})

it('inclui editores atuais no welcome de quem entra', () => {
  hub.setEditing(socketA, 'user-a', true)
  hub.join(socketC, userC)
  expect(lastMessageOfType(socketC, 'welcome').editorUserIds).toEqual(['user-a'])
})
```

> Ajustar os helpers (`lastMessageOfType`, criação de sockets/join) ao que o arquivo de teste já usa. Ler o topo do `office-hub.test.ts` antes de escrever.

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts`
Expected: FAIL — `hub.setEditing` não existe / `editorUserIds` ausente.

- [ ] **Step 3: Implementar no hub**

Em `apps/api/src/lib/office-hub.ts`:

1. Declarar os campos junto de `confettiActive`/`confettiSocket` (~linha 60-85 da classe):

```ts
  /** Usuários atualmente com o editor de decoração aberto (presença efêmera). */
  private editingActive = new Set<string>()
  /** Aba dona do estado de edição por usuário (mesmo papel de confettiSocket ao cair). */
  private editingSocket = new Map<string, OfficeSocket>()
```

2. Método `setEditing` (perto de `move`/`raiseHand`):

```ts
  setEditing(socket: OfficeSocket, userId: string, editing: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    let changed = false
    if (editing) {
      this.editingSocket.set(userId, socket)
      changed = !this.editingActive.has(userId)
      this.editingActive.add(userId)
    } else {
      if (this.editingSocket.get(userId) === socket) this.editingSocket.delete(userId)
      changed = this.editingActive.delete(userId)
    }
    if (changed) this.broadcast({ type: 'editors-changed', userIds: [...this.editingActive] })
  }
```

3. No `welcome` (linha 134-141), acrescentar:

```ts
      editorUserIds: [...this.editingActive],
```

4. Em `leave` (após o bloco de `raisedHandSocket`, ~linha 316), acrescentar:

```ts
    if (this.editingSocket.get(userId) === socket) {
      this.editingSocket.delete(userId)
      if (this.editingActive.delete(userId)) {
        this.broadcast({ type: 'editors-changed', userIds: [...this.editingActive] })
      }
    }
```

5. Em `configure`, no bloco de limpeza `if (changed && !keepPresence)` (linha 150-162), acrescentar:

```ts
      this.editingActive.clear()
      this.editingSocket.clear()
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/office-hub.ts apps/api/src/lib/office-hub.test.ts
git commit -m "feat(api): presença de editores no office-hub"
```

---

## Task 6: Dispatch de `set-editing` na rota WS — api

**Files:**
- Modify: `apps/api/src/routes/office-ws.ts:118-155`
- Test: coberto pelos testes do hub (Task 5) + typecheck; sem teste novo dedicado.

**Interfaces:**
- Consumes: `officeHub.setEditing`, união `OfficeClientMessage` (com `set-editing`).

- [ ] **Step 1: Adicionar o ramo no switch de mensagens**

No `ws.on('message', ...)` de `apps/api/src/routes/office-ws.ts`, junto aos outros `else if` (após `set-character-name`, ~linha 147):

```ts
  } else if (msg.type === 'set-editing' && typeof msg.editing === 'boolean') {
    officeHub.setEditing(ws, user.id, msg.editing)
  }
```

- [ ] **Step 2: Typecheck da api**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/office-ws.ts
git commit -m "feat(api): roteia set-editing no websocket do escritório"
```

---

## Task 7: Bridge — editores + flag de edição-suja — web

**Files:**
- Modify: `apps/web/src/office/OfficeBridge.ts`
- Test: `apps/web/src/office/OfficeBridge.test.ts`

**Interfaces:**
- Produces:
  - `editingActiveIds` refletido de `editors-changed` e `welcome.editorUserIds`.
  - `snapshot()` passa a retornar `editorUserIds: string[]`.
  - `setEditingDirty(dirty: boolean)` / `isEditingDirty(): boolean` (flag mutável, como `movementLocked`).
- Consumes: `OfficeServerMessage`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `apps/web/src/office/OfficeBridge.test.ts`:

```ts
it('reflete editors-changed no snapshot', () => {
  const bridge = new OfficeBridge()
  bridge.emitServerMessage({ type: 'welcome', youId: 'me', occupants: [], editorUserIds: ['x'] } as any)
  expect(bridge.snapshot().editorUserIds).toEqual(['x'])
  bridge.emitServerMessage({ type: 'editors-changed', userIds: ['x', 'y'] } as any)
  expect(bridge.snapshot().editorUserIds).toEqual(['x', 'y'])
})

it('inclui editores no replay sintético do welcome', () => {
  const bridge = new OfficeBridge()
  bridge.emitServerMessage({ type: 'welcome', youId: 'me', occupants: [], editorUserIds: ['x'] } as any)
  let replayed: any = null
  bridge.onServerMessage((m) => { if (m.type === 'welcome') replayed = m })
  expect(replayed.editorUserIds).toEqual(['x'])
})

it('guarda a flag editingDirty', () => {
  const bridge = new OfficeBridge()
  expect(bridge.isEditingDirty()).toBe(false)
  bridge.setEditingDirty(true)
  expect(bridge.isEditingDirty()).toBe(true)
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/OfficeBridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar no bridge**

Em `apps/web/src/office/OfficeBridge.ts`:

1. Campos (junto de `handRaisedActiveIds`, linha 62-64):

```ts
  private editingActiveIds = new Set<string>()
  private editingDirty = false
```

2. `applyToSnapshot` — no `case 'welcome'` (linha 94-100) acrescentar:

```ts
        this.editingActiveIds = new Set(message.editorUserIds ?? [])
```
   e um novo case:

```ts
      case 'editors-changed':
        this.editingActiveIds = new Set(message.userIds)
        break
```

3. Replay sintético em `onServerMessage` (linha 75-81) — acrescentar ao objeto do welcome:

```ts
        editorUserIds: [...this.editingActiveIds],
```

4. `snapshot()` (linha 168-170):

```ts
  snapshot(): { youId: string | null; occupants: OfficeOccupant[]; editorUserIds: string[] } {
    return { youId: this.youId, occupants: [...this.occupants.values()], editorUserIds: [...this.editingActiveIds] }
  }
```

5. Flag mutável (perto de `setMovementLocked`, linha 182-188):

```ts
  setEditingDirty(dirty: boolean): void { this.editingDirty = dirty }
  isEditingDirty(): boolean { return this.editingDirty }
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/OfficeBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/OfficeBridge.ts apps/web/src/office/OfficeBridge.test.ts
git commit -m "feat(web): bridge reflete editores e flag de edição-suja"
```

---

## Task 8: `useOfficeSocket` expõe `editorUserIds` — web

**Files:**
- Modify: `apps/web/src/office/useOfficeSocket.ts:6-10,59-63,133`
- Test: coberto por Task 7 (bridge) + Task 11 (indicador); sem teste dedicado do hook.

**Interfaces:**
- Produces: `OfficeSocketState` ganha `editorUserIds: string[]`.

- [ ] **Step 1: Estender o estado espelhado**

Em `apps/web/src/office/useOfficeSocket.ts`:

1. Interface (linha 6-10):

```ts
export interface OfficeSocketState {
  occupants: OfficeOccupant[]
  youId: string | null
  connected: boolean
  editorUserIds: string[]
}
```

2. Onde o snapshot é espelhado a cada mensagem (linha 59-63), incluir `editorUserIds` no estado (adicionar um `useState<string[]>([])` e setá-lo do `bridge.snapshot().editorUserIds`, ao lado de occupants/youId).

3. Retorno (linha 133):

```ts
  return { occupants, youId, connected, editorUserIds }
```

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (nota: consumidores de `useOfficeSocket` — `OfficeSessionContext` — continuam válidos, só ignoram o campo novo por ora).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/office/useOfficeSocket.ts
git commit -m "feat(web): useOfficeSocket expõe editorUserIds"
```

---

## Task 9: Editor de decoração sem lock, com merge-publish — web

**Files:**
- Modify: `apps/web/src/office/editing/decorationApi.ts`
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts:113-148,776-858,874-942`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.tsx` (adicionar/atualizar; se não existir, criar cobrindo `save()`)

**Interfaces:**
- Consumes: `mergeDecoration` (indireto via API), `ActiveOfficeMapDTO`, `pruneUnusedTilesets`.
- Produces:
  - `decorationApi.getActiveMapForEditing(): Promise<ActiveOfficeMapDTO>`
  - `decorationApi.mergePublish(input: { baseVersion: number; document: MapDocumentV1 }): Promise<{ version: number; document: MapDocumentV1 }>`
  - `useOfficeMapEditing`: `enter()` semeia de `GET /office/map` sem lock; `save()` faz um único `mergePublish`. Novo ref `baseVersionRef`.

- [ ] **Step 1: Escrever o teste que falha (save chama mergePublish)**

Em `apps/web/src/office/editing/useOfficeMapEditing.test.tsx` (criar se necessário; mockar `./decorationApi`). Teste mínimo:

```ts
vi.mock('./decorationApi')
import * as api from './decorationApi'

it('save() chama mergePublish com o baseVersion carregado e re-ancora', async () => {
  ;(api.getActiveMapForEditing as any).mockResolvedValue({
    map: { id: 'm', name: 'M' },
    publication: { id: 'p1', version: 7 },
    document: emptyDoc(),
    assets: [], rooms: [], desks: [],
  })
  ;(api.mergePublish as any).mockResolvedValue({ version: 8, document: emptyDoc() })

  const { result } = renderHook(() => useOfficeMapEditing(fakeCanvasRef()))
  await act(() => result.current.enter())
  await act(() => result.current.save())

  expect(api.mergePublish).toHaveBeenCalledWith({ baseVersion: 7, document: expect.anything() })
  expect(api.acquireDecorationLock).not.toHaveBeenCalled?.() // lock não é mais usado
})
```

> `emptyDoc`/`fakeCanvasRef` são helpers locais; `fakeCanvasRef` retorna `{ current: { getScene: () => ({ setEditing(){}, ... }) } }` com os métodos usados por `enter`/`save` como no-ops. Ajuste conforme a superfície real chamada.

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.tsx`
Expected: FAIL (`mergePublish`/`getActiveMapForEditing` inexistentes; save ainda usa saveDecorationDraft).

- [ ] **Step 3: Adicionar as funções de API**

Em `apps/web/src/office/editing/decorationApi.ts` (usa `apiFetch` de `../../lib/api`; importar `ActiveOfficeMapDTO` de `@legends/shared`):

```ts
export function getActiveMapForEditing(): Promise<ActiveOfficeMapDTO> {
  return apiFetch<ActiveOfficeMapDTO>('/office/map')
}

export function mergePublish(input: { baseVersion: number; document: MapDocumentV1 }): Promise<{ version: number; document: MapDocumentV1 }> {
  return apiFetch('/office/map/edit/merge-publish', {
    method: 'POST',
    body: JSON.stringify({ baseVersion: input.baseVersion, document: input.document }),
  })
}
```

- [ ] **Step 4: `enter()` sem lock, semeando do mapa publicado**

Em `apps/web/src/office/editing/useOfficeMapEditing.ts`:

1. Adicionar o ref (junto de `revisionRef`, linha 116):

```ts
  const baseVersionRef = useRef(0)
```

2. Reescrever o miolo de `enter()` (linhas 783-794) — remover `acquireDecorationLock`, `getDecorationDraft`, `lockTokenRef`, e o `setInterval` de heartbeat (linhas 827-830). Substituir por:

```ts
      const active = await api.getActiveMapForEditing()
      documentRef.current = active.document
      baseDocRef.current = active.document
      baseVersionRef.current = active.publication.version
      resetHistory()
```

   Manter a chamada de `canvasRef.current?.getScene()?.setEditing(true, {...})` e o `setState(... active:true, dirty:false ...)`. Remover do `setState` qualquer campo de lock (ex.: `lockError`) se existir.

3. Em `cancel()` (linha ~760): remover `releaseDecorationLock` e o clear do heartbeat; manter `getScene()?.setEditing(false)` e `setState(... active:false ...)`.

- [ ] **Step 5: `save()` com um único merge-publish**

Substituir o corpo de `save()` (linhas 874-942) por:

```ts
  const save = useCallback(async () => {
    if (!documentRef.current || savingRef.current) return
    const doc = pruneUnusedTilesets(documentRef.current)
    savingRef.current = true
    setState((s) => ({ ...s, saving: true }))
    try {
      const result = await api.mergePublish({ baseVersion: baseVersionRef.current, document: doc })
      baseVersionRef.current = result.version
      // Re-ancora na versão mesclada: o applyMap pós-refetch (broadcast do próprio
      // publish) renderiza o documento de todos; documentRef/baseDoc passam a ser o merged.
      documentRef.current = result.document
      baseDocRef.current = result.document
      resetHistory()
      setState((s) => ({ ...s, dirty: false, saving: false }))
    } catch (err) {
      setState((s) => ({ ...s, saving: false }))
      throw err
    } finally {
      savingRef.current = false
    }
  }, [/* deps existentes: resetHistory etc. */])
```

   Remover do hook: import/uso de `acquireDecorationLock`, `heartbeatDecorationLock`, `releaseDecorationLock`, `getDecorationDraft`, `saveDecorationDraft`, `publishDecoration`, `lockTokenRef`, `heartbeatRef`, `revisionRef` e o handler `dismissLockError` (e removê-lo do objeto de retorno, linhas 1040-1053, junto de qualquer campo `lockError` do state). Ajustar `OfficeMapEditingState` para remover campos de lock não usados.

- [ ] **Step 6: Rodar para ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck web (garante que consumidores do lock removido compilam)**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros. (Se `OfficePage`/`OfficeEditDrawer`/`SelectionToolbar` referenciam `dismissLockError`/`lockError`, ajustar nesses arquivos — ver Task 11.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/office/editing/decorationApi.ts apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.tsx
git commit -m "feat(web): editor de decoração sem lock, salva via merge-publish"
```

---

## Task 10: Efeito de mensagem de mapa ciente de edição-suja — web

**Files:**
- Modify: `apps/web/src/office/session/mapMessage.ts`
- Modify: `apps/web/src/office/session/OfficeSessionContext.tsx:194-213`
- Test: `apps/web/src/office/session/mapMessage.test.ts`

**Interfaces:**
- Produces: `mapMessageEffect(message, onOfficePage, editingDirty): MapMessageEffect` — retorna `'ignore'` para `map-decor-updated` quando `editingDirty` (não puxa o refetch que apagaria o trabalho não salvo do editor).
- Consumes: `bridge.isEditingDirty()` (Task 7).

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/office/session/mapMessage.test.ts`:

```ts
it('ignora map-decor-updated enquanto o editor tem alterações não salvas', () => {
  expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' } as any, true, true)).toBe('ignore')
})

it('refetch em map-decor-updated quando não está editando sujo', () => {
  expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' } as any, true, false)).toBe('refetch')
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/mapMessage.test.ts`
Expected: FAIL (assinatura de 2 args).

- [ ] **Step 3: Implementar**

Reescrever `apps/web/src/office/session/mapMessage.ts`:

```ts
import type { OfficeServerMessage } from '@legends/shared'

export type MapMessageEffect = 'reload' | 'leave' | 'refetch' | 'ignore'

export function mapMessageEffect(
  message: OfficeServerMessage,
  onOfficePage: boolean,
  editingDirty: boolean,
): MapMessageEffect {
  if (message.type === 'map-changed') return onOfficePage ? 'reload' : 'leave'
  if (message.type === 'map-decor-updated') return editingDirty ? 'ignore' : 'refetch'
  return 'ignore'
}
```

Em `apps/web/src/office/session/OfficeSessionContext.tsx` (linha 197-204), passar o terceiro argumento:

```ts
      switch (mapMessageEffect(message, onOfficePage, bridge.isEditingDirty())) {
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/session/mapMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/session/mapMessage.ts apps/web/src/office/session/OfficeSessionContext.tsx
git commit -m "feat(web): não refetcha o mapa enquanto o editor tem alterações não salvas"
```

---

## Task 11: Indicador de editores + fiação no OfficePage — web

**Files:**
- Create: `apps/web/src/office/editing/EditorsPresence.tsx`
- Create: `apps/web/src/office/editing/EditorsPresence.test.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`

**Interfaces:**
- Consumes: `editorUserIds` (de `useOfficeSocket`, Task 8), `occupants` (para nomes), `youId`, `editing.state` (Task 9), `bridge` (Task 7).
- Produces: componente `EditorsPresence` e a fiação de `set-editing`/`editingDirty` no OfficePage.

- [ ] **Step 1: Escrever o teste do indicador que falha**

Criar `apps/web/src/office/editing/EditorsPresence.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { EditorsPresence } from './EditorsPresence'

it('lista outros editores pelo nome, excluindo você', () => {
  render(
    <EditorsPresence
      editorUserIds={['me', 'u2']}
      youId="me"
      occupants={[{ userId: 'me', name: 'Eu' }, { userId: 'u2', name: 'Ana' }] as any}
    />,
  )
  expect(screen.getByText(/Ana/)).toBeInTheDocument()
  expect(screen.queryByText(/Eu/)).not.toBeInTheDocument()
})

it('não renderiza nada quando só você edita', () => {
  const { container } = render(
    <EditorsPresence editorUserIds={['me']} youId="me" occupants={[{ userId: 'me', name: 'Eu' }] as any} />,
  )
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/EditorsPresence.test.tsx`
Expected: FAIL (componente inexistente).

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/office/editing/EditorsPresence.tsx` (Tailwind, texto em pt-BR, seguindo o estilo dos componentes vizinhos do drawer):

```tsx
import type { OfficeOccupant } from '@legends/shared'

interface Props {
  editorUserIds: string[]
  youId: string | null
  occupants: OfficeOccupant[]
}

export function EditorsPresence({ editorUserIds, youId, occupants }: Props) {
  const nameOf = (id: string) => occupants.find((o) => o.userId === id)?.name ?? 'Alguém'
  const others = editorUserIds.filter((id) => id !== youId)
  if (others.length === 0) return null
  const names = others.map(nameOf)
  const label =
    names.length === 1
      ? `${names[0]} também está editando`
      : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} também estão editando`
  return (
    <div className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status">
      {label}
    </div>
  )
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/EditorsPresence.test.tsx`
Expected: PASS.

- [ ] **Step 5: Fiar no OfficePage**

Em `apps/web/src/pages/OfficePage.tsx`:

1. Obter `editorUserIds` da sessão/socket. Se o OfficePage já recebe `occupants`/`youId` do contexto de sessão, expor também `editorUserIds` por lá (o `OfficeSessionContext` já consome `useOfficeSocket`; adicionar `editorUserIds` ao valor do contexto e ao tipo). Caso o OfficePage use `useOfficeSocket` direto, já vem do retorno.

2. Enviar `set-editing` quando o modo de edição liga/desliga (efeito):

```tsx
useEffect(() => {
  bridge.emitClientMessage({ type: 'set-editing', editing: editing.state.active })
}, [bridge, editing.state.active])
```

3. Manter a flag de edição-suja no bridge (para Task 10):

```tsx
useEffect(() => {
  bridge.setEditingDirty(editing.state.active && editing.state.dirty)
}, [bridge, editing.state.active, editing.state.dirty])
```

4. Renderizar `<EditorsPresence editorUserIds={editorUserIds} youId={youId} occupants={occupants} />` dentro do `OfficeEditDrawer` (só faz sentido visível em modo de edição — condicionar a `editing.state.active`).

5. Se `OfficePage`/`OfficeEditDrawer`/`SelectionToolbar` ainda referenciam `editing.dismissLockError`/`lockError` removidos na Task 9, remover esses usos (o lock não existe mais).

- [ ] **Step 6: Typecheck + testes web afetados**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web exec vitest run src/office/editing/EditorsPresence.test.tsx src/office/session/mapMessage.test.ts src/office/OfficeBridge.test.ts`
Expected: sem erros de tipo; testes PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/editing/EditorsPresence.tsx apps/web/src/office/editing/EditorsPresence.test.tsx apps/web/src/pages/OfficePage.tsx apps/web/src/office/session/OfficeSessionContext.tsx
git commit -m "feat(web): indicador de editores e envio de presença de edição"
```

---

## Task 12: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Subir Postgres e rodar a suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os workspaces verdes.

- [ ] **Step 2: Typecheck de todos os workspaces**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Smoke manual (skill `verify`)**

Seguir a skill `verify` para subir web+api e, com duas sessões (duas abas/usuários), confirmar: (a) ambos abrem o editor sem 423; (b) A adiciona móvel e salva → B (sem editar) vê a mudança; (c) B edita com alterações não salvas enquanto A salva → B não perde o trabalho e, ao salvar, o merge preserva os dois; (d) indicador "também está editando" aparece.

- [ ] **Step 4: Finalizar a branch**

Usar a skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Notas de rastreabilidade (spec → tasks)

- Merge 3-vias por id (spec §motor de merge) → Task 1, 3.
- Endpoint `merge-publish`, guard estrutural, fallback base podada, transação Serializable (spec §backend) → Task 2, 3.
- Aposentar lock/draft só na decoração (spec §lock e draft) → Task 9 (front) + Task 3 (novo caminho não toca draft; rotas de lock antigas seguem para o editor estrutural).
- Presença de editores via WS (spec §presença) → Task 4, 5, 6, 7, 8, 11.
- `enter()`/`save()`/reação a broadcast (spec §frontend) → Task 9, 10, 11.
- Casos de borda (spec §casos de borda) → cobertos em Task 3 (concorrência/guard/fallback) e Task 10 (dirty).
- Testes (spec §testes) → Tasks 1, 3, 5, 7, 9, 10, 11 + Task 12.
