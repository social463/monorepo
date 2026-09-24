# Comunidade INOVA Nativa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer o núcleo funcional da plataforma INOVA (projetos de inovação com kanban de fase, diário de bordo, tarefas, histórico e atividade) para dentro do Legends como módulo nativo, restrito à empresa EMR, substituindo o redirecionamento externo em `/comunidade-inova`.

**Architecture:** Módulo novo seguindo `route → service → Prisma` do próprio repo: 5 models tenant-scoped (`InovaProject`, `InovaPhaseHistory`, `InovaDiaryEntry`, `InovaProjectTask`, `InovaActivity`), um service (`inova-service.ts`) com dupla trava de empresa (slug fixo `emr` + config `inova_module_enabled`), uma rota (`routes/inova.ts`), DTOs em `@legends/shared`, e páginas novas em `apps/web/src/pages/inova/`. Upload de evidências do diário via o presign S3 já existente. Notificação de criação/edição de projeto via o `postTeamsNotification` já existente.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vite/React 18, TanStack Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-comunidade-inova-nativa-design.md`

## Global Constraints

- Todo model novo leva `companyId String @default("company-emr")` e entra em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`).
- Duas camadas de restrição à EMR, SEMPRE as duas: (1) `company.slug === 'emr'` checado no service (constante dedicada, mesmo padrão de `EMR_SLUG` em `apps/api/src/services/agent-service.ts:42`); (2) `inova_module_enabled` lido de `AppSetting` via `development-settings-service.ts`. Falta qualquer uma → 403 tratado (`InovaError`, `status: 403`).
- Criar/editar projeto e mudar fase: `ADMIN`/`SUBADMIN` (guard `app.requireAdminOrSubadmin`). Diário de bordo e tarefas: qualquer usuário autenticado da empresa.
- Mensagens de erro e toda UI em português.
- Sem paginação nesta leva (baixo volume, como o original).
- `pnpm db:up` precisa estar rodando antes de qualquer teste da API.

---

