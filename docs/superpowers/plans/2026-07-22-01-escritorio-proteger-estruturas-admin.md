# Proteção de estruturas do admin no escritório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que usuários comuns removam ou alterem estruturas criadas pelo admin no escritório (piso, colisões, zonas, links e mobília), mantendo a "mobília livre" para todos.

**Architecture:** Cada objeto do mapa ganha `createdBy` (`{ id, role }`). Um guard puro em `@legends/shared` (`assertOnlyDecorationChanged`) passa a receber o **ator** e, para não-admin, rejeita remover/alterar objeto **protegido** (criado por admin ou legado sem `createdBy`); o **piso** entra no conjunto estrutural. O service da API carimba `createdBy` nos objetos novos (autoridade) e chama o guard com o ator. O web espelha a regra para não deixar o comum montar uma edição que o server recusaria.

**Tech Stack:** TypeScript ESM, Zod, Fastify 4, Prisma 5, React 18, Vitest.

## Global Constraints

- Contrato primeiro: **alterar o tipo em `@legends/shared` antes** de api/web (fonte única).
- Camadas finas: route → service → guard puro. Sem regra de negócio na route.
- Mensagens ao usuário em **pt-BR**.
- `UserRole` = `LEGEND | LEAD | MANAGER | HEAD | ADMIN | THIRD_PARTY`; "admin" = `role === 'ADMIN'`.
- Erros de domínio da API são `OfficeMapError(message, status, code, details)`; o `setErrorHandler` de `office-maps.ts` já responde `err.status`.
- Testes colocados ao lado (`*.test.ts(x)`). API testa contra Postgres real (`pnpm db:up`).
- Typecheck: use o binário direto (`node_modules/.bin/tsc`), não `npx tsc`.
- Não rodar a suíte completa a cada passo — rode só o arquivo alterado; suíte completa é verificação final.

---

## File Structure

- `packages/shared/src/office-map.ts` — schema do objeto (`createdBy`), `UserRoleSchema`, `isProtectedFromMembers`, `STRUCTURAL_LAYER_KEYS`, `assertOnlyDecorationChanged`, `mergeDecoration`.
- `packages/shared/src/office-map.test.ts` / `office-map-decoration.test.ts` — testes do contrato/guard.
- `apps/api/src/services/office-map-service.ts` — `stampObjectOwnership` + ator nas três funções de decoração.
- `apps/api/src/services/office-map-service.test.ts` — testes de serviço.
- `apps/api/src/routes/office-maps.ts` — rotas `member` passam o ator.
- `apps/web/src/office/editing/decorationDoc.ts` — helpers de remoção respeitam predicado de proteção.
- `apps/web/src/office/editing/useOfficeMapEditing.ts` — ator + predicado + aplicação no eraser/rect/clearAll/select.
- `apps/web/src/pages/OfficePage.tsx` — passa o ator do `AuthContext` ao hook.

---

### Task 1: Contrato — `createdBy`, `UserRoleSchema`, `isProtectedFromMembers`, piso estrutural

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Test: `packages/shared/src/office-map.test.ts`

**Interfaces:**
- Consumes: `USER_ROLES` de `./enums` (`['LEGEND','LEAD','MANAGER','HEAD','ADMIN','THIRD_PARTY'] as const`).
- Produces:
  - `MapObjectV1` passa a ter `createdBy?: { id: string; role: UserRole } | null` (herdado do `ObjectBaseShape`).
  - `export function isProtectedFromMembers(object: MapObjectV1): boolean`
  - `STRUCTURAL_LAYER_KEYS = ['walls', 'floor'] as const`

- [ ] **Step 1: Escrever o teste que falha**

Adicione em `packages/shared/src/office-map.test.ts` (importe o que faltar de `./index`):

