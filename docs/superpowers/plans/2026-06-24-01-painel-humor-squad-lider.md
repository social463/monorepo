# Painel de humor da squad para o líder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o líder de uma squad leia, no próprio perfil e de forma privada, o humor atual e o histórico de humor das demais pessoas da(s) squad(s) que lidera.

**Architecture:** Pré-requisito (Parte A): refatorar o enum de papéis (`DEV→LEGEND`, `LEAD` mantido, novos `MANAGER`/`HEAD`, `ADMIN` mantido) e adicionar `leaderId` ao model `Squad` (um líder por squad; um líder em várias squads). Feature (Parte B): dois endpoints novos (humor atual dos membros das squads lideradas + histórico paginado por membro, autorizado por `leaderId`), tipos em `@legends/shared`, e um componente `SquadMoodPanel` na coluna esquerda do perfil, abaixo da "Galeria de selos", com accordion + scroll infinito.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (api), Vite 5 + React 18 + Tailwind 3 + React Query (web), Vitest (testes), TypeScript ESM, monorepo pnpm. Contrato em `@legends/shared`.

## Global Constraints

- Camadas finas e separadas: **route → service → Prisma**. Sem regra de negócio na route; erros de domínio são classes tipadas com `status` HTTP, tratadas por `instanceof` na route.
- Validação de entrada com **Zod** (`safeParse` → `400 { message, issues }`).
- Contrato compartilhado: **altere o tipo em `@legends/shared` primeiro**, depois os dois lados.
- DTO em `apps/api/src/lib/serialize.ts`.
- Mensagens ao usuário em **português**.
- Testes da API batem em **Postgres real** — exige `pnpm db:up` antes de `pnpm test`. `test/setup.ts` trunca tabelas em `beforeEach`.
- **Nunca editar migration já aplicada** — gerar nova com Prisma.
- Web sempre fala com a API por `/api` (cliente `apiFetch`). Só envia `Content-Type: application/json` quando há corpo.
- `pnpm build`/Vitest **não fazem typecheck completo** — rode `tsc --noEmit` por workspace ao mudar DTOs/includes Prisma.
- Mood: 5 níveis `MoodLevel` (`GREAT|GOOD|NEUTRAL|LOW|HARD`), constantes/labels em `packages/shared/src/mood.ts` (`MOOD_OPTIONS`).
- Visibilidade do painel: só renderiza para o próprio líder (`isOwnProfile && role === "LEAD"`); a barreira real é a autorização por `leaderId` no backend.

---

## Mapa de arquivos

**Parte A — papéis + liderança**
- Modify: `packages/shared/src/enums.ts` — `USER_ROLES`.
- Modify: `apps/api/prisma/schema.prisma` — enum `UserRole`, default de `User.role`, `Squad.leaderId` + relações.
- Create: `apps/api/prisma/migrations/<timestamp>_add_roles_squad_leader/migration.sql` (SQL ajustado à mão).
- Modify: `apps/api/prisma/seed.ts` — `role: "DEV"` → `role: "LEGEND"`.
- Modify (fixtures de teste): todos os `role: 'DEV'` e helpers `'DEV' | 'LEAD'` → `'LEGEND'` (ver Task 2).
- Modify: `packages/shared/src/squad.ts` — `SquadDTO.leaderId`, `SquadWithMembersDTO.leader`, `UpdateSquadRequest.leaderId`.
- Modify: `apps/api/src/services/squad-service.ts` — `squadInclude` + `updateSquad` aceita `leaderId`.
- Modify: `apps/api/src/lib/serialize.ts` — `toSquadDTO`/`toSquadWithMembersDTO` + tipo local `SquadWithMembers`.
- Modify: `apps/api/src/routes/admin.ts` — `updateSquadSchema` aceita `leaderId`.
- Test: `apps/api/src/routes/admin.test.ts` — definir/limpar líder.
- Modify: `apps/web/src/pages/admin/SquadsSection.tsx` — seletor de líder por squad.

**Parte B — feature de humor**
- Create: `packages/shared/src/squad-mood.ts` + barril `packages/shared/src/index.ts`.
- Create: `apps/api/src/services/squad-mood-service.ts`.
- Test: `apps/api/src/services/squad-mood-service.test.ts`.
- Create: `apps/api/src/routes/squad-mood.ts` + registro em `apps/api/src/app.ts`.
- Test: `apps/api/src/routes/squad-mood.test.ts`.
- Create: `apps/web/src/pages/profile/SquadMoodPanel.tsx`.
- Test: `apps/web/src/pages/profile/SquadMoodPanel.test.tsx`.
- Modify: `apps/web/src/pages/ProfilePage.tsx` — wrapper da coluna esquerda + render do painel.

---

## Parte A — Papéis + liderança de squad

### Task 1: Atualizar `USER_ROLES` em `@legends/shared`

**Files:**
- Modify: `packages/shared/src/enums.ts:1`

**Interfaces:**
- Produces: `USER_ROLES = ['LEGEND','LEAD','MANAGER','HEAD','ADMIN']`; tipo `UserRole`.

- [ ] **Step 1: Editar o enum compartilhado**

Em `packages/shared/src/enums.ts`, trocar a linha 1:

```ts
export const USER_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD', 'ADMIN'] as const
```

(`UserRole` já deriva de `USER_ROLES`, não muda.)

- [ ] **Step 2: Build do shared**

