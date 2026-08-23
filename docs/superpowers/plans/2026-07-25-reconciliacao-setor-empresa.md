# Reconciliação: escopo por Setor (main) x escopo por Empresa (multi-tenancy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `git merge origin/main` mergear limpo na branch `feat/multi-empresa-auth-jwt-clean`
(PR #10609), reconciliando o escopo por SETOR que `main` já tem (PR #10610, join manual a
`sectorId`) com o escopo por EMPRESA que a branch introduz (`scopedPrisma(companyId)`), sem perder
nenhuma das duas camadas de isolamento.

**Architecture:** Empresa é o filtro de isolamento real/automático (`scopedPrisma(companyId)`,
via Prisma Client Extension em `tenant-scope.ts`); setor é um refinamento *dentro* da empresa,
aplicado explicitamente em cada função de serviço que precisa dele (join manual a
`author.sectorId`/`target.sectorId`/`user.sectorId`, ou — nos 7 models de Review, que ganham
`sectorId` denormalizado nesta reconciliação — filtro direto na própria tabela). Nenhuma mudança
na extensão `tenant-scope.ts` além de adicionar `UserBadge` à allowlist: `scopedPrisma(companyId)`
já mescla `companyId` automaticamente em qualquer `where`/`create` que a função passar; basta cada
função de serviço somar seu próprio filtro de `sectorId` por cima.

**Tech Stack:** TypeScript ESM, Fastify 4, Prisma 5 + PostgreSQL, Vitest, pnpm workspaces
(`apps/api`, `packages/shared`).

## Global Constraints

- **REGRA DE SEGURANÇA**: antes de rodar qualquer `prisma migrate dev`, confirme que
  `apps/api/.env`'s `DATABASE_URL` aponta para `localhost:5432` (Postgres local via
  `pnpm db:up`) — nunca para um banco de homologação/produção remoto.
- Não editar nenhuma migration já aplicada; toda mudança de schema nesta reconciliação entra numa
  migration **nova**.
- O merge (`git merge origin/main`) só é commitado na última task, depois de todos os conflitos
  resolvidos e testados.
- Sub-agentes/execução: rodar apenas os testes do arquivo alterado a cada task; a suíte completa
  (`pnpm test`) só entra na task final de verificação.
- Mensagens ao usuário em português (produto pt-BR); código novo segue o padrão da camada vizinha
  (route fina, lógica no service, DTO em `serialize.ts`).

## Achados da investigação (leia antes de começar)

- **`git merge-base origin/main origin/feat/multi-empresa-auth-jwt-clean` = `855e9b0990be34876aeb2612b9e94d7ef208ab05`.**
  As SHAs analisadas foram `origin/main = 78151f9a8efe285bd17fa63d870e5af1f2015af2` e
  `origin/feat/multi-empresa-auth-jwt-clean = c32b875dcd9708c579133fdf39c04cddaabafa5e` — **ambas
  as branches são movidas por outros times/CI em paralelo** (main recebe merges de PR contínuos;
  a branch de multi-tenancy segue recebendo commits). Ao executar este plano, faça
  `git fetch origin` e confirme que ainda está nas mesmas SHAs (ou próximas) antes de abrir o
  merge — se a branch avançou muito, releia os arquivos conflitantes antes de aplicar as
  resoluções abaixo ao pé da letra, porque elas foram derivadas do código exato dessas duas SHAs.
- **O conjunto real de arquivos com conflito de merge (`git merge --no-commit --no-ff`, testado
  num worktree descartável nessas duas SHAs) é MENOR do que o levantamento inicial de 14
  arquivos sugeria.** Só 9 arquivos geram `<<<<<<<` de verdade:
  `apps/api/src/lib/serialize.ts`, `apps/api/src/routes/highlights.ts`,
  `apps/api/src/routes/review.ts`, `apps/api/src/routes/users.ts`,
  `apps/api/src/services/mural-service.ts`, `apps/api/src/services/mural-service.test.ts`,
  `apps/api/src/services/review-service.ts`, `apps/api/src/services/review-service.test.ts`,
  `packages/shared/src/auth.ts`. Os outros 5 do levantamento original —
  `apps/api/src/app.ts`, `apps/api/src/lib/office-hub.ts`, `apps/api/src/routes/auth.ts`,
  `apps/api/src/routes/profile.ts`, `apps/api/src/routes/profile.test.ts` — o merge automático do
  git (`git merge-file`/recursive) já resolve sozinho, com o resultado semanticamente correto
  (confirmado lendo o conteúdo pós-merge). Eles continuam tendo uma task de VERIFICAÇÃO (não de
  edição) abaixo, porque "sem conflito textual" não é o mesmo que "sem call-site quebrado" — ver
  próximo ponto.
- **`schema.prisma` também dá auto-merge limpo** (main e branch tocam campos/relações diferentes
  dentro dos mesmos models, em posições que não colidem linha a linha). Não há nada para resolver
  manualmente nele durante o merge — a mudança de schema desta reconciliação (sectorId nos 7
  models de Review + companyId em UserBadge) é uma migration **nova**, aplicada depois do merge
  (Task 2).
- **Efeito colateral do merge de `serialize.ts` que o git NÃO detecta como conflito em outros
  arquivos**: `toPublicUser` muda de assinatura posicional (`sectorName` OU `companyName` como
  3º parâmetro, dependendo do lado) para um único objeto de opções
  `{ sectorName?, companyName? }`. Isso quebra silenciosamente os 3 call-sites que passavam um
  3º argumento posicional em arquivos que auto-mergearam sem conflito textual:
  `apps/api/src/routes/profile.ts` (`toPublicUser(profile.user, [], sectorName)`),
  `apps/api/src/routes/users.ts` (já é um dos 9 arquivos com conflito, mas o `toPublicUser` ali
  é uma segunda mudança dentro do mesmo arquivo) e `apps/api/src/routes/auth.ts` (4 call-sites,
  `toPublicUser(user, sectorFeatures, await companyNameFor(user.companyId))`). TypeScript pega
  isso no `tsc --noEmit`, mas como é fácil deixar passar numa resolução apressada, cada task abaixo
  que mexe nesses arquivos já entrega o call-site corrigido.
- **Gap real confirmado**: `UserBadge` nunca ganhou `companyId` em nenhuma fatia anterior de
  multi-tenancy, e `mural-service.ts` usa `prisma.userBadge.findMany` cru (não `scopedPrisma`) —
  mesmo depois do merge automático do git. Corrigido na Task 2 (schema) + Task 4 (serviço).
- **Migration mais recente de cada lado**: main tem `20260724120000_add_default_office_desk`
  (não mexe em Review/UserBadge); a branch tem, na sequência,
  `20260724203104_add_company_to_feedback`, `20260724220200_add_company_to_mood_entry`,
  `20260724225801_add_company_to_notification`, `20260725003745_add_company_to_review` (é o
  precedente exato do padrão a replicar: `companyId String @default("company-emr")` +
  `@@index([companyId])` + FK, nos mesmos 7 models de Review) e
  `20260725101459_office_multi_tenancy` (mais recente de todas). A migration nova desta
  reconciliação (Task 2) usa o timestamp `20260725120000`, depois de todas as anteriores.

---

### Task 1: Abrir o merge (worktree isolado, sem commitar)

**Files:**
- Nenhum arquivo de código — só operações de git.

- [ ] **Step 1: Criar o worktree**

```bash
git fetch origin
git worktree add ../legends-merge-setor-empresa feat/multi-empresa-auth-jwt-clean
cd ../legends-merge-setor-empresa
```

- [ ] **Step 2: Abrir o merge sem commitar**

```bash
git merge origin/main --no-commit --no-ff
```

Expected: git reporta `Automatic merge failed; fix conflicts and then commit the result.` e
`git status --porcelain` lista exatamente estes 9 arquivos como `UU` (unmerged):

```
apps/api/src/lib/serialize.ts
apps/api/src/routes/highlights.ts
apps/api/src/routes/review.ts
apps/api/src/routes/users.ts
apps/api/src/services/mural-service.ts
apps/api/src/services/mural-service.test.ts
apps/api/src/services/review-service.ts
apps/api/src/services/review-service.test.ts
packages/shared/src/auth.ts
```

Se a lista vier diferente (a mais comum: mais arquivos em conflito, porque uma das branches
avançou desde a investigação), pare e releia os arquivos extras antes de prosseguir — as
resoluções das tasks seguintes assumem exatamente este conjunto.

- [ ] **Step 3: Não commitar ainda.** Siga para a Task 2. O merge fica "aberto" (estado
  conflitado) até a Task 9.

---

### Task 2: Schema — `sectorId` nos 7 models de Review + `companyId` em `UserBadge`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (sem conflito de merge — edição pós-merge)
- Modify: `apps/api/src/lib/tenant-scope.ts` (sem conflito de merge — adicionar `'UserBadge'`)
- Create: `apps/api/prisma/migrations/20260725120000_add_sector_to_review_and_company_to_user_badge/migration.sql`

**Interfaces:**
- Produces: `Review.sectorId`, `ReviewComment.sectorId`, `ReviewReaction.sectorId`,
  `ReviewCommentReaction.sectorId`, `ReviewShare.sectorId`, `ReviewMention.sectorId`,
  `ReviewCommentMention.sectorId` (todos `String @default("sector-dev-produto")`, com relação a
  `Sector` e `@@index([sectorId])` — mesmo padrão de `companyId` nesses models, replicado 1:1).
  `UserBadge.companyId` (`String @default("company-emr")`, relação a `Company`,
  `@@index([companyId])`).

- [ ] **Step 1: Editar `schema.prisma` — os 7 models de Review ganham `sectorId`**

Nos 7 models `Review`, `ReviewComment`, `ReviewReaction`, `ReviewCommentReaction`, `ReviewShare`,
`ReviewMention`, `ReviewCommentMention`, adicione o campo `sectorId` logo após `companyId`, a
relação `sector Sector @relation(...)` logo após a relação `company`, e `@@index([sectorId])`
logo após `@@index([companyId])`. Resultado final de cada model:

```prisma
model Review {
  id        String   @id @default(cuid())
  authorId  String
  content   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  author    User            @relation("ReviewsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  comments  ReviewComment[]
  reactions ReviewReaction[]
  shares    ReviewShare[]
  mentions  ReviewMention[]
  company   Company         @relation(fields: [companyId], references: [id])
  sector    Sector          @relation(fields: [sectorId], references: [id])

  @@index([createdAt])
  @@index([authorId])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewComment {
  id        String   @id @default(cuid())
  reviewId  String
  authorId  String
  content   String
  createdAt DateTime @default(now())
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  review    Review                  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  author    User                    @relation("ReviewCommentsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  reactions ReviewCommentReaction[]
  mentions  ReviewCommentMention[]
  company   Company                 @relation(fields: [companyId], references: [id])
  sector    Sector                  @relation(fields: [sectorId], references: [id])

  @@index([reviewId, createdAt])
  @@index([authorId])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewReaction {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])
  sector  Sector  @relation(fields: [sectorId], references: [id])

  @@unique([reviewId, userId, emoji])
  @@index([reviewId])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewCommentReaction {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])
  sector  Sector        @relation(fields: [sectorId], references: [id])

  @@unique([commentId, userId, emoji])
  @@index([commentId])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewShare {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])
  sector  Sector  @relation(fields: [sectorId], references: [id])

  @@unique([reviewId, userId])
  @@index([reviewId])
  @@index([createdAt])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewMention {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  name      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])
  sector  Sector  @relation(fields: [sectorId], references: [id])

  @@unique([reviewId, userId])
  @@index([reviewId])
  @@index([companyId])
  @@index([sectorId])
}

model ReviewCommentMention {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  name      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")
  sectorId  String   @default("sector-dev-produto")

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])
  sector  Sector        @relation(fields: [sectorId], references: [id])

  @@unique([commentId, userId])
  @@index([commentId])
  @@index([companyId])
  @@index([sectorId])
}
```

- [ ] **Step 2: Editar `schema.prisma` — `Sector` ganha as 7 back-relations**

No `model Sector`, adicione os 7 campos de array logo após `thirdPartyInvites`:

```prisma
model Sector {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  active          Boolean  @default(true)
  enabledFeatures Json     @default("[]")
  companyId       String   @default("company-emr")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  company           Company            @relation(fields: [companyId], references: [id])
  users             User[]
  roles             SectorRole[]
  votingPeriods     VotingPeriod[]
  squads            Squad[]
  categorySectors   CategorySector[]
  badgeSectors      BadgeSector[]
  thirdPartyInvites ThirdPartyInvite[]
  reviews                Review[]
  reviewComments         ReviewComment[]
  reviewReactions        ReviewReaction[]
  reviewCommentReactions ReviewCommentReaction[]
  reviewShares           ReviewShare[]
  reviewMentions         ReviewMention[]
  reviewCommentMentions  ReviewCommentMention[]

  @@index([companyId])
}
```

- [ ] **Step 3: Editar `schema.prisma` — `UserBadge` ganha `companyId`**

```prisma
model UserBadge {
  id          String           @id @default(cuid())
  userId      String
  badgeId     String
  periodId    String?
  source      BadgeAwardSource @default(AUTO)
  awardedById String?
  awardedAt   DateTime         @default(now())
  featured    Boolean          @default(false)
  companyId   String           @default("company-emr")

  user      User    @relation(fields: [userId], references: [id])
  badge     Badge   @relation(fields: [badgeId], references: [id])
  awardedBy User?   @relation("BadgesAwarded", fields: [awardedById], references: [id])
  company   Company @relation(fields: [companyId], references: [id])

  /// Índice é NULLS NOT DISTINCT (ver migration 20260612180000) — bloqueia concessão manual duplicada com periodId null.
  @@unique([userId, badgeId, periodId])
  @@index([userId])
  @@index([companyId])
}
```

- [ ] **Step 4: Editar `schema.prisma` — `Company` ganha a back-relation de `UserBadge`**

No `model Company`, adicione `userBadges UserBadge[]` logo após `reviewCommentMentions`:

```prisma
  reviewMentions          ReviewMention[]
  reviewCommentMentions   ReviewCommentMention[]
  userBadges              UserBadge[]
```

- [ ] **Step 5: Gerar a migration à mão** (SEGURANÇA: confirme antes que
  `apps/api/.env`'s `DATABASE_URL` aponta pra `localhost:5432`, não para homologação/produção)

```bash
mkdir -p apps/api/prisma/migrations/20260725120000_add_sector_to_review_and_company_to_user_badge
```

Crie `apps/api/prisma/migrations/20260725120000_add_sector_to_review_and_company_to_user_badge/migration.sql`:

```sql
-- Reconciliação sector (main) x company (multi-tenancy): os 7 models de Review ganham
-- sectorId denormalizado (mesmo padrão do companyId), e UserBadge — nunca tocado por
-- nenhuma fatia de multi-tenancy até aqui — ganha companyId.

-- AlterTable: sectorId nos 7 models de Review
ALTER TABLE "Review" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewComment" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewReaction" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewCommentReaction" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewShare" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewMention" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';
ALTER TABLE "ReviewCommentMention" ADD COLUMN     "sectorId" TEXT NOT NULL DEFAULT 'sector-dev-produto';

-- Backfill: sectorId real do autor da resenha/comentário/reação/etc (o default acima só
-- cobre quem não tiver correspondência, o que não deveria acontecer em dado consistente).
UPDATE "Review" r SET "sectorId" = u."sectorId" FROM "User" u WHERE u.id = r."authorId";
UPDATE "ReviewComment" rc SET "sectorId" = u."sectorId" FROM "User" u WHERE u.id = rc."authorId";
UPDATE "ReviewReaction" rr SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rr."reviewId";
UPDATE "ReviewCommentReaction" rcr SET "sectorId" = rc."sectorId" FROM "ReviewComment" rc WHERE rc.id = rcr."commentId";
UPDATE "ReviewShare" rs SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rs."reviewId";
UPDATE "ReviewMention" rm SET "sectorId" = rv."sectorId" FROM "Review" rv WHERE rv.id = rm."reviewId";
UPDATE "ReviewCommentMention" rcm SET "sectorId" = rc."sectorId" FROM "ReviewComment" rc WHERE rc.id = rcm."commentId";

-- CreateIndex
CREATE INDEX "Review_sectorId_idx" ON "Review"("sectorId");
CREATE INDEX "ReviewComment_sectorId_idx" ON "ReviewComment"("sectorId");
CREATE INDEX "ReviewReaction_sectorId_idx" ON "ReviewReaction"("sectorId");
CREATE INDEX "ReviewCommentReaction_sectorId_idx" ON "ReviewCommentReaction"("sectorId");
CREATE INDEX "ReviewShare_sectorId_idx" ON "ReviewShare"("sectorId");
CREATE INDEX "ReviewMention_sectorId_idx" ON "ReviewMention"("sectorId");
CREATE INDEX "ReviewCommentMention_sectorId_idx" ON "ReviewCommentMention"("sectorId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewReaction" ADD CONSTRAINT "ReviewReaction_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewCommentReaction" ADD CONSTRAINT "ReviewCommentReaction_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewShare" ADD CONSTRAINT "ReviewShare_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewMention" ADD CONSTRAINT "ReviewMention_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewCommentMention" ADD CONSTRAINT "ReviewCommentMention_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: companyId no UserBadge (nunca tinha sido tocado por nenhuma fatia de multi-tenancy)
ALTER TABLE "UserBadge" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'company-emr';

-- Backfill: companyId real do dono do selo.
UPDATE "UserBadge" ub SET "companyId" = u."companyId" FROM "User" u WHERE u.id = ub."userId";

-- CreateIndex
CREATE INDEX "UserBadge_companyId_idx" ON "UserBadge"("companyId");

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 6: Aplicar a migration e regenerar o client**

```bash
pnpm db:up
cat apps/api/.env | grep DATABASE_URL   # confirme localhost:5432 antes de seguir
pnpm --filter @legends/api exec prisma migrate dev
pnpm db:generate
```

Expected: `prisma migrate dev` reconhece a migration já escrita à mão (mesmo nome de diretório),
aplica sem gerar diff adicional, e termina com `Your database is now in sync with your schema.`

- [ ] **Step 7: Adicionar `UserBadge` a `TENANT_SCOPED_MODELS`**

Modify `apps/api/src/lib/tenant-scope.ts`:

```typescript
const TENANT_SCOPED_MODELS = new Set([
  'Sector',
  'User',
  'VotingPeriod',
  'Vote',
  'Squad',
  'ThirdPartyInvite',
  'Category',
  'Badge',
  'UserBadge',
  'Feedback',
  'FeedbackReaction',
  'MoodEntry',
  'Notification',
  'Review',
  'ReviewComment',
  'ReviewReaction',
  'ReviewCommentReaction',
  'ReviewShare',
  'ReviewMention',
  'ReviewCommentMention',
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

(Só a linha `'UserBadge',` é nova — o resto do arquivo, incluindo `scopedPrisma` e
`findUserInCompany`, não muda.)

- [ ] **Step 8: Verificar**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: sem erros (o schema novo ainda não é consumido por nenhum service — isso vem nas
próximas tasks — então este passo só confirma que o Prisma Client gerado é válido).

- [ ] **Step 9: Commit intermediário (dentro do merge em aberto, NÃO faz `git commit` do merge)**

Não commite nada ainda — o merge inteiro só vira um commit na Task 9. Deixe o working tree como
está e siga para a Task 3.

---

### Task 3: `review-service.ts` + `review-service.test.ts`

**Files:**
- Modify: `apps/api/src/services/review-service.ts` (resolve conflito de merge)
- Modify: `apps/api/src/services/review-service.test.ts` (resolve conflito de merge)

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` de `../lib/tenant-scope`; `Review`/`ReviewComment`/etc. com
  `sectorId` (Task 2).
- Produces (assinaturas finais, usadas pela Task 4 — `routes/review.ts`):
  - `createReview(input: { authorId, content, mentionedUserIds?, gif?, image?, companyId }): Promise<ReviewWithRelations>`
  - `listFeed(viewerId, companyId, sectorId, opts: { cursor?, limit }): Promise<{ items, nextCursor, sharedReviewIds }>`
  - `getReviewForViewer(reviewId, viewerId, companyId, sectorId): Promise<{ review, sharedByMe }>`
  - `deleteReview(input: { reviewId, userId, role, companyId, sectorId }): Promise<void>`
  - `listComments(reviewId, companyId, sectorId, opts: { offset, limit }): Promise<ReviewCommentWithRelations[]>`
  - `createComment(input: { reviewId, authorId, viewerSectorId, content, mentionedUserIds?, gif?, image?, companyId }): Promise<{ comment, reviewAuthorId, replyRecipientIds }>`
  - `deleteComment(input: { commentId, userId, role, companyId, sectorId }): Promise<{ reviewId }>`
  - `toggleReviewReaction(input: { reviewId, userId, emoji, companyId, sectorId }): Promise<{ review, added, reviewAuthorId, sharedByMe }>`
  - `toggleCommentReaction(input: { commentId, userId, emoji, companyId, sectorId }): Promise<{ comment }>`
  - `shareReview(input: { reviewId, userId, companyId, sectorId }): Promise<{ reviewAuthorId, created }>`
  - `unshareReview(input: { reviewId, userId, companyId }): Promise<void>` (sem `sectorId` — a
    combinação `reviewId`+`userId` já pinpointa a linha, e a resenha em si já foi validada por
    quem chama antes de compartilhar/descompartilhar)

**Decisão de reconciliação**: cada função que hoje valida "a resenha/comentário pertence ao
setor de quem pede" passa a comparar contra o **`sectorId` denormalizado** da própria linha
(`review.sectorId`, não mais `review.author.sectorId` via join) — mais barato e consistente com o
padrão já usado para `companyId`. `resolveMentions` continua restringindo menções ao mesmo setor
do autor (comportamento do `main`), agora também dentro da empresa
(`scopedPrisma(companyId).user.findMany(...)`). Toda `create` nos 7 models de Review — inclusive
as aninhadas (`mentions: { create: [...] }`, que **não** passam pela extensão `scopedPrisma`
porque não são uma operação de topo separada) — precisa setar `sectorId` explicitamente; senão
cai no default `'sector-dev-produto'` da migration, que é errado para qualquer autor de outro
setor.

- [ ] **Step 1: Substituir `apps/api/src/services/review-service.ts` pelo conteúdo abaixo**

```typescript
import { Prisma } from '@prisma/client'
import {
  REVIEW_MAX_LENGTH,
  REVIEW_REACTIONS,
  MAX_REVIEW_MENTIONS,
  isGiphyHost,
  type AttachedGif,
  type AttachedImage,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'

export class ReviewError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ReviewError'
  }
}

export const reviewInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
  _count: { select: { comments: true, shares: true } },
} as const
export type ReviewWithRelations = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>

export const reviewCommentInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
} as const
export type ReviewCommentWithRelations = Prisma.ReviewCommentGetPayload<{
  include: typeof reviewCommentInclude
}>