### Task 1: Schema Prisma — models do INOVA

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate` (nome sugerido: `comunidade_inova_nativa`)

**Interfaces:**
- Produces: enums `InovaProjectPhase`, `InovaDiaryEntryType`, `InovaTaskStatus`; models `InovaProject`, `InovaPhaseHistory`, `InovaDiaryEntry`, `InovaProjectTask`, `InovaActivity`, todos com `companyId String @default("company-emr")`.

- [ ] **Step 1: Adicionar os enums e models ao schema**

Adicione antes de `model Company {` (ou em qualquer ponto do arquivo — Prisma não exige ordem):

```prisma
enum InovaProjectPhase {
  IDEA
  EXPLORING_SOLUTION
  TESTING_SOLUTION
  ROUTINE_USE
  EXPANDING
  COMPLETED
}

enum InovaDiaryEntryType {
  MANUAL
  AUTOMATIC
}

enum InovaTaskStatus {
  PENDING
  IN_PROGRESS
  DONE
}

model InovaProject {
  id                   String            @id @default(cuid())
  title                String
  category             String
  sector               String
  description          String
  problemDescription   String?
  results              String?
  hoursSaved           Float?
  costReduction        Float?
  otherMetrics         String?
  projectCosts         String?
  toolsUsed            String?
  deadline             DateTime?         @db.Date
  priority             String?
  leadershipChallenge  String?
  sectorRepresentative String?
  responsible1         String?
  responsible2         String?
  phase                InovaProjectPhase @default(IDEA)
  archived             Boolean           @default(false)
  createdById          String
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt
  companyId            String            @default("company-emr")

  createdBy    User                @relation("InovaProjectCreatedBy", fields: [createdById], references: [id])
  company      Company             @relation(fields: [companyId], references: [id])
  phaseHistory InovaPhaseHistory[]
  diaryEntries InovaDiaryEntry[]
  tasks        InovaProjectTask[]
  activity     InovaActivity[]

  @@index([companyId])
  @@index([phase])
}

model InovaPhaseHistory {
  id         String            @id @default(cuid())
  projectId  String
  phase      InovaProjectPhase
  note       String?
  occurredAt DateTime          @default(now())
  companyId  String            @default("company-emr")

  project InovaProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  company Company      @relation(fields: [companyId], references: [id])

  @@index([projectId])
  @@index([companyId])
}

model InovaDiaryEntry {
  id            String              @id @default(cuid())
  projectId     String
  title         String
  description   String?
  learnings     String?
  tools         String?
  entryType     InovaDiaryEntryType @default(MANUAL)
  occurredAt    DateTime            @default(now())
  imageUrls     String[]
  videoLinks    String[]
  externalLinks String[]
  createdById   String
  createdAt     DateTime            @default(now())
  companyId     String              @default("company-emr")

  project   InovaProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy User         @relation("InovaDiaryEntryCreatedBy", fields: [createdById], references: [id])
  company   Company      @relation(fields: [companyId], references: [id])

  @@index([projectId])
  @@index([companyId])
}

model InovaProjectTask {
  id          String          @id @default(cuid())
  projectId   String
  title       String
  description String?
  responsible String?
  dueDate     DateTime?       @db.Date
  status      InovaTaskStatus @default(PENDING)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  companyId   String          @default("company-emr")

  project InovaProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  company Company      @relation(fields: [companyId], references: [id])

  @@index([projectId])
  @@index([companyId])
}

model InovaActivity {
  id        String   @id @default(cuid())
  projectId String
  action    String
  entity    String
  summary   String
  actorId   String
  details   Json?
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  project InovaProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  actor   User         @relation("InovaActivityActor", fields: [actorId], references: [id])
  company Company      @relation(fields: [companyId], references: [id])

  @@index([projectId])
  @@index([companyId])
}
```

- [ ] **Step 2: Adicionar as back-relations em `User`**

Em `model User { ... }` (schema.prisma:199-409), logo após a linha
`developmentThursdayEvents   DevelopmentThursdayEvent[] @relation("DevelopmentThursdayPresenter")`
(por volta da linha 289), adicione:

```prisma
  inovaProjectsCreated    InovaProject[]      @relation("InovaProjectCreatedBy")
  inovaDiaryEntries       InovaDiaryEntry[]   @relation("InovaDiaryEntryCreatedBy")
  inovaActivityAsActor    InovaActivity[]     @relation("InovaActivityActor")
```

- [ ] **Step 3: Adicionar as back-relations em `Company`**

Em `model Company { ... }`, logo após a linha `appSettings                AppSetting[]`, adicione:

```prisma
  inovaProjects      InovaProject[]
  inovaPhaseHistory  InovaPhaseHistory[]
  inovaDiaryEntries  InovaDiaryEntry[]
  inovaProjectTasks  InovaProjectTask[]
  inovaActivity      InovaActivity[]
```

- [ ] **Step 4: Gerar e aplicar a migration**

Run: `pnpm db:up && pnpm db:migrate` (nomeie a migration `comunidade_inova_nativa` quando solicitado)
Expected: migration criada em `apps/api/prisma/migrations/<timestamp>_comunidade_inova_nativa/` e aplicada sem erro.

- [ ] **Step 5: Regenerar o Prisma Client**

Run: `pnpm db:generate`
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(inova): adiciona models do módulo INOVA ao schema"
```

---

### Task 2: Isolamento multi-tenant — registrar os models novos

**Files:**
- Modify: `apps/api/src/lib/tenant-scope.ts`

**Interfaces:**
- Consumes: nenhuma (edição de constante).
- Produces: `TENANT_SCOPED_MODELS` passa a incluir os 5 models do INOVA — todo código que usar `scopedPrisma(companyId).inovaProject...` etc. depende disso para o isolamento funcionar.

- [ ] **Step 1: Adicionar os models à lista**

Em `apps/api/src/lib/tenant-scope.ts`, dentro do `Set([...])` de `TENANT_SCOPED_MODELS`, adicione (por exemplo, próximo a `'DevelopmentThursdayEvent'`):

```ts
  'InovaProject',
  'InovaPhaseHistory',
  'InovaDiaryEntry',
  'InovaProjectTask',
  'InovaActivity',
```

- [ ] **Step 2: Rodar o teste de isolamento existente para garantir que nada quebrou**

Run: `pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.test.ts`
Expected: PASS (se o arquivo existir; caso não exista um teste dedicado, pule este step e valide no Task 7 via teste do service).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/tenant-scope.ts
git commit -m "feat(inova): escopa os models do INOVA por empresa"
```

---

### Task 3: Contrato compartilhado — DTOs e enums do INOVA

**Files:**
- Create: `packages/shared/src/inova.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/inova.test.ts`

**Interfaces:**
- Produces:
  - `type InovaProjectPhase = 'IDEA' | 'EXPLORING_SOLUTION' | 'TESTING_SOLUTION' | 'ROUTINE_USE' | 'EXPANDING' | 'COMPLETED'`
  - `INOVA_PROJECT_PHASES: { value: InovaProjectPhase; label: string }[]` (ordem do kanban)
  - `type InovaDiaryEntryType = 'MANUAL' | 'AUTOMATIC'`
  - `type InovaTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE'`
  - `INOVA_SUGGESTED_SECTORS: string[]`
  - `interface InovaProjectDTO { id, title, category, sector, description, problemDescription, results, hoursSaved, costReduction, otherMetrics, projectCosts, toolsUsed, deadline, priority, leadershipChallenge, sectorRepresentative, responsible1, responsible2, phase, archived, createdById, createdByName, createdAt, updatedAt }`
  - `interface InovaPhaseHistoryDTO { id, projectId, phase, note, occurredAt }`
  - `interface InovaDiaryEntryDTO { id, projectId, title, description, learnings, tools, entryType, occurredAt, imageUrls, videoLinks, externalLinks, createdById, createdByName, createdAt }`
  - `interface InovaProjectTaskDTO { id, projectId, title, description, responsible, dueDate, status, createdAt, updatedAt }`
  - `interface InovaActivityDTO { id, projectId, action, entity, summary, actorId, actorName, details, createdAt }`
  - `interface InovaProjectListResponse { projects: InovaProjectDTO[] }`
  - `interface InovaProjectDetailResponse { project: InovaProjectDTO; phaseHistory: InovaPhaseHistoryDTO[]; diaryEntries: InovaDiaryEntryDTO[]; tasks: InovaProjectTaskDTO[]; activity: InovaActivityDTO[] }`

- [ ] **Step 1: Escrever o teste do contrato**

```ts
// packages/shared/src/inova.test.ts
import { describe, expect, it } from 'vitest'
import { INOVA_PROJECT_PHASES, INOVA_SUGGESTED_SECTORS } from './inova'

describe('catálogo do INOVA', () => {
  it('tem as 6 fases do kanban, na ordem', () => {
    expect(INOVA_PROJECT_PHASES.map((p) => p.value)).toEqual([
      'IDEA',
      'EXPLORING_SOLUTION',
      'TESTING_SOLUTION',
      'ROUTINE_USE',
      'EXPANDING',
      'COMPLETED',
    ])
  })

  it('cada fase tem um rótulo em português, não vazio', () => {
    for (const phase of INOVA_PROJECT_PHASES) {
      expect(phase.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('tem setores sugeridos, sem duplicata', () => {
    expect(INOVA_SUGGESTED_SECTORS.length).toBeGreaterThan(0)
    expect(new Set(INOVA_SUGGESTED_SECTORS).size).toBe(INOVA_SUGGESTED_SECTORS.length)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/shared exec vitest run src/inova.test.ts`
Expected: FAIL — `Cannot find module './inova'`

- [ ] **Step 3: Escrever `packages/shared/src/inova.ts`**

```ts
export type InovaProjectPhase =
  | 'IDEA'
  | 'EXPLORING_SOLUTION'
  | 'TESTING_SOLUTION'
  | 'ROUTINE_USE'
  | 'EXPANDING'
  | 'COMPLETED'

/** Ordem do kanban de projetos do INOVA — a mesma progressão do projeto original. */
export const INOVA_PROJECT_PHASES: { value: InovaProjectPhase; label: string }[] = [
  { value: 'IDEA', label: 'Ideia do Projeto' },
  { value: 'EXPLORING_SOLUTION', label: 'Explorando a Solução' },
  { value: 'TESTING_SOLUTION', label: 'Testando a Solução' },
  { value: 'ROUTINE_USE', label: 'Usando na Rotina' },
  { value: 'EXPANDING', label: 'Expandindo para Mais Pessoas' },
  { value: 'COMPLETED', label: 'Concluído' },
]

export type InovaDiaryEntryType = 'MANUAL' | 'AUTOMATIC'

export type InovaTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE'

export const INOVA_TASK_STATUSES: { value: InovaTaskStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pendente' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluída' },
]

/** Sugestão de setor no formulário de projeto — texto livre, não é FK de `Sector`. */
export const INOVA_SUGGESTED_SECTORS = [
  'Desenvolvimento de Produto',
  'Estratégia e Finanças',
  'Marketing',
  'Ensino',
  'Comercial',
  'B2B',
  'CX',
  'Gente & Gestão',
]

export interface InovaProjectDTO {
  id: string
  title: string
  category: string
  sector: string
  description: string
  problemDescription: string | null
  results: string | null
  hoursSaved: number | null
  costReduction: number | null
  otherMetrics: string | null
  projectCosts: string | null
  toolsUsed: string | null
  deadline: string | null
  priority: string | null
  leadershipChallenge: string | null
  sectorRepresentative: string | null
  responsible1: string | null
  responsible2: string | null
  phase: InovaProjectPhase
  archived: boolean
  createdById: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface InovaPhaseHistoryDTO {
  id: string
  projectId: string
  phase: InovaProjectPhase
  note: string | null
  occurredAt: string
}

export interface InovaDiaryEntryDTO {
  id: string
  projectId: string
  title: string
  description: string | null
  learnings: string | null
  tools: string | null
  entryType: InovaDiaryEntryType
  occurredAt: string
  imageUrls: string[]
  videoLinks: string[]
  externalLinks: string[]
  createdById: string
  createdByName: string
  createdAt: string
}

export interface InovaProjectTaskDTO {
  id: string
  projectId: string
  title: string
  description: string | null
  responsible: string | null
  dueDate: string | null
  status: InovaTaskStatus
  createdAt: string
  updatedAt: string
}

export interface InovaActivityDTO {
  id: string
  projectId: string
  action: string
  entity: string
  summary: string
  actorId: string
  actorName: string
  details: Record<string, unknown> | null
  createdAt: string
}

export interface InovaProjectListResponse {
  projects: InovaProjectDTO[]
}

export interface InovaProjectDetailResponse {
  project: InovaProjectDTO
  phaseHistory: InovaPhaseHistoryDTO[]
  diaryEntries: InovaDiaryEntryDTO[]
  tasks: InovaProjectTaskDTO[]
  activity: InovaActivityDTO[]
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/shared exec vitest run src/inova.test.ts`
Expected: PASS

- [ ] **Step 5: Registrar o barril**

Em `packages/shared/src/index.ts`, adicione ao final:

```ts
export * from './inova'
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/inova.ts packages/shared/src/inova.test.ts packages/shared/src/index.ts
git commit -m "feat(inova): contrato compartilhado do módulo INOVA"
```

---

### Task 4: Configuração por empresa — habilitar módulo + webhook do Teams

Substitui `inovaCommunityUrl`/`inovaSupportUrl` (que deixam de fazer sentido: a comunidade agora é interna, não há mais "criar conta" nem "redefinir senha" separados) por `inovaModuleEnabled` e `inovaTeamsWebhookUrl`, no mesmo `DevelopmentSettingsDTO`/`development-settings-service.ts` que já existe.

**Files:**
- Modify: `packages/shared/src/pdi.ts:263-280` (`DevelopmentSettingsDTO`)
- Modify: `apps/api/src/services/development-settings-service.ts`
- Modify: `apps/api/src/routes/development.ts`
- Test: `apps/api/src/routes/pdi.test.ts` (os testes de `inovaCommunityUrl`/`inovaSupportUrl` em `apps/api/src/routes/pdi.test.ts:190-237` — ajustar para os campos novos)

**Interfaces:**
- Produces: `DevelopmentSettingsDTO` com `inovaModuleEnabled: boolean` e `inovaTeamsWebhookUrl: string | null` no lugar de `inovaCommunityUrl`/`inovaSupportUrl`; `getDevelopmentSettings(companyId)` e `updateDevelopmentSettings({ ..., inovaModuleEnabled?, inovaTeamsWebhookUrl?, actorId, companyId })` do jeito que já existiam para os outros campos.
- Consumes (Task 7 usa): `getDevelopmentSettings(companyId).inovaModuleEnabled` para a segunda trava do gate.

- [ ] **Step 1: Atualizar o DTO em `@legends/shared`**

Em `packages/shared/src/pdi.ts`, troque o bloco de `DevelopmentSettingsDTO` (linhas 263-280) por:

```ts
export interface DevelopmentSettingsDTO {
  leaderApprovalRequired: boolean
  /** Link externo de Avaliações e Pesquisas (ImpulseUP); `null` esconde o item do menu. */
  impulseUpUrl: string | null
  /**
   * Liga o módulo nativo da Comunidade INOVA (projetos de inovação). Restrito
   * à EMR por uma trava de código além desta config — ver `EMR_SLUG` em
   * `inova-service.ts`. `false`/ausente esconde o item do menu e a rota
   * responde 403.
   */
  inovaModuleEnabled: boolean
  /** Webhook do Teams que recebe aviso de criação/edição de projeto do INOVA. */
  inovaTeamsWebhookUrl: string | null
}
```

- [ ] **Step 2: Atualizar o service**

Em `apps/api/src/services/development-settings-service.ts`, troque as constantes `INOVA_COMMUNITY_URL_KEY`/`INOVA_SUPPORT_URL_KEY` por:

```ts
/** Liga o módulo nativo do INOVA (por empresa; ver EMR_SLUG em inova-service.ts). */
export const INOVA_MODULE_ENABLED_KEY = 'inova_module_enabled'
/** Webhook do Teams para notificação de projeto do INOVA criado/editado. */
export const INOVA_TEAMS_WEBHOOK_KEY = 'inova_teams_webhook_url'
```

E troque o corpo de `getDevelopmentSettings`/`updateDevelopmentSettings` (mantendo `readSetting`/`writeSetting` como estão) por:

```ts
export async function getDevelopmentSettings(companyId: string): Promise<DevelopmentSettingsDTO> {
  const [approval, impulseUpUrl, inovaModuleEnabled, inovaTeamsWebhookUrl] = await Promise.all([
    readSetting(PDI_LEADER_APPROVAL_KEY, companyId),
    readSetting(IMPULSEUP_URL_KEY, companyId),
    readSetting(INOVA_MODULE_ENABLED_KEY, companyId),
    readSetting(INOVA_TEAMS_WEBHOOK_KEY, companyId),
  ])
  return {
    leaderApprovalRequired: approval == null ? PDI_LEADER_APPROVAL_DEFAULT : approval === 'true',
    impulseUpUrl: impulseUpUrl?.trim() || null,
    inovaModuleEnabled: inovaModuleEnabled === 'true',
    inovaTeamsWebhookUrl: inovaTeamsWebhookUrl?.trim() || null,
  }
}

export async function leaderApprovalRequired(companyId: string): Promise<boolean> {
  return (await getDevelopmentSettings(companyId)).leaderApprovalRequired
}

export async function updateDevelopmentSettings(input: {
  leaderApprovalRequired?: boolean
  impulseUpUrl?: string | null
  inovaModuleEnabled?: boolean
  inovaTeamsWebhookUrl?: string | null
  actorId: string
  companyId: string
}): Promise<DevelopmentSettingsDTO> {
  const before = await getDevelopmentSettings(input.companyId)

  if (input.leaderApprovalRequired !== undefined) {
    await writeSetting(PDI_LEADER_APPROVAL_KEY, input.companyId, String(input.leaderApprovalRequired))
  }
  if (input.impulseUpUrl !== undefined) {
    await writeSetting(IMPULSEUP_URL_KEY, input.companyId, input.impulseUpUrl?.trim() || null)
  }
  if (input.inovaModuleEnabled !== undefined) {
    await writeSetting(INOVA_MODULE_ENABLED_KEY, input.companyId, String(input.inovaModuleEnabled))
  }
  if (input.inovaTeamsWebhookUrl !== undefined) {
    await writeSetting(INOVA_TEAMS_WEBHOOK_KEY, input.companyId, input.inovaTeamsWebhookUrl?.trim() || null)
  }

  const after = await getDevelopmentSettings(input.companyId)
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'AppSetting',
    entityId: 'development',
    action: 'UPDATE',
    before,
    after,
    companyId: input.companyId,
  })
  return after
}
```

- [ ] **Step 3: Atualizar a validação da rota**

Em `apps/api/src/routes/development.ts`, troque o `updateSchema` e o corpo do PATCH:

```ts
const updateSchema = z.object({
  leaderApprovalRequired: z.boolean().optional(),
  impulseUpUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  inovaModuleEnabled: z.boolean().optional(),
  inovaTeamsWebhookUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
})
```

```ts
      const settings = await updateDevelopmentSettings({
        leaderApprovalRequired: parsed.data.leaderApprovalRequired,
        impulseUpUrl: parsed.data.impulseUpUrl === '' ? null : parsed.data.impulseUpUrl,
        inovaModuleEnabled: parsed.data.inovaModuleEnabled,
        inovaTeamsWebhookUrl: parsed.data.inovaTeamsWebhookUrl === '' ? null : parsed.data.inovaTeamsWebhookUrl,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
```

- [ ] **Step 4: Atualizar os testes existentes que referenciam os campos antigos**

Em `apps/api/src/routes/pdi.test.ts:190-237`, troque toda referência a `inovaCommunityUrl`/`inovaSupportUrl` por `inovaModuleEnabled`/`inovaTeamsWebhookUrl` (booleano e URL de webhook, respectivamente) — mantendo o formato dos testes existentes (request PATCH em `/admin/development/settings`, assert no GET).

- [ ] **Step 5: Rodar os testes**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/pdi.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/pdi.ts apps/api/src/services/development-settings-service.ts apps/api/src/routes/development.ts apps/api/src/routes/pdi.test.ts
git commit -m "feat(inova): troca URL externa da Comunidade INOVA por config do módulo nativo"
```

---

### Task 5: Upload de evidências do diário de bordo (S3 presign)

**Files:**
- Modify: `apps/api/src/lib/s3-client.ts`
- Modify: `apps/api/src/routes/image-uploads.ts`
- Test: `apps/api/src/routes/image-uploads.test.ts` (adicionar um teste ao arquivo existente, se houver; senão criar seguindo o padrão de outros testes de rota do repo)

**Interfaces:**
- Produces: `buildInovaDiaryKey(companyId: string, userId: string, contentType: string): string` → `inova-diary/<companyId>/<userId>/<uuid>.<ext>`; rota `POST /uploads/inova-diary/presign`.

- [ ] **Step 1: Adicionar `buildInovaDiaryKey` em `s3-client.ts`**

Ao lado de `buildFeedMediaKey`, adicione:

```ts
/**
 * Chave de evidência do diário de bordo do INOVA:
 * `inova-diary/<companyId>/<userId>/<uuid>.<ext>`. Mesmo critério de
 * `buildFeedMediaKey` (extensão pelo content-type, nunca escolhida pelo
 * cliente), namespaced por empresa E por usuário — evidência é do autor do
 * registro, dentro da empresa que só a EMR usa hoje.
 */
export function buildInovaDiaryKey(companyId: string, userId: string, contentType: string): string {
  const ext = EXT_BY_MEDIA_TYPE[contentType] ?? 'bin'
  return `inova-diary/${companyId}/${userId}/${randomUUID()}.${ext}`
}
```

Se `EXT_BY_MEDIA_TYPE` não existir ainda no arquivo (confira ao lado de `EXT_BY_TYPE`, usado por `buildImageKey`/`buildFeedMediaKey` — leia o arquivo para confirmar o nome exato do mapa que essas funções já usam para vídeo/imagem antes de reaproveitar ou criar um novo mapa `image/jpeg → jpg, image/png → png, image/webp → webp, image/gif → gif, video/mp4 → mp4, video/webm → webm`).

- [ ] **Step 2: Adicionar a rota de presign em `image-uploads.ts`**

Ao lado da rota `/uploads/media/presign`, adicione:

```ts
  /**
   * Evidência do diário de bordo do INOVA: imagem ou vídeo, enviado por
   * qualquer colaborador autenticado (diário é aberto a todo mundo, só
   * criar/editar projeto e mudar fase é admin/subadmin). Mesmos tipo/tamanho
   * de mídia já usados pelo Feed — sem limite novo.
   */
  app.post('/uploads/inova-diary/presign', { onRequest: [app.authenticate] }, async (request, reply) => {
    const cfg = s3Config()
    if (!cfg) return reply.code(503).send({ message: 'Uploads desabilitados.' })

    const parsed = presignSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { contentType, size } = parsed.data
    const kind = mediaKindFor(contentType)
    if (!kind || (kind !== 'IMAGE' && kind !== 'VIDEO')) {
      return reply.code(400).send({ message: 'Formato não suportado. Envie imagem ou vídeo MP4/WebM.' })
    }
    if (size > mediaMaxBytesFor(kind)) {
      return reply.code(400).send({ message: mediaTooLargeMessage(kind) })
    }

    const key = buildInovaDiaryKey(request.user.companyId, request.user.sub, contentType)
    const uploadUrl = await presignImageUpload({ key, contentType })
    return reply.send({ uploadUrl, publicUrl: publicUrlFor(key, cfg), key, kind })
  })
```

E adicione `buildInovaDiaryKey` ao import de `'../lib/s3-client'` no topo do arquivo.

- [ ] **Step 3: Rodar os testes de upload existentes**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/image-uploads.test.ts`
Expected: PASS (o arquivo pode não existir um teste dedicado a este endpoint ainda — se não existir, escreva um teste mínimo que faça POST em `/uploads/inova-diary/presign` autenticado com um `contentType: 'image/png', size: 1000` e afira `200` com `uploadUrl`/`publicUrl`/`key` na resposta, seguindo o formato dos testes vizinhos no mesmo arquivo).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/s3-client.ts apps/api/src/routes/image-uploads.ts apps/api/src/routes/image-uploads.test.ts
git commit -m "feat(inova): presign de upload para evidências do diário de bordo"
```

---

### Task 6: Service do INOVA — projeto, fase e gate de empresa

**Files:**
- Create: `apps/api/src/services/inova-service.ts`
- Test: `apps/api/src/services/inova-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma` (`../lib/tenant-scope`), `prisma` (`../lib/prisma`), `getDevelopmentSettings` (`./development-settings-service`), `postTeamsNotification` (`../lib/teams-client`), `absoluteUrl` (`../lib/app-url`), `recordAuditLog` (`./audit-log-service`) — mesma assinatura já lida nos Tasks anteriores.
- Produces:
  - `class InovaError extends Error { status: number }`
  - `async function ensureInovaModuleEnabled(companyId: string): Promise<void>` (lança `InovaError` 403 se a empresa não for EMR ou o módulo estiver desligado)
  - `async function listInovaProjects(companyId: string, options?: { archived?: boolean }): Promise<InovaProjectDTO[]>`
  - `async function getInovaProjectDetail(companyId: string, projectId: string): Promise<InovaProjectDetailResponse>`
  - `async function createInovaProject(input: CreateInovaProjectInput): Promise<InovaProjectDTO>`
  - `async function updateInovaProject(input: UpdateInovaProjectInput): Promise<InovaProjectDTO>`
  - `async function changeInovaProjectPhase(input: { id: string; phase: InovaProjectPhase; note?: string; actorId: string; companyId: string }): Promise<InovaProjectDTO>`
  - Usados pelos Tasks 7/8 (diário, tarefas, listagem de atividade): serão adicionados naquele arquivo, mesma exportação.

- [ ] **Step 1: Escrever o teste do gate de empresa**

```ts
// apps/api/src/services/inova-service.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateDevelopmentSettings } from './development-settings-service'
import { createInovaProject, InovaError, listInovaProjects } from './inova-service'

async function createAdmin(companyId: string) {
  return prisma.user.create({
    data: {
      email: `admin-${Math.random()}@teste.com`,
      passwordHash: 'x',
      name: 'Admin',
      role: 'ADMIN',
      companyId,
      sectorId: (await prisma.sector.findFirstOrThrow({ where: { companyId } })).id,
    },
  })
}

describe('gate de empresa do INOVA', () => {
  it('recusa empresa que não é EMR mesmo com o módulo ligado', async () => {
    const outraEmpresa = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    const setor = await prisma.sector.create({ data: { name: 'Setor', slug: 'setor', companyId: outraEmpresa.id } })
    const admin = await prisma.user.create({
      data: {
        email: 'admin@outra.com',
        passwordHash: 'x',
        name: 'Admin Outra',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
        sectorId: setor.id,
      },
    })
    await updateDevelopmentSettings({
      inovaModuleEnabled: true,
      actorId: admin.id,
      companyId: outraEmpresa.id,
    })

    await expect(
      createInovaProject({
        companyId: outraEmpresa.id,
        actorId: admin.id,
        title: 'Projeto',
        category: 'IA',
        sector: 'Ensino',
        description: 'Descrição',
      }),
    ).rejects.toThrow(InovaError)
  })

  it('recusa a EMR com o módulo desligado', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await expect(listInovaProjects(DEFAULT_COMPANY_ID)).resolves.toEqual([])
    await expect(
      createInovaProject({
        companyId: DEFAULT_COMPANY_ID,
        actorId: admin.id,
        title: 'Projeto',
        category: 'IA',
        sector: 'Ensino',
        description: 'Descrição',
      }),
    ).rejects.toThrow(InovaError)
  })

  it('permite a EMR com o módulo ligado', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })
    expect(project.phase).toBe('IDEA')
    const list = await listInovaProjects(DEFAULT_COMPANY_ID)
    expect(list.map((p) => p.id)).toContain(project.id)
  })
})
```

Nota: `listInovaProjects` **não** lança quando o módulo está desligado — devolve lista vazia (padrão comum de listagem que serve tanto a checagem do menu quanto a tela). Só as mutações (`create`/`update`/mudança de fase/diário/tarefa) lançam `InovaError`. Ajuste o teste acima se, ao escrever o service, você decidir o contrário para a listagem — mas mantenha as mutações sempre lançando.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: FAIL — `Cannot find module './inova-service'`

- [ ] **Step 3: Escrever `inova-service.ts`**

```ts
import type { InovaProjectPhase } from '@legends/shared'
import type { InovaProject } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { getDevelopmentSettings } from './development-settings-service'
import { toInovaProjectDTO } from '../lib/serialize'