Run: `pnpm --filter @legends/shared build`
Expected: build OK (sem erros de tipo).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/enums.ts
git commit -m "feat(shared): novos papéis LEGEND/MANAGER/HEAD no enum de roles"
```

---

### Task 2: Schema Prisma — enum, default e `Squad.leaderId` + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:10-14` (enum), `:61` (default), `:120-129` (Squad), `:50-90` (User relations)
- Create: `apps/api/prisma/migrations/<timestamp>_add_roles_squad_leader/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Modify: fixtures de teste com `role: 'DEV'`

**Interfaces:**
- Produces: enum `UserRole { LEGEND LEAD MANAGER HEAD ADMIN }`; `Squad.leaderId` + relação `leader`/`ledSquads`.

- [ ] **Step 1: Editar o enum e o default no schema**

Em `apps/api/prisma/schema.prisma`, trocar o enum (linhas 10-14):

```prisma
enum UserRole {
  LEGEND
  LEAD
  MANAGER
  HEAD
  ADMIN
}
```

E o default do campo `role` (linha 61):

```prisma
  role         UserRole @default(LEGEND)
```

- [ ] **Step 2: Adicionar `leaderId` ao model `Squad`**

No model `Squad` (após a linha `active`/`createdAt`, antes de `members`):

```prisma
model Squad {
  id        String   @id @default(cuid())
  name      String   @unique
  slug      String   @unique
  active    Boolean  @default(true)
  leaderId  String?
  createdAt DateTime @default(now())

  leader  User?            @relation("SquadLeader", fields: [leaderId], references: [id], onDelete: SetNull)
  members SquadMember[]
  rooms   RetroRoomSquad[]

  @@index([leaderId])
}
```

- [ ] **Step 3: Adicionar a back-relation no model `User`**

No model `User`, junto das outras relações (ex.: após `squadMemberships`):

```prisma
  ledSquads           Squad[]            @relation("SquadLeader")
```

- [ ] **Step 4: Gerar a migration SEM aplicar**

Run: `pnpm --filter @legends/api exec prisma migrate dev --create-only --name add_roles_squad_leader`
Expected: cria a pasta de migration com um `migration.sql` (provavelmente destrutivo para o enum — será substituído no próximo passo).

- [ ] **Step 5: Substituir o conteúdo do `migration.sql` por SQL seguro**

Abrir o `apps/api/prisma/migrations/<timestamp>_add_roles_squad_leader/migration.sql` recém-criado e **substituir todo o conteúdo** por:

```sql
-- Renomeia DEV -> LEGEND (preserva dados e default existentes) e adiciona novos valores.
ALTER TYPE "UserRole" RENAME VALUE 'DEV' TO 'LEGEND';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'HEAD';

-- Default explícito do papel.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'LEGEND';

-- Liderança da squad.
ALTER TABLE "Squad" ADD COLUMN "leaderId" TEXT;
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Squad_leaderId_idx" ON "Squad"("leaderId");
```

> Nota: `ALTER TYPE ... ADD VALUE` roda dentro da transação da migration no PostgreSQL ≥ 12 desde que o novo valor não seja **usado** na mesma transação — aqui só usamos `LEGEND` (renomeado, já existente) no `SET DEFAULT`, então é seguro.

- [ ] **Step 6: Aplicar a migration e regenerar o client**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev`
Expected: aplica a migration `add_roles_squad_leader` sem erros; "Already in sync"/migração aplicada.

Run: `pnpm db:generate`
Expected: Prisma Client regenerado com o novo enum e `Squad.leaderId`.

- [ ] **Step 7: Atualizar o seed**

Em `apps/api/prisma/seed.ts`, substituir as ocorrências de `role: "DEV"` por `role: "LEGEND"` (os devs viram lendas). `role: "LEAD"` permanece.

Run: `grep -n "DEV" apps/api/prisma/seed.ts`
Expected: nenhuma ocorrência de `"DEV"` como papel restante.

- [ ] **Step 8: Atualizar fixtures de teste (`'DEV'` → `'LEGEND'`)**

Após a migration, o enum não tem mais `DEV`; testes que criam `role: 'DEV'` quebram em runtime e em tipo. Substituir em todos os arquivos de teste:

Run: `grep -rln "'DEV'" apps/api/src`
Expected: lista de arquivos (ex.: `serialize.test.ts`, `serialize-retro.test.ts`, `admin.test.ts`, `retro-*.test.ts`, `profile-actions.test.ts`, `notification-service.test.ts`).

Em cada um, trocar `'DEV'` por `'LEGEND'` — inclusive nas assinaturas de helpers `role: 'DEV' | 'LEAD'` → `role: 'LEGEND' | 'LEAD'` e nos defaults `= 'DEV'` → `= 'LEGEND'`. **Não** mexer em `'LEAD'`/`'ADMIN'`.

Run: `grep -rn "'DEV'" apps/api/src`
Expected: nenhuma ocorrência.

Run: `grep -rn "toBe('DEV')\|role: 'DEV'" apps/api/src`
Expected: nenhuma (ex.: `admin.test.ts:298` `expect(...).toBe('DEV')` → `toBe('LEGEND')`).

- [ ] **Step 9: Typecheck da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Rodar a suíte da API**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS (verde) — confirma que o rename de papéis não quebrou nada.

- [ ] **Step 11: Commit**

```bash
git add apps/api/prisma packages/shared apps/api/src
git commit -m "feat(api): migra papéis (DEV->LEGEND, +MANAGER/HEAD) e adiciona Squad.leaderId"
```

---

### Task 3: Backend — definir líder da squad (service + serialize + route + contrato)