```ts
import { describe, it, expect } from 'vitest'
import {
  MapObjectV1Schema,
  isProtectedFromMembers,
  STRUCTURAL_LAYER_KEYS,
  type MapObjectV1,
} from './index'

describe('createdBy nos objetos', () => {
  const base = {
    id: 'obj-1',
    layerKey: 'objects',
    type: 'collision',
    geometry: { kind: 'rectangle', x: 0, y: 0, width: 32, height: 32 },
    properties: {},
  } as const

  it('aceita objeto sem createdBy (legado)', () => {
    expect(MapObjectV1Schema.safeParse(base).success).toBe(true)
  })

  it('aceita createdBy com id e role', () => {
    const parsed = MapObjectV1Schema.safeParse({
      ...base,
      createdBy: { id: 'u1', role: 'ADMIN' },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejeita role fora do enum', () => {
    const parsed = MapObjectV1Schema.safeParse({
      ...base,
      createdBy: { id: 'u1', role: 'SUPERUSER' },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('isProtectedFromMembers', () => {
  const obj = (createdBy: MapObjectV1['createdBy']): MapObjectV1 =>
    ({
      id: 'o',
      layerKey: 'objects',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 32, height: 32 },
      properties: {},
      createdBy,
    }) as MapObjectV1

  it('protege objeto legado (createdBy nulo/ausente)', () => {
    expect(isProtectedFromMembers(obj(null))).toBe(true)
  })
  it('protege objeto criado por admin', () => {
    expect(isProtectedFromMembers(obj({ id: 'a', role: 'ADMIN' }))).toBe(true)
  })
  it('NÃO protege objeto criado por comum', () => {
    expect(isProtectedFromMembers(obj({ id: 'm', role: 'LEGEND' }))).toBe(false)
  })
})

describe('STRUCTURAL_LAYER_KEYS', () => {
  it('inclui piso e paredes', () => {
    expect([...STRUCTURAL_LAYER_KEYS]).toEqual(['walls', 'floor'])
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map.test.ts`
Expected: FAIL (`isProtectedFromMembers is not a function` / `createdBy` rejeitado / `STRUCTURAL_LAYER_KEYS` sem `floor`).

- [ ] **Step 3: Implementar no `office-map.ts`**

No topo, garanta o import do enum (junto dos imports existentes):

```ts
import { USER_ROLES } from "./enums";
```

Logo após a definição de `COLOR_PATTERN`/`MapIdentifierSchema` (antes de `ObjectBaseShape`), adicione:

```ts
export const UserRoleSchema = z.enum(USER_ROLES);
```

Troque o `ObjectBaseShape` (linha ~220) para incluir `createdBy`:

```ts
const ObjectBaseShape = {
  id: MapIdentifierSchema,
  layerKey: MapIdentifierSchema,
  createdBy: z
    .object({ id: z.string().min(1), role: UserRoleSchema })
    .nullish(),
};
```

Troque `STRUCTURAL_LAYER_KEYS` (linha ~1433):

```ts
export const STRUCTURAL_LAYER_KEYS = ["walls", "floor"] as const;
```

Adicione o helper de proteção logo após `assertOnlyDecorationChanged` (ou junto de `sameDecorObject`):

```ts
/**
 * Um objeto é "protegido" (intocável por usuário comum) quando foi criado por
 * um admin ou é legado (sem `createdBy` — todo objeto publicado antes desta
 * feature). Backfill conservador: sem autoria conhecida, tratamos como do admin.
 */
export function isProtectedFromMembers(object: MapObjectV1): boolean {
  return object.createdBy == null || object.createdBy.role === "ADMIN";
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck do shared**

Run: `packages/shared/node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit` (ou `node_modules/.bin/tsc -p packages/shared` a partir da raiz)
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/office-map.ts packages/shared/src/office-map.test.ts
git commit -m "feat(shared): createdBy nos objetos do mapa + piso estrutural + isProtectedFromMembers"
```

---

### Task 2: Contrato — guard ciente do ator + `mergeDecoration` preserva `createdBy`

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Test: `packages/shared/src/office-map-decoration.test.ts`

**Interfaces:**
- Consumes: `isProtectedFromMembers` (Task 1), `sameDecorObject` (interno já existente).
- Produces: `assertOnlyDecorationChanged(previous, next, actor?: { isAdmin: boolean }): DecorationGuardResult` — quando `actor` é não-admin, viola se algum objeto **protegido** de `previous` for removido ou modificado em `next`. Códigos: `PROTECTED_OBJECT_REMOVED`, `PROTECTED_OBJECT_MODIFIED`.