/**
 * Empresa cujo slug é `emr` — hoje a única com o módulo INOVA, do mesmo jeito
 * que `EMR_SLUG` em `agent-service.ts` trava o bloco de acolhimento emocional.
 * Deliberadamente redundante com `inova_module_enabled`: mesmo que a config
 * seja ligada por engano em outra empresa, esta trava recusa.
 */
const INOVA_ALLOWED_COMPANY_SLUG = 'emr'

export class InovaError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

async function ensureInovaModuleEnabled(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } })
  if (company?.slug !== INOVA_ALLOWED_COMPANY_SLUG) {
    throw new InovaError('Módulo Comunidade INOVA não disponível para esta empresa.', 403)
  }
  const { inovaModuleEnabled } = await getDevelopmentSettings(companyId)
  if (!inovaModuleEnabled) {
    throw new InovaError('Módulo Comunidade INOVA está desativado.', 403)
  }
}

async function isInovaModuleEnabled(companyId: string): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } })
  if (company?.slug !== INOVA_ALLOWED_COMPANY_SLUG) return false
  return (await getDevelopmentSettings(companyId)).inovaModuleEnabled
}

export async function listInovaProjects(
  companyId: string,
  options: { archived?: boolean } = {},
): Promise<ReturnType<typeof toInovaProjectDTO>[]> {
  if (!(await isInovaModuleEnabled(companyId))) return []
  const projects = await scopedPrisma(companyId).inovaProject.findMany({
    where: { archived: options.archived ?? false },
    include: { createdBy: true },
    orderBy: { createdAt: 'desc' },
  })
  return projects.map(toInovaProjectDTO)
}

