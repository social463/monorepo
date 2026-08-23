# Multi-tenancy no Escritório — sub-fatia 1: dados + services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada um dos 11 models do domínio de Escritório (`OfficeSetting`, `OfficeMap`,
`OfficeMapDraft`, `OfficeMapAsset`, `OfficeMapEditLock`, `OfficeMapPublication`,
`OfficeMapPublicationAsset`, `OfficeRoom`, `OfficeRoomAccessGrant`, `OfficeDesk`,
`OfficeDeskClaim`, `OfficeGuestInvite`) isolamento por empresa — schema + os 3 services
(`office-map-service.ts`, `office-setting-service.ts`, `office-guest-service.ts`) — sem tocar
rotas nem o `officeHub`/`office-ws.ts` (sub-fatias seguintes).

**Architecture:** `OfficeSetting` deixa de ser singleton (`id Int @default(1)`) e vira uma linha
por empresa (`companyId String @id`) — não entra na allowlist `TENANT_SCOPED_MODELS` porque o
service já resolve a linha certa via `where: { companyId }` explícito, sem precisar da extensão
(e a extensão nem suporta `upsert`, que o service usa bastante). Os outros 10 models ganham
`companyId` denormalizado com `@default("company-emr")`, entram em `TENANT_SCOPED_MODELS`, e todo
`prisma.<model>` nesses services vira `scopedPrisma(companyId).<model>`. `materializePublication`
(a função que publica um mapa em lote via `createMany`) passa a rodar dentro de
`scopedPrisma(companyId).$transaction(...)` em vez de `prisma.$transaction(...)` — assim a
extensão intercepta cada `createMany` de sala/mesa/grant/claim e injeta `companyId`
automaticamente, sem precisar tocar em cada `createMany` individualmente.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest.

## Global Constraints

- Branch de trabalho: `feat/multi-empresa-auth-jwt` (mesma linha das fatias anteriores de
  multi-tenancy já commitadas nesta branch — `tenant-scope.ts`, `Company`, `Sector`, `User`,
  `VotingPeriod`, `Vote`, `Squad`, `ThirdPartyInvite`, `Category`, `Badge` já migrados e
  escopados). Trabalhar em worktree isolado (`superpowers:using-git-worktrees`).
- **Antes de rodar `prisma migrate dev` ou qualquer comando que grave no Postgres, confirme que
  `apps/api/.env`'s `DATABASE_URL` é
  `postgresql://legends:legends@localhost:5432/legends?schema=public` (Postgres local). Se for
  qualquer outra coisa, pare e reporte BLOCKED sem executar nada.**
- `pnpm db:up` precisa estar de pé antes de rodar qualquer teste da API ou migration.
- `scopedPrisma` **não suporta `upsert`** (lança `TenantScopeError` de propósito,
  `apps/api/src/lib/tenant-scope.ts`) — é exatamente por isso que `OfficeSetting` **não** entra
  em `TENANT_SCOPED_MODELS` (decisão desta fatia, ver Task 1): os dois services que fazem
  `officeSetting.upsert(...)` (`office-setting-service.ts`, `materializePublication`) continuam
  usando `prisma.officeSetting` puro, só com `where`/`create` explícitos por `companyId`.
- `companyId` entra como **novo parâmetro posicional ao final** de toda função exportada que
  hoje não tem — mesma convenção das fatias anteriores (ex.: `createCategory(input, actorId,
  companyId)`). Exceção: `getActiveOfficeMap(_userId?: string)` — o parâmetro `_userId` nunca foi
  usado; ele é **substituído** por `getActiveOfficeMap(companyId: string)`, não empilhado.
  `getValidOfficeGuestInvite(rawToken)` é a única função que **não** ganha `companyId` — ver
  Task 3.
- Padrão de transação escopada+`createMany` (`ReturnType<typeof scopedPrisma>` como tipo de
  parâmetro `db`, cast `tx as unknown as Prisma.TransactionClient` só ao repassar `tx` pra
  `recordAuditLog`): já usado em `apps/api/src/services/category-service.ts` e
  `badge-admin-service.ts` — copiar o padrão, não inventar um novo.
- **Fora de escopo, quebra de compilação esperada e aceita** (mesmo handoff das fatias
  anteriores): `apps/api/src/routes/office-maps.ts`, `office-guests.ts`, `office-media.ts`,
  trecho `/admin/office-settings` de `admin.ts`, e `apps/api/src/routes/office-ws.ts` chamam as
  funções destes 3 services com a assinatura antiga — vão para de compilar até a sub-fatia 2. Os
  testes de rota que exercitam esses arquivos (`office-maps.test.ts`, `office-media.test.ts`,
  `office-guests.test.ts` se existir) também vão parar de compilar — **não conserte, não rode
  `pnpm test` completo como critério de sucesso**; cada task deste plano roda só o(s) arquivo(s)
  de teste do service que ela mexeu. `officeHub`/`office-ws.ts` continuam sem particionamento por
  empresa (sub-fatia 3) — as chamadas internas a `officeHub.configure(...)` dentro dos services
  desta fatia continuam recebendo o `ActiveOfficeMapDTO` de sempre (sem `companyId` no DTO),
  inalteradas na forma.
- Zero mudança de comportamento observável em produção — só existe uma empresa hoje
  (`company-emr`, `DEFAULT_COMPANY_ID` de `@legends/shared`).

---

### Task 1: Migration + `tenant-scope.ts`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`
- Create: migration gerada por `prisma migrate dev` (nome sugerido `office_multi_tenancy`)

**Interfaces:**
- Produces: `OfficeMap.companyId`, `OfficeMapDraft.companyId`, `OfficeMapAsset.companyId`,
  `OfficeMapEditLock.companyId`, `OfficeMapPublication.companyId`,
  `OfficeMapPublicationAsset.companyId`, `OfficeRoom.companyId`,
  `OfficeRoomAccessGrant.companyId`, `OfficeDesk.companyId`, `OfficeDeskClaim.companyId`,
  `OfficeGuestInvite.companyId` (todos `string`, todos entram em `TENANT_SCOPED_MODELS`).
  `OfficeSetting.companyId` (agora a PK do model, `string`, **não** entra em
  `TENANT_SCOPED_MODELS`).

- [ ] **Step 1: Editar `schema.prisma` — os 10 models denormalizados**

Modify `apps/api/prisma/schema.prisma`. Em cada um dos 10 models abaixo, adicionar o campo
`companyId String @default("company-emr")`, a relação `company` e o índice — mesmo padrão de
`Sector`/`Category`/`Badge` já existentes no arquivo.

```prisma
model OfficeMap {
  id           String   @id @default(cuid())
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  companyId    String   @default("company-emr")

  company      Company                @relation(fields: [companyId], references: [id])
  draft        OfficeMapDraft?
  assets       OfficeMapAsset[]
  editLock     OfficeMapEditLock?
  publications OfficeMapPublication[]

  @@index([companyId])
}

model OfficeMapDraft {
  id             String   @id @default(cuid())
  mapId          String   @unique
  document       Json
  revision       Int      @default(0)
  lastEditedById String?
  savedAt        DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  companyId      String   @default("company-emr")

  map          OfficeMap @relation(fields: [mapId], references: [id], onDelete: Cascade)
  lastEditedBy User?     @relation("OfficeMapDraftEditor", fields: [lastEditedById], references: [id], onDelete: SetNull)
  company      Company   @relation(fields: [companyId], references: [id])

  @@index([lastEditedById])
  @@index([companyId])
}

model OfficeMapAsset {
  id          String   @id @default(cuid())
  mapId       String
  fileName    String
  mimeType    String
  sizeBytes   Int
  width       Int
  height      Int
  checksum    String
  storageKey  String   @unique
  createdById String?
  createdAt   DateTime @default(now())
  companyId   String   @default("company-emr")

  map              OfficeMap                  @relation(fields: [mapId], references: [id], onDelete: Cascade)
  createdBy        User?                      @relation("OfficeMapAssetCreator", fields: [createdById], references: [id], onDelete: SetNull)
  publicationLinks OfficeMapPublicationAsset[]
  company          Company                    @relation(fields: [companyId], references: [id])

  @@unique([mapId, checksum])
  @@index([mapId])
  @@index([createdById])
  @@index([companyId])
}

model OfficeMapEditLock {
  id        String   @id @default(cuid())
  mapId     String   @unique
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  companyId String   @default("company-emr")

  map     OfficeMap @relation(fields: [mapId], references: [id], onDelete: Cascade)
  user    User      @relation("OfficeMapLockOwner", fields: [userId], references: [id], onDelete: Cascade)
  company Company   @relation(fields: [companyId], references: [id])

  @@index([userId])
  @@index([expiresAt])
  @@index([companyId])
}

model OfficeMapPublication {
  id            String   @id @default(cuid())
  mapId         String
  createdById   String?
  version       Int
  schemaVersion String
  mapData       Json
  createdAt     DateTime @default(now())
  companyId     String   @default("company-emr")

  map           OfficeMap                  @relation(fields: [mapId], references: [id], onDelete: Cascade)
  createdBy     User?                      @relation("OfficeMapPublicationCreator", fields: [createdById], references: [id], onDelete: SetNull)
  assetLinks    OfficeMapPublicationAsset[]
  rooms         OfficeRoom[]
  desks         OfficeDesk[]
  activeSetting OfficeSetting?             @relation("ActiveOfficeMapPublication")
  company       Company                    @relation(fields: [companyId], references: [id])

  @@unique([mapId, version])
  @@index([createdById])
  @@index([companyId])
}

model OfficeMapPublicationAsset {
  publicationId String
  assetId       String
  createdAt     DateTime @default(now())
  companyId     String   @default("company-emr")

  publication OfficeMapPublication @relation(fields: [publicationId], references: [id], onDelete: Cascade)
  asset       OfficeMapAsset       @relation(fields: [assetId], references: [id], onDelete: Restrict)
  company     Company              @relation(fields: [companyId], references: [id])

  @@id([publicationId, assetId])
  @@index([assetId])
  @@index([companyId])
}

model OfficeRoom {
  id               String                 @id @default(cuid())
  mapPublicationId String
  name             String
  externalKey      String
  status           OfficeRoomStatus       @default(OPEN)
  capacity         Int?
  voiceEnabled     Boolean                @default(true)
  accessPolicy     OfficeRoomAccessPolicy @default(OPEN)
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt
  companyId        String                 @default("company-emr")

  mapPublication OfficeMapPublication   @relation(fields: [mapPublicationId], references: [id], onDelete: Cascade)
  accessGrants   OfficeRoomAccessGrant[]
  company        Company                @relation(fields: [companyId], references: [id])

  @@unique([mapPublicationId, externalKey])
  @@index([mapPublicationId])
  @@index([companyId])
}

model OfficeRoomAccessGrant {
  roomId    String
  userId    String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  room    OfficeRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user    User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@id([roomId, userId])
  @@index([userId])
  @@index([companyId])
}

model OfficeDesk {
  id               String   @id @default(cuid())
  mapPublicationId String
  name             String
  externalKey      String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  companyId        String   @default("company-emr")

  mapPublication OfficeMapPublication @relation(fields: [mapPublicationId], references: [id], onDelete: Cascade)
  claim          OfficeDeskClaim?
  company        Company              @relation(fields: [companyId], references: [id])

  @@unique([mapPublicationId, externalKey])
  @@index([mapPublicationId])
  @@index([companyId])
}

model OfficeDeskClaim {
  deskId    String   @id
  userId    String   @unique
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  desk    OfficeDesk @relation(fields: [deskId], references: [id], onDelete: Cascade)
  user    User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@index([companyId])
}
```

E `OfficeGuestInvite` (herda `companyId` do admin que criou o convite — ver Task 3):

```prisma
model OfficeGuestInvite {
  id          String    @id @default(cuid())
  tokenHash   String    @unique
  createdById String
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  companyId   String    @default("company-emr")

  createdBy User    @relation("OfficeGuestInviteCreator", fields: [createdById], references: [id], onDelete: Cascade)
  company   Company @relation(fields: [companyId], references: [id])

  @@index([createdById])
  @@index([expiresAt])
  @@index([companyId])
}
```