- [ ] **Step 1: Escrever o teste que falha**

Adicione em `packages/shared/src/office-map-decoration.test.ts`:

```ts
import { assertOnlyDecorationChanged } from './index'
// createEmptyMapDocumentV1 já é importado no topo do arquivo.

function docWith(objects: any[]) {
  const doc: any = createEmptyMapDocumentV1()
  doc.objects = objects
  return doc
}
const adminObj = {
  id: 'a1', layerKey: 'objects', type: 'collision',
  geometry: { kind: 'rectangle', x: 0, y: 0, width: 32, height: 32 },
  properties: {}, createdBy: { id: 'admin', role: 'ADMIN' },
}
const memberObj = {
  id: 'm1', layerKey: 'objects', type: 'collision',
  geometry: { kind: 'rectangle', x: 64, y: 64, width: 32, height: 32 },
  properties: {}, createdBy: { id: 'bob', role: 'LEGEND' },
}

describe('assertOnlyDecorationChanged com ator', () => {
  it('comum NÃO pode remover objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    const r = assertOnlyDecorationChanged(prev, next, { isAdmin: false })
    expect(r.ok).toBe(false)
    expect((r as any).violations[0].code).toBe('PROTECTED_OBJECT_REMOVED')
  })

  it('comum NÃO pode modificar objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([{ ...adminObj, geometry: { kind: 'rectangle', x: 5, y: 5, width: 32, height: 32 } }])
    const r = assertOnlyDecorationChanged(prev, next, { isAdmin: false })
    expect(r.ok).toBe(false)
    expect((r as any).violations[0].code).toBe('PROTECTED_OBJECT_MODIFIED')
  })

  it('comum PODE remover objeto de outro comum', () => {
    const prev = docWith([memberObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: false }).ok).toBe(true)
  })

  it('comum PODE adicionar objeto', () => {
    const prev = docWith([])
    const next = docWith([memberObj])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: false }).ok).toBe(true)
  })

  it('admin PODE remover objeto do admin', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next, { isAdmin: true }).ok).toBe(true)
  })

  it('sem ator mantém comportamento antigo (só estrutural)', () => {
    const prev = docWith([adminObj])
    const next = docWith([])
    expect(assertOnlyDecorationChanged(prev, next).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map-decoration.test.ts`
Expected: FAIL (o guard ignora o 3º parâmetro; remoções passam).

- [ ] **Step 3: Estender o guard**

Em `office-map.ts`, altere a assinatura e adicione o bloco de ownership no fim de `assertOnlyDecorationChanged` (antes do `return`):

```ts
export function assertOnlyDecorationChanged(
  previous: MapDocumentV1,
  next: MapDocumentV1,
  actor?: { isAdmin: boolean },
): DecorationGuardResult {
  const violations: MapStructuralViolation[] = [];
  // ...todas as checagens estruturais existentes permanecem inalteradas...

  if (actor && !actor.isAdmin) {
    const nextById = new Map(next.objects.map((o) => [o.id, o]));
    for (const prev of previous.objects) {
      if (!isProtectedFromMembers(prev)) continue;
      const after = nextById.get(prev.id);
      if (!after) {
        violations.push({
          code: "PROTECTED_OBJECT_REMOVED",
          message: "Só administradores podem remover estruturas do escritório",
          path: `objects.${prev.id}`,
        });
      } else if (!sameDecorObject(prev, after)) {
        violations.push({
          code: "PROTECTED_OBJECT_MODIFIED",
          message: "Só administradores podem alterar estruturas do escritório",
          path: `objects.${prev.id}`,
        });
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
```

> Nota: `sameDecorObject` compara `layerKey`/`geometry`/`properties` (não `createdBy`), então uma mudança só de autoria não dispara `PROTECTED_OBJECT_MODIFIED` — correto, autoria é gerida pelo server.

- [ ] **Step 4: Garantir que `mergeDecoration` preserva `createdBy`**

Adicione um teste em `office-map-decoration.test.ts` (bloco `mergeDecoration`):