**Files:**
- Modify: `packages/shared/src/squad.ts`
- Modify: `apps/api/src/services/squad-service.ts:15-17,48-70`
- Modify: `apps/api/src/lib/serialize.ts:397-408`
- Modify: `apps/api/src/routes/admin.ts` (schema `updateSquadSchema`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `Squad.leaderId` (Task 2).
- Produces: `updateSquad(id, { name?, active?, leaderId? })`; `SquadWithMembersDTO.leader: { id, name } | null`; `SquadDTO.leaderId: string | null`; `UpdateSquadRequest.leaderId?: string | null`.

- [ ] **Step 1: Escrever o teste de definir/limpar líder (falha)**

Adicionar em `apps/api/src/routes/admin.test.ts` (seguindo o padrão de criação de usuários/squads e token admin já usado no arquivo):

```ts
it('define e limpa o líder de uma squad', async () => {
  const admin = await prisma.user.create({ data: { name: 'Adm', email: 'adm-leader@x.com', passwordHash: 'x', role: 'ADMIN' } })
  const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia-leader@x.com', passwordHash: 'x', role: 'LEAD' } })
  const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN' })
  const squad = await prisma.squad.create({ data: { name: 'Squad X', slug: 'squad-x' } })

  const set = await app.inject({
    method: 'PATCH', url: `/admin/squads/${squad.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { leaderId: lead.id },
  })
  expect(set.statusCode).toBe(200)
  expect(set.json().squad.leaderId).toBe(lead.id)
  expect(set.json().squad.leader).toEqual({ id: lead.id, name: 'Lia' })

  const clear = await app.inject({
    method: 'PATCH', url: `/admin/squads/${squad.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { leaderId: null },
  })
  expect(clear.statusCode).toBe(200)
  expect(clear.json().squad.leaderId).toBeNull()
  expect(clear.json().squad.leader).toBeNull()
})

it('rejeita líder inexistente', async () => {
  const admin = await prisma.user.create({ data: { name: 'Adm2', email: 'adm2-leader@x.com', passwordHash: 'x', role: 'ADMIN' } })
  const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN' })
  const squad = await prisma.squad.create({ data: { name: 'Squad Y', slug: 'squad-y' } })
  const res = await app.inject({
    method: 'PATCH', url: `/admin/squads/${squad.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { leaderId: 'nao-existe' },
  })
  expect(res.statusCode).toBe(400)
})
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- admin.test`
Expected: FAIL — `leaderId`/`leader` não existem no DTO; `leaderId` ignorado pelo schema/serviço.

- [ ] **Step 3: Atualizar o contrato em `packages/shared/src/squad.ts`**

```ts
export interface SquadDTO {
  id: string
  name: string
  slug: string
  active: boolean
  leaderId: string | null
}

export interface SquadMemberDTO {
  id: string
  name: string
}

export interface SquadWithMembersDTO extends SquadDTO {
  leader: SquadMemberDTO | null
  members: SquadMemberDTO[]
}

export interface CreateSquadRequest {
  name: string
}

export interface UpdateSquadRequest {
  name?: string
  active?: boolean
  leaderId?: string | null
}

export interface AddSquadMemberRequest {
  userId: string
}
```

Run: `pnpm --filter @legends/shared build`
Expected: OK.

- [ ] **Step 4: Incluir `leader` no `squadInclude` e tratar `leaderId` em `updateSquad`**

Em `apps/api/src/services/squad-service.ts`, atualizar `squadInclude` (linhas 15-17):

```ts
export const squadInclude = {
  leader: true,
  members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
} as const
```

E no `updateSquad`, ampliar a assinatura e o corpo (linhas 48-70):

```ts
export async function updateSquad(
  id: string,
  input: { name?: string; active?: boolean; leaderId?: string | null },
): Promise<SquadWithMembers> {
  const data: Prisma.SquadUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.leaderId !== undefined) {
    if (input.leaderId === null) {
      data.leader = { disconnect: true }
    } else {
      const leader = await prisma.user.findUnique({ where: { id: input.leaderId } })
      if (!leader || !leader.active) throw new SquadError('Líder inválido.', 400)
      data.leader = { connect: { id: input.leaderId } }
    }
  }
  try {
    await prisma.squad.update({ where: { id }, data })
    return loadSquad(id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SquadError('Squad não encontrada.', 404)
      if (err.code === 'P2002') throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}
```

- [ ] **Step 5: Atualizar os serializers**

Em `apps/api/src/lib/serialize.ts`, atualizar o tipo local e as funções (linhas 397-408):

```ts
type SquadWithMembers = Prisma.SquadGetPayload<{
  include: { leader: true; members: { include: { user: true } } }
}>

export function toSquadDTO(squad: Squad): SquadDTO {
  return { id: squad.id, name: squad.name, slug: squad.slug, active: squad.active, leaderId: squad.leaderId }
}

export function toSquadWithMembersDTO(squad: SquadWithMembers): SquadWithMembersDTO {
  return {
    ...toSquadDTO(squad),
    leader: squad.leader ? { id: squad.leader.id, name: squad.leader.name } : null,
    members: squad.members.map((m) => ({ id: m.user.id, name: m.user.name })),
  }
}
```

- [ ] **Step 6: Aceitar `leaderId` no schema Zod do admin**

Em `apps/api/src/routes/admin.ts`, localizar `updateSquadSchema` (definido no topo do arquivo) e adicionar o campo. Resultado:

```ts
const updateSquadSchema = z.object({
  name: z.string().optional(),
  active: z.boolean().optional(),
  leaderId: z.string().nullable().optional(),
})
```

(A route `PATCH /admin/squads/:id` já repassa `parsed.data` para `updateSquad` — nada mais a mudar lá.)

- [ ] **Step 7: Rodar os testes (passam)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- admin.test`
Expected: PASS, incluindo os dois testes novos.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/squad.ts apps/api/src
git commit -m "feat(api): define líder da squad via admin (leaderId em updateSquad/DTO)"
```

---

### Task 4: Admin UI — seletor de líder por squad

**Files:**
- Modify: `apps/web/src/pages/admin/SquadsSection.tsx`

**Interfaces:**
- Consumes: `SquadWithMembersDTO.leader`/`leaderId`; `PATCH /admin/squads/:id` com `{ leaderId }`.

- [ ] **Step 1: Adicionar a mutation de líder**

Em `apps/web/src/pages/admin/SquadsSection.tsx`, junto das outras mutations (após `toggleSquad`):

```tsx
  const setLeader = useMutation({
    mutationFn: (vars: { id: string; leaderId: string | null }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ leaderId: vars.leaderId }),
      }),
    onSuccess: invalidate,
  })