export interface CreateInovaProjectInput {
  companyId: string
  actorId: string
  title: string
  category: string
  sector: string
  description: string
  problemDescription?: string | null
  results?: string | null
  hoursSaved?: number | null
  costReduction?: number | null
  otherMetrics?: string | null
  projectCosts?: string | null
  toolsUsed?: string | null
  deadline?: Date | null
  priority?: string | null
  leadershipChallenge?: string | null
  sectorRepresentative?: string | null
  responsible1?: string | null
  responsible2?: string | null
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new InovaError(message)
  return trimmed
}

export async function createInovaProject(input: CreateInovaProjectInput): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const title = requireNonEmpty(input.title, 'Informe o título do projeto.')
  const category = requireNonEmpty(input.category, 'Informe a categoria do projeto.')
  const sector = requireNonEmpty(input.sector, 'Informe o setor do projeto.')
  const description = requireNonEmpty(input.description, 'Informe a descrição do projeto.')

  const db = scopedPrisma(input.companyId)
  const project = await db.$transaction(async (tx) => {
    const created = await tx.inovaProject.create({
      data: {
        title,
        category,
        sector,
        description,
        problemDescription: input.problemDescription ?? null,
        results: input.results ?? null,
        hoursSaved: input.hoursSaved ?? null,
        costReduction: input.costReduction ?? null,
        otherMetrics: input.otherMetrics ?? null,
        projectCosts: input.projectCosts ?? null,
        toolsUsed: input.toolsUsed ?? null,
        deadline: input.deadline ?? null,
        priority: input.priority ?? null,
        leadershipChallenge: input.leadershipChallenge ?? null,
        sectorRepresentative: input.sectorRepresentative ?? null,
        responsible1: input.responsible1 ?? null,
        responsible2: input.responsible2 ?? null,
        createdById: input.actorId,
      },
      include: { createdBy: true },
    })
    await tx.inovaPhaseHistory.create({
      data: { projectId: created.id, phase: 'IDEA' },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: created.id,
        action: 'PROJECT_CREATED',
        entity: 'InovaProject',
        summary: `${created.createdBy.name} criou o projeto "${created.title}".`,
        actorId: input.actorId,
      },
    })
    return created
  })

  await notifyInovaProjectChange(project, 'criado')
  return toInovaProjectDTO(project)
}

export interface UpdateInovaProjectInput extends Partial<Omit<CreateInovaProjectInput, 'companyId' | 'actorId'>> {
  id: string
  companyId: string
  actorId: string
}

export async function updateInovaProject(input: UpdateInovaProjectInput): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const current = await db.inovaProject.findUnique({ where: { id: input.id } })
  if (!current) throw new InovaError('Projeto não encontrado.', 404)

  const data: Record<string, unknown> = {}
  if (input.title !== undefined) data.title = requireNonEmpty(input.title, 'Informe o título do projeto.')
  if (input.category !== undefined) data.category = requireNonEmpty(input.category, 'Informe a categoria do projeto.')
  if (input.sector !== undefined) data.sector = requireNonEmpty(input.sector, 'Informe o setor do projeto.')
  if (input.description !== undefined) data.description = requireNonEmpty(input.description, 'Informe a descrição do projeto.')
  for (const key of [
    'problemDescription',
    'results',
    'hoursSaved',
    'costReduction',
    'otherMetrics',
    'projectCosts',
    'toolsUsed',
    'deadline',
    'priority',
    'leadershipChallenge',
    'sectorRepresentative',
    'responsible1',
    'responsible2',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key]
  }

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProject.update({ where: { id: input.id }, data, include: { createdBy: true } })
    await tx.inovaActivity.create({
      data: {
        projectId: updated.id,
        action: 'PROJECT_UPDATED',
        entity: 'InovaProject',
        summary: `Projeto "${updated.title}" foi atualizado.`,
        actorId: input.actorId,
      },
    })
    return updated
  })

  await notifyInovaProjectChange(project, 'atualizado')
  return toInovaProjectDTO(project)
}

export async function changeInovaProjectPhase(input: {
  id: string
  phase: InovaProjectPhase
  note?: string
  actorId: string
  companyId: string
}): Promise<ReturnType<typeof toInovaProjectDTO>> {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const current = await db.inovaProject.findUnique({ where: { id: input.id } })
  if (!current) throw new InovaError('Projeto não encontrado.', 404)

  const project = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProject.update({
      where: { id: input.id },
      data: { phase: input.phase },
      include: { createdBy: true },
    })
    await tx.inovaPhaseHistory.create({
      data: { projectId: updated.id, phase: input.phase, note: input.note?.trim() || null },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: updated.id,
        action: 'PHASE_CHANGED',
        entity: 'InovaProject',
        summary: `Projeto "${updated.title}" mudou de fase.`,
        actorId: input.actorId,
        details: { phase: input.phase },
      },
    })
    return updated
  })

  return toInovaProjectDTO(project)
}

async function notifyInovaProjectChange(project: InovaProject & { createdBy: { name: string } }, acao: string): Promise<void> {
  const { inovaTeamsWebhookUrl } = await getDevelopmentSettings(project.companyId)
  if (!inovaTeamsWebhookUrl) return
  const { postTeamsNotification } = await import('../lib/teams-client')
  const { absoluteUrl } = await import('../lib/app-url')
  await postTeamsNotification(inovaTeamsWebhookUrl, {
    title: `Projeto do INOVA ${acao}: ${project.title}`,
    body: project.description,
    ctaUrl: absoluteUrl('/comunidade-inova'),
    ctaLabel: 'Ver projeto',
    emoji: '💡',
  })
}
```

Nota: os `import()` dinâmicos de `teams-client`/`app-url` dentro de `notifyInovaProjectChange` só existem para manter este trecho colável isoladamente no plano — ao escrever o arquivo de verdade, troque para import estático no topo (`import { postTeamsNotification } from '../lib/teams-client'` e `import { absoluteUrl } from '../lib/app-url'`), como o resto do repo faz.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: PASS (o Task 9 ainda não existe `toInovaProjectDTO` — se este teste rodar antes do Task 9 estar pronto, o TypeScript vai reclamar do import; **execute o Step 3 deste Task já com o Task 9 (serialize) feito**, ou adicione um `toInovaProjectDTO` mínimo aqui e mova para `serialize.ts` no Task 9 — o plano assume que Task 9 é implementado imediatamente após este, antes de rodar os testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inova-service.ts apps/api/src/services/inova-service.test.ts
git commit -m "feat(inova): service de projetos, fase e gate de empresa"
```

---

### Task 7: Service do INOVA — diário de bordo, tarefas e atividade

**Files:**
- Modify: `apps/api/src/services/inova-service.ts`
- Modify: `apps/api/src/services/inova-service.test.ts`

**Interfaces:**
- Consumes: `InovaError`, `ensureInovaModuleEnabled` (privado no mesmo arquivo — vire uma função de módulo reaproveitada), `scopedPrisma`.
- Produces:
  - `async function getInovaProjectDetail(companyId: string, projectId: string): Promise<InovaProjectDetailResponse>`
  - `async function addInovaDiaryEntry(input: { companyId: string; actorId: string; projectId: string; title: string; description?: string; learnings?: string; tools?: string; imageUrls?: string[]; videoLinks?: string[]; externalLinks?: string[] }): Promise<InovaDiaryEntryDTO>`
  - `async function createInovaProjectTask(input: { companyId: string; actorId: string; projectId: string; title: string; description?: string; responsible?: string; dueDate?: Date | null }): Promise<InovaProjectTaskDTO>`
  - `async function updateInovaProjectTaskStatus(input: { companyId: string; actorId: string; taskId: string; status: InovaTaskStatus }): Promise<InovaProjectTaskDTO>`

- [ ] **Step 1: Escrever o teste**

```ts
// acrescentar ao final de apps/api/src/services/inova-service.test.ts
import {
  addInovaDiaryEntry,
  createInovaProjectTask,
  getInovaProjectDetail,
  updateInovaProjectTaskStatus,
} from './inova-service'

describe('diário de bordo e tarefas', () => {
  it('qualquer usuário autenticado adiciona entrada de diário; task registra atividade', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto com diário',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })

    const membro = await prisma.user.create({
      data: {
        email: `membro-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Membro',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: (await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })).id,
      },
    })

    const entry = await addInovaDiaryEntry({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      projectId: project.id,
      title: 'Primeira entrada',
      description: 'Testamos a hipótese',
    })
    expect(entry.title).toBe('Primeira entrada')

    const task = await createInovaProjectTask({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      projectId: project.id,
      title: 'Validar com o time',
    })
    expect(task.status).toBe('PENDING')

    const updated = await updateInovaProjectTaskStatus({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      taskId: task.id,
      status: 'DONE',
    })
    expect(updated.status).toBe('DONE')

    const detail = await getInovaProjectDetail(DEFAULT_COMPANY_ID, project.id)
    expect(detail.diaryEntries).toHaveLength(1)
    expect(detail.tasks).toHaveLength(1)
    // criação do projeto + diário + task + mudança de status = 4 entradas de atividade
    expect(detail.activity.length).toBeGreaterThanOrEqual(4)
    expect(detail.phaseHistory).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: FAIL — funções não exportadas ainda.

- [ ] **Step 3: Adicionar ao `inova-service.ts`**