```ts
it('preserva createdBy dos objetos ao mesclar', () => {
  const base = docWith([])
  const mine = docWith([memberObj])
  const theirs = docWith([adminObj])
  const merged = mergeDecoration(base, mine, theirs)
  const m = merged.objects.find((o) => o.id === 'm1')
  const a = merged.objects.find((o) => o.id === 'a1')
  expect(m?.createdBy).toEqual({ id: 'bob', role: 'LEGEND' })
  expect(a?.createdBy).toEqual({ id: 'admin', role: 'ADMIN' })
})
```

`mergeDecoration` já monta objetos a partir de `theirs`/`mine` inteiros, então `createdBy` viaja junto — o teste é uma trava de regressão. Se falhar, garanta que nenhum passo do merge reconstrói objetos sem `createdBy`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/shared exec vitest run src/office-map-decoration.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
node_modules/.bin/tsc -p packages/shared --noEmit
git add packages/shared/src/office-map.ts packages/shared/src/office-map-decoration.test.ts
git commit -m "feat(shared): guard de decoração rejeita mexer em objeto protegido do admin"
```

---

### Task 3: API — carimbar `createdBy` e passar o ator ao guard

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/routes/office-maps.ts:236-260` (bloco `member`: PUT draft, publish, merge-publish)
- Test: `apps/api/src/services/office-map-service.test.ts`