```

- [ ] **Step 2: Renderizar o seletor de líder dentro do card da squad**

Dentro do `<li>` de cada squad, logo após o `<div className="flex items-center justify-between">` (antes da lista de membros), inserir:

```tsx
              <div className="mt-sm flex items-center gap-sm">
                <span className="font-label text-label-sm text-on-surface-variant">Líder:</span>
                <select
                  aria-label={`Líder da ${squad.name}`}
                  className={inputCls}
                  value={squad.leaderId ?? ''}
                  onChange={(e) => setLeader.mutate({ id: squad.id, leaderId: e.target.value || null })}
                >
                  <option value="">Sem líder</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
```

- [ ] **Step 3: Typecheck e build do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/admin/SquadsSection.tsx
git commit -m "feat(web): seletor de líder por squad no admin"
```

---

## Parte B — Feature de humor

### Task 5: Contrato compartilhado dos DTOs de humor da squad

**Files:**
- Create: `packages/shared/src/squad-mood.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `MoodSnapshotDTO`, `SquadMemberMoodDTO`, `LedSquadMoodsDTO`, `MoodHistoryEntryDTO`, `MoodHistoryPageDTO`.

- [ ] **Step 1: Criar o arquivo de tipos**

Criar `packages/shared/src/squad-mood.ts`:

```ts
import type { AvatarOptions, AvatarStyleKey } from './avatar'
import type { MoodLevel } from './mood'

// `day` em YYYY-MM-DD (data civil em America/Sao_Paulo).
export interface MoodSnapshotDTO {
  day: string
  mood: MoodLevel
  note: string | null
}

export interface SquadMemberMoodDTO {
  id: string
  name: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: AvatarOptions | null
  // Humor mais recente registrado pela pessoa (null se nunca registrou).
  currentMood: MoodSnapshotDTO | null
}

export interface LedSquadMoodsDTO {
  squadId: string
  squadName: string
  members: SquadMemberMoodDTO[]
}

export interface MoodHistoryEntryDTO {
  day: string
  mood: MoodLevel
  note: string | null
}

export interface MoodHistoryPageDTO {
  entries: MoodHistoryEntryDTO[]
  nextCursor: string | null
}
```

> Confirme que `packages/shared/src/avatar.ts` exporta `AvatarOptions` e `AvatarStyleKey` (são consumidos por `serialize.ts` via `@legends/shared`). Se o caminho do import divergir, ajuste para o módulo correto.

- [ ] **Step 2: Exportar no barril**

Em `packages/shared/src/index.ts`, adicionar (junto dos outros `export *`):

```ts
export * from './squad-mood'
```

- [ ] **Step 3: Build do shared**

Run: `pnpm --filter @legends/shared build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/squad-mood.ts packages/shared/src/index.ts
git commit -m "feat(shared): DTOs de humor da squad para o líder"
```

---

### Task 6: Service de humor da squad (autorização + histórico paginado)

**Files:**
- Create: `apps/api/src/services/squad-mood-service.ts`
- Test: `apps/api/src/services/squad-mood-service.test.ts`

**Interfaces:**
- Consumes: `Squad.leaderId`, `SquadMember`, `MoodEntry`; tipos de `@legends/shared` (Task 5).
- Produces:
  - `getLedSquadsWithMoods(leaderId: string): Promise<LedSquadMoodsDTO[]>`
  - `getMemberMoodHistory(leaderId: string, memberId: string, cursor: string | null, limit: number): Promise<MoodHistoryPageDTO>`
  - `class MoodAccessError extends Error { status: number }`

- [ ] **Step 1: Escrever o teste do service (falha)**

Criar `apps/api/src/services/squad-mood-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  getLedSquadsWithMoods,
  getMemberMoodHistory,
  MoodAccessError,
} from './squad-mood-service'

async function mkUser(name: string, email: string) {
  return prisma.user.create({ data: { name, email, passwordHash: 'x', role: 'LEGEND' } })
}

function dateOf(ymd: string) {
  return new Date(ymd) // UTC midnight, compatível com @db.Date
}