/** Conteúdo da resenha: texto (1..MAX) OU presença de anexo (gif/imagem). Devolve o texto trimado. */
function assertContentOrAttachment(content: string, hasAttachment: boolean): string {
  const trimmed = content.trim()
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    throw new ReviewError(`O texto precisa ter no máximo ${REVIEW_MAX_LENGTH} caracteres.`, 400)
  }
  if (trimmed.length === 0 && !hasAttachment) {
    throw new ReviewError('Escreva algo ou anexe um GIF ou imagem.', 400)
  }
  return trimmed
}

/** Valida que a URL do gif aponta para um host de CDN do Giphy permitido. */
function assertGifHost(gif?: AttachedGif): void {
  if (!gif) return
  let hostname = ''
  try {
    hostname = new URL(gif.url).hostname
  } catch {
    throw new ReviewError('GIF inválido.', 400)
  }
  if (!isGiphyHost(hostname)) {
    throw new ReviewError('GIF inválido.', 400)
  }
}

/** Um post/comentário aceita no máximo um anexo: gif OU imagem. */
function assertSingleAttachment(gif?: AttachedGif, image?: AttachedImage): void {
  if (gif && image) {
    throw new ReviewError('Anexe um GIF ou uma imagem, não os dois.', 400)
  }
}

/** Valida que a URL da imagem aponta para o nosso bucket público (S3_PUBLIC_BASE_URL). */
function assertImageHost(image?: AttachedImage): void {
  if (!image) return
  const cfg = s3Config()
  if (!cfg || !image.url.startsWith(`${cfg.publicBaseUrl}/`)) {
    throw new ReviewError('Imagem inválida.', 400)
  }
}