**Interfaces:**
- Consumes: `assertOnlyDecorationChanged(prev, next, { isAdmin })`, `isProtectedFromMembers`, `UserRole`, `MapObjectV1`, `MapDocumentV1` de `@legends/shared`.
- Produces:
  - `stampObjectOwnership(previous: MapDocumentV1, next: MapDocumentV1, actor: { id: string; role: UserRole }): MapDocumentV1`
  - Assinaturas passam a receber ator:
    - `saveOfficeDecorationDraft(input, actor: { id: string; role: UserRole }, lockToken)`
    - `publishOfficeDecoration(revision, actor: { id: string; role: UserRole })`
    - `mergeAndPublishDecoration(input, actor: { id: string; role: UserRole })`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/services/office-map-service.test.ts`, adicione um bloco (siga os helpers de setup já existentes no arquivo para criar mapa ativo/usuário; reuse o fixture `office-map-fixture.ts`). Esqueleto concreto:

```ts
describe('proteção de estruturas do admin (decoração)', () => {
  it('comum não pode apagar objeto do admin (403)', async () => {
    // 1. admin publica um mapa com um objeto collision createdBy admin
    // 2. comum tenta mergeAndPublishDecoration removendo esse objeto
    await expect(
      mergeAndPublishDecoration(
        { baseVersion: activeVersion, document: docSemOColisionDoAdmin },
        { id: comum.id, role: 'LEGEND' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })

  it('comum pode apagar objeto de outro comum', async () => {
    const r = await mergeAndPublishDecoration(
      { baseVersion: activeVersion, document: docSemOColisionDoOutroComum },
      { id: comum.id, role: 'LEGEND' },
    )
    expect(r.version).toBeGreaterThan(activeVersion)
  })

  it('objeto novo do comum nasce com createdBy do comum', async () => {
    const r = await mergeAndPublishDecoration(
      { baseVersion: activeVersion, document: docComMobiliaNovaDoComum },
      { id: comum.id, role: 'LEGEND' },
    )
    const novo = r.document.objects.find((o) => o.id === novoId)
    expect(novo?.createdBy).toEqual({ id: comum.id, role: 'LEGEND' })
  })

  it('server sobrescreve createdBy forjado em objeto novo', async () => {
    const forjado = { ...mobiliaNova, createdBy: { id: 'x', role: 'ADMIN' } }
    const r = await mergeAndPublishDecoration(
      { baseVersion: activeVersion, document: docComObjeto(forjado) },
      { id: comum.id, role: 'LEGEND' },
    )
    const novo = r.document.objects.find((o) => o.id === forjado.id)
    expect(novo?.createdBy).toEqual({ id: comum.id, role: 'LEGEND' })
  })
})
```

> O implementador monta os documentos a partir do fixture (`office-map-fixture.ts`) e do documento ativo. Use `getActiveOfficeMap()` para descobrir `activeVersion` e o documento base.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "proteção de estruturas"`
Expected: FAIL (as três funções ainda não recebem ator nem carimbam).

- [ ] **Step 3: Implementar `stampObjectOwnership`**

Em `office-map-service.ts`, junto dos helpers (perto de `canonicalDocument`/`activeDocument`):

```ts
import type { MapObjectV1, MapDocumentV1 } from '@legends/shared'
import type { UserRole } from '@legends/shared'

/**
 * Server é a AUTORIDADE sobre autoria: objeto existente mantém o `createdBy`
 * de `previous` (imutável — impede forjar); objeto novo recebe o ator. Assim
 * um comum não consegue se passar por admin nem reatribuir peça alheia.
 */
function stampObjectOwnership(
  previous: MapDocumentV1,
  next: MapDocumentV1,
  actor: { id: string; role: UserRole },
): MapDocumentV1 {
  const prevById = new Map(previous.objects.map((o) => [o.id, o]))
  return {
    ...next,
    objects: next.objects.map((o): MapObjectV1 => {
      const prev = prevById.get(o.id)
      return prev
        ? { ...o, createdBy: prev.createdBy ?? null }
        : { ...o, createdBy: { id: actor.id, role: actor.role } }
    }),
  }
}
```

- [ ] **Step 4: Threadar o ator nas três funções**

Troque as assinaturas e os corpos:

```ts
export async function saveOfficeDecorationDraft(
  input: { revision: number; document: unknown },
  actor: { id: string; role: UserRole },
  lockToken: string,
) {
  const mapId = await getActiveMapIdForEditing()
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const previous = await activeDocument()
  const stamped = stampObjectOwnership(previous, canonicalDocument(structural.data), actor)
  const guard = assertOnlyDecorationChanged(previous, stamped, { isAdmin: actor.role === 'ADMIN' })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return saveOfficeMapDraft(mapId, { revision: input.revision, document: stamped }, actor.id, lockToken)
}

export async function publishOfficeDecoration(
  revision: number,
  actor: { id: string; role: UserRole },
) {
  const mapId = await getActiveMapIdForEditing()
  const draft = await prisma.officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  const previous = await activeDocument()
  const stamped = stampObjectOwnership(previous, canonicalDocument(draft.document), actor)
  const guard = assertOnlyDecorationChanged(previous, stamped, { isAdmin: actor.role === 'ADMIN' })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return publishOfficeMap(mapId, revision, actor.id, true, { soft: true })
}
```

> Nota: `publishOfficeDecoration` publica o **rascunho já salvo**. O carimbo/guard aqui é rede de segurança; o rascunho já passou por `saveOfficeDecorationDraft`. Se o rascunho persistido não incluir o carimbo (fluxos antigos), o `stamped` recalcula. Mantenha `publishOfficeMap(mapId, revision, actor.id, ...)` — o `revision` continua sendo o do rascunho.

Na `mergeAndPublishDecoration`, dentro da transação, após obter `base` e antes do guard:

```ts
export async function mergeAndPublishDecoration(
  input: { baseVersion: number; document: unknown },
  actor: { id: string; role: UserRole },
): Promise<{ version: number; document: MapDocumentV1 }> {
  const mapId = await getActiveMapIdForEditing()
  const map = await requireMap(mapId)

  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    fail('Documento inválido', 400, 'MAP_DOCUMENT_MALFORMED', { issues: structural.error.issues })
  }
  const mineRaw: MapDocumentV1 = canonicalDocument(structural.data)

  const result = await prisma.$transaction(async (tx) => {
    const latestPub = await tx.officeMapPublication.findFirst({
      where: { mapId }, orderBy: { version: 'desc' }, select: { mapData: true },
    })
    const theirs = latestPub ? canonicalDocument(latestPub.mapData) : mineRaw
    const basePub = await tx.officeMapPublication.findFirst({
      where: { mapId, version: input.baseVersion }, select: { mapData: true },
    })
    const base = basePub ? canonicalDocument(basePub.mapData) : theirs

    const mine = stampObjectOwnership(base, mineRaw, actor)
    const guard = assertOnlyDecorationChanged(base, mine, { isAdmin: actor.role === 'ADMIN' })
    if (!guard.ok) {
      fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
    }

    const merged = mergeDecoration(base, mine, theirs)
    const validation = await validateDocument(mapId, merged, tx)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }

    const core = await materializePublication(tx, mapId, map, actor.id, true, validation)
    return { ...core, document: validation.document as MapDocumentV1 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  officeHub.configure(await getActiveOfficeMap(), false, true)
  officeHub.broadcastMapDecorUpdated(result.publication.id)
  return { version: result.version, document: result.document }
}
```

- [ ] **Step 5: Atualizar as rotas para passar o ator**

Em `apps/api/src/routes/office-maps.ts`, no bloco `member`, troque as três chamadas:

```ts
app.put('/office/map/edit/draft', member, async (request, reply) => {
  const body = decorSaveSchema.safeParse(request.body)
  if (!body.success) return badInput(reply, body.error)
  return saveOfficeDecorationDraft(
    { revision: body.data.revision, document: (request.body as { document: unknown }).document },
    { id: request.user.sub, role: request.user.role as UserRole },
    lockToken(request.headers),
  )
})

app.post('/office/map/edit/publish', member, async (request, reply) => {
  const body = decorPublishSchema.safeParse(request.body)
  if (!body.success) return badInput(reply, body.error)
  return publishOfficeDecoration(body.data.revision, { id: request.user.sub, role: request.user.role as UserRole })
})

app.post('/office/map/edit/merge-publish', member, async (request, reply) => {
  const body = decorMergeSchema.safeParse(request.body)
  if (!body.success) return badInput(reply, body.error)
  return mergeAndPublishDecoration(
    { baseVersion: body.data.baseVersion, document: (request.body as { document: unknown }).document },
    { id: request.user.sub, role: request.user.role as UserRole },
  )
})
```

Adicione `import type { UserRole } from '@legends/shared'` no topo de `office-maps.ts` se ainda não houver.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts`
Expected: PASS (bloco novo + regressões existentes verdes).

- [ ] **Step 7: Typecheck + commit**

```bash
apps/api/node_modules/.bin/tsc -p apps/api --noEmit
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts apps/api/src/routes/office-maps.ts
git commit -m "feat(api): carimba autoria e bloqueia comum de mexer em estrutura do admin"
```

---

### Task 4: Web — ator no hook + eraser respeita objeto protegido

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts`
- Modify: `apps/web/src/pages/OfficePage.tsx:96`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `isProtectedFromMembers` de `@legends/shared`; `useAuth().user` (`PublicUser` com `id`, `role`).
- Produces:
  - `useOfficeMapEditing(canvasRef, actor: { id: string; isAdmin: boolean } | null)`
  - Predicado interno `isProtectedFromActor(object: MapObjectV1): boolean` — `false` para admin; para comum, `true` sse o objeto está na **base publicada** (`baseDocRef`) **e** `isProtectedFromMembers(object)`. Objetos criados na sessão (fora da base) nunca são protegidos do seu criador.

- [ ] **Step 1: Escrever o teste que falha**

Em `useOfficeMapEditing.test.ts`, adicione (siga o padrão de montagem de `canvasRef`/cena mock já usado no arquivo; foque no comportamento do eraser):

```ts
it('comum não apaga mobília do admin (peça publicada)', () => {
  // base publicada com um tile-object createdBy admin na célula (0,0)
  // aciona o hook com actor { id:'bob', isAdmin:false }
  // dispara a borrachada sobre (0,0)
  // ESPERA: o objeto do admin continua no documentRef; limitError setado
})

it('comum apaga a própria mobília recém-colocada', () => {
  // sem base (peça criada na sessão), actor comum
  // borrachada remove normalmente
})

it('admin apaga mobília do admin', () => {
  // base publicada com tile-object admin, actor { isAdmin:true }
  // borrachada remove
})
```

> O implementador reusa o setup de cena/canvas já presente nos testes vizinhos do arquivo para instanciar o hook e chamar os callbacks do eraser.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts`
Expected: FAIL (hook ainda não tem `actor` nem bloqueia).

- [ ] **Step 3: Adicionar ator e predicado ao hook**

No topo de `useOfficeMapEditing.ts`, importe:

```ts
import { isProtectedFromMembers } from '@legends/shared'
```

Troque a assinatura:

```ts
export function useOfficeMapEditing(
  canvasRef: RefObject<OfficeCanvasHandle>,
  actor: { id: string; isAdmin: boolean } | null,
) {
```

Guarde o ator num ref (perto dos outros refs, para os callbacks lerem sem virar dependência) e crie o predicado:

```ts
const actorRef = useRef(actor)
actorRef.current = actor

/** Peça publicada do admin/legado é intocável pelo comum; peça da sessão é sempre editável pelo criador. */
const isProtectedFromActor = useCallback((object: MapObjectV1): boolean => {
  if (actorRef.current?.isAdmin) return false
  const fromBase = baseDocRef.current?.objects.some((o) => o.id === object.id) ?? false
  return fromBase && isProtectedFromMembers(object)
}, [])
```

No `eraseAt` (linha ~382), após obter `removed` de `removeTopTileObjectAt`, bloqueie a peça protegida antes de commitar:

```ts
const { doc: withoutTop, removed } = removeTopTileObjectAt(doc, col, row)
if (removed) {
  if (isProtectedFromActor(removed)) {
    setState((s) => ({ ...s, limitError: 'Essa peça foi criada pelo admin e não pode ser apagada.' }))
    return
  }
  commitOp()
  // ...resto inalterado...
}
```

No eraser por objeto (linha ~671–708, o handler que usa `topErasableObjectAtPixel`), após achar o alvo:

```ts
const target = topErasableObjectAtPixel(doc, x, y)
if (target && isProtectedFromActor(target)) {
  setState((s) => ({ ...s, limitError: 'Essa estrutura foi criada pelo admin e não pode ser apagada.' }))
  return
}
```

- [ ] **Step 4: Passar o ator na `OfficePage`**

Em `apps/web/src/pages/OfficePage.tsx` (a `OfficePage` já usa auth; se não, importe `useAuth`):

```ts
const { user } = useAuth()
const editing = useOfficeMapEditing(
  canvasRef,
  user ? { id: user.id, isAdmin: user.role === 'ADMIN' } : null,
)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
apps/web/node_modules/.bin/tsc -p apps/web --noEmit
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts apps/web/src/pages/OfficePage.tsx
git commit -m "feat(web): eraser respeita estruturas do admin no escritório"
```

---

### Task 5: Web — proteção em massa (retângulo, limpar tudo) e mover/girar

**Files:**
- Modify: `apps/web/src/office/editing/useOfficeMapEditing.ts`
- Test: `apps/web/src/office/editing/useOfficeMapEditing.test.ts`

**Interfaces:**
- Consumes: `isProtectedFromActor` (Task 4), `removeDecorationObjectsInRect`, `clearAllFurniture` interno, `selectGroup`, `tileObjectsInGroup`.
- Produces: as operações em massa e a seleção pulam objetos protegidos para o comum.

- [ ] **Step 1: Escrever o teste que falha**

Em `useOfficeMapEditing.test.ts`:

```ts
it('borracha em retângulo preserva objeto do admin e remove o do comum', () => {
  // base publicada: adminObj + memberObj dentro do mesmo retângulo
  // actor comum; arrasta borracha cobrindo os dois
  // ESPERA: adminObj permanece, memberObj some
})

it('comum não seleciona/gira grupo do admin', () => {
  // base publicada: grupo de mobília createdBy admin
  // actor comum aciona selectGroup
  // ESPERA: state.selection permanece null; limitError setado
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

**Borracha em retângulo** (linha ~855, onde chama `removeDecorationObjectsInRect`): filtre os protegidos antes de remover. Como o helper puro remove todos os elegíveis, adicione um parâmetro opcional de proteção em `decorationDoc.ts`:

```ts
// decorationDoc.ts
export function removeDecorationObjectsInRect(
  doc: MapDocumentV1,
  rect: { x: number; y: number; width: number; height: number },
  isProtected: (object: MapObjectV1) => boolean = () => false,
): { doc: MapDocumentV1; removed: MapObjectV1[] } {
  const removed: MapObjectV1[] = []
  const objects = doc.objects.filter((object) => {
    if (
      ERASABLE_OBJECT_TYPES.has(object.type) &&
      geometryIntersectsRect(object.geometry, rect) &&
      !isProtected(object)
    ) {
      removed.push(object)
      return false
    }
    return true
  })
  return { doc: removed.length ? { ...doc, objects } : doc, removed }
}
```

E no hook, passe o predicado:

```ts
const { doc: prunedDoc, removed } = removeDecorationObjectsInRect(
  documentRef.current!, rect, isProtectedFromActor,
)
```

**Limpar tudo** (`clearAllFurniture`, linha ~1503): para o comum, remova só o que não é protegido:

```ts
const clearAllFurniture = useCallback(() => {
  const doc = documentRef.current
  if (!doc) return
  const keep = (o: MapObjectV1) =>
    o.type !== 'tile-object' || isProtectedFromActor(o)
  const objects = doc.objects.filter(keep)
  if (objects.length === doc.objects.length) return
  commitOp()
  documentRef.current = { ...doc, objects }
  // ...resto (redesenho/estado dirty) conforme já existe...
}, [/* deps atuais + isProtectedFromActor */])
```

> Ajuste ao corpo real de `clearAllFurniture` mantendo o redesenho da cena já presente; a mudança-chave é o `keep` que preserva `tile-object` protegido.

**Selecionar/girar** (`selectGroup`, linha ~414): bloqueie grupo protegido para o comum:

```ts
const selectGroup = useCallback((groupKey: string) => {
  const doc = documentRef.current
  if (!doc) return
  const groupObjects = tileObjectsInGroup(doc, groupKey)
  if (groupObjects.some((o) => isProtectedFromActor(o))) {
    setState((s) => ({ ...s, limitError: 'Essa peça foi criada pelo admin e não pode ser movida.' }))
    return
  }
  // ...resto inalterado...
}, [/* deps atuais + isProtectedFromActor */])
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/office/editing/useOfficeMapEditing.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
apps/web/node_modules/.bin/tsc -p apps/web --noEmit
git add apps/web/src/office/editing/useOfficeMapEditing.ts apps/web/src/office/editing/decorationDoc.ts apps/web/src/office/editing/useOfficeMapEditing.test.ts
git commit -m "feat(web): proteção em massa e mover respeitam estruturas do admin"
```

---

### Task 6: Verificação final

**Files:** nenhum (só execução).

- [ ] **Step 1: Suíte do shared**

Run: `pnpm --filter @legends/shared test`
Expected: PASS.

- [ ] **Step 2: Suíte da API (Postgres de pé)**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Step 3: Suíte do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS.

- [ ] **Step 4: Typecheck geral**

Run: `pnpm build` (ou os `tsc -p` de cada workspace)
Expected: sem erros.

---

## Self-Review (feita pelo autor do plano)

- **Cobertura do spec:** `createdBy` no objeto (Task 1) ✓; piso estrutural (Task 1) ✓; guard ciente do ator + códigos `PROTECTED_OBJECT_*` (Task 2) ✓; `mergeDecoration` preserva autoria (Task 2) ✓; carimbo server-autoridade + 403 tipado nas três rotas member (Task 3) ✓; web espelha a regra no eraser/rect/clearAll/select (Tasks 4–5) ✓; testes nos três níveis (Tasks 1–5 + 6) ✓. Modelo **comunal** (comum apaga de outro comum) coberto por teste em Task 2 e Task 3 ✓. Fora de escopo (admin editor intocado; tile layer `objects` fora do estrutural; legado protegido) respeitado.
- **Sem placeholders de código:** todo passo que altera código traz o código.
- **Consistência de tipos:** `assertOnlyDecorationChanged(prev, next, { isAdmin })` usado igual em shared/api; `stampObjectOwnership(previous, next, { id, role })`; `isProtectedFromMembers(object)` (shared, sem ator) vs `isProtectedFromActor(object)` (hook web, com base+ator) — nomes distintos de propósito.
- **Nota de simplificação:** o web não carimba `createdBy` otimista — objetos da sessão (fora de `baseDocRef`) são sempre editáveis pelo criador; só peça publicada admin/legado é protegida. Elimina forjar autoria no cliente e mantém o server como autoridade.