describe('squad-mood-service', () => {
  it('lista squads lideradas com o humor atual de cada membro (exclui o líder)', async () => {
    const lead = await mkUser('Lia', 'lia@x.com')
    const ana = await mkUser('Ana', 'ana@x.com')
    const bob = await mkUser('Bob', 'bob@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Alpha', slug: 'alpha', leaderId: lead.id } })
    await prisma.squadMember.createMany({
      data: [
        { squadId: squad.id, userId: ana.id },
        { squadId: squad.id, userId: bob.id },
        { squadId: squad.id, userId: lead.id }, // líder também membro: deve ser excluído
      ],
    })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-20'), mood: 'GOOD', note: 'ok' } })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-22'), mood: 'GREAT', note: null } })
    // Bob sem registro.

    const result = await getLedSquadsWithMoods(lead.id)
    expect(result).toHaveLength(1)
    expect(result[0].squadName).toBe('Alpha')
    const names = result[0].members.map((m) => m.name).sort()
    expect(names).toEqual(['Ana', 'Bob'])
    const anaDto = result[0].members.find((m) => m.name === 'Ana')!
    expect(anaDto.currentMood).toEqual({ day: '2026-06-22', mood: 'GREAT', note: null })
    const bobDto = result[0].members.find((m) => m.name === 'Bob')!
    expect(bobDto.currentMood).toBeNull()
  })

  it('retorna vazio quando o usuário não lidera nenhuma squad', async () => {
    const someone = await mkUser('Zé', 'ze@x.com')
    expect(await getLedSquadsWithMoods(someone.id)).toEqual([])
  })

  it('histórico paginado por dia desc, com cursor', async () => {
    const lead = await mkUser('Lia2', 'lia2@x.com')
    const ana = await mkUser('Ana2', 'ana2@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Beta', slug: 'beta', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    for (const d of ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22']) {
      await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf(d), mood: 'NEUTRAL', note: d } })
    }
    const page1 = await getMemberMoodHistory(lead.id, ana.id, null, 2)
    expect(page1.entries.map((e) => e.day)).toEqual(['2026-06-22', '2026-06-21'])
    expect(page1.nextCursor).toBe('2026-06-21')

    const page2 = await getMemberMoodHistory(lead.id, ana.id, page1.nextCursor, 2)
    expect(page2.entries.map((e) => e.day)).toEqual(['2026-06-20', '2026-06-19'])
    expect(page2.nextCursor).toBe('2026-06-19')

    const page3 = await getMemberMoodHistory(lead.id, ana.id, page2.nextCursor, 2)
    expect(page3.entries.map((e) => e.day)).toEqual(['2026-06-18'])
    expect(page3.nextCursor).toBeNull()
  })

  it('nega histórico se o requisitante não lidera squad do alvo (403)', async () => {
    const lead = await mkUser('Lia3', 'lia3@x.com')
    const outroLead = await mkUser('Léo', 'leo@x.com')
    const ana = await mkUser('Ana3', 'ana3@x.com')
    const squadA = await prisma.squad.create({ data: { name: 'A', slug: 'a', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squadA.id, userId: ana.id } })

    await expect(getMemberMoodHistory(outroLead.id, ana.id, null, 10)).rejects.toMatchObject({
      name: 'MoodAccessError',
      status: 403,
    })
    expect(MoodAccessError).toBeDefined()
  })
})
```

- [ ] **Step 2: Rodar (falha)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- squad-mood-service`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o service**

Criar `apps/api/src/services/squad-mood-service.ts`:

```ts
import type {
  AvatarOptions,
  AvatarStyleKey,
  LedSquadMoodsDTO,
  MoodHistoryPageDTO,
  MoodLevel,
} from '@legends/shared'
import { prisma } from '../lib/prisma'

export class MoodAccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'MoodAccessError'
  }
}

// @db.Date volta como Date à meia-noite UTC; o ISO já é o YYYY-MM-DD correto.
function ymd(day: Date): string {
  return day.toISOString().slice(0, 10)
}

export async function getLedSquadsWithMoods(leaderId: string): Promise<LedSquadMoodsDTO[]> {
  const squads = await prisma.squad.findMany({
    where: { leaderId, active: true },
    include: { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
    orderBy: { name: 'asc' },
  })

  const result: LedSquadMoodsDTO[] = []
  for (const squad of squads) {
    const members = squad.members.filter((m) => m.userId !== leaderId)
    const memberDTOs = await Promise.all(
      members.map(async (m) => {
        const latest = await prisma.moodEntry.findFirst({
          where: { userId: m.userId },
          orderBy: { day: 'desc' },
        })
        return {
          id: m.user.id,
          name: m.user.name,
          photoUrl: m.user.photoUrl,
          avatarStyle: m.user.avatarStyle as AvatarStyleKey | null,
          avatarSeed: m.user.avatarSeed,
          avatarOptions: (m.user.avatarOptions as AvatarOptions | null) ?? null,
          currentMood: latest
            ? { day: ymd(latest.day), mood: latest.mood as MoodLevel, note: latest.note }
            : null,
        }
      }),
    )
    result.push({ squadId: squad.id, squadName: squad.name, members: memberDTOs })
  }
  return result
}

export async function getMemberMoodHistory(
  leaderId: string,
  memberId: string,
  cursor: string | null,
  limit: number,
): Promise<MoodHistoryPageDTO> {
  // Autorização: o líder precisa liderar alguma squad da qual o alvo é membro.
  const shared = await prisma.squad.findFirst({
    where: { leaderId, members: { some: { userId: memberId } } },
    select: { id: true },
  })
  if (!shared) throw new MoodAccessError('Sem acesso ao histórico deste integrante.', 403)

  const where: { userId: string; day?: { lt: Date } } = { userId: memberId }
  if (cursor) where.day = { lt: new Date(cursor) }

  const rows = await prisma.moodEntry.findMany({
    where,
    orderBy: { day: 'desc' },
    take: limit + 1,
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const entries = page.map((r) => ({ day: ymd(r.day), mood: r.mood as MoodLevel, note: r.note }))
  const nextCursor = hasMore ? entries[entries.length - 1].day : null
  return { entries, nextCursor }
}
```