- [ ] **Step 2: Editar `schema.prisma` — `OfficeSetting` vira per-company**

```prisma
model OfficeSetting {
  companyId              String   @id
  broadcastEnabled       Boolean  @default(false)
  activeMapPublicationId String?  @unique
  updatedAt              DateTime @updatedAt

  company              Company               @relation(fields: [companyId], references: [id])
  activeMapPublication OfficeMapPublication? @relation("ActiveOfficeMapPublication", fields: [activeMapPublicationId], references: [id], onDelete: SetNull)
}
```

- [ ] **Step 3: Adicionar as relações inversas em `Company`**

Modify `apps/api/prisma/schema.prisma`, `model Company` — adicionar ao final da lista de
relações:

```prisma
model Company {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sectors           Sector[]
  users             User[]
  votingPeriods     VotingPeriod[]
  votes             Vote[]
  squads            Squad[]
  thirdPartyInvites ThirdPartyInvite[]
  categories        Category[]
  badges            Badge[]

  officeSetting              OfficeSetting?
  officeMaps                 OfficeMap[]
  officeMapDrafts            OfficeMapDraft[]
  officeMapAssets            OfficeMapAsset[]
  officeMapEditLocks         OfficeMapEditLock[]
  officeMapPublications      OfficeMapPublication[]
  officeMapPublicationAssets OfficeMapPublicationAsset[]
  officeRooms                OfficeRoom[]
  officeRoomAccessGrants     OfficeRoomAccessGrant[]
  officeDesks                OfficeDesk[]
  officeDeskClaims           OfficeDeskClaim[]
  officeGuestInvites         OfficeGuestInvite[]
}
```

- [ ] **Step 4: Gerar a migration com `--create-only` e revisar antes de aplicar**

A troca de PK do `OfficeSetting` (de `id Int @default(1)` pra `companyId String`) é a única parte
não-puramente-aditiva desta migration — vale gerar com `--create-only` pra revisar o SQL antes de
rodar contra o banco.

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --create-only --name office_multi_tenancy`

Abra o arquivo gerado em `apps/api/prisma/migrations/<timestamp>_office_multi_tenancy/migration.sql`
e confirme que ele é equivalente a este (a ordem exata das `ALTER TABLE`/`CREATE INDEX`/
`ADD CONSTRAINT` pode variar, mas o conjunto de operações deve ser este):

```sql
-- AlterTable: OfficeSetting deixa de ser singleton (id Int = 1) e vira 1 linha por empresa
ALTER TABLE "OfficeSetting" ADD COLUMN "companyId" TEXT;
UPDATE "OfficeSetting" SET "companyId" = 'company-emr';
ALTER TABLE "OfficeSetting" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "OfficeSetting" DROP CONSTRAINT "OfficeSetting_pkey";
ALTER TABLE "OfficeSetting" DROP COLUMN "id";
ALTER TABLE "OfficeSetting" ADD CONSTRAINT "OfficeSetting_pkey" PRIMARY KEY ("companyId");

-- AlterTable: companyId denormalizado nos outros 10 models
ALTER TABLE "OfficeMap" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapDraft" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapAsset" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapEditLock" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapPublication" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeMapPublicationAsset" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeRoom" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeRoomAccessGrant" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeDesk" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeDeskClaim" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';
ALTER TABLE "OfficeGuestInvite" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- CreateIndex
CREATE INDEX "OfficeMap_companyId_idx" ON "OfficeMap"("companyId");
CREATE INDEX "OfficeMapDraft_companyId_idx" ON "OfficeMapDraft"("companyId");
CREATE INDEX "OfficeMapAsset_companyId_idx" ON "OfficeMapAsset"("companyId");
CREATE INDEX "OfficeMapEditLock_companyId_idx" ON "OfficeMapEditLock"("companyId");
CREATE INDEX "OfficeMapPublication_companyId_idx" ON "OfficeMapPublication"("companyId");
CREATE INDEX "OfficeMapPublicationAsset_companyId_idx" ON "OfficeMapPublicationAsset"("companyId");
CREATE INDEX "OfficeRoom_companyId_idx" ON "OfficeRoom"("companyId");
CREATE INDEX "OfficeRoomAccessGrant_companyId_idx" ON "OfficeRoomAccessGrant"("companyId");
CREATE INDEX "OfficeDesk_companyId_idx" ON "OfficeDesk"("companyId");
CREATE INDEX "OfficeDeskClaim_companyId_idx" ON "OfficeDeskClaim"("companyId");
CREATE INDEX "OfficeGuestInvite_companyId_idx" ON "OfficeGuestInvite"("companyId");

-- AddForeignKey
ALTER TABLE "OfficeSetting" ADD CONSTRAINT "OfficeSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMap" ADD CONSTRAINT "OfficeMap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapDraft" ADD CONSTRAINT "OfficeMapDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapAsset" ADD CONSTRAINT "OfficeMapAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapEditLock" ADD CONSTRAINT "OfficeMapEditLock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapPublication" ADD CONSTRAINT "OfficeMapPublication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeMapPublicationAsset" ADD CONSTRAINT "OfficeMapPublicationAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeRoom" ADD CONSTRAINT "OfficeRoom_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeRoomAccessGrant" ADD CONSTRAINT "OfficeRoomAccessGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeDesk" ADD CONSTRAINT "OfficeDesk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeDeskClaim" ADD CONSTRAINT "OfficeDeskClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeGuestInvite" ADD CONSTRAINT "OfficeGuestInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Se o Prisma gerar algo estruturalmente diferente disso (ex.: tentar recriar a tabela inteira em
vez de `ALTER`/`DROP COLUMN`), pare e ajuste o `schema.prisma` antes de aceitar — não aplique uma
migration destrutiva além do necessário.

- [ ] **Step 5: Aplicar a migration**

Run: `pnpm --filter @legends/api exec prisma migrate dev`
Expected: aplica a migration criada no Step 4 e roda `prisma generate`, sem prompts de perda de
dado.

- [ ] **Step 6: Registrar os 10 models em `tenant-scope.ts`**

Modify `apps/api/src/lib/tenant-scope.ts`:

```ts
const TENANT_SCOPED_MODELS = new Set([
  'Sector',
  'User',
  'VotingPeriod',
  'Vote',
  'Squad',
  'ThirdPartyInvite',
  'Category',
  'Badge',
  'OfficeMap',
  'OfficeMapDraft',
  'OfficeMapAsset',
  'OfficeMapEditLock',
  'OfficeMapPublication',
  'OfficeMapPublicationAsset',
  'OfficeRoom',
  'OfficeRoomAccessGrant',
  'OfficeDesk',
  'OfficeDeskClaim',
  'OfficeGuestInvite',
])
```

`OfficeSetting` fica de fora de propósito — ver "Global Constraints".

- [ ] **Step 7: `tsc --noEmit` — só pra confirmar que o schema/client geram limpo**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: os 3 services desta fatia (ainda não tocados) e as rotas vão acusar erros de tipo
assim que as próximas tasks mudarem as assinaturas — mas **agora**, antes de qualquer outra
mudança, o `tsc` deve rodar limpo (o Prisma Client já reflete o novo schema; nenhum código ainda
usa os campos novos). Se houver erro aqui, o schema tem um problema — pare e corrija antes de
seguir.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/lib/tenant-scope.ts
git commit -m "feat: adiciona companyId aos models do Escritório (migration + allowlist)"
```

---

### Task 2: `office-setting-service.ts`

**Files:**
- Modify: `apps/api/src/services/office-setting-service.ts`
- Modify: `apps/api/src/services/office-setting-service.test.ts`

**Interfaces:**
- Consumes: `OfficeSetting.companyId` (Task 1, PK do model).
- Produces: `getOfficeSettings(companyId: string): Promise<OfficeConfigDTO>`,
  `setBroadcastEnabled(broadcastEnabled: boolean, actorId: string, companyId: string):
  Promise<OfficeConfigDTO>`.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/office-setting-service.test.ts` — arquivo inteiro:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getOfficeSettings, setBroadcastEnabled } from './office-setting-service'