/** Resolve mentionedUserIds em {userId, name}: dedup, só ativos não-admin do mesmo setor (dentro da empresa), cap MAX_REVIEW_MENTIONS. */
async function resolveMentions(
  userIds: string[] | undefined,
  companyId: string,
  sectorId: string,
): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_REVIEW_MENTIONS)
  const users = await scopedPrisma(companyId).user.findMany({
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, sectorId },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(`${n.createdAt.toISOString()}|${n.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|', 2)
    const createdAt = new Date(iso)
    if (!id || Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<ReviewWithRelations> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId, author.sectorId)
  return scopedPrisma(input.companyId).review.create({
    data: {
      authorId: input.authorId,
      content,
      sectorId: author.sectorId,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId: input.companyId,
                sectorId: author.sectorId,
              })),
            },
          }
        : {}),
    },
    include: reviewInclude,
  })
}

export async function listFeed(
  viewerId: string,
  companyId: string,
  sectorId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: ReviewWithRelations[]; nextCursor: string | null; sharedReviewIds: Set<string> }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const where: Prisma.ReviewWhereInput = {
    sectorId,
    author: { active: true },
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  }
  const db = scopedPrisma(companyId)
  const rows = await db.review.findMany({
    where,
    include: reviewInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null
  const shares = items.length
    ? await db.reviewShare.findMany({
        where: { userId: viewerId, reviewId: { in: items.map((r) => r.id) } },
        select: { reviewId: true },
      })
    : []
  return { items, nextCursor, sharedReviewIds: new Set(shares.map((s) => s.reviewId)) }
}

export async function getReviewForViewer(
  reviewId: string,
  viewerId: string,
  companyId: string,
  sectorId: string,
): Promise<{ review: ReviewWithRelations; sharedByMe: boolean }> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUnique({ where: { id: reviewId }, include: reviewInclude })
  if (!review || review.sectorId !== sectorId) {
    throw new ReviewError('Resenha não encontrada.', 404)
  }
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId, userId: viewerId } },
    select: { id: true },
  })
  return { review, sharedByMe: Boolean(share) }
}

export async function deleteReview(input: {
  reviewId: string
  userId: string
  role: string
  companyId: string
  sectorId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!existing || existing.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
  await db.review.delete({ where: { id: input.reviewId } })
}

export async function listComments(
  reviewId: string,
  companyId: string,
  sectorId: string,
  opts: { offset: number; limit: number },
): Promise<ReviewCommentWithRelations[]> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, sectorId: true } })
  if (!review || review.sectorId !== sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  return db.reviewComment.findMany({
    where: { reviewId },
    include: reviewCommentInclude,
    orderBy: { createdAt: 'asc' },
    skip: opts.offset,
    take: opts.limit + 1,
  })
}

export async function createComment(input: {
  reviewId: string
  authorId: string
  viewerSectorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.viewerSectorId) throw new ReviewError('Resenha não encontrada.', 404)
  // Participantes anteriores (distintos) ANTES de inserir o novo comentário.
  const prior = await db.reviewComment.findMany({
    where: { reviewId: input.reviewId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId, input.viewerSectorId)
  const comment = await db.reviewComment.create({
    data: {
      reviewId: input.reviewId,
      authorId: input.authorId,
      content,
      sectorId: input.viewerSectorId,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId: input.companyId,
                sectorId: input.viewerSectorId,
              })),
            },
          }
        : {}),
    },
    include: reviewCommentInclude,
  })
  const replyRecipientIds = [...new Set(prior.map((c) => c.authorId))].filter(
    (id) => id !== input.authorId && id !== review.authorId,
  )
  return { comment, reviewAuthorId: review.authorId, replyRecipientIds }
}

export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  companyId: string
  sectorId: string
}): Promise<{ reviewId: string }> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, reviewId: true, sectorId: true },
  })
  if (!existing || existing.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir este comentário.', 403)
  }
  await db.reviewComment.delete({ where: { id: input.commentId } })
  return { reviewId: existing.reviewId }
}

function assertEmoji(emoji: string) {
  if (!(REVIEW_REACTIONS as readonly string[]).includes(emoji)) {
    throw new ReviewError('Reação inválida.', 400)
  }
}

export async function toggleReviewReaction(input: {
  reviewId: string
  userId: string
  emoji: string
  companyId: string
  sectorId: string
}): Promise<{ review: ReviewWithRelations; added: boolean; reviewAuthorId: string; sharedByMe: boolean }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewReaction.findUnique({
    where: { reviewId_userId_emoji: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji } },
  })
  let added: boolean
  if (existing) {
    await db.reviewReaction.delete({ where: { id: existing.id } })
    added = false
  } else {
    await db.reviewReaction.create({
      data: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji, sectorId: input.sectorId },
    })
    added = true
  }
  const full = await db.review.findUniqueOrThrow({ where: { id: input.reviewId }, include: reviewInclude })
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
    select: { id: true },
  })
  return { review: full, added, reviewAuthorId: review.authorId, sharedByMe: Boolean(share) }
}

export async function toggleCommentReaction(input: {
  commentId: string
  userId: string
  emoji: string
  companyId: string
  sectorId: string
}): Promise<{ comment: ReviewCommentWithRelations }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const comment = await db.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, sectorId: true },
  })
  if (!comment || comment.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  const existing = await db.reviewCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId: input.commentId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) {
    await db.reviewCommentReaction.delete({ where: { id: existing.id } })
  } else {
    await db.reviewCommentReaction.create({
      data: { commentId: input.commentId, userId: input.userId, emoji: input.emoji, sectorId: input.sectorId },
    })
  }
  const full = await db.reviewComment.findUniqueOrThrow({
    where: { id: input.commentId },
    include: reviewCommentInclude,
  })
  return { comment: full }
}

export async function shareReview(input: {
  reviewId: string
  userId: string
  companyId: string
  sectorId: string
}): Promise<{ reviewAuthorId: string; created: boolean }> {
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, sectorId: true },
  })
  if (!review || review.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
  })
  if (existing) return { reviewAuthorId: review.authorId, created: false }
  await db.reviewShare.create({ data: { reviewId: input.reviewId, userId: input.userId, sectorId: input.sectorId } })
  return { reviewAuthorId: review.authorId, created: true }
}

export async function unshareReview(input: { reviewId: string; userId: string; companyId: string }): Promise<void> {
  await scopedPrisma(input.companyId).reviewShare.deleteMany({ where: { reviewId: input.reviewId, userId: input.userId } })
}
```

- [ ] **Step 2: Substituir `apps/api/src/services/review-service.test.ts` pelo conteúdo abaixo**
  (mantém TODOS os testes de isolamento por setor do `main` e TODOS os testes de isolamento por
  empresa da branch, ajustando cada chamada às novas assinaturas)

```typescript
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { createReview, listFeed, ReviewError, createComment, deleteComment, deleteReview, listComments, toggleCommentReaction, toggleReviewReaction, shareReview, unshareReview, getReviewForViewer } from './review-service'
import { isGiphyHost } from '@legends/shared'

// s3Config() só resolve com bucket+region+publicBaseUrl definidos (ver lib/s3-client.ts).
// Forçado (não `??`) para o teste ser hermético mesmo quando o .env local tem S3 real:
// o fixture IMG abaixo precisa casar com S3_PUBLIC_BASE_URL em assertImageHost.
process.env.S3_BUCKET = 'bucket-teste'
process.env.S3_REGION = 'us-east-1'
process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
const IMG = { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 }
const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, sectorId = SECTOR) {
  return prisma.user.create({ data: { name: email.split('@')[0], email, passwordHash: 'x', sectorId } })
}

async function makeAdminActor() {
  return prisma.user.create({ data: { name: 'admin', email: `admin-${Math.random()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' } })
}

/** Cria um 2º setor (para testes de isolamento) e um usuário nele. */
async function makeUserInOtherSector(email: string) {
  const admin = await makeAdminActor()
  const sector = await createSector({ name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
  return makeUser(email, sector.id)
}

describe('review-service: createReview + listFeed', () => {
  it('cria uma resenha com conteúdo válido', async () => {
    const u = await makeUser('a@empresa.com')
    const review = await createReview({ authorId: u.id, content: '  Olá time!  ', companyId: DEFAULT_COMPANY_ID })
    expect(review.content).toBe('Olá time!')
    expect(review.author.id).toBe(u.id)
  })

  it('rejeita conteúdo vazio e acima de 280 (ReviewError 400)', async () => {
    const u = await makeUser('b@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', companyId: DEFAULT_COMPANY_ID })).rejects.toBeInstanceOf(ReviewError)
    await expect(createReview({ authorId: u.id, content: 'x'.repeat(281), companyId: DEFAULT_COMPANY_ID })).rejects.toBeInstanceOf(ReviewError)
  })

  it('pagina o feed por cursor, mais novo primeiro, sem duplicar', async () => {
    const u = await makeUser('c@empresa.com')
    for (let i = 0; i < 5; i++) await createReview({ authorId: u.id, content: `r${i}`, companyId: DEFAULT_COMPANY_ID })

    const page1 = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].content).toBe('r4')
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { cursor: page1.nextCursor!, limit: 2 })
    expect(page2.items.map((r) => r.content)).toEqual(['r2', 'r1'])

    const ids = new Set([...page1.items, ...page2.items].map((r) => r.id))
    expect(ids.size).toBe(4)
  })

  it('não inclui resenhas de autores desativados no feed', async () => {
    const active = await makeUser('active@empresa.com')
    const inactive = await prisma.user.create({
      data: { name: 'inactive', email: 'inactive@empresa.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const viewer = await makeUser('viewer@empresa.com')
    await createReview({ authorId: active.id, content: 'visível', companyId: DEFAULT_COMPANY_ID })
    // criar resenha diretamente no banco para contornar a validação de autor ativo em createReview
    await prisma.review.create({ data: { authorId: inactive.id, content: 'invisível', sectorId: SECTOR } })

    const feed = await listFeed(viewer.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).toContain('visível')
    expect(feed.items.map((r) => r.content)).not.toContain('invisível')
  })

  it('marca sharedReviewIds para o viewer', async () => {
    const u = await makeUser('d@empresa.com')
    const r = await createReview({ authorId: u.id, content: 'compartilhável', companyId: DEFAULT_COMPANY_ID })
    await prisma.reviewShare.create({ data: { reviewId: r.id, userId: u.id, sectorId: SECTOR } })
    const feed = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.sharedReviewIds.has(r.id)).toBe(true)
  })
})

describe('review-service: comentários e exclusão', () => {
  it('cria comentário e calcula destinatários de reply (distintos, sem ator nem autor da resenha)', async () => {
    const author = await makeUser('rauthor@empresa.com')
    const p1 = await makeUser('p1@empresa.com')
    const p2 = await makeUser('p2@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'thread', companyId: DEFAULT_COMPANY_ID })

    // p1 comenta (sem participantes anteriores)
    const first = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'oi', companyId: DEFAULT_COMPANY_ID })
    expect(first.reviewAuthorId).toBe(author.id)
    expect(first.replyRecipientIds).toEqual([])

    // p1 comenta de novo: participante anterior é p1 (== ator) → filtrado
    const again = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'de novo', companyId: DEFAULT_COMPANY_ID })
    expect(again.replyRecipientIds).toEqual([])

    // p2 comenta: participante anterior p1 entra; author é o autor da resenha (não duplica)
    const third = await createComment({ reviewId: review.id, authorId: p2.id, viewerSectorId: SECTOR, content: 'cheguei', companyId: DEFAULT_COMPANY_ID })
    expect(third.replyRecipientIds).toEqual([p1.id])

    // author comenta na própria resenha: participantes anteriores p1,p2; nenhum é o ator
    const byAuthor = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'valeu', companyId: DEFAULT_COMPANY_ID })
    expect(byAuthor.replyRecipientIds.sort()).toEqual([p1.id, p2.id].sort())
  })

  it('lista comentários do mais antigo ao mais novo com hasMore via take+1', async () => {
    const author = await makeUser('lc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    for (let i = 0; i < 3; i++) {
      await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: `c${i}`, companyId: DEFAULT_COMPANY_ID })
    }
    const rows = await listComments(review.id, DEFAULT_COMPANY_ID, SECTOR, { offset: 0, limit: 2 })
    expect(rows).toHaveLength(3) // take = limit + 1
    expect(rows[0].content).toBe('c0')
  })

  it('deleteReview: autor 204, terceiro 403, admin ok, inexistente 404', async () => {
    const author = await makeUser('dr@empresa.com')
    const stranger = await makeUser('str@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar', companyId: DEFAULT_COMPANY_ID })

    await expect(
      deleteReview({ reviewId: review.id, userId: stranger.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 403 })
    await deleteReview({ reviewId: review.id, userId: author.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
    await expect(
      deleteReview({ reviewId: 'nope', userId: author.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteReview: SUBADMIN também pode excluir resenha de terceiro', async () => {
    const author = await makeUser('dr-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar via subadmin', companyId: DEFAULT_COMPANY_ID })
    await deleteReview({ reviewId: review.id, userId: 'someone', role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
  })

  it('deleteComment: admin pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment: SUBADMIN também pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment retorna o reviewId do comentário removido', async () => {
    const author = await makeUser('ana-del@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'oi', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'comentário', companyId: DEFAULT_COMPANY_ID })

    const result = await deleteComment({ commentId: comment.id, userId: author.id, role: 'COLLABORATOR', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })

    expect(result.reviewId).toBe(review.id)
  })
})

describe('review-service: reações', () => {
  it('toggle de reação na resenha é idempotente (add → remove)', async () => {
    const u = await makeUser('rr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'reagir', companyId: DEFAULT_COMPANY_ID })

    const add = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(add.added).toBe(true)
    expect(add.review.reactions).toHaveLength(1)

    const remove = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(remove.added).toBe(false)
    expect(remove.review.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora do conjunto (400)', async () => {
    const u = await makeUser('rrx@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '🍕', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('toggle de reação no comentário funciona', async () => {
    const u = await makeUser('cr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: u.id, viewerSectorId: SECTOR, content: 'c', companyId: DEFAULT_COMPANY_ID })
    const res = await toggleCommentReaction({ commentId: comment.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(res.comment.reactions).toHaveLength(1)
  })
})

describe('review-service: compartilhamento', () => {
  it('compartilha (idempotente) e descompartilha', async () => {
    const author = await makeUser('sa@empresa.com')
    const sharer = await makeUser('sh@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'mural!', companyId: DEFAULT_COMPANY_ID })

    const first = await shareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(first.created).toBe(true)
    expect(first.reviewAuthorId).toBe(author.id)

    const again = await shareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(again.created).toBe(false)
    expect(await prisma.reviewShare.count()).toBe(1)

    await unshareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.reviewShare.count()).toBe(0)
  })

  it('404 ao compartilhar resenha inexistente', async () => {
    const u = await makeUser('s404@empresa.com')
    await expect(
      shareReview({ reviewId: 'nope', userId: u.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('review-service: menções', () => {
  it('grava menções (dedup, ativos não-admin, cap 10) e o DTO as inclui', async () => {
    const author = await makeUser('m-author@empresa.com')
    const a = await makeUser('m-a@empresa.com')
    const b = await makeUser('m-b@empresa.com')
    const inativo = await prisma.user.create({
      data: { name: 'Inativo', email: 'm-inativo@empresa.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'm-admin@empresa.com', passwordHash: 'x', role: 'ADMIN', sectorId: SECTOR },
    })

    const review = await createReview({
      authorId: author.id,
      content: `oi @${a.name} @${b.name}`,
      mentionedUserIds: [a.id, a.id, b.id, inativo.id, admin.id, 'inexistente'],
      companyId: DEFAULT_COMPANY_ID,
    })
    // dedup + filtro: só a e b
    expect(review.mentions.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort())
    expect(review.mentions.find((m) => m.userId === a.id)?.name).toBe(a.name)
  })

  it('cap de 10 menções', async () => {
    const author = await makeUser('m-cap@empresa.com')
    const users = []
    for (let i = 0; i < 12; i++) users.push(await makeUser(`m-cap-${i}@empresa.com`))
    const review = await createReview({
      authorId: author.id,
      content: 'muitos',
      mentionedUserIds: users.map((u) => u.id),
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.mentions).toHaveLength(10)
  })

  it('comentário também grava menções no DTO', async () => {
    const author = await makeUser('mc-author@empresa.com')
    const alvo = await makeUser('mc-alvo@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: `e aí @${alvo.name}`,
      mentionedUserIds: [alvo.id],
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(comment.mentions.map((m) => m.userId)).toEqual([alvo.id])
  })

  it('não permite mencionar alguém de outro setor', async () => {
    const author = await makeUser('m-cross-author@empresa.com')
    const outro = await makeUserInOtherSector('m-cross-outro@empresa.com')
    const review = await createReview({
      authorId: author.id,
      content: `oi @${outro.name}`,
      mentionedUserIds: [outro.id],
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.mentions).toHaveLength(0)
  })

  it('menção criada em resenha de empresa não-default herda o companyId real (não o default do banco)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Empresa Nao Default Mencao', slug: 'empresa-nao-default-mencao-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorEmpresaNaoDefault', email: 'autor-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const mentioned = await prisma.user.create({
      data: { name: 'MencionadoEmpresaNaoDefault', email: 'mencionado-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await createReview({
      authorId: author.id,
      content: 'oi @mencionado',
      mentionedUserIds: [mentioned.id],
      companyId: otherCompany.id,
    })
    const mention = await prisma.reviewMention.findFirstOrThrow({ where: { reviewId: review.id } })
    expect(mention.companyId).toBe(otherCompany.id)
  })

  it('menção criada em comentário de empresa não-default herda o companyId real', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Empresa Nao Default Mencao Comentario', slug: 'empresa-nao-default-mencao-comentario-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorComentarioEmpresaNaoDefault', email: 'autor-comentario-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const mentioned = await prisma.user.create({
      data: { name: 'MencionadoComentarioEmpresaNaoDefault', email: 'mencionado-comentario-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await createReview({ authorId: author.id, content: 'r', companyId: otherCompany.id })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: author.sectorId,
      content: 'e aí @mencionado',
      mentionedUserIds: [mentioned.id],
      companyId: otherCompany.id,
    })
    const mention = await prisma.reviewCommentMention.findFirstOrThrow({ where: { commentId: comment.id } })
    expect(mention.companyId).toBe(otherCompany.id)
  })
})

describe('review-service: gif', () => {
  it('cria resenha com gif (texto + gif)', async () => {
    const u = await makeUser('gif1@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: 'olha esse',
      gif: { url: 'https://media.giphy.com/x.gif', width: 100, height: 80 },
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.gifUrl).toBe('https://media.giphy.com/x.gif')
    expect(review.gifWidth).toBe(100)
    expect(review.gifHeight).toBe(80)
  })

  it('cria resenha só com gif (sem texto)', async () => {
    const u = await makeUser('gif2@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: '',
      gif: { url: 'https://media.giphy.com/y.gif', width: 1, height: 1 },
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.content).toBe('')
    expect(review.gifUrl).toBe('https://media.giphy.com/y.gif')
  })

  it('rejeita vazio sem gif (400)', async () => {
    const u = await makeUser('gif3@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita gif de host fora da allowlist (400)', async () => {
    const u = await makeUser('gif4@empresa.com')
    await expect(
      createReview({
        authorId: u.id,
        content: 'x',
        gif: { url: 'https://evil.example/z.gif', width: 1, height: 1 },
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(isGiphyHost('media.giphy.com')).toBe(true)
  })

  it('cria comentário só com gif (sem texto)', async () => {
    const author = await makeUser('gif-comment@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const result = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: '',
      gif: { url: 'https://media.giphy.com/c.gif', width: 50, height: 40 },
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(result.comment.gifUrl).toBe('https://media.giphy.com/c.gif')
    expect(result.comment.gifWidth).toBe(50)
    expect(result.comment.gifHeight).toBe(40)
  })
})

describe('review-service: imagem anexada', () => {
  it('persiste a imagem na resenha', async () => {
    const u = await makeUser('img1@empresa.com')
    const review = await createReview({ authorId: u.id, content: '', image: IMG, companyId: DEFAULT_COMPANY_ID })
    expect(review.imageUrl).toBe(IMG.url)
    expect(review.imageWidth).toBe(100)
    expect(review.imageHeight).toBe(80)
  })

  it('aceita só imagem, sem texto', async () => {
    const u = await makeUser('img2@empresa.com')
    await expect(
      createReview({ authorId: u.id, content: '   ', image: IMG, companyId: DEFAULT_COMPANY_ID }),
    ).resolves.toBeTruthy()
  })

  it('rejeita imagem e gif juntos (400)', async () => {
    const u = await makeUser('img3@empresa.com')
    const gif = { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', gif, image: IMG, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('rejeita imagem de host fora do bucket (400)', async () => {
    const u = await makeUser('img4@empresa.com')
    const evil = { url: 'https://evil.com/x.png', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', image: evil, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('persiste imagem no comentário', async () => {
    const author = await makeUser('img5@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'post', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: '', image: IMG, companyId: DEFAULT_COMPANY_ID })
    expect(comment.imageUrl).toBe(IMG.url)
  })
})

describe('review-service: getReviewForViewer escopado por empresa', () => {
  it('lança erro pra resenha de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review', slug: 'outra-empresa-review-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaReview', email: 'autor-outra-empresa-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    const viewer = await makeUser('viewer-review-empresa@x.com')

    await expect(getReviewForViewer(review.id, viewer.id, DEFAULT_COMPANY_ID, SECTOR)).rejects.toThrow()
  })
})

describe('resolveMentions escopado por empresa (via createReview)', () => {
  it('não inclui menção a usuário de outra empresa mesmo que o id seja passado', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mencao', slug: 'outra-empresa-mencao-test' } })
    const author = await makeUser('autor-mencao-empresa@x.com')
    const outsider = await prisma.user.create({
      data: { name: 'ForaMencao', email: 'fora-mencao@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })

    const review = await createReview({
      authorId: author.id,
      content: 'tentando mencionar alguém de outra empresa',
      mentionedUserIds: [outsider.id],
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(review.mentions).toHaveLength(0)
  })
})

describe('mutações de resenha escopadas por empresa', () => {
  it('deleteReview/toggleReviewReaction/shareReview/createComment tratam resenha de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review Mutacao', slug: 'outra-empresa-review-mutacao-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMutacao', email: 'autor-outra-empresa-mutacao@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    const actor = await makeUser('ator-mutacao-empresa@x.com')

    await expect(
      deleteReview({ reviewId: review.id, userId: actor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: actor.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: actor.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: actor.id, viewerSectorId: SECTOR, content: 'comentário', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('review-service: isolamento por setor', () => {
  it('listFeed não retorna resenha de outro setor', async () => {
    const viewer = await makeUser('iso-viewer@empresa.com')
    const outro = await makeUserInOtherSector('iso-outro@empresa.com')
    await createReview({ authorId: outro.id, content: 'resenha de outro setor', companyId: DEFAULT_COMPANY_ID })
    const feed = await listFeed(viewer.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).not.toContain('resenha de outro setor')
  })

  it('getReviewForViewer/deleteReview/comentar/reagir/compartilhar em resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-author@empresa.com')
    const viewer = await makeUser('iso-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'privada do outro setor', companyId: DEFAULT_COMPANY_ID })

    await expect(getReviewForViewer(review.id, viewer.id, DEFAULT_COMPANY_ID, SECTOR)).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteReview({ reviewId: review.id, userId: viewer.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: viewer.id, viewerSectorId: SECTOR, content: 'oi', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: viewer.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: viewer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(listComments(review.id, DEFAULT_COMPANY_ID, SECTOR, { offset: 0, limit: 10 })).rejects.toMatchObject({ status: 404 })
  })

  it('deleteComment/toggleCommentReaction em comentário de resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-c-author@empresa.com')
    const viewer = await makeUser('iso-c-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: outroAuthor.id,
      viewerSectorId: outroAuthor.sectorId,
      content: 'c',
      companyId: DEFAULT_COMPANY_ID,
    })

    await expect(
      deleteComment({ commentId: comment.id, userId: viewer.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleCommentReaction({ commentId: comment.id, userId: viewer.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 3: Rodar os testes deste arquivo**

```bash
pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts
```

Expected: todos os testes passam (banco `legends_test` já de pé via `pnpm db:up` +
`test/global-setup.ts`).

---

### Task 4: `routes/review.ts`

**Files:**
- Modify: `apps/api/src/routes/review.ts` (resolve conflito de merge — só chama as funções da
  Task 3 com as assinaturas novas; nenhuma rota nova, nenhum schema Zod novo)

**Interfaces:**
- Consumes: as 11 funções de `review-service.ts` da Task 3;
  `notifyReviewComment`/`notifyReviewCommentReply`/`notifyReviewMention`/`notifyReviewReaction`/`notifyReviewShared`
  de `notification-service.ts` (assinatura `(payload, companyId)` — já é assim na branch, esse
  arquivo não tem conflito de merge porque só a branch o modificou).

- [ ] **Step 1: Substituir `apps/api/src/routes/review.ts` pelo conteúdo abaixo**

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REVIEW_MAX_LENGTH, REVIEW_REACTIONS, MAX_REVIEW_MENTIONS } from '@legends/shared'
import {
  ReviewError,
  createComment,
  createReview,
  deleteComment,
  deleteReview,
  getReviewForViewer,
  listComments,
  listFeed,
  shareReview,
  toggleCommentReaction,
  toggleReviewReaction,
  unshareReview,
} from '../services/review-service'
import {
  notifyReviewComment,
  notifyReviewCommentReply,
  notifyReviewMention,
  notifyReviewReaction,
  notifyReviewShared,
} from '../services/notification-service'
import { toReviewCommentDTO, toReviewDTO } from '../lib/serialize'
import { reviewHub } from '../lib/review-hub'

/** Limite do feed: default 20, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined, fallback = 20): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), 50)
}

const gifSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const contentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif || v.image, {
    message: 'Escreva algo ou anexe um GIF ou imagem.',
  })
const reactionSchema = z.object({ emoji: z.enum(REVIEW_REACTIONS) })
const invalidContent = { message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou anexe um GIF ou imagem.` }

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    try {
      const { items, nextCursor, sharedReviewIds } = await listFeed(
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
        {
          cursor: query.cursor,
          limit: clampLimit(query.limit),
        },
      )
      return reply.send({
        items: items.map((r) => toReviewDTO(r, request.user.sub, sharedReviewIds.has(r.id))),
        nextCursor,
      })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidContent, issues: parsed.error.flatten() })
    try {
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewMention({
          recipientIds: review.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: review.id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(201).send({ review: toReviewDTO(review, request.user.sub, false) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteReview({
        reviewId: id,
        userId: request.user.sub,
        role: request.user.role,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/reactions/toggle', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { review, added, reviewAuthorId, sharedByMe } = await toggleReviewReaction({
        reviewId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      if (added) {
        try {
          await notifyReviewReaction({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { reviewAuthorId, created } = await shareReview({
        reviewId: id,
        userId: request.user.sub,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      if (created) {
        try {
          await notifyReviewShared({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      const { review, sharedByMe } = await getReviewForViewer(
        id,
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
      )
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await unshareReview({ reviewId: id, userId: request.user.sub, companyId: request.user.companyId })
      const { review, sharedByMe } = await getReviewForViewer(
        id,
        request.user.sub,
        request.user.companyId,
        request.user.sectorId,
      )
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit, 10)
    const offset = Math.max(0, Number(query.offset) || 0)
    try {
      const rows = await listComments(id, request.user.companyId, request.user.sectorId, { offset, limit })
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return reply.send({ items: page.map((c) => toReviewCommentDTO(c, request.user.sub)), hasMore })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidContent, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { comment, reviewAuthorId, replyRecipientIds } = await createComment({
        reviewId: id,
        authorId: request.user.sub,
        viewerSectorId: request.user.sectorId,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewComment({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'comments:changed', reviewId: id })
      return reply.code(201).send({ comment: toReviewCommentDTO(comment, request.user.sub) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/comments/:commentId', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    try {
      const { reviewId } = await deleteComment({
        commentId,
        userId: request.user.sub,
        role: request.user.role,
        companyId: request.user.companyId,
        sectorId: request.user.sectorId,
      })
      reviewHub.broadcast({ type: 'comments:changed', reviewId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post(
    '/reviews/comments/:commentId/reactions/toggle',
    { onRequest: [app.authenticate, app.requireFeature('resenha')] },
    async (request, reply) => {
      const parsed = reactionSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
      const { commentId } = request.params as { commentId: string }
      try {
        const { comment } = await toggleCommentReaction({
          commentId,
          userId: request.user.sub,
          emoji: parsed.data.emoji,
          companyId: request.user.companyId,
          sectorId: request.user.sectorId,
        })
        reviewHub.broadcast({ type: 'comments:changed', reviewId: comment.reviewId })
        return reply.send({ comment: toReviewCommentDTO(comment, request.user.sub) })
      } catch (err) {
        if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
}
```

- [ ] **Step 2: Verificar tipos e testes de rota**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/api exec vitest run src/routes/review.test.ts
```

Expected: sem erros de tipo; testes de rota passam (o arquivo de teste de rota não está na lista
de conflito — ele já chama a API HTTP, não as funções internamente, então não muda).

---

### Task 5: `mural-service.ts` + `mural-service.test.ts` (inclui o fix do gap de `UserBadge`)

**Files:**
- Modify: `apps/api/src/services/mural-service.ts` (resolve conflito de merge)
- Modify: `apps/api/src/services/mural-service.test.ts` (resolve conflito de merge)

**Interfaces:**
- Produces: `getMuralItems(viewerId: string, viewerSectorId: string, now?: Date): Promise<MuralItemDTO[]>`
  (assinatura de `main`, preservada — `routes/mural.ts` já chama assim e não tem conflito de
  merge, então não muda).

**Decisão de reconciliação**: `Feedback`/`MoodEntry`/`ReviewShare` continuam com o join manual de
`sectorId` que `main` já tem (`target.sectorId`/`user.sectorId`/`review.author.sectorId`), agora
todos usando `scopedPrisma(viewer.companyId)` como client em vez de `prisma` cru. `UserBadge`
também migra de `prisma.userBadge.findMany` para `scopedPrisma(viewer.companyId).userBadge.findMany`
— é o gap confirmado na investigação (nenhuma fatia anterior de multi-tenancy tinha tocado essa
query).

- [ ] **Step 1: Substituir `apps/api/src/services/mural-service.ts` pelo conteúdo abaixo**

```typescript
import { PUBLIC_FEEDBACK_CATEGORIES, type MuralItemDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { feedbackInclude } from './feedback-service'
import { reviewInclude } from './review-service'
import { toMuralFeedbackItem, toMuralBadgeItem, toMuralMoodItem, toMuralReviewItem } from '../lib/serialize'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export async function getMuralItems(
  viewerId: string,
  viewerSectorId: string,
  now: Date = new Date(),
): Promise<MuralItemDTO[]> {
  const since = new Date(now.getTime() - WINDOW_MS)
  // Avisos de humor têm vida útil de um dia: filtramos pela data civil de hoje (America/Sao_Paulo),
  // então na virada do dia eles somem sozinhos e reaparecem se a pessoa responder de novo.
  const { day: today } = todayInSaoPaulo()
  // viewerId vem sempre de request.user.sub (JWT já validado) — sempre existe.
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, select: { companyId: true } })

  const [feedbacks, badges, moods, reviewShares] = await Promise.all([
    scopedPrisma(viewer.companyId).feedback.findMany({
      where: {
        sharedAt: { gte: since },
        category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] },
        target: { active: true, sectorId: viewerSectorId },
      },
      include: { ...feedbackInclude, target: true },
      orderBy: { sharedAt: 'desc' },
    }),
    scopedPrisma(viewer.companyId).userBadge.findMany({
      where: { awardedAt: { gte: since }, user: { active: true, sectorId: viewerSectorId } },
      include: { user: true, badge: true },
      orderBy: { awardedAt: 'desc' },
    }),
    scopedPrisma(viewer.companyId).moodEntry.findMany({
      where: { day: today, user: { active: true, sectorId: viewerSectorId } },
      select: { id: true, createdAt: true, user: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Shares (mais recentes primeiro) das resenhas de autores ativos do mesmo setor, na janela.
    scopedPrisma(viewer.companyId).reviewShare.findMany({
      where: { createdAt: { gte: since }, review: { author: { active: true, sectorId: viewerSectorId } } },
      include: { user: true, review: { include: reviewInclude } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Dedup por resenha: a 1ª ocorrência (ordem desc) é o share mais recente; agrega os sharers.
  const byReview = new Map<
    string,
    { review: (typeof reviewShares)[number]['review']; sharers: (typeof reviewShares)[number]['user'][]; latestShareAt: Date }
  >()
  for (const share of reviewShares) {
    const entry = byReview.get(share.reviewId)
    if (entry) {
      entry.sharers.push(share.user)
    } else {
      byReview.set(share.reviewId, { review: share.review, sharers: [share.user], latestShareAt: share.createdAt })
    }
  }

  const items: MuralItemDTO[] = [
    ...feedbacks.map((f) => toMuralFeedbackItem(f, viewerId)),
    ...badges.map((b) => toMuralBadgeItem(b)),
    ...moods.map((m) => toMuralMoodItem(m)),
    ...[...byReview.values()].map((r) => toMuralReviewItem(r)),
  ]
  return items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}
```

- [ ] **Step 2: Substituir `apps/api/src/services/mural-service.test.ts` pelo conteúdo abaixo**
  (mantém os testes de isolamento por setor do `main` + os de isolamento por empresa da branch, e
  adiciona a cobertura do gap de `UserBadge` sem `companyId`)

```typescript
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { getMuralItems } from './mural-service'
import { todayInSaoPaulo, addDays, dayFromYmd } from '../lib/sao-paulo-date'

const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, sectorId = SECTOR) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x', sectorId } })
}

async function makeUserInOtherSector(email: string) {
  const admin = await prisma.user.create({
    data: { name: 'admin', email: `admin-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const sector = await createSector({ name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
  return makeUser(email, sector.id)
}

describe('getMuralItems', () => {
  it('inclui feedback público compartilhado dentro de 7d e exclui não compartilhado', async () => {
    const author = await makeUser('m-author@x.com')
    const target = await makeUser('m-target@x.com')
    const shared = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback compartilhado específico', category: 'POSITIVO', sharedAt: new Date() },
    })
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback não compartilhado aqui', category: 'POSITIVO' },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    const fbItems = items.filter((i) => i.type === 'feedback')
    expect(fbItems.map((i) => i.id)).toContain(shared.id)
    expect(fbItems).toHaveLength(1)
  })

  it('exclui feedback compartilhado há mais de 7 dias', async () => {
    const author = await makeUser('m-old-author@x.com')
    const target = await makeUser('m-old-target@x.com')
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback antigo demais aqui', category: 'POSITIVO', sharedAt: old },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
  })

  it('exclui feedback compartilhado de alvo desativado', async () => {
    const author = await makeUser('m-inactive-author@x.com')
    const target = await prisma.user.create({
      data: { name: 'inativo', email: 'm-inactive-target@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback de alvo desativado', category: 'POSITIVO', sharedAt: new Date() },
    })
    const items = await getMuralItems(author.id, author.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
  })

  it('exclui selo de usuário desativado', async () => {
    const user = await prisma.user.create({
      data: { name: 'inativo', email: 'm-inactive-badge@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-inativo', name: 'Selo Inativo', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: user.id, badgeId: badge.id } })
    const items = await getMuralItems(user.id, user.sectorId)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
  })

  it('ordena por timestamp desc (mais recente primeiro)', async () => {
    const author = await makeUser('m-ord-author@x.com')
    const target = await makeUser('m-ord-target@x.com')
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    const a = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais antigo do par', category: 'POSITIVO', sharedAt: older },
    })
    const b = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais recente do par', category: 'ELOGIO', sharedAt: newer },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    const ids = items.filter((i) => i.type === 'feedback').map((i) => i.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
  })

  it('inclui aviso de quem respondeu ao humor hoje (sem expor o humor)', async () => {
    const responder = await makeUser('m-mood-today@x.com')
    const { day } = todayInSaoPaulo()
    const entry = await prisma.moodEntry.create({
      data: { userId: responder.id, day, mood: 'GREAT', note: 'segredo' },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    const moodItems = items.filter((i) => i.type === 'mood')
    expect(moodItems).toHaveLength(1)
    expect(moodItems[0].id).toBe(entry.id)
    expect(moodItems[0].user.id).toBe(responder.id)
    // O humor e a nota nunca aparecem no item do mural.
    expect(JSON.stringify(moodItems[0])).not.toContain('GREAT')
    expect(JSON.stringify(moodItems[0])).not.toContain('segredo')
  })

  it('exclui aviso de humor registrado em dias anteriores', async () => {
    const responder = await makeUser('m-mood-old@x.com')
    const { ymd } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responder.id, day: dayFromYmd(addDays(ymd, -1)), mood: 'GOOD', note: null },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('exclui aviso de humor de usuário desativado', async () => {
    const responder = await prisma.user.create({
      data: { name: 'inativo', email: 'm-mood-inactive@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responder.id, day, mood: 'NEUTRAL', note: null },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('não mostra feedback, selo, aviso de humor e resenha compartilhada de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural', slug: 'outra-empresa-mural-test' } })
    const authorOutraEmpresa = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMural', email: 'autor-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const targetOutraEmpresa = await prisma.user.create({
      data: { name: 'AlvoOutraEmpresaMural', email: 'alvo-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await prisma.feedback.create({
      data: {
        authorId: authorOutraEmpresa.id,
        targetId: targetOutraEmpresa.id,
        message: 'feedback compartilhado de outra empresa',
        category: 'POSITIVO',
        sharedAt: new Date(),
        companyId: otherCompany.id,
      },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-outra-empresa', name: 'Selo Outra Empresa', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: targetOutraEmpresa.id, badgeId: badge.id, companyId: otherCompany.id } })
    const viewer = await makeUser('m-viewer-empresa-padrao@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
  })

  it('não mostra aviso de humor de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural Mood', slug: 'outra-empresa-mural-mood-test' } })
    const responderOutraEmpresa = await prisma.user.create({
      data: { name: 'ResponderOutraEmpresaMural', email: 'responder-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responderOutraEmpresa.id, day, mood: 'GREAT', note: null, companyId: otherCompany.id },
    })
    const viewer = await makeUser('m-viewer-empresa-padrao-mood@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('não mostra resenha compartilhada de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural Review', slug: 'outra-empresa-mural-review-test' } })
    const authorOutraEmpresa = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMuralReview', email: 'autor-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const sharerOutraEmpresa = await prisma.user.create({
      data: { name: 'SharerOutraEmpresaMuralReview', email: 'sharer-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: authorOutraEmpresa.id, content: 'resenha de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    await prisma.reviewShare.create({
      data: { reviewId: review.id, userId: sharerOutraEmpresa.id, companyId: otherCompany.id, sectorId: SECTOR },
    })
    const viewer = await makeUser('m-viewer-empresa-padrao-review@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
  })

  it('isolamento por setor: feedback, badge, mood e review share de outro setor não aparecem', async () => {
    const viewer = await makeUser('m-iso-viewer@x.com')
    const outroAuthor = await makeUserInOtherSector('m-iso-author@x.com')
    const outroTarget = await makeUserInOtherSector('m-iso-target@x.com')

    await prisma.feedback.create({
      data: { authorId: outroAuthor.id, targetId: outroTarget.id, message: 'feedback de outro setor', category: 'POSITIVO', sharedAt: new Date() },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-outro-setor', name: 'Selo Outro Setor', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: outroTarget.id, badgeId: badge.id } })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({ data: { userId: outroTarget.id, day, mood: 'GOOD', note: null } })
    const outroReview = await prisma.review.create({ data: { authorId: outroAuthor.id, content: 'resenha de outro setor', sectorId: outroAuthor.sectorId } })
    await prisma.reviewShare.create({ data: { reviewId: outroReview.id, userId: outroTarget.id, sectorId: outroAuthor.sectorId } })

    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Rodar os testes deste arquivo**

```bash
pnpm --filter @legends/api exec vitest run src/services/mural-service.test.ts
```

Expected: todos os testes passam, incluindo o novo caso de `UserBadge` de outra empresa.

---

### Task 6: `serialize.ts` + `packages/shared/src/auth.ts` (`PublicUser`) + call-sites de `toPublicUser`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (resolve conflito de merge)
- Modify: `packages/shared/src/auth.ts` (resolve conflito de merge)
- Modify: `apps/api/src/routes/auth.ts` (SEM conflito de merge — o git resolve sozinho — mas os 4
  call-sites de `toPublicUser` ali quebram de tipo depois do Step 1/2 e precisam de ajuste)
- Modify: `apps/api/src/routes/profile.ts` (idem: sem conflito de merge, 1 call-site pra ajustar)
- Modify: `apps/api/src/routes/users.ts` (já é um dos 9 com conflito — Task 7 cuida do resto do
  arquivo; aqui só o `toPublicUser` do bloco de showcase)

**Interfaces:**
- Produces: `toPublicUser(user: User, sectorFeatures?: string[], opts?: { sectorName?: string; companyName?: string | null }): PublicUser`
  — troca o 3º parâmetro posicional (que era `sectorName: string` no `main` OU
  `companyName: string | null` na branch, mesma posição, propósitos incompatíveis) por um objeto
  de opções que carrega os dois.

- [ ] **Step 1: Resolver o conflito em `packages/shared/src/auth.ts`** — `PublicUser` ganha os
  dois campos, um do `main` e um da branch, sem posição compartilhada:

```typescript
export interface PublicUser {
  id: string
  name: string
  email: string | null
  role: UserRole
  area: Area | null
  position: string | null
  squad: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  active: boolean
  joinedAt: string
  leftAt: string | null
  sectorId: string
  /** Nome do setor — resolvido só onde relevante (showcase, perfil); ausente nos demais DTOs. */
  sectorName?: string
  companyId: string
  /** Nome da empresa — só preenchido pelas rotas que alimentam o AuthContext (login/registro/me); demais DTOs trazem null. */
  companyName: string | null
  enabledFeatures: FeatureKey[]
  /** Features efetivas do SETOR do usuário (vazio para DTOs de "outro usuário" onde isso não é necessário). */
  sectorFeatures: FeatureKey[]
}
```

(o resto do arquivo — `AdminUserDTO`, `LoginRequest`, `RegisterRequest`, `AuthResponse`,
`RefreshResponse` — não muda.)

- [ ] **Step 2: Resolver o conflito em `apps/api/src/lib/serialize.ts` — assinatura de `toPublicUser`**

```typescript
export function toPublicUser(
  user: User,
  sectorFeatures: string[] = [],
  opts: { sectorName?: string; companyName?: string | null } = {},
): PublicUser {
  return {
    id: user.id,
    name: user.name,
    // E-mail é ocultado para ex-lendas (quem já saiu do time).
    email: user.leftAt ? null : user.email,
    role: user.role,
    area: user.area,
    position: user.position,
    squad: user.squad,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
    active: user.active,
    joinedAt: user.joinedAt.toISOString(),
    leftAt: user.leftAt ? user.leftAt.toISOString() : null,
    sectorId: user.sectorId,
    sectorName: opts.sectorName,
    companyId: user.companyId,
    companyName: opts.companyName ?? null,
    enabledFeatures: Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as FeatureKey[]) : [],
    sectorFeatures: sectorFeatures as FeatureKey[],
  }
}
```

Nenhum outro trecho de `serialize.ts` muda — todos os outros ~11 call-sites de `toPublicUser`
dentro do próprio arquivo (`toAdminUser`, `toVoteDTO`, `toFeedbackDTO`, etc.) já chamam com 1
argumento só, então continuam válidos sem alteração.

- [ ] **Step 3: Ajustar os 4 call-sites em `apps/api/src/routes/auth.ts`** (arquivo sem conflito
  de merge — o git já resolveu sozinho preservando `companyNameFor` da branch e
  `import { sectorFeaturesFor } from '../lib/sector-features'` do `main`; só os 4 usos de
  `toPublicUser` precisam do novo formato de opções)

Troque cada uma das 4 ocorrências de `toPublicUser(user, sectorFeatures, await companyNameFor(user.companyId))`
(ou a variante com `await sectorFeaturesFor(user.sectorId)` no lugar de `sectorFeatures`) por:

```typescript
toPublicUser(user, sectorFeatures, { companyName: await companyNameFor(user.companyId) })
```

e

```typescript
toPublicUser(user, await sectorFeaturesFor(user.sectorId), { companyName: await companyNameFor(user.companyId) })
```

respectivamente (mesmas duas variantes que já existiam, só embrulhando o último argumento).

- [ ] **Step 4: Ajustar o call-site em `apps/api/src/routes/profile.ts`** (arquivo sem conflito
  de merge — o git preservou corretamente a lógica combinada de `sectorFeaturesFor`/`votingEnabled`
  do `main` com os guards `findUserInCompany` da branch; só o `toPublicUser` quebra de tipo)

Em `GET /users/:id/profile`, troque:

```typescript
user: toPublicUser(profile.user, [], sectorName),
```

por:

```typescript
user: toPublicUser(profile.user, [], { sectorName }),
```

- [ ] **Step 5: Verificar tipos**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts src/routes/profile.test.ts
```

Expected: sem erros de tipo (o restante dos call-sites de `toPublicUser` — `super-admin.ts`,
`third-party-invites.ts`, `users.ts` fora do showcase — já usa 0 ou 1 argumento, compatível com o
default `{}`); testes passam. Não rode `pnpm test` completo ainda — isso é a Task 9.

---

### Task 7: `routes/users.ts` + `routes/highlights.ts`

**Files:**
- Modify: `apps/api/src/routes/users.ts` (resolve conflito de merge)
- Modify: `apps/api/src/routes/highlights.ts` (resolve conflito de merge)

**Interfaces:**
- Consumes: `listShowcase(opts: { former?, sectorId?, companyId? })` de `profile-service.ts`
  (não tem conflito de merge — só a branch mudou esse arquivo, adicionando `companyId` sem tocar
  no `sectorId` que já existia); `listPublishedHighlights(companyId?, sectorId?)` de
  `highlight-service.ts` (idem, sem conflito — auto-merge já combina os dois filtros).

- [ ] **Step 1: Substituir `apps/api/src/routes/users.ts` pelo conteúdo abaixo** — mantém a
  seleção de setor do `main` (`?sectorId=`, `all`, trava pra `THIRD_PARTY`) inalterada e só soma
  `companyId: request.user.companyId` na chamada de `listShowcase`, além de embrulhar o
  `toPublicUser` no novo formato de opções (Task 6):

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { listShowcase } from '../services/profile-service'
import { sectorNamesFor } from '../lib/sector-features'
import { toAwardedBadgeDTO, toPublicUser } from '../lib/serialize'

const showcaseQuerySchema = z.object({ former: z.string().optional(), sectorId: z.string().optional() })

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { onRequest: [app.authenticate] }, async (request, reply) => {
    const users = await prisma.user.findMany({
      // Time: colegas do mesmo setor, menos admins. Inclui lideranças (LEAD), que fazem parte do
      // time e têm perfil, mas não recebem votos (filtradas na tela de votação).
      where: {
        active: true,
        role: { notIn: ['ADMIN', 'SUBADMIN'] },
        id: { not: request.user.sub },
        sectorId: request.user.sectorId,
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map((u) => toPublicUser(u)) })
  })

  // Galeria de conquistas: devs ativos com reconhecimentos e selos agregados.
  // Com ?former=1 (ou true), retorna ex-lendas em vez dos ativos.
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/users/showcase', { onRequest: [app.authenticate, app.requireFeature('lendas')] }, async (request, reply) => {
    const parsed = showcaseQuerySchema.safeParse(request.query)
    const former = parsed.success ? parsed.data.former : undefined
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId,
      companyId: request.user.companyId,
    })
    const sectorNames = await sectorNamesFor(rows.map((row) => row.user.sectorId))
    return reply.send({
      entries: rows.map((row) => ({
        user: toPublicUser(row.user, [], { sectorName: sectorNames.get(row.user.sectorId) ?? '' }),
        recognitions: row.recognitions,
        badges: row.badges.map(toAwardedBadgeDTO),
      })),
    })
  })
}
```

Nota: `where.sectorId: request.user.sectorId` em `GET /users` continua usando só `sectorId`, sem
`scopedPrisma`/`companyId` — isso NÃO é um esquecimento: `sectorId` já é um cuid único emitido por
uma única empresa (o `Sector` em si é `companyId`-scoped), então filtrar por um `sectorId` exato
já restringe implicitamente à empresa correta, sem precisar de filtro explícito extra. É o mesmo
raciocínio que a branch já aplica em outros pontos do código que filtram por um `sectorId` exato
vindo do JWT do próprio usuário.

- [ ] **Step 2: Resolver `apps/api/src/routes/highlights.ts`** — mantém a seleção de setor do
  `main` e chama `listPublishedHighlights` com `companyId` primeiro, `sectorId` depois (assinatura
  já reconciliada em `highlight-service.ts`, sem conflito de merge):

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listPublishedHighlights } from '../services/highlight-service'
import { toHighlightDTO } from '../lib/serialize'

const highlightsQuerySchema = z.object({ sectorId: z.string().optional() })

export async function highlightRoutes(app: FastifyInstance) {
  // Com ?sectorId=<id>, mostra outro setor (padrão: o próprio); ?sectorId=all mostra todos.
  // THIRD_PARTY nunca escolhe: o parâmetro é ignorado, sempre vê o próprio setor.
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (request, reply) => {
    const parsed = highlightsQuerySchema.safeParse(request.query)
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const entries = await listPublishedHighlights(request.user.companyId, sectorId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })
}
```

- [ ] **Step 3: Verificar**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/api exec vitest run src/routes/users.test.ts src/routes/highlights.test.ts
```

Expected: sem erros; testes passam.

---

### Task 8: Verificar os arquivos que o git já auto-mergeou (sem edição — só conferência)

**Files:**
- Verify (sem editar, salvo achado): `apps/api/src/app.ts`, `apps/api/src/lib/office-hub.ts`,
  `apps/api/src/routes/profile.ts` (já ajustado na Task 6), `apps/api/src/routes/profile.test.ts`.

Estes 4 arquivos (mais `routes/auth.ts`, já coberto na Task 6) fizeram parte do levantamento
inicial de "arquivos que colidem", mas o merge automático do git já produz o resultado correto —
confirmado lendo o conteúdo pós-merge nas SHAs investigadas. Esta task é só uma dupla-checagem
antes de seguir pro commit final.

- [ ] **Step 1: Conferir `apps/api/src/app.ts`** — os dois registros aditivos devem estar
  presentes: `sectorRoutes` (do `main`, `GET /sectors`) e `superAdminRoutes` +
  `requireSuperAdmin` (da branch).

```bash
grep -n "sectorRoutes\|superAdminRoutes\|requireSuperAdmin" apps/api/src/app.ts
```

Expected: 5 ocorrências — import + `app.register(sectorRoutes)`; import + `app.register(superAdminRoutes)`
+ `app.decorate('requireSuperAdmin', ...)`. Se alguma faltar, adicione manualmente seguindo o
padrão dos registros vizinhos (aditivo, sem lógica cruzada).

- [ ] **Step 2: Conferir `apps/api/src/lib/office-hub.ts`** — o método privado
  `roomLockOwnerId` (do `main`, usa `claimedDeskInMeetingRoom` de `@legends/shared`) e o guard
  correspondente em `setRoomLock` devem estar presentes por cima do registry `getOfficeHub(companyId)`
  da branch (não do singleton antigo).

```bash
grep -n "roomLockOwnerId\|claimedDeskInMeetingRoom\|getOfficeHub" apps/api/src/lib/office-hub.ts
```

Expected: `claimedDeskInMeetingRoom` no import, `private roomLockOwnerId(...)` definido, e dentro
de `setRoomLock` a linha `const lockOwnerId = this.roomLockOwnerId(room.externalKey)` seguida do
guard `if (lockOwnerId && lockOwnerId !== userId) return`. Se o método ou o guard não aparecerem
(cenário só possível se as branches tiverem divergido mais desde a investigação), adicione-os
manualmente: o método vai logo depois de `roomForPosition`, o guard logo depois da linha
`if (!room || room.status === 'LOCKED') return` dentro de `setRoomLock` — sem nenhuma outra
mudança de lógica, é puramente aditivo.

- [ ] **Step 3: Conferir `apps/api/src/routes/profile.ts` e `profile.test.ts`**

```bash
grep -n "votingEnabled\|findUserInCompany\|sectorFeaturesFor" apps/api/src/routes/profile.ts
```

Expected: as 3 rotas (`GET /users/:id`, `GET /users/:id/profile`, `GET /users/:id/votes`) usam
`findUserInCompany(request.user.companyId, id)` (guard de empresa da branch) E
`GET /users/:id/profile` ainda calcula `votingEnabled` via `sectorFeaturesFor` (feature do
`main`). Isso já foi ajustado na Task 6 (só o `toPublicUser`); aqui é só conferência.

- [ ] **Step 4: Rodar os testes destes arquivos**

```bash
pnpm --filter @legends/api exec vitest run apps/api/src/lib/office-hub.test.ts apps/api/src/routes/profile.test.ts apps/api/src/routes/auth.test.ts
```

Expected: todos passam.

---

### Task 9: Verificação final e commit do merge

**Files:**
- Nenhuma edição — só verificação e o commit do merge.

- [ ] **Step 1: Typecheck completo dos dois workspaces tocados**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/shared exec tsc --noEmit
```

Expected: sem erros em nenhum dos dois.

- [ ] **Step 2: Confirmar que não sobrou nenhum marcador de conflito**

```bash
grep -rln "<<<<<<<\|^=======$\|>>>>>>>" apps packages 2>/dev/null
```

Expected: nenhuma saída (comando não encontra nada).

- [ ] **Step 3: Suíte completa** (SEGURANÇA: confirme de novo que `apps/api/.env`'s
  `DATABASE_URL` aponta pra `localhost:5432` antes — a suíte da API roda migrations no banco de
  teste)

```bash
pnpm db:up
pnpm test
```

Expected: todos os workspaces passam (`@legends/shared`, `@legends/api`, `@legends/web`).

- [ ] **Step 4: Build completo**

```bash
pnpm build
```

Expected: build de todos os workspaces sem erro (garante que não há import quebrado que só
apareceria em produção/bundling).

- [ ] **Step 5: Commit do merge**

```bash
git add -A
git commit -m "$(cat <<'EOF'
merge: reconcilia escopo por setor (main) com multi-tenancy por empresa

Sector.reviews/reviewComments/etc + Review*.sectorId denormalizado (mesmo padrão de
companyId) e UserBadge.companyId (gap: nunca tinha entrado em nenhuma fatia de
multi-tenancy) fecham a reconciliação entre PR #10610 (escopo por setor, já em main)
e a linha de multi-tenancy desta branch (PR #10609): empresa via scopedPrisma
automático, setor como filtro explícito por cima em cada função que precisa dele.
EOF
)"
git log --oneline -1
```

Expected: um único commit de merge (preserva os commits da branch — nenhum é reescrito), com pai
duplo apontando para `origin/main` e para o `HEAD` anterior da branch.

- [ ] **Step 6: Push da branch (não do worktree solto) e limpeza**

```bash
git push origin feat/multi-empresa-auth-jwt-clean
cd -
git worktree remove ../legends-merge-setor-empresa
```

Expected: push aceito (PR #10609 passa a mostrar "mergeable" com `main`); o worktree temporário é
removido, sem afetar o checkout principal.

---

## Auto-revisão (self-review)

**Cobertura do design**: todos os itens do design aprovado foram endereçados — migration de
`sectorId` nos 7 models de Review + `companyId` em `UserBadge` e `TENANT_SCOPED_MODELS` (Task 2);
`review-service.ts`/`review.ts` com `sectorId` explícito por cima de `scopedPrisma(companyId)`
(Tasks 3-4); `mural-service.ts` com join manual de `sectorId` sobre `scopedPrisma` + fix do gap de
`UserBadge` (Task 5); `toPublicUser` como objeto de opções + todos os call-sites (Task 6);
`office-hub.ts` verificado como aditivo/sem conflito real (Task 8); `users.ts`/`profile.ts`/
`highlights.ts`/`app.ts` reconciliados função por função (Tasks 6-8); commit único preservando os
commits da branch (Task 9).

**Divergência do design corrigida com base no código real**: o levantamento original citava 14
arquivos "conflitantes"; o merge de verdade (testado num worktree descartável nas SHAs
investigadas) só gera conflito textual em 9. Os outros 5 (`app.ts`, `office-hub.ts`,
`routes/auth.ts`, `routes/profile.ts`, `routes/profile.test.ts`) o git resolve sozinho e
corretamente — mas dois deles (`routes/auth.ts`, `routes/profile.ts`) têm call-sites de
`toPublicUser` que ficam type-invalid depois da Task 6 sem gerar `<<<<<<<` em lugar nenhum, porque
a mudança de assinatura está em outro arquivo. Isso está documentado explicitamente nos
"Achados da investigação" e coberto pela Task 6 (edição) e Task 8 (conferência dos que não
precisam de edição).

**Scan de placeholders**: nenhum "resolva aqui"/"TODO"/"similar à Task N" sem código — todo bloco
de resolução de conflito mostra o arquivo final completo (ou a função inteira, quando o arquivo é
grande e só uma função mudou). Migration SQL escrita por extenso, incluindo os `UPDATE` de
backfill (que o design original não detalhou — decisão: preencher `sectorId`/`companyId` reais a
partir do autor/dono antes de confiar no `DEFAULT`, já que o default do banco existe só para a
`ALTER TABLE` não falhar em linhas existentes, não para ser o valor certo delas).

**Consistência de tipos entre tasks**: `listFeed`/`getReviewForViewer`/`deleteReview`/
`listComments`/`toggleReviewReaction`/`toggleCommentReaction`/`shareReview` recebem
`(..., companyId, sectorId, ...)` de forma consistente entre `review-service.ts` (Task 3) e
`review.ts` (Task 4) — conferido campo a campo. `toPublicUser(user, sectorFeatures?, opts?)` é
consumido de forma consistente em `serialize.ts` (Task 6), `routes/auth.ts` (Task 6),
`routes/profile.ts` (Task 6) e `routes/users.ts` (Task 7). `getMuralItems(viewerId, viewerSectorId, now?)`
mantém a assinatura que `routes/mural.ts` (sem conflito, não editado neste plano) já espera.