- [ ] **Step 4: Rodar (passa)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- squad-mood-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/squad-mood-service.ts apps/api/src/services/squad-mood-service.test.ts
git commit -m "feat(api): service de humor da squad (autorização por leaderId + histórico paginado)"
```

---

### Task 7: Rotas de humor da squad

**Files:**
- Create: `apps/api/src/routes/squad-mood.ts`
- Modify: `apps/api/src/app.ts:24,73`
- Test: `apps/api/src/routes/squad-mood.test.ts`

**Interfaces:**
- Consumes: `getLedSquadsWithMoods`, `getMemberMoodHistory`, `MoodAccessError` (Task 6).
- Produces: `GET /me/led-squads/moods` → `{ squads: LedSquadMoodsDTO[] }`; `GET /users/:userId/mood-history?cursor=&limit=` → `MoodHistoryPageDTO` (403 para não-líder).

- [ ] **Step 1: Escrever o teste das rotas (falha)**

Criar `apps/api/src/routes/squad-mood.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: FastifyInstance
beforeAll(async () => { app = buildApp(); await app.ready() })
afterAll(async () => { await app.close() })

async function mkUser(name: string, email: string) {
  return prisma.user.create({ data: { name, email, passwordHash: 'x', role: 'LEGEND' } })
}
function tokenFor(app: FastifyInstance, id: string) {
  return app.jwt.sign({ sub: id, role: 'LEAD' })
}