async function createActor() {
  const user = await prisma.user.create({ data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
  return user.id
}

async function otherCompany(slug: string) {
  return prisma.company.create({ data: { name: slug, slug } })
}

describe('office-setting-service', () => {
  it('sem linha no banco, o default é desligado', async () => {
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('liga, persiste e lê de volta', async () => {
    const actorId = await createActor()
    expect(await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
  })

  it('desligar de novo é idempotente (upsert da linha única)', async () => {
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)
    await setBroadcastEnabled(false, actorId, DEFAULT_COMPANY_ID)
    await setBroadcastEnabled(false, actorId, DEFAULT_COMPANY_ID)
    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('configuração de uma empresa não vaza pra outra', async () => {
    const company = await otherCompany('outra-empresa-office-setting-test')
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, DEFAULT_COMPANY_ID)

    expect(await getOfficeSettings(company.id)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
  })

  it('ligar numa empresa não afeta o desligado da outra', async () => {
    const company = await otherCompany('outra-empresa-office-setting-test-2')
    const actorId = await createActor()
    await setBroadcastEnabled(true, actorId, company.id)

    expect(await getOfficeSettings(DEFAULT_COMPANY_ID)).toEqual({ broadcastEnabled: false, activeMapPublicationId: null })
    expect(await getOfficeSettings(company.id)).toEqual({ broadcastEnabled: true, activeMapPublicationId: null })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-setting-service.test.ts`
Expected: FAIL — erro de tipos/chamada (`getOfficeSettings`/`setBroadcastEnabled` ainda esperam
menos argumentos).

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-setting-service.ts` — arquivo inteiro:

```ts
import type { OfficeConfigDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/**
 * Config do escritório — 1 linha por empresa (`companyId` é a PK do model), criada
 * on-demand. `broadcastEnabled` é o interruptor de custo do alto-falante.
 *
 * `OfficeSetting` NÃO está em `TENANT_SCOPED_MODELS` (ver tenant-scope.ts): a extensão não
 * suporta `upsert`, que este service usa o tempo todo, e como `companyId` já É a PK, o
 * isolamento aqui é feito manualmente via `where`/`create` explícitos — não precisa da
 * injeção automática da extensão.
 */
export async function getOfficeSettings(companyId: string): Promise<OfficeConfigDTO> {
  const row = await prisma.officeSetting.findUnique({ where: { companyId } })
  return {
    broadcastEnabled: row?.broadcastEnabled ?? false,
    activeMapPublicationId: row?.activeMapPublicationId ?? null,
  }
}

export async function setBroadcastEnabled(
  broadcastEnabled: boolean,
  actorId: string,
  companyId: string,
): Promise<OfficeConfigDTO> {
  const before = await prisma.officeSetting.findUnique({ where: { companyId } })
  const row = await prisma.officeSetting.upsert({
    where: { companyId },
    create: { companyId, broadcastEnabled },
    update: { broadcastEnabled },
  })
  await recordAuditLog({
    actorId,
    entityType: 'OfficeSetting',
    entityId: companyId,
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: row,
  })
  return {
    broadcastEnabled: row.broadcastEnabled,
    activeMapPublicationId: row.activeMapPublicationId,
  }
}
```

Note: `entityId` do audit log muda de `'1'` (id fixo do singleton antigo) pra `companyId` — mais
correto agora que a linha é por empresa, e não quebra nenhum consumidor (o campo é só texto livre
de auditoria).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-setting-service.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-setting-service.ts apps/api/src/services/office-setting-service.test.ts
git commit -m "feat: escopa office-setting-service.ts por empresa"
```

---

### Task 3: `office-guest-service.ts`

**Files:**
- Modify: `apps/api/src/services/office-guest-service.ts`
- Modify: `apps/api/src/services/office-guest-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma` (`apps/api/src/lib/tenant-scope.ts`, já existente),
  `OfficeGuestInvite.companyId` (Task 1).
- Produces: `createOfficeGuestInvite(createdById: string, expiresInMinutes: number, companyId:
  string)` — `companyId` novo 3º parâmetro. `getValidOfficeGuestInvite(rawToken: string)`
  **inalterada** — não ganha `companyId` (ver Step 3).

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/office-guest-service.test.ts` — arquivo inteiro:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createOfficeGuestInvite, getValidOfficeGuestInvite } from './office-guest-service'

describe('office-guest-service', () => {
  it('cria convite com validade clampeada', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite, rawToken } = await createOfficeGuestInvite(admin.id, 5, DEFAULT_COMPANY_ID)
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rawToken).toHaveLength(43)
  })

  it('audita criação de convite de convidado', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditGuestAdmin', email: 'auditguest@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const { invite } = await createOfficeGuestInvite(admin.id, 60, DEFAULT_COMPANY_ID)
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'OfficeGuestInvite', entityId: invite.id } })
    expect(row.action).toBe('CREATE')
  })

  it('convite criado por admin de uma empresa herda o companyId do admin, não o default', async () => {
    const company = await prisma.company.create({ data: { name: 'Outra Empresa Guest', slug: 'outra-empresa-guest-test' } })
    const admin = await prisma.user.create({
      data: { name: 'Admin Outra Empresa', email: `admin-outra-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
    })
    const { invite } = await createOfficeGuestInvite(admin.id, 30, company.id)
    expect(invite.companyId).toBe(company.id)
  })

  it('validação de convite continua funcionando sem sessão de empresa (convidado não tem companyId próprio)', async () => {
    const company = await prisma.company.create({ data: { name: 'Outra Empresa Guest Validate', slug: 'outra-empresa-guest-validate-test' } })
    const admin = await prisma.user.create({
      data: { name: 'Admin Validate', email: `admin-validate-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
    })
    const { rawToken, invite } = await createOfficeGuestInvite(admin.id, 30, company.id)
    const found = await getValidOfficeGuestInvite(rawToken)
    expect(found.id).toBe(invite.id)
    expect(found.companyId).toBe(company.id)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-guest-service.test.ts`
Expected: FAIL — `createOfficeGuestInvite` ainda espera só 2 argumentos.

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-guest-service.ts` — trocar só `createOfficeGuestInvite`;
`getValidOfficeGuestInvite` fica **exatamente como está** (continua em `prisma.officeGuestInvite`
puro, não `scopedPrisma`: quem chama é o convidado sem sessão de empresa — resolver o convite pelo
token, não por `companyId`, é a única forma de saber a que empresa ele pertence):

```ts
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  OFFICE_GUEST_CHARACTER_PRESETS,
  OFFICE_GUEST_INVITE_MAX_MINUTES,
  OFFICE_GUEST_INVITE_MIN_MINUTES,
  OFFICE_GUEST_NAME_MAX_LENGTH,
  type OfficeGuestSessionDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class OfficeGuestInviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'OfficeGuestInviteError'
  }
}

export interface OfficeGuestJwtPayload {
  sub: string
  role: 'GUEST'
  // Convidado é sector-agnostic (não é um User real) — campos fixos só para
  // satisfazer a forma do payload do JWT; não são lidos em lugar nenhum.
  sectorId: ''
  companyId: ''
  features: []
  guest: true
  name: string
  presetId: string
  inviteId: string
}

export function hashOfficeGuestToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url')
}

function clampDuration(minutes: number): number {
  return Math.min(OFFICE_GUEST_INVITE_MAX_MINUTES, Math.max(OFFICE_GUEST_INVITE_MIN_MINUTES, minutes))
}

export async function createOfficeGuestInvite(createdById: string, expiresInMinutes: number, companyId: string) {
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await scopedPrisma(companyId).officeGuestInvite.create({
    data: {
      tokenHash: hashOfficeGuestToken(rawToken),
      createdById,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'OfficeGuestInvite', entityId: invite.id, action: 'CREATE', after: invite })
  return { invite, rawToken }
}

// Sem `companyId`, de propósito: o convidado que chega aqui ainda não provou pertencer a
// nenhuma empresa (não tem sessão) — o único jeito de saber a que empresa o convite pertence
// é achando a linha pelo hash do token. `invite.companyId` (herdado do admin que criou o
// convite) é o que as sub-fatias seguintes usam pra resolver o mapa certo pro convidado.
export async function getValidOfficeGuestInvite(rawToken: string) {
  const invite = await prisma.officeGuestInvite.findUnique({
    where: { tokenHash: hashOfficeGuestToken(rawToken) },
  })
  if (!invite || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new OfficeGuestInviteError('Convite expirado ou inválido', 404)
  }
  return invite
}

export async function issueOfficeGuestSession(
  app: FastifyInstance,
  input: { token: string; name: string; presetId: string },
): Promise<OfficeGuestSessionDTO> {
  const invite = await getValidOfficeGuestInvite(input.token)
  const name = input.name.trim().slice(0, OFFICE_GUEST_NAME_MAX_LENGTH)
  if (!name) throw new OfficeGuestInviteError('Informe o nome do convidado')
  const preset = OFFICE_GUEST_CHARACTER_PRESETS.find((candidate) => candidate.id === input.presetId)
  if (!preset) throw new OfficeGuestInviteError('Personagem inválido')

  const expiresInSeconds = Math.max(1, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000))
  const guest = {
    id: `guest:${randomUUID()}`,
    name,
    presetId: preset.id,
    avatarSeed: preset.seed,
    avatarOptions: preset.options,
  }
  const payload: OfficeGuestJwtPayload = {
    sub: guest.id,
    role: 'GUEST',
    sectorId: '',
    companyId: '',
    features: [],
    guest: true,
    name,
    presetId: preset.id,
    inviteId: invite.id,
  }

  return {
    token: app.jwt.sign(payload, { expiresIn: expiresInSeconds }),
    expiresAt: invite.expiresAt.toISOString(),
    guest,
  }
}

export function isOfficeGuestPayload(value: unknown): value is OfficeGuestJwtPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<OfficeGuestJwtPayload>
  return payload.guest === true && payload.role === 'GUEST' && typeof payload.sub === 'string'
    && typeof payload.name === 'string' && typeof payload.presetId === 'string'
}
```

`issueOfficeGuestSession`/`isOfficeGuestPayload` ficam idênticos — o payload do JWT do convidado
continua com `companyId: ''` de propósito (o convidado em si não é crachado com empresa; sub-fatia
2/3 é que vai decidir como o hub resolve o mapa via `invite.companyId`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-guest-service.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-guest-service.ts apps/api/src/services/office-guest-service.test.ts
git commit -m "feat: escopa office-guest-service.ts por empresa"
```

---

### Task 4: `office-map-service.ts` — helpers compartilhados + CRUD de mapa + assets

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/services/office-map-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma` (Task 1's `tenant-scope.ts`).
- Produces (usados pelas Tasks 5-7):
  - `activePublicationId(companyId: string): Promise<string | null>`
  - `requireMap(mapId: string, companyId: string): Promise<{ id: string; name: string }>`
  - `getActiveMapIdForEditing(companyId: string): Promise<string>`
  - `listOfficeMaps(companyId: string): Promise<OfficeMapSummaryDTO[]>`
  - `createOfficeMap(input, userId: string, companyId: string): Promise<OfficeMapSummaryDTO>`
  - `renameOfficeMap(mapId: string, name: string, actorId: string, companyId: string)`
  - `deleteOfficeMap(mapId: string, actorId: string, companyId: string): Promise<void>`
  - `listOfficeMapAssets(mapId: string, companyId: string): Promise<OfficeMapAssetDTO[]>`
  - `uploadOfficeMapAsset(mapId: string, userId: string, file, companyId: string)`
  - `deleteOfficeMapAsset(mapId: string, assetId: string, actorId: string, companyId: string)`
  - `validateOfficeMapDraft(mapId: string, revision: number, companyId: string)`
  - `validateDocument(mapId, input, companyId, db?)` — `companyId` novo 3º parâmetro
    posicional, `db` empurrado pro 4º.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/office-map-service.test.ts` — adicionar ao final do arquivo (antes
do último `})`  de fechamento do describe de proteção de estruturas, ou seja, como um novo
`describe` de topo):

```ts
describe('isolamento multi-empresa (CRUD de mapa + assets)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('listOfficeMaps de uma empresa não lista mapa de outra', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-list-test')
    await createOfficeMap({ name: 'Mapa Empresa A', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await createOfficeMap({ name: 'Mapa Empresa B', width: 10, height: 10, tileSize: 32 }, user.id, company.id)

    const listA = await listOfficeMaps(DEFAULT_COMPANY_ID)
    const listB = await listOfficeMaps(company.id)
    expect(listA.some((m) => m.name === 'Mapa Empresa B')).toBe(false)
    expect(listB.some((m) => m.name === 'Mapa Empresa A')).toBe(false)
  })

  it('renameOfficeMap com companyId de outra empresa dá 404', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-rename-test')
    const map = await createOfficeMap({ name: 'Mapa Rename', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(renameOfficeMap(map.id, 'Hackeado', user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })

  it('deleteOfficeMap com companyId de outra empresa dá 404 e não apaga o mapa', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-delete-test')
    const map = await createOfficeMap({ name: 'Mapa Delete', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(deleteOfficeMap(map.id, user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    await expect(prisma.officeMap.findUniqueOrThrow({ where: { id: map.id } })).resolves.toBeTruthy()
  })

  it('listOfficeMapAssets com companyId de outra empresa dá 404 em vez de vazar', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-assets-test')
    const map = await createOfficeMap({ name: 'Mapa Assets', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(listOfficeMapAssets(map.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })
})
```

No topo do arquivo, o `import` precisa incluir `DEFAULT_COMPANY_ID` de `@legends/shared` e as
novas funções:

```ts
import { OFFICE_TILESET_CATALOG, MapTileSizeSchema, DEFAULT_COMPANY_ID, createEmptyMapDocumentV1, type MapDocumentV1, type MapObjectV1 } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createOfficeMap,
  acquireOfficeMapLock,
  saveOfficeMapDraft,
  publishOfficeMap,
  getActiveOfficeMap,
  getActiveMapIdForEditing,
  saveOfficeDecorationDraft,
  publishOfficeDecoration,
  renameOfficeMap,
  deleteOfficeMap,
  mergeAndPublishDecoration,
  listOfficeMaps,
  listOfficeMapAssets,
} from './office-map-service'
```

(As chamadas já existentes no arquivo — `createOfficeMap`, `acquireOfficeMapLock`,
`saveOfficeMapDraft`, `publishOfficeMap`, `getActiveOfficeMap`, `saveOfficeDecorationDraft`,
`publishOfficeDecoration`, `mergeAndPublishDecoration` — só vão ganhar o novo parâmetro
`companyId` nas Tasks 5-7; por ora este arquivo vai ficar com erro de tipo nessas chamadas
antigas até essas tasks passarem por aqui de novo. Isso é esperado: rode só os testes do
`describe` novo neste passo.)

- [ ] **Step 2: Rodar só o describe novo e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (CRUD de mapa + assets)"`
Expected: FAIL — `createOfficeMap`/`listOfficeMaps`/etc. ainda não aceitam `companyId`.

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-map-service.ts`. Trocar o import do `prisma` puro por
incluir também `scopedPrisma`:

```ts
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
```

Substituir `activePublicationId`:

```ts
async function activePublicationId(companyId: string): Promise<string | null> {
  const row = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  return row?.activeMapPublicationId ?? null
}
```

Substituir `requireMap`:

```ts
async function requireMap(mapId: string, companyId: string) {
  const map = await scopedPrisma(companyId).officeMap.findUnique({ where: { id: mapId }, select: { id: true, name: true } })
  if (!map) fail('Mapa não encontrado', 404, 'MAP_NOT_FOUND')
  return map
}
```

Substituir `getActiveMapIdForEditing`:

```ts
export async function getActiveMapIdForEditing(companyId: string): Promise<string> {
  const setting = await prisma.officeSetting.findUnique({
    where: { companyId },
    select: { activeMapPublication: { select: { mapId: true } } },
  })
  const mapId = setting?.activeMapPublication?.mapId
  if (!mapId) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  return mapId
}
```

Substituir `validateDocument` (só a assinatura e a busca de `officeMapAsset` mudam):

```ts
async function validateDocument(
  mapId: string,
  input: unknown,
  companyId: string,
  db: ReturnType<typeof scopedPrisma> | Prisma.TransactionClient = scopedPrisma(companyId),
) {
  const structural = MapDocumentV1StructuralSchema.safeParse(input)
  if (!structural.success) {
    const result = validateMapDocumentV1(input)
    return { valid: false, errors: result.errors.map((error) => ({ ...error })), document: null, assets: [] }
  }

  // Mapas criados antes de uma nova layer reservada (ex.: `desks`) existir
  // não a têm no documento salvo; preenche automaticamente em vez de exigir
  // uma migração manual por mapa.
  const healed = ensureReservedLayers(structural.data)
  const result = validateMapDocumentV1(healed)
  const errors: Array<{ code: string; message: string; path: string; objectId?: string; layerKey?: string }> =
    result.errors.map((error) => ({ ...error }))

  // Builtins (catálogo) não têm linha em OfficeMapAsset: resolve dims pelo
  // catálogo e não os inclui na busca por-mapId nem no `assets` retornado.
  const allIds = [...new Set(healed.tilesets.map((tileset) => tileset.assetId))]
  const dbIds = allIds.filter((id) => !isBuiltinTilesetAssetId(id))
  const assets = dbIds.length
    ? await db.officeMapAsset.findMany({ where: { mapId, id: { in: dbIds } } })
    : []
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  healed.tilesets.forEach((tileset, index) => {
    const builtin = builtinTilesetAsset(tileset.assetId)
    const dims = builtin
      ? { width: builtin.width, height: builtin.height }
      : byId.get(tileset.assetId)
    if (!dims) {
      errors.push({ code: 'ASSET_NOT_FOUND', path: `tilesets[${index}].assetId`, message: 'O asset do tileset não pertence a este mapa' })
      return
    }
    const columns = Math.floor(dims.width / tileset.tileWidth)
    const rows = Math.floor(dims.height / tileset.tileHeight)
    if (columns !== tileset.columns || columns * rows !== tileset.tileCount) {
      errors.push({ code: 'ASSET_DIMENSIONS_INVALID', path: `tilesets[${index}]`, message: 'A grade do tileset não corresponde às dimensões da imagem' })
    }
  })
  return { valid: errors.length === 0, errors, document: healed, assets }
}
```

Substituir `listOfficeMaps`:

```ts
export async function listOfficeMaps(companyId: string): Promise<OfficeMapSummaryDTO[]> {
  const [activeId, maps] = await Promise.all([
    activePublicationId(companyId),
    scopedPrisma(companyId).officeMap.findMany({
      orderBy: { createdAt: 'asc' },
      include: { publications: { orderBy: { version: 'desc' }, select: publicationSelect } },
    }),
  ])
  return maps.map((map) => ({
    id: map.id,
    name: map.name,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    publications: map.publications.map((publication) => asPublication(publication, activeId)),
  }))
}
```

Substituir `createOfficeMap`:

```ts
export async function createOfficeMap(
  input: { name: string; width: number; height: number; tileSize: MapTileSize },
  userId: string,
  companyId: string,
): Promise<OfficeMapSummaryDTO> {
  const document = createEmptyMapDocumentV1({
    width: input.width,
    height: input.height,
    tileSize: input.tileSize,
  })
  const map = await scopedPrisma(companyId).officeMap.create({
    data: {
      name: input.name.trim(),
      draft: {
        create: {
          document: document as unknown as Prisma.InputJsonValue,
          lastEditedById: userId,
        },
      },
    },
  })
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMap', entityId: map.id, action: 'CREATE', after: map })
  return {
    id: map.id,
    name: map.name,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    publications: [],
  }
}
```

> Nota: `draft: { create: { ... } }` é um nested-write relacional — a extensão `scopedPrisma` NÃO
> intercepta nested-writes (só a operação top-level, aqui `officeMap.create`). Isso é seguro
> porque `OfficeMapDraft.companyId` tem `@default("company-emr")`: a linha do draft nasce com o
> default, não com o `companyId` real, até uma escrita explícita corrigir isso. Como
> `getOfficeMapDraft`/`saveOfficeMapDraft` (Task 7) sempre acessam o draft via `mapId` (já
> validado contra a empresa por `requireMap`) e nunca fazem `scopedPrisma(companyId)
> .officeMapDraft.findUnique({ where: { mapId } })` sem passar por esse `requireMap` antes, a
> leitura nunca vaza — mas o valor de `OfficeMapDraft.companyId` em si fica errado (sempre
> `company-emr`) até a primeira `saveOfficeMapDraft`, que usa `updateMany` (operação top-level,
> ESSA sim interceptada) e corrige. Registrar esse gap como aceitável nesta fatia: análogo ao já
> documentado pra Review (`ReviewComment`/nested-writes), decisão consciente, não bug.

Substituir `renameOfficeMap`:

```ts
export async function renameOfficeMap(mapId: string, name: string, actorId: string, companyId: string) {
  const before = await requireMap(mapId, companyId)
  const map = await scopedPrisma(companyId).officeMap.update({ where: { id: mapId }, data: { name: name.trim() } })
  await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'UPDATE', before, after: map })
  return { ...map, createdAt: map.createdAt.toISOString(), updatedAt: map.updatedAt.toISOString() }
}
```

Substituir `deleteOfficeMap`:

```ts
export async function deleteOfficeMap(mapId: string, actorId: string, companyId: string): Promise<void> {
  const before = await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  const active = await prisma.officeSetting.findFirst({
    where: { companyId, activeMapPublication: { mapId } },
    select: { companyId: true },
  })
  if (active) fail('Ative outro mapa antes de excluir este', 409, 'MAP_IS_ACTIVE')
  const assets = await db.officeMapAsset.findMany({ where: { mapId }, select: { storageKey: true } })
  await db.$transaction(async (tx) => {
    await tx.officeMapPublicationAsset.deleteMany({ where: { publication: { mapId } } })
    await tx.officeMap.delete({ where: { id: mapId } })
    await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'DELETE', before, tx: tx as unknown as Prisma.TransactionClient })
  })
  await Promise.allSettled(
    assets.filter(({ storageKey }) => !storageKey.startsWith('builtin:')).map(({ storageKey }) => deleteS3Object(storageKey)),
  )
}
```

Substituir `listOfficeMapAssets`:

```ts
export async function listOfficeMapAssets(mapId: string, companyId: string): Promise<OfficeMapAssetDTO[]> {
  await requireMap(mapId, companyId)
  const assets = await scopedPrisma(companyId).officeMapAsset.findMany({ where: { mapId }, orderBy: { createdAt: 'asc' } })
  return assets.map(asAsset)
}
```

Substituir `uploadOfficeMapAsset`:

```ts
export async function uploadOfficeMapAsset(mapId: string, userId: string, file: UploadedOfficeMapAsset, companyId: string) {
  await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  const cfg = s3Config()
  if (!cfg) fail('O armazenamento S3 não está configurado', 503, 'S3_DISABLED')
  const image = inspectImage(file)
  const digest = checksum(file.buffer)
  const existing = await db.officeMapAsset.findUnique({
    where: { mapId_checksum: { mapId, checksum: digest } },
  })
  if (existing) return asAsset(existing)
  const aggregate = await db.officeMapAsset.aggregate({ where: { mapId }, _sum: { sizeBytes: true } })
  if ((aggregate._sum.sizeBytes ?? 0) + file.buffer.length > MAP_DOCUMENT_V1_LIMITS.maxAssetsBytesPerMap) {
    fail('Os assets deste mapa excedem o limite de 100 MB', 413, 'MAP_ASSETS_TOO_LARGE')
  }
  const id = randomUUID()
  const key = `office-maps/${mapId}/${id}.${image.extension}`
  await putS3Object({ key, contentType: image.mimeType, body: file.buffer })
  try {
    const asset = await db.officeMapAsset.create({
      data: {
        id,
        mapId,
        fileName: basename(file.filename.replaceAll('\\', '/')).slice(0, 255) || `tileset.${image.extension}`,
        mimeType: image.mimeType,
        sizeBytes: file.buffer.length,
        width: image.width,
        height: image.height,
        checksum: digest,
        storageKey: key,
        createdById: userId,
      },
    })
    await recordAuditLog({ actorId: userId, entityType: 'OfficeMapAsset', entityId: asset.id, action: 'CREATE', after: asset })
    return asAsset(asset)
  } catch (error) {
    await deleteS3Object(key).catch(() => undefined)
    throw error
  }
}
```

Substituir `deleteOfficeMapAsset`:

```ts
export async function deleteOfficeMapAsset(mapId: string, assetId: string, actorId: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const asset = await db.officeMapAsset.findFirst({
    where: { id: assetId, mapId },
    include: { _count: { select: { publicationLinks: true } } },
  })
  if (!asset) fail('Asset não encontrado', 404, 'ASSET_NOT_FOUND')
  if (asset._count.publicationLinks > 0) fail('Assets publicados não podem ser excluídos', 409, 'ASSET_IS_PUBLISHED')
  await db.officeMapAsset.delete({ where: { id: assetId } })
  await recordAuditLog({ actorId, entityType: 'OfficeMapAsset', entityId: assetId, action: 'DELETE', before: asset })
  if (!asset.storageKey.startsWith('builtin:')) await deleteS3Object(asset.storageKey).catch(() => undefined)
}
```

Substituir `validateOfficeMapDraft`:

```ts
export async function validateOfficeMapDraft(mapId: string, revision: number, companyId: string) {
  await requireMap(mapId, companyId)
  const draft = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  if (draft.revision !== revision) {
    fail('A revisão informada não é a atual', 409, 'DRAFT_REVISION_CONFLICT', { currentRevision: draft.revision })
  }
  const result = await validateDocument(mapId, draft.document, companyId)
  return { valid: result.valid, errors: result.errors }
}
```

- [ ] **Step 4: Rodar só o describe novo e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (CRUD de mapa + assets)"`
Expected: PASS em todos os testes do describe novo. (O resto do arquivo continua quebrado até as
Tasks 5-7 — esperado.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat: escopa helpers + CRUD de mapa + assets em office-map-service.ts"
```

---

### Task 5: `office-map-service.ts` — salas/mesas + `getActiveOfficeMap`

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/services/office-map-service.test.ts`

**Interfaces:**
- Consumes: `activePublicationId(companyId)` (Task 4).
- Produces (usados pelas Tasks 6-7): `getActiveOfficeMap(companyId: string):
  Promise<ActiveOfficeMapDTO>`, `listActiveOfficeRooms(companyId)`, `listActiveOfficeDesks
  (companyId)`, `claimOfficeDesk(deskId, userId, companyId)`, `releaseOfficeDesk(deskId, userId,
  companyId)`, `adminReleaseOfficeDesk(deskId, actorId, companyId)`, `updateOfficeRoom(roomId,
  input, actorId, companyId)`.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/office-map-service.test.ts` — adicionar mais um `describe`:

```ts
describe('isolamento multi-empresa (salas e mesas)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  // `seedActiveMap` publica um documento sem objetos `meeting-room`/`desk` (só um
  // tile na layer `objects`), então `materializePublication` não cria nenhuma linha
  // de `OfficeRoom`/`OfficeDesk` pra ele. Em vez de montar um documento inteiro só
  // pra estes testes, insere a sala/mesa direto contra a publicação ativa já
  // materializada — mais direto, e testa a mesma coisa (isolamento por companyId).
  async function seedRoomAndDesk(companyId: string) {
    const { mapId } = await seedActiveMap(companyId)
    const active = await getActiveOfficeMap(companyId)
    const room = await prisma.officeRoom.create({
      data: {
        mapPublicationId: active.publication.id,
        name: 'Sala Teste',
        externalKey: `sala-teste-${Date.now()}-${Math.random()}`,
        companyId,
      },
    })
    const desk = await prisma.officeDesk.create({
      data: {
        mapPublicationId: active.publication.id,
        name: 'Mesa Teste',
        externalKey: `mesa-teste-${Date.now()}-${Math.random()}`,
        companyId,
      },
    })
    return { mapId, room, desk }
  }

  it('getActiveOfficeMap de uma empresa não enxerga o mapa ativo de outra', async () => {
    const { mapId: mapIdA } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-active-map-test')
    await expect(getActiveOfficeMap(company.id)).rejects.toMatchObject({ status: 404, code: 'ACTIVE_MAP_NOT_FOUND' })
    const activeA = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(activeA.map.id).toBe(mapIdA)
  })

  it('claimOfficeDesk com companyId de outra empresa dá 404, não vaza mesa alheia', async () => {
    const { desk } = await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-desk-claim-test')
    const otherUser = await member()
    await expect(claimOfficeDesk(desk.id, otherUser.id, company.id)).rejects.toMatchObject({ status: 404, code: 'DESK_NOT_FOUND' })
    const claim = await prisma.officeDeskClaim.findUnique({ where: { deskId: desk.id } })
    expect(claim).toBeNull()
  })

  it('listActiveOfficeRooms/listActiveOfficeDesks de uma empresa sem mapa ativo retornam vazio, não o da outra', async () => {
    await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-rooms-desks-test')
    expect(await listActiveOfficeRooms(company.id)).toEqual([])
    expect(await listActiveOfficeDesks(company.id)).toEqual([])
  })

  it('updateOfficeRoom com companyId de outra empresa dá 404, não altera a sala', async () => {
    const { room } = await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-room-update-test')
    const actor = await admin()
    await expect(updateOfficeRoom(room.id, { status: 'LOCKED' }, actor.id, company.id)).rejects.toMatchObject({ status: 404, code: 'ROOM_NOT_FOUND' })
    const stillOpen = await prisma.officeRoom.findUniqueOrThrow({ where: { id: room.id } })
    expect(stillOpen.status).toBe('OPEN')
  })
})
```

Adicionar `listActiveOfficeRooms`, `listActiveOfficeDesks`, `claimOfficeDesk`, `updateOfficeRoom`
ao `import` de `./office-map-service` no topo do arquivo de teste. `seedActiveMap` também precisa
aceitar `companyId` opcional já nesta task (com default `DEFAULT_COMPANY_ID`) — a assinatura final
completa (incluindo o uso de `acquireOfficeMapLock`/`saveOfficeMapDraft` escopados) só fecha na
Task 7, mas o parâmetro em si e seu default já são adicionados aqui:

```ts
async function seedActiveMap(companyId: string = DEFAULT_COMPANY_ID) {
  const user = await admin()
  const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, companyId)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  const tileWidth = MapTileSizeSchema.parse(builtin.tileWidth)
  const tileHeight = MapTileSizeSchema.parse(builtin.tileHeight)
  doc.tilesets.push({
    id: 'ts1', assetId: builtin.assetId, name: builtin.name,
    tileWidth, tileHeight,
    columns: builtin.columns, tileCount: builtin.tileCount,
  })
  const objectsLayer = doc.layers.find((l) => l.key === 'objects')
  if (objectsLayer?.type === 'tile') objectsLayer.data[0] = 'ts1:0'
  const lock = await acquireOfficeMapLock(mapId, user.id, companyId)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, companyId)
  await publishOfficeMap(mapId, saved.revision, user.id, true, companyId)
  const active = await getActiveOfficeMap(companyId)
  return { user, mapId, activeDoc: active.document, revision: saved.revision }
}
```

Isso substitui (não duplica) o `seedActiveMap` que a Task 6 também edita — como as duas tasks
tocam a mesma função, a versão final em vigor depois da Task 6/7 é a mostrada na Task 6 Step 1
(idêntica a esta, só formatada como parte daquele passo). Se a Task 5 já a deixar assim, a Task 6
Step 1 é a mesma edição — sem conflito, apenas confirme que já está correta.

- [ ] **Step 2: Rodar só o describe novo e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (salas e mesas)"`
Expected: FAIL — `getActiveOfficeMap`/etc. ainda não aceitam (ou aceitam errado) `companyId` como
único parâmetro, e as chamadas antigas em `seedActiveMap`/`seedProtectedObjects` (que passam
`user.id`) ainda quebram a compilação. Isso é esperado até o Step 3 desta task ser aplicado — mas
o describe novo em si deve falhar por assertividade errada, não só por erro de compilação de
outro trecho do arquivo. Se o arquivo inteiro não compilar por causa de `seedActiveMap`, ajuste
temporariamente `seedActiveMap`/`seedProtectedObjects` neste mesmo passo para passar
`DEFAULT_COMPANY_ID` como último argumento em toda chamada de função de `office-map-service.ts`
usada dentro deles (mesmo que essas funções ainda não aceitem o parâmetro — o TS vai reclamar de
"excess argument", não impede o teste de rodar via `vitest` com `--no-typecheck` implícito do
esbuild/swc; ignore o erro do editor, o `tsc --noEmit` completo só roda como verificação final da
task).

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-map-service.ts`. Substituir `asRoom`/`listActiveOfficeRooms`
(a formatadora `asRoom` fica igual — só a função que a chama muda):

```ts
export async function listActiveOfficeRooms(companyId: string): Promise<OfficeRoomDTO[]> {
  const activeId = await activePublicationId(companyId)
  if (!activeId) return []
  const rooms = await scopedPrisma(companyId).officeRoom.findMany({
    where: { mapPublicationId: activeId },
    orderBy: { name: 'asc' },
    include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
  })
  return rooms.map(asRoom)
}
```

Substituir `listActiveOfficeDesks` (a formatadora `asDesk` fica igual):

```ts
export async function listActiveOfficeDesks(companyId: string): Promise<OfficeDeskDTO[]> {
  const activeId = await activePublicationId(companyId)
  if (!activeId) return []
  const desks = await scopedPrisma(companyId).officeDesk.findMany({
    where: { mapPublicationId: activeId },
    orderBy: { name: 'asc' },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return desks.map(asDesk)
}
```

Substituir `claimOfficeDesk`:

```ts
export async function claimOfficeDesk(deskId: string, userId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({ where: { id: deskId, mapPublicationId: activeId ?? '__none__' } })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  const existingClaimOnDesk = await db.officeDeskClaim.findUnique({ where: { deskId } })
  if (existingClaimOnDesk) fail('Esta mesa já está ocupada', 409, 'DESK_ALREADY_CLAIMED')
  const existingClaimByUser = await db.officeDeskClaim.findUnique({ where: { userId } })
  if (existingClaimByUser) fail('Você já ocupa outra mesa — abandone-a antes de reivindicar outra', 409, 'DESK_USER_ALREADY_HAS_DESK')
  try {
    await db.officeDeskClaim.create({ data: { deskId, userId } })
  } catch (err) {
    // catch P2002: handles concurrent-claim race (two claimOfficeDesk calls can both
    // pass the findUnique checks above before either inserts; the second insert
    // violates the unique constraint on deskId or userId — translate to the same
    // domain error the synchronous check would have thrown).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target
      const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
      if (fields.includes('userId')) {
        fail('Você já ocupa outra mesa — abandone-a antes de reivindicar outra', 409, 'DESK_USER_ALREADY_HAS_DESK')
      }
      fail('Esta mesa já está ocupada', 409, 'DESK_ALREADY_CLAIMED')
    }
    throw err
  }
  const updated = await db.officeDesk.findUniqueOrThrow({
    where: { id: deskId },
    include: { claim: { include: { user: { select: { id: true, name: true } } } } },
  })
  return asDesk(updated)
}
```

Substituir `releaseOfficeDesk`:

```ts
export async function releaseOfficeDesk(deskId: string, userId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  if (desk.claim.userId !== userId) fail('Você não ocupa esta mesa', 403, 'DESK_NOT_OWNER')
  await db.officeDeskClaim.delete({ where: { deskId } })
  return asDesk({ ...desk, claim: null })
}
```

Substituir `adminReleaseOfficeDesk`:

```ts
export async function adminReleaseOfficeDesk(deskId: string, actorId: string, companyId: string): Promise<OfficeDeskDTO> {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const desk = await db.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  await db.officeDeskClaim.delete({ where: { deskId } })
  await recordAuditLog({ actorId, entityType: 'OfficeDeskClaim', entityId: desk.id, action: 'DELETE', before: desk.claim })
  return asDesk({ ...desk, claim: null })
}
```

Substituir `updateOfficeRoom`:

```ts
export async function updateOfficeRoom(
  roomId: string,
  input: {
    status?: 'OPEN' | 'LOCKED'
    capacity?: number | null
    voiceEnabled?: boolean
    accessPolicy?: 'OPEN' | 'ALLOWLIST'
    allowedUserIds?: string[]
  },
  actorId: string,
  companyId: string,
) {
  const db = scopedPrisma(companyId)
  const activeId = await activePublicationId(companyId)
  const room = await db.officeRoom.findFirst({ where: { id: roomId, mapPublicationId: activeId ?? '__none__' } })
  if (!room) fail('Sala ativa não encontrada', 404, 'ROOM_NOT_FOUND')
  const { allowedUserIds, ...data } = input
  if (allowedUserIds) {
    const count = await prisma.user.count({ where: { id: { in: allowedUserIds }, active: true, companyId } })
    if (count !== new Set(allowedUserIds).size) fail('A lista contém usuários inválidos', 400, 'ROOM_USERS_INVALID')
  }
  await db.$transaction(async (tx) => {
    await tx.officeRoom.update({ where: { id: roomId }, data })
    if (allowedUserIds) {
      await tx.officeRoomAccessGrant.deleteMany({ where: { roomId } })
      if (allowedUserIds.length) {
        await tx.officeRoomAccessGrant.createMany({
          data: [...new Set(allowedUserIds)].map((userId) => ({ roomId, userId })),
        })
      }
    }
    await recordAuditLog({ actorId, entityType: 'OfficeRoom', entityId: roomId, action: 'UPDATE', before: room, after: data, tx: tx as unknown as Prisma.TransactionClient })
  })
  const updated = await db.officeRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
  })
  // Atualiza as regras autoritativas sem desconectar quem já está na mesma publicação.
  officeHub.configure(await getActiveOfficeMap(companyId), false)
  return asRoom(updated)
}
```

Nota: `allowedUserIds` valida contra `User` (não tenant-scoped nesta fatia — já está na allowlist
desde as fatias anteriores) — o filtro `companyId` explícito aqui é defesa em profundidade contra
alocar sala pra usuário de outra empresa; sem ele, `prisma.user.count` sozinho não teria como
saber a que empresa a sala pertence.

Substituir `getActiveOfficeMap`:

```ts
export async function getActiveOfficeMap(companyId: string): Promise<ActiveOfficeMapDTO> {
  const setting = await prisma.officeSetting.findUnique({
    where: { companyId },
    include: {
      activeMapPublication: {
        include: {
          createdBy: { select: { id: true, name: true } },
          map: { select: { id: true, name: true } },
          assetLinks: { include: { asset: true } },
          rooms: {
            include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
          },
          desks: {
            include: { claim: { include: { user: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  })
  const publication = setting?.activeMapPublication
  if (!publication) fail('Nenhum mapa foi publicado para o escritório', 404, 'ACTIVE_MAP_NOT_FOUND')
  const rooms = publication.rooms.map(asRoom)
  const document = publication.mapData as unknown as MapDocumentV1
  const dbAssets = publication.assetLinks.map(({ asset }) => asAsset(asset))
  const desks = publication.desks.map(asDesk)
  return {
    map: publication.map,
    publication: asPublication(publication, publication.id),
    document,
    assets: withBuiltinAssets(document, dbAssets),
    rooms,
    desks,
  }
}
```

Nota: `setting.activeMapPublication` já vem via a FK `activeMapPublicationId`, que aponta pra uma
`OfficeMapPublication` — como essa publicação foi criada dentro do escopo da mesma empresa (Task
6 garante isso via `materializePublication`), não precisa filtrar de novo por `companyId` na
publicação em si; o `where: { companyId }` no `OfficeSetting` já é a fronteira.

- [ ] **Step 4: Rodar só o describe novo e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (salas e mesas)"`
Expected: PASS em todos os testes do describe novo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat: escopa salas/mesas e getActiveOfficeMap em office-map-service.ts"
```

---

### Task 6: `office-map-service.ts` — publicação (`materializePublication`/`publishOfficeMap`/`mergeAndPublishDecoration`)

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/services/office-map-service.test.ts`
- Modify: `apps/api/src/services/office-map-service.merge.test.ts`

**Interfaces:**
- Consumes: `requireMap`/`activePublicationId` (Task 4), `getActiveOfficeMap` (Task 5).
- Produces (usado pela Task 7): `publishOfficeMap(mapId, revision, userId, activate, companyId,
  options?)`, `mergeAndPublishDecoration(input, actor, companyId)`.
- Produces (só interno/rotas): `materializePublication` (não exportada), `listOfficeMapPublications
  (mapId, companyId)`, `getOfficeMapPublication(mapId, publicationId, companyId)`,
  `activateOfficeMapPublication(publicationId, actorId, companyId)`.

- [ ] **Step 1: Escrever os testes falhando**

`seedActiveMap` já foi atualizada pra aceitar `companyId` (com default `DEFAULT_COMPANY_ID`) na
Task 5, Step 1 — não repita essa edição aqui, só confirme que ela está em vigor. Adicionar ao
arquivo o describe de isolamento de publicação:

```ts
describe('isolamento multi-empresa (publicação)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('materializePublication cria OfficeRoom/OfficeDesk com o companyId real, não o default do banco', async () => {
    const company = await otherCompany('outra-empresa-materialize-test')
    const { mapId } = await seedActiveMap(company.id)
    const active = await getActiveOfficeMap(company.id)
    expect(active.map.id).toBe(mapId)
    const rooms = await prisma.officeRoom.findMany({ where: { mapPublication: { mapId } } })
    const desks = await prisma.officeDesk.findMany({ where: { mapPublication: { mapId } } })
    for (const room of rooms) expect(room.companyId).toBe(company.id)
    for (const desk of desks) expect(desk.companyId).toBe(company.id)
    const publication = await prisma.officeMapPublication.findFirstOrThrow({ where: { mapId } })
    expect(publication.companyId).toBe(company.id)
  })

  it('listOfficeMapPublications/getOfficeMapPublication com companyId de outra empresa dá 404', async () => {
    const { mapId } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-pub-list-test')
    await expect(listOfficeMapPublications(mapId, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const pubs = await prisma.officeMapPublication.findMany({ where: { mapId } })
    await expect(getOfficeMapPublication(mapId, pubs[0]!.id, company.id)).rejects.toMatchObject({ status: 404 })
  })

  it('activateOfficeMapPublication com companyId de outra empresa dá 404 e não ativa nada', async () => {
    const { mapId } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-pub-activate-test')
    const pubs = await prisma.officeMapPublication.findMany({ where: { mapId } })
    const actor = await admin()
    await expect(activateOfficeMapPublication(pubs[0]!.id, actor.id, company.id)).rejects.toMatchObject({ status: 404, code: 'PUBLICATION_NOT_FOUND' })
    await expect(getOfficeSettingActive(company.id)).resolves.toBeNull()
  })
})

async function getOfficeSettingActive(companyId: string) {
  const row = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  return row?.activeMapPublicationId ?? null
}
```

Adicionar `listOfficeMapPublications`, `getOfficeMapPublication`, `activateOfficeMapPublication`
ao `import` de `./office-map-service` no topo do arquivo.

- [ ] **Step 2: Rodar só os describes novos e confirmar que falham**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (publicação)"`
Expected: FAIL — `publishOfficeMap` ainda não aceita `companyId`, `materializePublication` não
injeta `companyId` real.

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-map-service.ts`. Substituir a assinatura de
`materializePublication` (o corpo muda só onde toca `OfficeSetting`, que não é tenant-scoped —
resto se beneficia da injeção automática da extensão porque `tx` agora vem de
`scopedPrisma(companyId).$transaction`):

```ts
async function materializePublication(
  tx: Prisma.TransactionClient,
  mapId: string,
  map: Awaited<ReturnType<typeof requireMap>>,
  userId: string,
  activate: boolean,
  validation: PublicationValidation,
  companyId: string,
) {
  const latest = await tx.officeMapPublication.aggregate({ where: { mapId }, _max: { version: true } })
  const version = (latest._max.version ?? 0) + 1
  const setting = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  const previousRooms = setting?.activeMapPublicationId
    ? await tx.officeRoom.findMany({
        where: { mapPublicationId: setting.activeMapPublicationId },
        include: { accessGrants: { select: { userId: true } } },
      })
    : []
  const previousByKey = new Map(previousRooms.map((room) => [room.externalKey, room]))
  const previousDesks = setting?.activeMapPublicationId
    ? await tx.officeDesk.findMany({
        where: { mapPublicationId: setting.activeMapPublicationId },
        include: { claim: true },
      })
    : []
  const previousDeskByKey = new Map(previousDesks.map((desk) => [desk.externalKey, desk]))
  const publication = await tx.officeMapPublication.create({
    data: {
      mapId,
      createdById: userId,
      version,
      schemaVersion: validation.document.schemaVersion,
      mapData: validation.document as unknown as Prisma.InputJsonValue,
    },
    select: publicationSelect,
  })
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'CREATE', after: publication, tx })
  if (validation.assets.length) {
    await tx.officeMapPublicationAsset.createMany({
      data: validation.assets.map((asset) => ({ publicationId: publication.id, assetId: asset.id })),
    })
  }
  // Antes, cada sala/mesa era um `create` (+ eventuais `create`s de claim)
  // AWAITADO individualmente dentro desta MESMA transação interativa — em
  // mapas com bastante mobília/mesas, N round-trips sequenciais ao Postgres
  // (mais ainda contra um banco remoto/homolog) estouram o timeout padrão de
  // 5s do Prisma pra transações interativas, e a transação fecha no meio do
  // loop ("Transaction not found ... refere-se a uma transação já fechada").
  // Agora todo mundo é montado em memória com um `id` já gerado (cuid é só
  // convenção do Prisma — um `randomUUID()` nosso serve igual como PK) e
  // inserido em lote (`createMany`), então o custo em round-trips não cresce
  // com o tamanho do mapa. `createMany` é interceptado por `scopedPrisma` —
  // `companyId` é injetado em cada linha automaticamente contanto que `tx`
  // venha de `scopedPrisma(companyId).$transaction(...)` (ver publishOfficeMap
  // / mergeAndPublishDecoration).
  const roomsToCreate: Prisma.OfficeRoomCreateManyInput[] = []
  const roomAccessGrants: Prisma.OfficeRoomAccessGrantCreateManyInput[] = []
  const desksToCreate: Prisma.OfficeDeskCreateManyInput[] = []
  const deskClaims: Prisma.OfficeDeskClaimCreateManyInput[] = []
  const claimUserIdsToReplace: string[] = []
  for (const object of validation.document.objects) {
    if (object.type === 'meeting-room') {
      const previous = previousByKey.get(object.properties.externalKey)
      const roomId = randomUUID()
      roomsToCreate.push({
        id: roomId,
        mapPublicationId: publication.id,
        externalKey: object.properties.externalKey,
        name: object.properties.name,
        status: previous?.status ?? object.properties.status,
        capacity: previous?.capacity ?? object.properties.capacity ?? null,
        voiceEnabled: previous?.voiceEnabled ?? object.properties.voiceEnabled,
        accessPolicy: previous?.accessPolicy ?? object.properties.accessPolicy,
      })
      for (const { userId: grantedUserId } of previous?.accessGrants ?? []) {
        roomAccessGrants.push({ roomId, userId: grantedUserId })
      }
      continue
    }
    if (object.type === 'desk') {
      const previous = previousDeskByKey.get(object.properties.externalKey)
      const deskId = randomUUID()
      desksToCreate.push({
        id: deskId,
        mapPublicationId: publication.id,
        externalKey: object.properties.externalKey,
        name: object.properties.name,
      })
      if (previous?.claim) {
        // A claim anterior ainda existe presa à mesa antiga (superada por esta
        // publicação) — `userId` é @unique em OfficeDeskClaim, então precisa sumir
        // antes do create abaixo, senão republicar com uma mesa ocupada quebra com
        // violação de unicidade.
        claimUserIdsToReplace.push(previous.claim.userId)
        deskClaims.push({ deskId, userId: previous.claim.userId })
      }
    }
  }
  if (roomsToCreate.length) await tx.officeRoom.createMany({ data: roomsToCreate })
  if (roomAccessGrants.length) await tx.officeRoomAccessGrant.createMany({ data: roomAccessGrants })
  if (desksToCreate.length) await tx.officeDesk.createMany({ data: desksToCreate })
  if (claimUserIdsToReplace.length) {
    await tx.officeDeskClaim.deleteMany({ where: { userId: { in: claimUserIdsToReplace } } })
  }
  if (deskClaims.length) await tx.officeDeskClaim.createMany({ data: deskClaims })
  const roomsCreated = roomsToCreate.length
  const desksCreated = desksToCreate.length
  if (activate) {
    await prisma.officeSetting.upsert({
      where: { companyId },
      create: { companyId, activeMapPublicationId: publication.id },
      update: { activeMapPublicationId: publication.id },
    })
  }
  return {
    publication: asPublication(publication, activate ? publication.id : setting?.activeMapPublicationId ?? null),
    version,
    roomsCreated,
    desksCreated,
    activated: activate,
    map,
  }
}
```

Nota: `tx.officeSetting.upsert(...)`/`prisma.officeSetting.findUnique(...)` viram chamadas fora do
`tx` de sala/mesa nada muda de comportamento — `OfficeSetting` nunca foi tenant-scoped via
extensão, então ler/escrever ele por fora da transação de `tx` (que é o client escopado) é
equivalente; manter o `prisma` puro aqui (em vez de `tx`) evita reintroduzir um `tx.officeSetting
.upsert` que a extensão rejeitaria SE `OfficeSetting` estivesse na allowlist — como não está, `tx
.officeSetting.upsert` também funcionaria, mas usar `prisma` direto deixa mais explícito que este
model é intencionalmente não-escopado.

Substituir `publishOfficeMap`:

```ts
export async function publishOfficeMap(
  mapId: string,
  revision: number,
  userId: string,
  activate: boolean,
  companyId: string,
  options: { soft?: boolean } = {},
) {
  const map = await requireMap(mapId, companyId)
  const result = await scopedPrisma(companyId).$transaction(async (tx) => {
    const draft = await tx.officeMapDraft.findUnique({ where: { mapId } })
    if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
    if (draft.revision !== revision) {
      fail('A revisão informada não é a atual', 409, 'DRAFT_REVISION_CONFLICT', { currentRevision: draft.revision })
    }
    const validation = await validateDocument(mapId, draft.document, companyId, tx as unknown as Prisma.TransactionClient)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }
    return materializePublication(tx as unknown as Prisma.TransactionClient, mapId, map, userId, activate, validation, companyId)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PUBLISH_TRANSACTION_TIMEOUT })
  if (activate) {
    if (options.soft) {
      // keepPresence: não desconecta ninguém; o broadcast abaixo alcança as
      // entries preservadas para um refresh suave (sem reload).
      officeHub.configure(await getActiveOfficeMap(companyId), false, true)
      officeHub.broadcastMapDecorUpdated(result.publication.id)
    } else {
      officeHub.configure(await getActiveOfficeMap(companyId), true)
    }
  }
  return result
}
```

Substituir `mergeAndPublishDecoration`:

```ts
export async function mergeAndPublishDecoration(
  input: { baseVersion: number; document: unknown },
  actor: { id: string; role: UserRole },
  companyId: string,
): Promise<{ version: number; document: MapDocumentV1 }> {
  const mapId = await getActiveMapIdForEditing(companyId)
  const map = await requireMap(mapId, companyId)

  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    fail('Documento inválido', 400, 'MAP_DOCUMENT_MALFORMED', { issues: structural.error.issues })
  }
  const mineRaw: MapDocumentV1 = canonicalDocument(structural.data)

  const result = await scopedPrisma(companyId).$transaction(async (tx) => {
    const latestPub = await tx.officeMapPublication.findFirst({
      where: { mapId },
      orderBy: { version: 'desc' },
      select: { mapData: true },
    })
    const theirs = latestPub ? canonicalDocument(latestPub.mapData) : mineRaw
    const basePub = await tx.officeMapPublication.findFirst({
      where: { mapId, version: input.baseVersion },
      select: { mapData: true },
    })
    const base = basePub ? canonicalDocument(basePub.mapData) : theirs

    const mine = stampObjectOwnership(base, mineRaw, actor)

    // Guarda contra a MINHA edição em relação ao que eu abri (`base`), não
    // contra o resultado do merge: `mergeDecoration` sempre herda map/layers
    // de `theirs`, então uma edição estrutural minha desapareceria em
    // silêncio no merge em vez de ser rejeitada — e comparar contra `theirs`
    // também acusaria falso positivo se OUTRA publicação (ex.: admin) mudou
    // a estrutura enquanto eu editava, sem culpa minha.
    const guard = assertOnlyDecorationChanged(base, mine, { isAdmin: actor.role === 'ADMIN' })
    if (!guard.ok) {
      fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
    }

    const merged = mergeDecoration(base, mine, theirs)
    const validation = await validateDocument(mapId, merged, companyId, tx as unknown as Prisma.TransactionClient)
    if (!validation.valid || !validation.document) {
      fail('O mapa possui erros e não pode ser publicado', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
    }

    const core = await materializePublication(tx as unknown as Prisma.TransactionClient, mapId, map, actor.id, true, validation, companyId)
    return { ...core, document: validation.document as MapDocumentV1 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...PUBLISH_TRANSACTION_TIMEOUT })

  // Publicação suave: mantém presença e faz refresh suave em todos (inclusive
  // editores sem alterações locais).
  officeHub.configure(await getActiveOfficeMap(companyId), false, true)
  officeHub.broadcastMapDecorUpdated(result.publication.id)

  return { version: result.version, document: result.document }
}
```

Substituir `listOfficeMapPublications`:

```ts
export async function listOfficeMapPublications(mapId: string, companyId: string) {
  await requireMap(mapId, companyId)
  const [activeId, publications] = await Promise.all([
    activePublicationId(companyId),
    scopedPrisma(companyId).officeMapPublication.findMany({ where: { mapId }, orderBy: { version: 'desc' }, select: publicationSelect }),
  ])
  return publications.map((publication) => asPublication(publication, activeId))
}
```

Substituir `getOfficeMapPublication`:

```ts
export async function getOfficeMapPublication(mapId: string, publicationId: string, companyId: string) {
  const publication = await scopedPrisma(companyId).officeMapPublication.findFirst({
    where: { id: publicationId, mapId },
    include: {
      createdBy: { select: { id: true, name: true } },
      assetLinks: { include: { asset: true } },
      rooms: { include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } } },
      map: { select: { id: true, name: true } },
    },
  })
  if (!publication) fail('Publicação não encontrada', 404, 'PUBLICATION_NOT_FOUND')
  const activeId = await activePublicationId(companyId)
  const document = publication.mapData as unknown as MapDocumentV1
  return {
    ...asPublication(publication, activeId),
    map: publication.map,
    document,
    assets: withBuiltinAssets(document, publication.assetLinks.map(({ asset }) => asAsset(asset))),
    rooms: publication.rooms.map(asRoom),
  }
}
```

Substituir `activateOfficeMapPublication`:

```ts
export async function activateOfficeMapPublication(publicationId: string, actorId: string, companyId: string) {
  const publication = await scopedPrisma(companyId).officeMapPublication.findUnique({ where: { id: publicationId }, select: { id: true, mapId: true } })
  if (!publication) fail('Publicação não encontrada', 404, 'PUBLICATION_NOT_FOUND')
  await prisma.officeSetting.upsert({
    where: { companyId },
    create: { companyId, activeMapPublicationId: publication.id },
    update: { activeMapPublicationId: publication.id },
  })
  await recordAuditLog({ actorId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'UPDATE', after: { activated: true } })
  officeHub.configure(await getActiveOfficeMap(companyId), true)
  return { activeMapPublicationId: publication.id, mapId: publication.mapId }
}
```

- [ ] **Step 4: Rodar só os describes novos e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "isolamento multi-empresa (publicação)"`
Expected: PASS em todos os testes do describe novo.

- [ ] **Step 5: Ajustar `office-map-service.merge.test.ts` (mesma mudança de `seedActiveMap`)**

Modify `apps/api/src/services/office-map-service.merge.test.ts` — `seedActiveMap` e as chamadas
de `mergeAndPublishDecoration` ganham `DEFAULT_COMPANY_ID`:

```ts
import { describe, it, expect } from 'vitest'
import {
  OFFICE_TILESET_CATALOG,
  MapTileSizeSchema,
  DEFAULT_COMPANY_ID,
  createEmptyMapDocumentV1,
  type MapDocumentV1,
  type MapObjectV1,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createOfficeMap,
  acquireOfficeMapLock,
  saveOfficeMapDraft,
  publishOfficeMap,
  getActiveOfficeMap,
  mergeAndPublishDecoration,
} from './office-map-service'
```

(O resto do arquivo — `admin()`, `builtinTileset48()`, `tileObj`, `withObject` — fica igual.)
`seedActiveMap`:

```ts
async function seedActiveMap() {
  const user = await admin()
  const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, DEFAULT_COMPANY_ID)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  const tileWidth = MapTileSizeSchema.parse(builtin.tileWidth)
  const tileHeight = MapTileSizeSchema.parse(builtin.tileHeight)
  doc.tilesets.push({
    id: 'ts1',
    assetId: builtin.assetId,
    name: builtin.name,
    tileWidth,
    tileHeight,
    columns: builtin.columns,
    tileCount: builtin.tileCount,
  })
  const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, DEFAULT_COMPANY_ID)
  await publishOfficeMap(mapId, saved.revision, user.id, true, DEFAULT_COMPANY_ID)
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  return { mapId, baseVersion: active.publication.version, baseDoc: active.document, userId: user.id }
}
```

E as 4 chamadas de `mergeAndPublishDecoration({...}, {...})` no corpo dos testes ganham
`DEFAULT_COMPANY_ID` como 3º argumento — ex. `mergeAndPublishDecoration({ baseVersion, document:
aDoc }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID)`. Aplicar a mesma mudança nas outras 3
chamadas do arquivo (`b`, `fallback 2-vias`, `rejeita mudança estrutural`, `rejeita documento
malformado` — 2 chamadas nesse último teste).

- [ ] **Step 6: Rodar `office-map-service.merge.test.ts` e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.merge.test.ts`
Expected: PASS em todos os testes (este arquivo não depende de `acquireOfficeMapLock`/
`saveOfficeMapDraft` com assinatura nova além do que já foi coberto — mas se `acquireOfficeMapLock`/
`saveOfficeMapDraft` ainda não aceitam `companyId` nesta task, este passo FALHA de propósito; é
esperado — a Task 7 escopa essas duas funções e este arquivo só fecha 100% verde depois dela.
Anote isso e siga para a Task 7 sem tentar corrigir aqui.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts apps/api/src/services/office-map-service.merge.test.ts
git commit -m "feat: escopa publicação de mapa (materializePublication/publishOfficeMap/mergeAndPublishDecoration)"
```

---

### Task 7: `office-map-service.ts` — rascunho/lock/decoração

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/services/office-map-service.test.ts`

**Interfaces:**
- Consumes: `requireMap` (Task 4), `getActiveMapIdForEditing` (Task 4), `getActiveOfficeMap`
  (Task 5), `publishOfficeMap` (Task 6).
- Produces: `getOfficeMapDraft(mapId, companyId)`, `saveOfficeMapDraft(mapId, input, userId,
  lockToken, companyId)`, `acquireOfficeMapLock(mapId, userId, companyId)`,
  `heartbeatOfficeMapLock(mapId, userId, lockToken, companyId)`, `releaseOfficeMapLock(mapId,
  userId, lockToken, companyId)`, `saveOfficeDecorationDraft(input, actor, lockToken, companyId)`,
  `publishOfficeDecoration(revision, actor, companyId)`.

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/office-map-service.test.ts` — atualizar
`seedProtectedObjects`/os testes de "edição de decoração por membro" pra passar `DEFAULT_COMPANY_ID`,
e adicionar o describe de isolamento final:

No `describe('edição de decoração por membro', ...)`, cada chamada de `acquireOfficeMapLock`,
`saveOfficeDecorationDraft`, `publishOfficeDecoration`, `getActiveMapIdForEditing` ganha
`DEFAULT_COMPANY_ID` como último argumento:

```ts
describe('edição de decoração por membro', () => {
  it('resolve o mapId do publication ativo', async () => {
    const { mapId } = await seedActiveMap()
    await expect(getActiveMapIdForEditing(DEFAULT_COMPANY_ID)).resolves.toBe(mapId)
  })

  it('rejeita delta estrutural com 403', async () => {
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const bad = JSON.parse(JSON.stringify(activeDoc))
    bad.map.width += 1
    const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
    await expect(
      saveOfficeDecorationDraft({ revision, document: bad }, { id: user.id, role: 'ADMIN' }, lock.lockToken, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })

  it('aceita decoração e publica pelo caminho suave', async () => {
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const good = JSON.parse(JSON.stringify(activeDoc))
    const objects = good.layers.find((l: any) => l.key === 'objects')
    if (objects) objects.data[0] = null // mudança inócua de decoração (segue válido)
    const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
    const saved = await saveOfficeDecorationDraft(
      { revision, document: good },
      { id: user.id, role: 'ADMIN' },
      lock.lockToken,
      DEFAULT_COMPANY_ID,
    )
    const pub = await publishOfficeDecoration(saved.revision, { id: user.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)
    expect(pub.activated).toBe(true)
  })
})
```

`seedProtectedObjects` ganha `DEFAULT_COMPANY_ID` nas 2 chamadas de `mergeAndPublishDecoration`
(já cobertas na Task 6, mas revisitadas aqui porque a função só compila de ponta a ponta depois
desta task):

```ts
async function seedProtectedObjects() {
  const { user: adminUser, mapId } = await seedActiveMap()
  const comum = await member()
  const outroComum = await member()

  const active0 = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  const withAdminObj: MapDocumentV1 = {
    ...active0.document,
    objects: [...active0.document.objects, collisionObject('admin-obj')],
  }
  const afterAdmin = await mergeAndPublishDecoration(
    { baseVersion: active0.publication.version, document: withAdminObj },
    { id: adminUser.id, role: 'ADMIN' },
    DEFAULT_COMPANY_ID,
  )

  const withOutroObj: MapDocumentV1 = {
    ...afterAdmin.document,
    objects: [...afterAdmin.document.objects, collisionObject('outro-comum-obj')],
  }
  const afterOutro = await mergeAndPublishDecoration(
    { baseVersion: afterAdmin.version, document: withOutroObj },
    { id: outroComum.id, role: 'LEGEND' },
    DEFAULT_COMPANY_ID,
  )

  return {
    mapId,
    adminUser,
    comum,
    outroComum,
    activeVersion: afterOutro.version,
    doc: afterOutro.document,
  }
}
```

As 4 chamadas de `mergeAndPublishDecoration` dentro do `describe('proteção de estruturas do admin
(decoração)', ...)` ganham `DEFAULT_COMPANY_ID` como 3º argumento, igual às da Task 6.

Adicionar o describe final de isolamento:

```ts
describe('isolamento multi-empresa (rascunho e lock)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('getOfficeMapDraft com companyId de outra empresa dá 404', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-draft-test')
    const map = await createOfficeMap({ name: 'Mapa Draft', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(getOfficeMapDraft(map.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })

  it('acquireOfficeMapLock com companyId de outra empresa dá 404, não pega o lock de fato', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-lock-test')
    const map = await createOfficeMap({ name: 'Mapa Lock', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(acquireOfficeMapLock(map.id, user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const lock = await prisma.officeMapEditLock.findUnique({ where: { mapId: map.id } })
    expect(lock).toBeNull()
  })

  it('saveOfficeMapDraft com companyId de outra empresa dá 404, não altera o rascunho', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-save-draft-test')
    const map = await createOfficeMap({ name: 'Mapa Save', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    const lock = await acquireOfficeMapLock(map.id, user.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId: map.id } })
    await expect(
      saveOfficeMapDraft(map.id, { revision: draft.revision, document: draft.document }, user.id, lock.lockToken, company.id),
    ).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const stillSame = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId: map.id } })
    expect(stillSame.revision).toBe(draft.revision)
  })
})
```

Adicionar `getOfficeMapDraft`, `heartbeatOfficeMapLock`, `releaseOfficeMapLock` ao `import` de
`./office-map-service` se ainda não estiverem lá (já estão, exceto se removidos — conferir).

- [ ] **Step 2: Rodar o arquivo inteiro e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts`
Expected: FAIL — `getOfficeMapDraft`/`acquireOfficeMapLock`/`saveOfficeMapDraft`/
`saveOfficeDecorationDraft`/`publishOfficeDecoration` ainda não aceitam `companyId`.

- [ ] **Step 3: Implementar**

Modify `apps/api/src/services/office-map-service.ts`. Substituir `getOfficeMapDraft`:

```ts
export async function getOfficeMapDraft(mapId: string, companyId: string): Promise<OfficeMapDraftDTO> {
  const map = await requireMap(mapId, companyId)
  const db = scopedPrisma(companyId)
  let draft = await db.officeMapDraft.findUnique({
    where: { mapId },
    include: { lastEditedBy: { select: { id: true, name: true } } },
  })
  if (!draft) {
    const document = createEmptyMapDocumentV1()
    draft = await db.officeMapDraft.create({
      data: { mapId, document: document as unknown as Prisma.InputJsonValue },
      include: { lastEditedBy: { select: { id: true, name: true } } },
    })
  } else {
    // Mapas criados antes de uma nova layer reservada existir (ex.: `desks`)
    // não a têm no documento salvo; preenche e persiste ao abrir o rascunho.
    const structural = MapDocumentV1StructuralSchema.safeParse(draft.document)
    if (structural.success) {
      const healed = ensureReservedLayers(structural.data)
      if (JSON.stringify(healed) !== JSON.stringify(structural.data)) {
        draft = await db.officeMapDraft.update({
          where: { mapId },
          data: { document: healed as unknown as Prisma.InputJsonValue },
          include: { lastEditedBy: { select: { id: true, name: true } } },
        })
      }
    }
  }
  return {
    map,
    revision: draft.revision,
    document: draft.document as unknown as MapDocumentV1,
    savedAt: draft.savedAt.toISOString(),
    updatedBy: draft.lastEditedBy,
  }
}
```

Substituir `requireLock`:

```ts
async function requireLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  const db = scopedPrisma(companyId)
  const lock = await db.officeMapEditLock.findFirst({
    where: { mapId, userId, tokenHash: tokenHash(lockToken), expiresAt: { gt: new Date() } },
  })
  if (!lock) {
    const current = await db.officeMapEditLock.findUnique({
      where: { mapId },
      include: { user: { select: { id: true, name: true } } },
    })
    fail('O lock de edição expirou ou pertence a outra pessoa', 423, 'MAP_LOCKED', {
      expiresAt: current?.expiresAt.toISOString() ?? null,
      owner: current?.user ?? null,
    })
  }
}
```

Substituir `saveOfficeMapDraft`:

```ts
export async function saveOfficeMapDraft(
  mapId: string,
  input: { revision: number; document: unknown },
  userId: string,
  lockToken: string,
  companyId: string,
) {
  await requireMap(mapId, companyId)
  await requireLock(mapId, userId, lockToken, companyId)
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const validation = await validateDocument(mapId, structural.data, companyId)
  if (validation.errors.some((error) => error.code === 'DOCUMENT_TOO_LARGE')) {
    fail('O documento excede o limite de 10 MB', 413, 'DOCUMENT_TOO_LARGE')
  }
  const savedAt = new Date()
  const updated = await scopedPrisma(companyId).officeMapDraft.updateMany({
    where: { mapId, revision: input.revision },
    data: {
      document: (validation.document ?? structural.data) as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
      savedAt,
      lastEditedById: userId,
    },
  })
  if (updated.count !== 1) {
    const current = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId }, select: { revision: true } })
    fail('O rascunho foi alterado por outra requisição', 409, 'DRAFT_REVISION_CONFLICT', {
      expectedRevision: input.revision,
      currentRevision: current?.revision ?? null,
    })
  }
  return {
    revision: input.revision + 1,
    savedAt: savedAt.toISOString(),
    validationSummary: { valid: validation.valid, errorCount: validation.errors.length },
  }
}
```

Substituir `activeDocument`:

```ts
async function activeDocument(companyId: string): Promise<MapDocumentV1> {
  const active = await getActiveOfficeMap(companyId)
  return canonicalDocument(active.document)
}
```

Substituir `saveOfficeDecorationDraft`:

```ts
export async function saveOfficeDecorationDraft(
  input: { revision: number; document: unknown },
  actor: { id: string; role: UserRole },
  lockToken: string,
  companyId: string,
) {
  const mapId = await getActiveMapIdForEditing(companyId)
  const structural = MapDocumentV1StructuralSchema.safeParse(input.document)
  if (!structural.success) {
    const validation = validateMapDocumentV1(input.document)
    fail('A estrutura do documento é inválida', 422, 'MAP_DOCUMENT_INVALID', { errors: validation.errors })
  }
  const previous = await activeDocument(companyId)
  const stamped = stampObjectOwnership(previous, canonicalDocument(structural.data), actor)
  const guard = assertOnlyDecorationChanged(previous, stamped, { isAdmin: actor.role === 'ADMIN' })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return saveOfficeMapDraft(mapId, { revision: input.revision, document: stamped }, actor.id, lockToken, companyId)
}
```

Substituir `publishOfficeDecoration`:

```ts
export async function publishOfficeDecoration(revision: number, actor: { id: string; role: UserRole }, companyId: string) {
  const mapId = await getActiveMapIdForEditing(companyId)
  const draft = await scopedPrisma(companyId).officeMapDraft.findUnique({ where: { mapId } })
  if (!draft) fail('Rascunho não encontrado', 404, 'DRAFT_NOT_FOUND')
  const previous = await activeDocument(companyId)
  const next = canonicalDocument(draft.document)
  const guard = assertOnlyDecorationChanged(previous, next, { isAdmin: actor.role === 'ADMIN' })
  if (!guard.ok) fail('Alterações estruturais não são permitidas', 403, 'STRUCTURAL_EDIT_FORBIDDEN', { violations: guard.violations })
  return publishOfficeMap(mapId, revision, actor.id, true, companyId, { soft: true })
}
```

Substituir `acquireOfficeMapLock`:

```ts
export async function acquireOfficeMapLock(mapId: string, userId: string, companyId: string): Promise<OfficeMapLockDTO> {
  await requireMap(mapId, companyId)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
  if (!user) fail('Usuário não encontrado', 404, 'USER_NOT_FOUND')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + MAP_DOCUMENT_V1_LIMITS.editLockTtlMs)
  const lockToken = randomBytes(32).toString('base64url')
  const db = scopedPrisma(companyId)
  const existing = await db.officeMapEditLock.findUnique({
    where: { mapId },
    include: { user: { select: { id: true, name: true } } },
  })
  if (existing && existing.expiresAt > now && existing.userId !== userId) {
    fail('Este mapa já está sendo editado', 423, 'MAP_LOCKED', {
      expiresAt: existing.expiresAt.toISOString(),
      owner: existing.user,
    })
  }
  await db.officeMapEditLock.upsert({
    where: { mapId },
    create: { mapId, userId, tokenHash: tokenHash(lockToken), expiresAt },
    update: { userId, tokenHash: tokenHash(lockToken), expiresAt },
  })
  return { lockToken, expiresAt: expiresAt.toISOString(), owner: user }
}
```

Espera — `db.officeMapEditLock.upsert` acima: `OfficeMapEditLock` ESTÁ em `TENANT_SCOPED_MODELS`
(Task 1), e a extensão **rejeita `upsert`** com `TenantScopeError`. Substituir por `find` +
`create`/`update` (mesmo padrão de `setTodayMood` na fatia de MoodEntry):

```ts
export async function acquireOfficeMapLock(mapId: string, userId: string, companyId: string): Promise<OfficeMapLockDTO> {
  await requireMap(mapId, companyId)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
  if (!user) fail('Usuário não encontrado', 404, 'USER_NOT_FOUND')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + MAP_DOCUMENT_V1_LIMITS.editLockTtlMs)
  const lockToken = randomBytes(32).toString('base64url')
  const db = scopedPrisma(companyId)
  const existing = await db.officeMapEditLock.findUnique({
    where: { mapId },
    include: { user: { select: { id: true, name: true } } },
  })
  if (existing && existing.expiresAt > now && existing.userId !== userId) {
    fail('Este mapa já está sendo editado', 423, 'MAP_LOCKED', {
      expiresAt: existing.expiresAt.toISOString(),
      owner: existing.user,
    })
  }
  // `OfficeMapEditLock` é tenant-scoped, e `scopedPrisma` não suporta `upsert` (levanta
  // `TenantScopeError` de propósito) — `find` já foi feito acima (`existing`), decide
  // entre `create`/`update` explicitamente.
  if (existing) {
    await db.officeMapEditLock.update({
      where: { mapId },
      data: { userId, tokenHash: tokenHash(lockToken), expiresAt },
    })
  } else {
    await db.officeMapEditLock.create({
      data: { mapId, userId, tokenHash: tokenHash(lockToken), expiresAt },
    })
  }
  return { lockToken, expiresAt: expiresAt.toISOString(), owner: user }
}
```

Substituir `heartbeatOfficeMapLock`:

```ts
export async function heartbeatOfficeMapLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  await requireLock(mapId, userId, lockToken, companyId)
  const expiresAt = new Date(Date.now() + MAP_DOCUMENT_V1_LIMITS.editLockTtlMs)
  await scopedPrisma(companyId).officeMapEditLock.update({ where: { mapId }, data: { expiresAt } })
  return { expiresAt: expiresAt.toISOString() }
}
```

Substituir `releaseOfficeMapLock`:

```ts
export async function releaseOfficeMapLock(mapId: string, userId: string, lockToken: string, companyId: string) {
  const deleted = await scopedPrisma(companyId).officeMapEditLock.deleteMany({
    where: { mapId, userId, tokenHash: tokenHash(lockToken) },
  })
  if (deleted.count !== 1) fail('Lock de edição inválido', 423, 'MAP_LOCKED')
}
```

- [ ] **Step 4: Rodar o arquivo inteiro e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts`
Expected: PASS em todos os testes do arquivo (todos os describes, incluindo os das Tasks 4-6).

- [ ] **Step 5: Rodar `office-map-service.merge.test.ts` de novo**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.merge.test.ts`
Expected: agora PASS (dependia de `acquireOfficeMapLock`/`saveOfficeMapDraft` escopados, feito
neste passo).

- [ ] **Step 6: Rodar os 5 arquivos de teste desta fatia juntos**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts src/services/office-map-service.merge.test.ts src/services/office-setting-service.test.ts src/services/office-guest-service.test.ts src/lib/tenant-scope.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: `tsc --noEmit` — confirmar que só rotas/office-ws quebram**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros **apenas** em `apps/api/src/routes/office-maps.ts`, `office-guests.ts`,
`office-media.ts`, `admin.ts` (trecho `/admin/office-settings`), `office-ws.ts`, e nos arquivos de
teste de rota que os exercitam (`office-maps.test.ts`, `office-media.test.ts`) — todos chamando
as funções desta fatia com a assinatura antiga (faltando `companyId`). Nenhum erro em
`src/services/office-*.ts`, `src/lib/tenant-scope.ts` nem `src/services/office-*.test.ts`. Se
houver erro em algum desses últimos, pare e corrija antes de seguir — essa é a barra de "sub-fatia
1 está completa".

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat: escopa rascunho/lock/decoração em office-map-service.ts"
```

---

## Verificação final (não é uma task — rode antes de considerar a fatia pronta)

1. `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts src/services/office-map-service.merge.test.ts src/services/office-setting-service.test.ts src/services/office-guest-service.test.ts src/lib/tenant-scope.test.ts` — todos PASS.
2. `pnpm --filter @legends/api exec tsc --noEmit` — erros só nas rotas/`office-ws.ts` listadas na
   Task 7 Step 7 (documentar a lista exata de arquivos com erro no relatório final, pra
   confirmar que a sub-fatia 2 sabe exatamente o que precisa consertar).
3. **Não** rodar `pnpm --filter @legends/api test` (suíte inteira) como critério de sucesso desta
   fatia — as rotas quebradas fazem outros arquivos de teste falharem por design (handoff pra
   sub-fatia 2).