```ts
export async function getInovaProjectDetail(companyId: string, projectId: string) {
  await ensureInovaModuleEnabled(companyId)
  const db = scopedPrisma(companyId)
  const project = await db.inovaProject.findUnique({ where: { id: projectId }, include: { createdBy: true } })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)

  const [phaseHistory, diaryEntries, tasks, activity] = await Promise.all([
    db.inovaPhaseHistory.findMany({ where: { projectId }, orderBy: { occurredAt: 'asc' } }),
    db.inovaDiaryEntry.findMany({ where: { projectId }, include: { createdBy: true }, orderBy: { occurredAt: 'desc' } }),
    db.inovaProjectTask.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    db.inovaActivity.findMany({ where: { projectId }, include: { actor: true }, orderBy: { createdAt: 'desc' } }),
  ])

  return {
    project: toInovaProjectDTO(project),
    phaseHistory: phaseHistory.map(toInovaPhaseHistoryDTO),
    diaryEntries: diaryEntries.map(toInovaDiaryEntryDTO),
    tasks: tasks.map(toInovaProjectTaskDTO),
    activity: activity.map(toInovaActivityDTO),
  }
}

export async function addInovaDiaryEntry(input: {
  companyId: string
  actorId: string
  projectId: string
  title: string
  description?: string | null
  learnings?: string | null
  tools?: string | null
  imageUrls?: string[]
  videoLinks?: string[]
  externalLinks?: string[]
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const project = await db.inovaProject.findUnique({ where: { id: input.projectId }, select: { id: true, title: true } })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)
  const title = requireNonEmpty(input.title, 'Informe o título da entrada.')

  const entry = await db.$transaction(async (tx) => {
    const created = await tx.inovaDiaryEntry.create({
      data: {
        projectId: input.projectId,
        title,
        description: input.description ?? null,
        learnings: input.learnings ?? null,
        tools: input.tools ?? null,
        imageUrls: input.imageUrls ?? [],
        videoLinks: input.videoLinks ?? [],
        externalLinks: input.externalLinks ?? [],
        createdById: input.actorId,
      },
      include: { createdBy: true },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: input.projectId,
        action: 'DIARY_ENTRY_ADDED',
        entity: 'InovaDiaryEntry',
        summary: `${created.createdBy.name} adicionou uma entrada no diário de "${project.title}".`,
        actorId: input.actorId,
      },
    })
    return created
  })

  return toInovaDiaryEntryDTO(entry)
}

export async function createInovaProjectTask(input: {
  companyId: string
  actorId: string
  projectId: string
  title: string
  description?: string | null
  responsible?: string | null
  dueDate?: Date | null
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const project = await db.inovaProject.findUnique({ where: { id: input.projectId }, select: { id: true, title: true } })
  if (!project) throw new InovaError('Projeto não encontrado.', 404)
  const title = requireNonEmpty(input.title, 'Informe o título da tarefa.')

  const task = await db.$transaction(async (tx) => {
    const created = await tx.inovaProjectTask.create({
      data: {
        projectId: input.projectId,
        title,
        description: input.description ?? null,
        responsible: input.responsible ?? null,
        dueDate: input.dueDate ?? null,
      },
    })
    await tx.inovaActivity.create({
      data: {
        projectId: input.projectId,
        action: 'TASK_CREATED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${created.title}" criada em "${project.title}".`,
        actorId: input.actorId,
      },
    })
    return created
  })

  return toInovaProjectTaskDTO(task)
}

export async function updateInovaProjectTaskStatus(input: {
  companyId: string
  actorId: string
  taskId: string
  status: import('@legends/shared').InovaTaskStatus
}) {
  await ensureInovaModuleEnabled(input.companyId)
  const db = scopedPrisma(input.companyId)
  const current = await db.inovaProjectTask.findUnique({ where: { id: input.taskId } })
  if (!current) throw new InovaError('Tarefa não encontrada.', 404)

  const task = await db.$transaction(async (tx) => {
    const updated = await tx.inovaProjectTask.update({ where: { id: input.taskId }, data: { status: input.status } })
    await tx.inovaActivity.create({
      data: {
        projectId: current.projectId,
        action: 'TASK_STATUS_CHANGED',
        entity: 'InovaProjectTask',
        summary: `Tarefa "${updated.title}" mudou de status.`,
        actorId: input.actorId,
        details: { status: input.status },
      },
    })
    return updated
  })

  return toInovaProjectTaskDTO(task)
}
```

E adicione ao topo do arquivo os imports de `toInovaPhaseHistoryDTO`, `toInovaDiaryEntryDTO`, `toInovaProjectTaskDTO`, `toInovaActivityDTO` junto de `toInovaProjectDTO` (todos vêm de `../lib/serialize`, feitos no Task 9 — ver nota do Task 6 Step 4).

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/inova-service.ts apps/api/src/services/inova-service.test.ts
git commit -m "feat(inova): diário de bordo, tarefas e atividade do projeto"
```

---

### Task 8: Serialize — DTOs do INOVA

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`

**Interfaces:**
- Consumes: tipos Prisma `InovaProject & { createdBy: User }`, `InovaPhaseHistory`, `InovaDiaryEntry & { createdBy: User }`, `InovaProjectTask`, `InovaActivity & { actor: User }`.
- Produces: `toInovaProjectDTO`, `toInovaPhaseHistoryDTO`, `toInovaDiaryEntryDTO`, `toInovaProjectTaskDTO`, `toInovaActivityDTO` — usados pelo Task 6/7 (service) e Task 9 (rota).

> Este Task deve ser feito **antes** de rodar os testes do Task 6/7 (o service importa estas funções). Ordem de execução sugerida: Task 6 (código, sem rodar teste) → Task 8 (este) → voltar e rodar os testes do Task 6 e 7.

- [ ] **Step 1: Adicionar os mappers a `serialize.ts`**

Ao lado de mappers parecidos (ex.: `toDevelopmentThursdayEventDTO`, se existir; senão, ao final do arquivo), adicione:

```ts
import type {
  InovaActivity,
  InovaDiaryEntry,
  InovaPhaseHistory,
  InovaProject,
  InovaProjectTask,
  User,
} from '@prisma/client'
import type {
  InovaActivityDTO,
  InovaDiaryEntryDTO,
  InovaPhaseHistoryDTO,
  InovaProjectDTO,
  InovaProjectTaskDTO,
} from '@legends/shared'