describe('rotas de humor da squad', () => {
  it('GET /me/led-squads/moods retorna squads lideradas com humor atual', async () => {
    const lead = await mkUser('Lia', 'lia-r@x.com')
    const ana = await mkUser('Ana', 'ana-r@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Alpha', slug: 'alpha-r', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: new Date('2026-06-22'), mood: 'GREAT', note: null } })

    const res = await app.inject({
      method: 'GET', url: '/me/led-squads/moods',
      headers: { authorization: `Bearer ${tokenFor(app, lead.id)}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.squads).toHaveLength(1)
    expect(body.squads[0].members[0]).toMatchObject({ name: 'Ana', currentMood: { mood: 'GREAT', day: '2026-06-22' } })
  })

  it('GET /users/:id/mood-history pagina com cursor', async () => {
    const lead = await mkUser('Lia2', 'lia2-r@x.com')
    const ana = await mkUser('Ana2', 'ana2-r@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Beta', slug: 'beta-r', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    for (const d of ['2026-06-20', '2026-06-21', '2026-06-22']) {
      await prisma.moodEntry.create({ data: { userId: ana.id, day: new Date(d), mood: 'GOOD', note: d } })
    }
    const res = await app.inject({
      method: 'GET', url: `/users/${ana.id}/mood-history?limit=2`,
      headers: { authorization: `Bearer ${tokenFor(app, lead.id)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().entries.map((e: { day: string }) => e.day)).toEqual(['2026-06-22', '2026-06-21'])
    expect(res.json().nextCursor).toBe('2026-06-21')
  })

  it('GET /users/:id/mood-history nega não-líder com 403', async () => {
    const outro = await mkUser('Léo', 'leo-r@x.com')
    const ana = await mkUser('Ana3', 'ana3-r@x.com')
    const lead = await mkUser('Lia3', 'lia3-r@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Gama', slug: 'gama-r', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    const res = await app.inject({
      method: 'GET', url: `/users/${ana.id}/mood-history`,
      headers: { authorization: `Bearer ${tokenFor(app, outro.id)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('exige autenticação (401 sem token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/me/led-squads/moods' })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Rodar (falha)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- squad-mood.test`
Expected: FAIL — rota inexistente (404).

- [ ] **Step 3: Implementar as rotas**

Criar `apps/api/src/routes/squad-mood.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { MoodHistoryPageDTO } from '@legends/shared'
import {
  getLedSquadsWithMoods,
  getMemberMoodHistory,
  MoodAccessError,
} from '../services/squad-mood-service'

const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export async function squadMoodRoutes(app: FastifyInstance) {
  app.get('/me/led-squads/moods', { onRequest: [app.authenticate] }, async (request, reply) => {
    const squads = await getLedSquadsWithMoods(request.user.sub)
    return reply.send({ squads })
  })

  app.get('/users/:userId/mood-history', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = historyQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const page: MoodHistoryPageDTO = await getMemberMoodHistory(
        request.user.sub,
        userId,
        parsed.data.cursor ?? null,
        parsed.data.limit ?? 10,
      )
      return reply.send(page)
    } catch (err) {
      if (err instanceof MoodAccessError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Registrar as rotas no app**

Em `apps/api/src/app.ts`, adicionar o import (junto dos demais, ~linha 24):

```ts
import { squadMoodRoutes } from './routes/squad-mood'
```

E o registro (junto dos demais `app.register`, ~linha 73):

```ts
  app.register(squadMoodRoutes)
```

- [ ] **Step 5: Rodar (passa)**

Run: `pnpm db:up && pnpm --filter @legends/api test -- squad-mood.test`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/squad-mood.ts apps/api/src/routes/squad-mood.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de humor da squad (led-squads/moods + mood-history)"
```

---

### Task 8: Componente `SquadMoodPanel` (accordion + scroll infinito)

**Files:**
- Create: `apps/web/src/pages/profile/SquadMoodPanel.tsx`
- Test: `apps/web/src/pages/profile/SquadMoodPanel.test.tsx`

**Interfaces:**
- Consumes: `GET /me/led-squads/moods` → `{ squads: LedSquadMoodsDTO[] }`; `GET /users/:id/mood-history` → `MoodHistoryPageDTO`; componente `Avatar`, `Icon`; `MOOD_OPTIONS`.
- Produces: `export function SquadMoodPanel()` (sem props; busca os próprios dados).

- [ ] **Step 1: Escrever o teste do componente (falha)**

Criar `apps/web/src/pages/profile/SquadMoodPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SquadMoodPanel } from './SquadMoodPanel'
import * as api from '../../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const squadsPayload = {
  squads: [
    {
      squadId: 's1',
      squadName: 'Alpha',
      members: [
        {
          id: 'u-ana', name: 'Ana', photoUrl: null,
          avatarStyle: null, avatarSeed: null, avatarOptions: null,
          currentMood: { day: '2026-06-22', mood: 'GREAT', note: null },
        },
        {
          id: 'u-bob', name: 'Bob', photoUrl: null,
          avatarStyle: null, avatarSeed: null, avatarOptions: null,
          currentMood: null,
        },
      ],
    },
  ],
}

beforeEach(() => vi.restoreAllMocks())

describe('SquadMoodPanel', () => {
  it('mostra a squad e o humor atual de cada membro', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue(squadsPayload as never)
    wrap(<SquadMoodPanel />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(/Sem registro/i)).toBeInTheDocument()
  })

  it('expandir um membro busca e lista o histórico com a nota', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/me/led-squads/moods')) return squadsPayload as never
      if (path.startsWith('/users/u-ana/mood-history')) {
        return {
          entries: [
            { day: '2026-06-22', mood: 'GREAT', note: 'semana ótima' },
            { day: '2026-06-21', mood: 'GOOD', note: null },
          ],
          nextCursor: null,
        } as never
      }
      throw new Error(`unexpected ${path}`)
    })
    wrap(<SquadMoodPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    expect(await screen.findByText('semana ótima')).toBeInTheDocument()
  })

  it('não renderiza nada quando não há squads lideradas', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({ squads: [] } as never)
    const { container } = wrap(<SquadMoodPanel />)
    await waitFor(() => expect(api.apiFetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Rodar (falha)**

Run: `pnpm --filter @legends/web test -- SquadMoodPanel`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o componente**

Criar `apps/web/src/pages/profile/SquadMoodPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  LedSquadMoodsDTO,
  MoodHistoryPageDTO,
  MoodLevel,
  SquadMemberMoodDTO,
} from "@legends/shared";
import { MOOD_OPTIONS } from "@legends/shared";
import { apiFetch } from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";

const MOOD_BY_VALUE = Object.fromEntries(
  MOOD_OPTIONS.map((o) => [o.value, { emoji: o.emoji, label: o.label }]),
) as Record<MoodLevel, { emoji: string; label: string }>;

function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

export function SquadMoodPanel() {
  const squadsQuery = useQuery({
    queryKey: ["led-squads-moods"],
    queryFn: () =>
      apiFetch<{ squads: LedSquadMoodsDTO[] }>("/me/led-squads/moods"),
  });

  const squads = squadsQuery.data?.squads ?? [];
  // Não lidera nenhuma squad (ou ainda carregando) → não ocupa espaço.
  if (squads.length === 0) return null;

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <h3 className="mb-lg font-headline text-headline-md text-on-surface">
        Humor da squad
      </h3>
      <div className="flex flex-col gap-lg">
        {squads.map((squad) => (
          <div key={squad.squadId}>
            <h4 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">
              {squad.squadName}
            </h4>
            {squad.members.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Sem integrantes.
              </p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {squad.members.map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: SquadMemberMoodDTO }) {
  const [open, setOpen] = useState(false);
  const current = member.currentMood;
  const meta = current ? MOOD_BY_VALUE[current.mood] : null;

  return (
    <li className="overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-md p-md text-left transition-colors hover:bg-surface-container-high"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-container/20">
          <Avatar user={member} />
        </span>
        <span className="flex-grow font-label text-label-md text-on-surface">
          {member.name}
        </span>
        <span className="shrink-0 font-body text-body-sm text-on-surface-variant">
          {meta ? (
            <>
              <span aria-hidden>{meta.emoji}</span> {meta.label} ·{" "}
              {formatDay(current!.day)}
            </>
          ) : (
            "Sem registro"
          )}
        </span>
        <Icon
          name={open ? "expand_less" : "expand_more"}
          className="shrink-0 text-[20px] text-on-surface-variant"
        />
      </button>
      {open && <MemberHistory memberId={member.id} />}
    </li>
  );
}

function MemberHistory({ memberId }: { memberId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["mood-history", memberId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", "10");
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<MoodHistoryPageDTO>(
        `/users/${memberId}/mood-history?${params.toString()}`,
      );
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: containerRef.current },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  if (query.isLoading) {
    return (
      <p className="px-md pb-md text-body-sm text-on-surface-variant">
        Carregando…
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="px-md pb-md text-body-sm text-on-surface-variant">
        Sem histórico.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="max-h-72 overflow-y-auto px-md pb-md">
      <ul className="flex flex-col gap-xs">
        {entries.map((e) => {
          const meta = MOOD_BY_VALUE[e.mood];
          return (
            <li
              key={e.day}
              className="flex items-start gap-sm border-t border-outline-variant/10 pt-xs first:border-t-0 first:pt-0"
            >
              <span aria-hidden className="text-[18px] leading-none">
                {meta.emoji}
              </span>
              <div className="flex-grow">
                <div className="flex items-center justify-between gap-sm">
                  <span className="font-label text-label-sm text-on-surface">
                    {meta.label}
                  </span>
                  <span className="font-label text-label-sm text-on-surface-variant">
                    {formatDay(e.day)}
                  </span>
                </div>
                {e.note && (
                  <p className="mt-0.5 text-body-sm text-on-surface-variant">
                    {e.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && (
        <p className="pt-sm text-center text-body-sm text-on-surface-variant">
          Carregando…
        </p>
      )}
    </div>
  );
}
```

> Confirme que existe um glyph válido para `Icon name="expand_more"/"expand_less"` no projeto (Material Symbols). Se o set usado for diferente, troque pelos nomes equivalentes já usados em outros accordions/toggles.

- [ ] **Step 4: Garantir o stub de `IntersectionObserver` nos testes**

`jsdom` não implementa `IntersectionObserver`. Verifique se já há stub global em `apps/web/src/test/setup.ts` (ou equivalente configurado no Vitest). Se **não** houver, adicionar no setup global:

```ts
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
// @ts-expect-error jsdom não tem IntersectionObserver
globalThis.IntersectionObserver = globalThis.IntersectionObserver ?? IO
```

(O teste do componente não depende de o observer disparar — a primeira página vem do `useInfiniteQuery`; o stub só evita o crash de referência.)

- [ ] **Step 5: Rodar (passa)**

Run: `pnpm --filter @legends/web test -- SquadMoodPanel`
Expected: PASS.

- [ ] **Step 6: Typecheck do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/profile/SquadMoodPanel.tsx apps/web/src/pages/profile/SquadMoodPanel.test.tsx apps/web/src/test/setup.ts
git commit -m "feat(web): painel de humor da squad (accordion + scroll infinito)"
```

---

### Task 9: Integrar o painel no perfil do líder (layout de coluna)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx:23,514-531`

**Interfaces:**
- Consumes: `SquadMoodPanel` (Task 8); `isOwnProfile`, `isLead` já existentes em `ProfilePage`.

- [ ] **Step 1: Importar o componente**

Em `apps/web/src/pages/ProfilePage.tsx`, junto dos imports de `./profile/*` (após a linha 23 `import { MoodOfDay } ...`):

```tsx
import { SquadMoodPanel } from "./profile/SquadMoodPanel";
```

- [ ] **Step 2: Envolver a coluna esquerda do bloco `isLead` e renderizar o painel**

Substituir o bloco `isLead` (linhas 514-531) por:

```tsx
          {isLead && (
            <div className="grid grid-cols-12 items-start gap-lg">
              {/* Coluna esquerda: galeria + painel de humor empilhados, largura de 1 coluna */}
              <div className="col-span-12 flex flex-col gap-lg lg:col-span-5">
                <BadgeGallery
                  badges={badges}
                  emptyLabel="Nenhum selo atribuído ainda."
                  className=""
                  highlightId={highlightBadgeId}
                  editable={isOwnProfile}
                  onSaveFeatured={saveFeatured}
                />
                {/* Humor da squad: privado, só no próprio perfil do líder. */}
                {isOwnProfile && <SquadMoodPanel />}
              </div>

              {/* Área de feedbacks (substitui o histórico de reconhecimento) */}
              <div className="col-span-12 lg:col-span-7">
                <FeedbackSection
                  targetId={user.id}
                  highlightId={highlightFeedbackId}
                />
              </div>
            </div>
          )}
```

Notas:
- `BadgeGallery` perdeu a prop `className="col-span-12 lg:col-span-5"` — agora quem dá a largura é o wrapper. (`BadgeGallery` aceita `className` opcional; ausente, usa só o estilo base.)
- `FeedbackSection` passou a ficar dentro de um wrapper `lg:col-span-7` para preservar o layout de duas colunas. Se `FeedbackSection` já aplicava `col-span` próprio internamente, remova a duplicação mantendo o resultado de 7 colunas (verifique o root do componente).

- [ ] **Step 3: Typecheck e testes do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: PASS (testes existentes do ProfilePage continuam verdes).

- [ ] **Step 4: Verificação visual rápida**

Run: `pnpm dev`
Verificar manualmente, logado como um usuário `LEAD` que lidera uma squad com membros: no próprio perfil, abaixo da "Galeria de selos", aparece "Humor da squad" agrupado por squad; expandir um membro carrega o histórico; rolar carrega mais. Conferir que o painel **não** aparece ao visitar o perfil de outra pessoa nem para papéis não-LEAD.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): exibe painel de humor da squad no perfil do líder (layout de coluna)"
```

---

## Verificação final

- [ ] **Suíte completa da API**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Suíte completa do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS.

- [ ] **Typecheck dos workspaces alterados**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Build geral**

Run: `pnpm build`
Expected: build de todos os workspaces OK.

---

## Notas de risco / decisões

- **Migration de enum**: o passo de substituir o `migration.sql` gerado é crítico — o SQL automático do Prisma para enums costuma recriar o tipo e perder dados. O SQL manual usa `RENAME VALUE` + `ADD VALUE`.
- **`LEAD` e `ADMIN` inalterados**: minimiza o blast radius — `requireAdmin`, `retro-ws` (`role !== 'LEAD'`), `isLead === "LEAD"` e os tokens `role: 'LEAD'` dos testes seguem válidos.
- **Autorização**: a barreira real do humor é `leaderId` no service (`getMemberMoodHistory` → 403); o gate de UI (`isOwnProfile && isLead`) é só cosmético.
- **Cursor por `day`**: como `MoodEntry` é único por `(userId, day)`, paginar por `day` estritamente-menor não duplica nem pula registros.
- **Fora de escopo**: atribuição de `MANAGER`/`HEAD`, alçada de gestor/head, visibilidade para gestor/head, notificações de humor, sync de `User.squad` (string) com `SquadMember`.
```