export function toInovaProjectDTO(project: InovaProject & { createdBy: User }): InovaProjectDTO {
  return {
    id: project.id,
    title: project.title,
    category: project.category,
    sector: project.sector,
    description: project.description,
    problemDescription: project.problemDescription,
    results: project.results,
    hoursSaved: project.hoursSaved,
    costReduction: project.costReduction,
    otherMetrics: project.otherMetrics,
    projectCosts: project.projectCosts,
    toolsUsed: project.toolsUsed,
    deadline: project.deadline ? project.deadline.toISOString().slice(0, 10) : null,
    priority: project.priority,
    leadershipChallenge: project.leadershipChallenge,
    sectorRepresentative: project.sectorRepresentative,
    responsible1: project.responsible1,
    responsible2: project.responsible2,
    phase: project.phase,
    archived: project.archived,
    createdById: project.createdById,
    createdByName: project.createdBy.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function toInovaPhaseHistoryDTO(entry: InovaPhaseHistory): InovaPhaseHistoryDTO {
  return {
    id: entry.id,
    projectId: entry.projectId,
    phase: entry.phase,
    note: entry.note,
    occurredAt: entry.occurredAt.toISOString(),
  }
}

export function toInovaDiaryEntryDTO(entry: InovaDiaryEntry & { createdBy: User }): InovaDiaryEntryDTO {
  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    description: entry.description,
    learnings: entry.learnings,
    tools: entry.tools,
    entryType: entry.entryType,
    occurredAt: entry.occurredAt.toISOString(),
    imageUrls: entry.imageUrls,
    videoLinks: entry.videoLinks,
    externalLinks: entry.externalLinks,
    createdById: entry.createdById,
    createdByName: entry.createdBy.name,
    createdAt: entry.createdAt.toISOString(),
  }
}

export function toInovaProjectTaskDTO(task: InovaProjectTask): InovaProjectTaskDTO {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    responsible: task.responsible,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export function toInovaActivityDTO(activity: InovaActivity & { actor: User }): InovaActivityDTO {
  return {
    id: activity.id,
    projectId: activity.projectId,
    action: activity.action,
    entity: activity.entity,
    summary: activity.summary,
    actorId: activity.actorId,
    actorName: activity.actor.name,
    details: (activity.details as Record<string, unknown> | null) ?? null,
    createdAt: activity.createdAt.toISOString(),
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (a checagem final só passa depois do Task 6/7 estarem com os imports corretos — se rodar isolado agora e o service ainda não existir, ignore erros vindos de `inova-service.ts` e volte a rodar depois do Task 7).

- [ ] **Step 3: Voltar e rodar os testes do Task 6 e 7**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/inova-service.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "feat(inova): serializadores dos DTOs do INOVA"
```

---

### Task 9: Rotas HTTP do INOVA

**Files:**
- Create: `apps/api/src/routes/inova.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/inova.test.ts`

**Interfaces:**
- Consumes: todas as funções do `inova-service.ts` (Tasks 6/7).
- Produces:
  - `GET /inova/projects` (autenticado) → `{ projects: InovaProjectDTO[] }`
  - `GET /inova/projects/:id` (autenticado) → `InovaProjectDetailResponse`
  - `POST /inova/projects` (admin/subadmin) → `{ project: InovaProjectDTO }`
  - `PATCH /inova/projects/:id` (admin/subadmin) → `{ project: InovaProjectDTO }`
  - `PATCH /inova/projects/:id/phase` (admin/subadmin) → `{ project: InovaProjectDTO }`
  - `POST /inova/projects/:id/diary` (autenticado) → `{ entry: InovaDiaryEntryDTO }`
  - `POST /inova/projects/:id/tasks` (autenticado) → `{ task: InovaProjectTaskDTO }`
  - `PATCH /inova/tasks/:id/status` (autenticado) → `{ task: InovaProjectTaskDTO }`
  - `export async function inovaRoutes(app: FastifyInstance)`

- [ ] **Step 1: Escrever o teste da rota**

```ts
// apps/api/src/routes/inova.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateDevelopmentSettings } from '../services/development-settings-service'

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('rotas do INOVA', () => {
  it('recusa quem não é admin/subadmin ao criar projeto e permite listar/detalhar para qualquer autenticado', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    const membro = await prisma.user.create({
      data: {
        email: `membro-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Membro',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const tokenMembro = app.jwt.sign({ sub: membro.id, role: 'LEGEND', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID })
    const tokenAdmin = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID })

    const negado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenMembro),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(negado.statusCode).toBe(403)

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(criado.statusCode).toBe(200)
    const { project } = criado.json()

    const lista = await app.inject({
      method: 'GET',
      url: '/inova/projects',
      headers: auth(tokenMembro),
    })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().projects.map((p: { id: string }) => p.id)).toContain(project.id)

    const diario = await app.inject({
      method: 'POST',
      url: `/inova/projects/${project.id}/diary`,
      headers: auth(tokenMembro),
      payload: { title: 'Entrada' },
    })
    expect(diario.statusCode).toBe(200)

    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/inova.test.ts`
Expected: FAIL — `Cannot find module '../routes/inova'` (ou 404 nas rotas).

- [ ] **Step 3: Escrever `routes/inova.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { INOVA_PROJECT_PHASES } from '@legends/shared'
import {
  InovaError,
  addInovaDiaryEntry,
  changeInovaProjectPhase,
  createInovaProject,
  createInovaProjectTask,
  getInovaProjectDetail,
  listInovaProjects,
  updateInovaProject,
  updateInovaProjectTaskStatus,
} from '../services/inova-service'

const phaseValues = INOVA_PROJECT_PHASES.map((p) => p.value) as [string, ...string[]]

const projectInputSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  sector: z.string().min(1),
  description: z.string().min(1),
  problemDescription: z.string().nullable().optional(),
  results: z.string().nullable().optional(),
  hoursSaved: z.number().nullable().optional(),
  costReduction: z.number().nullable().optional(),
  otherMetrics: z.string().nullable().optional(),
  projectCosts: z.string().nullable().optional(),
  toolsUsed: z.string().nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  priority: z.string().nullable().optional(),
  leadershipChallenge: z.string().nullable().optional(),
  sectorRepresentative: z.string().nullable().optional(),
  responsible1: z.string().nullable().optional(),
  responsible2: z.string().nullable().optional(),
})

const updateProjectSchema = projectInputSchema.partial()

const phaseSchema = z.object({
  phase: z.enum(phaseValues),
  note: z.string().optional(),
})

const diaryEntrySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  learnings: z.string().optional(),
  tools: z.string().optional(),
  imageUrls: z.array(z.string().url()).optional(),
  videoLinks: z.array(z.string().url()).optional(),
  externalLinks: z.array(z.string().url()).optional(),
})

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  responsible: z.string().optional(),
  dueDate: z.string().datetime().optional(),
})

const taskStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE']),
})

export async function inovaRoutes(app: FastifyInstance) {
  app.get('/inova/projects', { onRequest: [app.authenticate] }, async (request, reply) => {
    const projects = await listInovaProjects(request.user.companyId)
    return reply.send({ projects })
  })

  app.get('/inova/projects/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return reply.send(await getInovaProjectDetail(request.user.companyId, id))
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post(
    '/inova/projects',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const parsed = projectInputSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await createInovaProject({
          ...parsed.data,
          deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
          companyId: request.user.companyId,
          actorId: request.user.sub,
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.patch(
    '/inova/projects/:id',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = updateProjectSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await updateInovaProject({
          ...parsed.data,
          deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : parsed.data.deadline,
          id,
          companyId: request.user.companyId,
          actorId: request.user.sub,
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.patch(
    '/inova/projects/:id/phase',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = phaseSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      try {
        const project = await changeInovaProjectPhase({
          id,
          phase: parsed.data.phase as (typeof phaseValues)[number] as never,
          note: parsed.data.note,
          companyId: request.user.companyId,
          actorId: request.user.sub,
        })
        return reply.send({ project })
      } catch (err) {
        if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )

  app.post('/inova/projects/:id/diary', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = diaryEntrySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const entry = await addInovaDiaryEntry({
        ...parsed.data,
        projectId: id,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ entry })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/inova/projects/:id/tasks', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = taskSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const task = await createInovaProjectTask({
        ...parsed.data,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        projectId: id,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ task })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/inova/tasks/:id/status', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = taskStatusSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    try {
      const task = await updateInovaProjectTaskStatus({
        taskId: id,
        status: parsed.data.status,
        companyId: request.user.companyId,
        actorId: request.user.sub,
      })
      return reply.send({ task })
    } catch (err) {
      if (err instanceof InovaError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Registrar a rota em `app.ts`**

Em `apps/api/src/app.ts`, adicione o import junto dos outros de `./routes/*` e a linha `app.register(inovaRoutes)` junto das demais (ex.: logo após `app.register(developmentRoutes)`, linha 245).

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/inova.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/inova.ts apps/api/src/routes/inova.test.ts apps/api/src/app.ts
git commit -m "feat(inova): rotas HTTP do módulo INOVA"
```

---

### Task 10: Cliente web do INOVA

**Files:**
- Create: `apps/web/src/lib/inova-api.ts`

**Interfaces:**
- Consumes: `apiFetch` (`./api`).
- Produces:
  - `listInovaProjects(): Promise<InovaProjectListResponse>`
  - `getInovaProjectDetail(id: string): Promise<InovaProjectDetailResponse>`
  - `createInovaProject(body): Promise<{ project: InovaProjectDTO }>`
  - `updateInovaProject(id, body): Promise<{ project: InovaProjectDTO }>`
  - `changeInovaProjectPhase(id, body: { phase, note? }): Promise<{ project: InovaProjectDTO }>`
  - `addInovaDiaryEntry(projectId, body): Promise<{ entry: InovaDiaryEntryDTO }>`
  - `createInovaProjectTask(projectId, body): Promise<{ task: InovaProjectTaskDTO }>`
  - `updateInovaProjectTaskStatus(taskId, status): Promise<{ task: InovaProjectTaskDTO }>`
  - `presignInovaDiaryUpload(contentType, size): Promise<{ uploadUrl: string; publicUrl: string; key: string; kind: string }>`
  - `uploadInovaDiaryEvidence(file: File): Promise<string>` (devolve `publicUrl`)

- [ ] **Step 1: Escrever `inova-api.ts`**

```ts
import type {
  InovaProjectDetailResponse,
  InovaProjectDTO,
  InovaProjectListResponse,
  InovaProjectPhase,
  InovaDiaryEntryDTO,
  InovaProjectTaskDTO,
  InovaTaskStatus,
} from '@legends/shared'
import { apiFetch } from './api'

export function listInovaProjects() {
  return apiFetch<InovaProjectListResponse>('/inova/projects')
}

export function getInovaProjectDetail(id: string) {
  return apiFetch<InovaProjectDetailResponse>(`/inova/projects/${id}`)
}

export function createInovaProject(body: Partial<InovaProjectDTO> & { title: string; category: string; sector: string; description: string }) {
  return apiFetch<{ project: InovaProjectDTO }>('/inova/projects', { method: 'POST', body: JSON.stringify(body) })
}

export function updateInovaProject(id: string, body: Partial<InovaProjectDTO>) {
  return apiFetch<{ project: InovaProjectDTO }>(`/inova/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function changeInovaProjectPhase(id: string, body: { phase: InovaProjectPhase; note?: string }) {
  return apiFetch<{ project: InovaProjectDTO }>(`/inova/projects/${id}/phase`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function addInovaDiaryEntry(
  projectId: string,
  body: { title: string; description?: string; learnings?: string; tools?: string; imageUrls?: string[]; videoLinks?: string[]; externalLinks?: string[] },
) {
  return apiFetch<{ entry: InovaDiaryEntryDTO }>(`/inova/projects/${projectId}/diary`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createInovaProjectTask(
  projectId: string,
  body: { title: string; description?: string; responsible?: string; dueDate?: string },
) {
  return apiFetch<{ task: InovaProjectTaskDTO }>(`/inova/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateInovaProjectTaskStatus(taskId: string, status: InovaTaskStatus) {
  return apiFetch<{ task: InovaProjectTaskDTO }>(`/inova/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function presignInovaDiaryUpload(contentType: string, size: number) {
  return apiFetch<{ uploadUrl: string; publicUrl: string; key: string; kind: string }>('/uploads/inova-diary/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType, size }),
  })
}

/** Sobe o arquivo direto no storage pela URL assinada e devolve a URL pública. */
export async function uploadInovaDiaryEvidence(file: File): Promise<string> {
  const { uploadUrl, publicUrl } = await presignInovaDiaryUpload(file.type, file.size)
  const res = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  if (!res.ok) throw new Error('Não foi possível enviar o arquivo.')
  return publicUrl
}
```

- [ ] **Step 2: Verificar que compila**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros novos relacionados a este arquivo.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/inova-api.ts
git commit -m "feat(inova): cliente web do módulo INOVA"
```

---

### Task 11: Página de entrada — kanban de projetos (substitui o redirecionamento)

**Files:**
- Modify: `apps/web/src/pages/ComunidadeInovaPage.tsx` (reescrito por completo — vira o kanban)
- Test: `apps/web/src/pages/ComunidadeInovaPage.test.tsx`

**Interfaces:**
- Consumes: `listInovaProjects`, `useDevelopmentSettings` (agora expõe `inovaModuleEnabled` em vez de `inovaCommunityUrl`), `INOVA_PROJECT_PHASES` (`@legends/shared`).
- Produces: `export function ComunidadeInovaPage()` — kanban por fase, com link para `InovaProjectDetailPage` (Task 13) e botão "Novo projeto" (Task 12) visível só para admin/subadmin.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/ComunidadeInovaPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ComunidadeInovaPage } from './ComunidadeInovaPage'
import * as inovaApi from '../lib/inova-api'
import * as authModule from '../auth/AuthContext'

vi.mock('../lib/inova-api')
vi.mock('../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

function renderPage() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ComunidadeInovaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ComunidadeInovaPage', () => {
  it('mostra os projetos agrupados por fase', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({
      projects: [
        {
          id: '1',
          title: 'Projeto A',
          category: 'IA',
          sector: 'Ensino',
          description: 'desc',
          problemDescription: null,
          results: null,
          hoursSaved: null,
          costReduction: null,
          otherMetrics: null,
          projectCosts: null,
          toolsUsed: null,
          deadline: null,
          priority: null,
          leadershipChallenge: null,
          sectorRepresentative: null,
          responsible1: null,
          responsible2: null,
          phase: 'IDEA',
          archived: false,
          createdById: 'u1',
          createdByName: 'Fulano',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.getByText('Ideia do Projeto')).toBeInTheDocument()
  })

  it('não mostra "Novo projeto" para quem não é admin/subadmin', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.listInovaProjects).mockResolvedValue({ projects: [] })

    renderPage()

    await waitFor(() => expect(screen.getByText('Ideia do Projeto')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /novo projeto/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ComunidadeInovaPage.test.tsx`
Expected: FAIL (a página atual não tem esse conteúdo).

- [ ] **Step 3: Reescrever `ComunidadeInovaPage.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { INOVA_PROJECT_PHASES, canAdminister } from '@legends/shared'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { listInovaProjects } from '../lib/inova-api'

/**
 * Comunidade INOVA — módulo nativo (era um redirecionamento externo até
 * 2026-09; ver docs/superpowers/specs/2026-09-03-comunidade-inova-nativa-design.md).
 * Kanban dos projetos de inovação por fase.
 */
export function ComunidadeInovaPage() {
  const { user } = useAuth()
  const { data, isPending } = useQuery({ queryKey: ['inova', 'projects'], queryFn: listInovaProjects })
  const podeCriar = user ? canAdminister(user) : false

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex items-center justify-between gap-md">
        <div>
          <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Comunidade INOVA</p>
          <h1 className="mt-2 font-headline text-headline-lg text-on-surface">Projetos de inovação</h1>
        </div>
        {podeCriar && (
          <Link
            to="/comunidade-inova/novo"
            className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            <Icon name="add" className="text-[18px]" />
            Novo projeto
          </Link>
        )}
      </header>

      {isPending && <p className="text-body-md text-on-surface-variant">Carregando…</p>}

      <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
        {INOVA_PROJECT_PHASES.map((phase) => {
          const projetosDaFase = (data?.projects ?? []).filter((p) => p.phase === phase.value)
          return (
            <div key={phase.value} className="flex flex-col gap-sm rounded-2xl border border-outline-variant/40 bg-surface-container-low p-md">
              <h2 className="font-headline text-headline-sm text-on-surface">{phase.label}</h2>
              {projetosDaFase.length === 0 && (
                <p className="text-body-sm text-on-surface-variant">Nenhum projeto nesta fase.</p>
              )}
              {projetosDaFase.map((project) => (
                <Link
                  key={project.id}
                  to={`/comunidade-inova/${project.id}`}
                  className="rounded-xl border border-outline-variant/40 bg-surface-container p-sm hover:border-primary/60"
                >
                  <p className="font-label text-label-md text-on-surface">{project.title}</p>
                  <p className="text-body-sm text-on-surface-variant">{project.sector}</p>
                </Link>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

Confirme que `canAdminister` já é exportado por `@legends/shared` (`permissions.ts`) e recebe `{ role, adminAccess? }` — ajuste a chamada conforme a assinatura real, lida no arquivo antes de usar.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ComunidadeInovaPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ComunidadeInovaPage.tsx apps/web/src/pages/ComunidadeInovaPage.test.tsx
git commit -m "feat(inova): kanban de projetos substitui o redirecionamento externo"
```

---

### Task 12: Formulário de projeto (criar/editar)

**Files:**
- Create: `apps/web/src/pages/inova/InovaProjectFormPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/inova/InovaProjectFormPage.test.tsx`

**Interfaces:**
- Consumes: `createInovaProject`, `updateInovaProject` (`../lib/inova-api`), `INOVA_SUGGESTED_SECTORS` (`@legends/shared`).
- Produces: `export function InovaProjectFormPage()`, rotas `/comunidade-inova/novo` e `/comunidade-inova/:id/editar` em `App.tsx`.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/inova/InovaProjectFormPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { InovaProjectFormPage } from './InovaProjectFormPage'
import * as inovaApi from '../../lib/inova-api'

vi.mock('../../lib/inova-api')

describe('InovaProjectFormPage', () => {
  it('cria um projeto novo com título, categoria, setor e descrição', async () => {
    vi.mocked(inovaApi.createInovaProject).mockResolvedValue({
      project: { id: 'novo-id' } as never,
    })
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comunidade-inova/novo']}>
          <Routes>
            <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
            <Route path="/comunidade-inova/:id" element={<p>detalhe</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.type(screen.getByLabelText(/título/i), 'Meu projeto')
    await userEvent.type(screen.getByLabelText(/categoria/i), 'IA')
    await userEvent.type(screen.getByLabelText(/descrição/i), 'Descrição do projeto')
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(inovaApi.createInovaProject).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('detalhe')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectFormPage.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `InovaProjectFormPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { INOVA_SUGGESTED_SECTORS } from '@legends/shared'
import { createInovaProject, updateInovaProject, getInovaProjectDetail } from '../../lib/inova-api'
import { useQuery } from '@tanstack/react-query'

const inputCls = 'rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'

export function InovaProjectFormPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id?: string }>()
  const isEdit = Boolean(id)
  const existing = useQuery({
    queryKey: ['inova', 'project', id],
    queryFn: () => getInovaProjectDetail(id as string),
    enabled: isEdit,
  })

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [sector, setSector] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (existing.data && !title && !category) {
    setTitle(existing.data.project.title)
    setCategory(existing.data.project.category)
    setSector(existing.data.project.sector)
    setDescription(existing.data.project.description)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = isEdit
        ? await updateInovaProject(id as string, { title, category, sector, description })
        : await createInovaProject({ title, category, sector, description })
      navigate(`/comunidade-inova/${result.project.id}`)
    } catch {
      setError('Não foi possível salvar o projeto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-lg p-lg md:p-xl">
      <h1 className="font-headline text-headline-lg text-on-surface">
        {isEdit ? 'Editar projeto' : 'Novo projeto de inovação'}
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título</span>
          <input aria-label="Título" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
          <input aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Setor</span>
          <input aria-label="Setor" list="inova-setores" value={sector} onChange={(e) => setSector(e.target.value)} className={inputCls} required />
          <datalist id="inova-setores">
            {INOVA_SUGGESTED_SECTORS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
          <textarea aria-label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} required rows={4} />
        </label>
        {error && <p className="text-body-sm text-error">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-fit items-center rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:opacity-60"
        >
          Salvar
        </button>
      </form>
    </section>
  )
}
```

- [ ] **Step 4: Registrar as rotas em `App.tsx`**

Junto de `<Route path="/comunidade-inova" element={<ComunidadeInovaPage />} />` (linha 534), adicione:

```tsx
                    <Route path="/comunidade-inova/novo" element={<InovaProjectFormPage />} />
                    <Route path="/comunidade-inova/:id/editar" element={<InovaProjectFormPage />} />
                    <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
```

E importe `InovaProjectFormPage` e `InovaProjectDetailPage` (Task 13) junto de `ComunidadeInovaPage` no topo do arquivo. Note que a ordem das rotas no React Router não importa aqui (segmentos distintos: `novo`, `:id/editar`, `:id`), mas garanta que `/comunidade-inova/novo` não seja capturado por `:id` — como são padrões de path diferentes (`/novo` fixo vs `/:id` variável), o React Router já resolve isso corretamente por especificidade, sem necessidade de reordenar.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectFormPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/inova/InovaProjectFormPage.tsx apps/web/src/pages/inova/InovaProjectFormPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(inova): formulário de criar/editar projeto"
```

---

### Task 13: Página de detalhe — diário, tarefas, histórico e atividade

**Files:**
- Create: `apps/web/src/pages/inova/InovaProjectDetailPage.tsx`
- Test: `apps/web/src/pages/inova/InovaProjectDetailPage.test.tsx`

**Interfaces:**
- Consumes: `getInovaProjectDetail`, `addInovaDiaryEntry`, `createInovaProjectTask`, `updateInovaProjectTaskStatus`, `changeInovaProjectPhase`, `uploadInovaDiaryEvidence` (`../../lib/inova-api`), `INOVA_PROJECT_PHASES`, `INOVA_TASK_STATUSES` (`@legends/shared`), `canAdminister` (`@legends/shared`), `useAuth` (`../../auth/AuthContext`).
- Produces: `export function InovaProjectDetailPage()`.

- [ ] **Step 1: Escrever o teste**

```tsx
// apps/web/src/pages/inova/InovaProjectDetailPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { InovaProjectDetailPage } from './InovaProjectDetailPage'
import * as inovaApi from '../../lib/inova-api'
import * as authModule from '../../auth/AuthContext'

vi.mock('../../lib/inova-api')
vi.mock('../../auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/AuthContext')>()),
  useAuth: vi.fn(),
}))

describe('InovaProjectDetailPage', () => {
  it('mostra o diário de bordo e as tarefas do projeto', async () => {
    vi.mocked(authModule.useAuth).mockReturnValue({ user: { role: 'LEGEND' } } as ReturnType<typeof authModule.useAuth>)
    vi.mocked(inovaApi.getInovaProjectDetail).mockResolvedValue({
      project: {
        id: '1',
        title: 'Projeto A',
        category: 'IA',
        sector: 'Ensino',
        description: 'desc',
        problemDescription: null,
        results: null,
        hoursSaved: null,
        costReduction: null,
        otherMetrics: null,
        projectCosts: null,
        toolsUsed: null,
        deadline: null,
        priority: null,
        leadershipChallenge: null,
        sectorRepresentative: null,
        responsible1: null,
        responsible2: null,
        phase: 'IDEA',
        archived: false,
        createdById: 'u1',
        createdByName: 'Fulano',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      phaseHistory: [{ id: 'ph1', projectId: '1', phase: 'IDEA', note: null, occurredAt: '2026-01-01T00:00:00.000Z' }],
      diaryEntries: [
        {
          id: 'd1',
          projectId: '1',
          title: 'Entrada 1',
          description: null,
          learnings: null,
          tools: null,
          entryType: 'MANUAL',
          occurredAt: '2026-01-02T00:00:00.000Z',
          imageUrls: [],
          videoLinks: [],
          externalLinks: [],
          createdById: 'u1',
          createdByName: 'Fulano',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      tasks: [
        {
          id: 't1',
          projectId: '1',
          title: 'Tarefa 1',
          description: null,
          responsible: null,
          dueDate: null,
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activity: [],
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/comunidade-inova/1']}>
          <Routes>
            <Route path="/comunidade-inova/:id" element={<InovaProjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Projeto A')).toBeInTheDocument())
    expect(screen.getByText('Entrada 1')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectDetailPage.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Escrever `InovaProjectDetailPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { INOVA_PROJECT_PHASES, INOVA_TASK_STATUSES, canAdminister } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import {
  addInovaDiaryEntry,
  changeInovaProjectPhase,
  createInovaProjectTask,
  getInovaProjectDetail,
  updateInovaProjectTaskStatus,
  uploadInovaDiaryEvidence,
} from '../../lib/inova-api'

const inputCls = 'rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'

export function InovaProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()
  const podeAdministrar = user ? canAdminister(user) : false

  const detail = useQuery({
    queryKey: ['inova', 'project', id],
    queryFn: () => getInovaProjectDetail(id as string),
    enabled: Boolean(id),
  })

  const [diaryTitle, setDiaryTitle] = useState('')
  const [diaryDescription, setDiaryDescription] = useState('')
  const [diaryFile, setDiaryFile] = useState<File | null>(null)
  const [taskTitle, setTaskTitle] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inova', 'project', id] })

  const addDiary = useMutation({
    mutationFn: async () => {
      const imageUrls = diaryFile ? [await uploadInovaDiaryEvidence(diaryFile)] : []
      return addInovaDiaryEntry(id as string, { title: diaryTitle, description: diaryDescription || undefined, imageUrls })
    },
    onSuccess: () => {
      setDiaryTitle('')
      setDiaryDescription('')
      setDiaryFile(null)
      invalidate()
    },
  })

  const addTask = useMutation({
    mutationFn: () => createInovaProjectTask(id as string, { title: taskTitle }),
    onSuccess: () => {
      setTaskTitle('')
      invalidate()
    },
  })

  const setTaskStatus = useMutation({
    mutationFn: (input: { taskId: string; status: 'PENDING' | 'IN_PROGRESS' | 'DONE' }) =>
      updateInovaProjectTaskStatus(input.taskId, input.status),
    onSuccess: invalidate,
  })

  const setPhase = useMutation({
    mutationFn: (phase: (typeof INOVA_PROJECT_PHASES)[number]['value']) => changeInovaProjectPhase(id as string, { phase }),
    onSuccess: invalidate,
  })

  if (detail.isPending || !detail.data) return <p className="p-lg text-body-md text-on-surface-variant">Carregando…</p>

  const { project, phaseHistory, diaryEntries, tasks, activity } = detail.data

  function handleDiarySubmit(event: FormEvent) {
    event.preventDefault()
    addDiary.mutate()
  }

  function handleTaskSubmit(event: FormEvent) {
    event.preventDefault()
    addTask.mutate()
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">{project.sector}</p>
        <h1 className="mt-2 font-headline text-headline-lg text-on-surface">{project.title}</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">{project.description}</p>
        {podeAdministrar && (
          <label className="mt-md flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Fase</span>
            <select
              value={project.phase}
              onChange={(e) => setPhase.mutate(e.target.value as (typeof INOVA_PROJECT_PHASES)[number]['value'])}
              className={inputCls}
            >
              {INOVA_PROJECT_PHASES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section>
        <h2 className="font-headline text-headline-sm text-on-surface">Diário de bordo</h2>
        <form onSubmit={handleDiarySubmit} className="mt-sm flex flex-col gap-sm rounded-2xl border border-outline-variant/40 p-md">
          <input aria-label="Título da entrada" value={diaryTitle} onChange={(e) => setDiaryTitle(e.target.value)} className={inputCls} required />
          <textarea aria-label="Descrição da entrada" value={diaryDescription} onChange={(e) => setDiaryDescription(e.target.value)} className={inputCls} />
          <input aria-label="Evidência" type="file" accept="image/*,video/mp4,video/webm" onChange={(e) => setDiaryFile(e.target.files?.[0] ?? null)} />
          <button type="submit" disabled={addDiary.isPending} className="inline-flex w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:opacity-60">
            Adicionar
          </button>
        </form>
        <ul className="mt-sm flex flex-col gap-sm">
          {diaryEntries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-outline-variant/40 p-sm">
              <p className="font-label text-label-md text-on-surface">{entry.title}</p>
              {entry.description && <p className="text-body-sm text-on-surface-variant">{entry.description}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-headline text-headline-sm text-on-surface">Tarefas</h2>
        <form onSubmit={handleTaskSubmit} className="mt-sm flex gap-sm">
          <input aria-label="Título da tarefa" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className={inputCls} required />
          <button type="submit" disabled={addTask.isPending} className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:opacity-60">
            Adicionar
          </button>
        </form>
        <ul className="mt-sm flex flex-col gap-sm">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between rounded-xl border border-outline-variant/40 p-sm">
              <span className="text-body-md text-on-surface">{task.title}</span>
              <select
                value={task.status}
                onChange={(e) => setTaskStatus.mutate({ taskId: task.id, status: e.target.value as 'PENDING' | 'IN_PROGRESS' | 'DONE' })}
                className={inputCls}
              >
                {INOVA_TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-headline text-headline-sm text-on-surface">Histórico de fase</h2>
        <ul className="mt-sm flex flex-col gap-1">
          {phaseHistory.map((h) => (
            <li key={h.id} className="text-body-sm text-on-surface-variant">
              {INOVA_PROJECT_PHASES.find((p) => p.value === h.phase)?.label ?? h.phase}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-headline text-headline-sm text-on-surface">Atividade</h2>
        <ul className="mt-sm flex flex-col gap-1">
          {activity.map((a) => (
            <li key={a.id} className="text-body-sm text-on-surface-variant">
              {a.summary}
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/inova/InovaProjectDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/inova/InovaProjectDetailPage.tsx apps/web/src/pages/inova/InovaProjectDetailPage.test.tsx
git commit -m "feat(inova): página de detalhe do projeto (diário, tarefas, histórico, atividade)"
```

---

### Task 14: Menu — gate por `inovaModuleEnabled`

**Files:**
- Modify: `apps/web/src/components/nav-items.ts`
- Modify: `apps/web/src/components/nav-items.test.ts`

**Interfaces:**
- Consumes: `useDevelopmentSettings().data.settings.inovaModuleEnabled` (em vez de `inovaCommunityUrl`).

- [ ] **Step 1: Atualizar o teste existente**

Em `apps/web/src/components/nav-items.test.ts:170-221`, troque os casos que hoje montam `inovaCommunityUrl: 'https://...'`/`inovaCommunityUrl: null` por `inovaModuleEnabled: true`/`inovaModuleEnabled: false`, mantendo a mesma asserção (item "Comunidade INOVA" aparece/some).

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: FAIL (o código ainda lê `inovaCommunityUrl`).

- [ ] **Step 3: Atualizar `nav-items.ts`**

Troque a variável de entrada (onde hoje o arquivo lê `inovaCommunityUrl` da configuração recebida) para ler `inovaModuleEnabled`, e o `const inovaCommunityGroups: NavGroup[] = inovaCommunityUrl ? [...] : []` (linhas ~119-131) por `= inovaModuleEnabled ? [...] : []`, mantendo o resto do bloco (rota, ícone, label, keywords) idêntico. Atualize também o comentário acima do bloco, que hoje descreve a URL configurável — troque para descrever a config booleana (`inovaModuleEnabled`) e a dupla trava de empresa, referenciando o spec.

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/nav-items.ts apps/web/src/components/nav-items.test.ts
git commit -m "feat(inova): item de menu passa a depender de inovaModuleEnabled"
```

---

### Task 15: Admin — trocar URL externa por toggle + webhook do Teams

**Files:**
- Modify: `apps/web/src/pages/admin/DevelopmentSection.tsx`

**Interfaces:**
- Consumes: `updateDevelopmentSettings({ inovaModuleEnabled, inovaTeamsWebhookUrl, ... })` (Task 4).

- [ ] **Step 1: Atualizar o componente**

Em `DevelopmentSection.tsx`, troque os dois `useState` de `inovaCommunityUrl`/`inovaSupportUrl` por:

```ts
  const [inovaModuleEnabled, setInovaModuleEnabled] = useState(false)
  const [inovaTeamsWebhookUrl, setInovaTeamsWebhookUrl] = useState('')
```

No `useEffect`, troque as duas linhas que leem `settings.data.settings.inovaCommunityUrl`/`inovaSupportUrl` por:

```ts
      setInovaModuleEnabled(settings.data.settings.inovaModuleEnabled)
      setInovaTeamsWebhookUrl(settings.data.settings.inovaTeamsWebhookUrl ?? '')
```

No `mutationFn` do `save`, troque os dois campos por:

```ts
        inovaModuleEnabled,
        inovaTeamsWebhookUrl: inovaTeamsWebhookUrl.trim() || null,
```

E troque os dois blocos `<label>` de "URL da Comunidade INOVA" e "Contato de suporte da Comunidade INOVA" (linhas 84-113) por:

```tsx
        <label className="flex items-start gap-sm">
          <input
            type="checkbox"
            checked={inovaModuleEnabled}
            onChange={(event) => setInovaModuleEnabled(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-label text-label-md text-on-surface">Habilitar Comunidade INOVA</span>
            <span className="block text-body-sm text-on-surface-variant">
              Liga o módulo nativo de projetos de inovação. Sem esta opção, o item some do menu.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            Webhook do Teams para notificações do INOVA
          </span>
          <input
            value={inovaTeamsWebhookUrl}
            onChange={(event) => setInovaTeamsWebhookUrl(event.target.value)}
            aria-label="Webhook do Teams para notificações do INOVA"
            placeholder="https://.../IncomingWebhook/..."
            className={inputCls}
          />
          <span className="text-body-sm text-on-surface-variant">
            G&amp;G recebe um aviso aqui a cada projeto criado ou atualizado. Sem URL, nenhuma notificação é enviada.
          </span>
        </label>
```

- [ ] **Step 2: Rodar os testes de admin, se houver**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/DevelopmentSection.test.tsx` (se o arquivo não existir, pule — a cobertura fica no fluxo manual do Task 16).
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/DevelopmentSection.tsx
git commit -m "feat(inova): admin troca URL externa por toggle e webhook do Teams"
```

---

### Task 16: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Rodar a suíte completa da API**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: PASS (todos os arquivos, incluindo os tocados nos Tasks 1-9)

- [ ] **Step 2: Rodar a suíte completa do web**

Run: `pnpm --filter @legends/web test`
Expected: PASS

- [ ] **Step 3: Rodar a suíte completa do shared**

Run: `pnpm --filter @legends/shared test`
Expected: PASS

- [ ] **Step 4: Rodar o build de todos os workspaces**

Run: `pnpm build`
Expected: sem erros de tipo/build em nenhum workspace.

- [ ] **Step 5: Subir a app e verificar manualmente**

Suba `pnpm dev` com `pnpm db:up` rodando. Habilite `inovaModuleEnabled` para a EMR em Administração › Desenvolvimento, confirme que o item "Comunidade INOVA" aparece no menu, crie um projeto (como admin), adicione uma entrada de diário (como colaborador comum), mude a fase, e confira que a tela de detalhe reflete diário/tarefas/histórico/atividade.

- [ ] **Step 6: Commit final (se sobrar algo solto)**

```bash
git status
```

Se houver qualquer arquivo modificado não commitado (ex.: ajuste de import esquecido em algum Task), revise e commit.
