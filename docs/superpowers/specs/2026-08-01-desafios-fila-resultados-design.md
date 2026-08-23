# Desafios e fila de resultados — design

Data: 2026-08-01
Origem: portal EMR, `/app/admin/resultados-desafios`
(`src/routes/app.admin.resultados-desafios.tsx`).

## Problema

Desafio sem moderação é desafio sem prova: qualquer um marca "fiz" e leva o prêmio.
A fila de resultados é onde o crédito de coins acontece de fato, e é o ponto mais
sensível do fluxo — crédito duplicado corrói a confiança na moeda inteira.

## Estado atual do Legends

Levantado antes de desenhar:

- **Não existe nenhum conceito de desafio.** Nenhum model, service, rota ou tela.
  A única ocorrência de "desafio" no repo é prosa no seed de cultura.
- **O livro-razão de coins existe e serve**: `CoinTransaction` é append-only, com
  unique `(userId, dedupeKey)` — exatamente a idempotência que precisamos. Mas
  `awardCoins()` tira o valor de uma `CoinRule` chaveada pelo enum `CoinEvent`
  (`@@unique([companyId, event])`), ou seja, um valor fixo por evento — não serve
  para uma recompensa configurada por desafio.
- **"Pontos" não existem** como saldo no Legends (há votos, selos e streaks, nenhum
  ledger de pontos). A recompensa desta feature é **só em coins**.
- Já pronto e reusável: `scopedPrisma`, `recordAuditLog(…, { tx })`,
  `app.requireAdminOrSubadmin`, `notification-service`, presign S3
  (`presignImageUpload` / `presignDocumentUpload` / `publicUrlFor`), e o padrão de
  cursor base64url `"<iso>|<id>"` de `review-service` e `notification-service`.
- Nenhuma branch, PR ou worktree tocando o assunto.

## Escopo

Entra:

1. **Desafio** — model + CRUD de admin enxuto (o mínimo para a fila fazer sentido).
2. **Participar** — a pessoa submete participação, com nota e evidência opcional.
3. **Fila** — G&G vê pendentes e histórico, com filtro por pessoa e por desafio e
   paginação server-side.
4. **Decidir** — aprovar (credita) ou rejeitar (com motivo), individual ou em lote.
5. **Avisar** — notificação da decisão, best-effort.
6. **Exportar** — CSV do recorte filtrado.

Fora de escopo: ranking público de desafios, evidência em vídeo, revisão por pares.

## Decisões

### Recompensa em coins, valor por desafio

`Challenge.rewardCoins` guarda o valor. A aprovação grava direto no livro-razão com
um `CoinEvent` novo, `CHALLENGE_APPROVED`, e `ruleId: null` — sem passar por
`CoinRule`, portanto sem teto de janela. A idempotência vem da unique
`(userId, dedupeKey)` com `dedupeKey = "CHALLENGE_APPROVED:<submissionId>"`.

Para o `coin-service` continuar sendo o único lugar que sabe montar `day` e
`dedupeKey`, entra uma função nova lá: `awardFixedCoins`, que aceita `amount`
explícito e um `tx` opcional.

`rewardCoins <= 0` não gera lançamento nenhum (nada de linha de valor zero no
extrato); a submissão ainda assim é aprovada.

### Uma submissão ativa por (desafio, pessoa)

O enunciado da task se contradiz — pede `@@unique([challengeId, userId])` global e,
duas linhas depois, "permite nova submissão do mesmo desafio". A regra adotada,
explícita:

- No máximo **uma submissão não-rejeitada** por (desafio, pessoa).
- Consequência 1: nunca duas pendentes.
- Consequência 2: aprovada é definitiva — a pessoa não submete de novo e não recebe
  a recompensa duas vezes.
- Consequência 3: rejeitada **libera** nova tentativa, e a linha rejeitada
  permanece no histórico com o motivo.

Mecanismo: índice único **parcial**.

```sql
CREATE UNIQUE INDEX "ChallengeSubmission_challengeId_userId_key"
  ON "ChallengeSubmission"("challengeId", "userId")
  WHERE status <> 'REJECTED';
```

O índice vive **apenas no SQL da migration**. O `schema.prisma` **não** declara
`@@unique([challengeId, userId])`.

Uma versão anterior deste spec dizia o contrário — declarar o `@@unique` comum e
trocar o SQL à mão, "porque o Prisma compara índices por nome e colunas e ignora o
predicado". **Isso é falso**, e foi verificado contra o Prisma 5.22 deste repo. Com o
`@@unique` declarado, `prisma migrate diff` emite:

```sql
CREATE UNIQUE INDEX "ChallengeSubmission_challengeId_userId_key"
  ON "ChallengeSubmission"("challengeId", "userId");
```

sem o `WHERE` e **sem um `DROP INDEX` antes** — ou seja, uma migration que falharia
ao aplicar, por nome de índice duplicado. E sairia em **todo** `migrate dev` futuro,
mesmo para mudanças sem relação com desafios. A causa é o introspector do Prisma não
representar índice único parcial no data model (`prisma/prisma#3388`, aberto).

Sem o `@@unique` no schema, o mesmo `migrate diff` volta `-- This is an empty
migration.`: os dois lados ficam cegos para o índice. O Postgres continua aplicando a
regra, e um insert duplicado continua chegando ao service como `P2002`, que é tudo o
que o service precisa.

**Efeito colateral bem-vindo:** sem o `@@unique`, o Prisma Client não gera o
`findUnique({ where: { challengeId_userId: … } })` — que seria uma mentira, capaz de
casar qualquer submissão rejeitada. A armadilha deixa de existir em vez de precisar
de disciplina para evitá-la. O comentário `///` no model registra que o índice é
DB-only e por quê.

### Setor: no desafio, nulável

`Challenge.sectorId` opcional. `null` significa desafio da empresa inteira, que só o
ADMIN cria e modera; preenchido significa desafio de um setor, que o SUBADMIN
daquele setor cria e modera. A fila do SUBADMIN mostra as submissões dos desafios do
próprio setor; o ADMIN vê tudo e filtra por setor.

O "líder de Gente e Gestão" do portal é, no Legends, o SUBADMIN do setor Gente e
Gestão (mais o ADMIN global).

Do lado do colaborador, `GET /challenges` devolve os desafios da empresa inteira
(`sectorId = null`) **mais** os do setor da pessoa — nunca os de outro setor.

### Apagar desafio só enquanto não houver submissão

`DELETE /admin/challenges/:id` só passa quando o desafio não tem nenhuma submissão;
caso contrário devolve 409 e a orientação é desativar (`active: false`). O
`onDelete: Cascade` fica como salvaguarda de integridade, não como caminho normal:
apagar um desafio já moderado sumiria com o histórico da fila enquanto os coins
creditados continuariam no extrato — o livro-razão é append-only de propósito.

### Idempotência do crédito: compare-and-set primeiro

O enunciado pede "relê a submissão, aborta se não estiver pendente, credita, e só
então marca como aprovada". **Essa ordem está errada** e vai invertida aqui: com um
`SELECT` simples sob Read Committed, duas transações concorrentes leem as duas
`PENDING` e creditam as duas — só o `dedupeKey` segura, e ambas marcam `APPROVED`
com `reviewedById` em corrida.

O que torna a operação correta é o **UPDATE condicional vir primeiro**, porque é ele
que tira o lock da linha: a transação concorrente bloqueia, reavalia o predicado
contra a linha já commitada, vê `APPROVED` e devolve `count === 0`. O `dedupeKey`
único fica como segunda rede, não como primeira.

Rejeitado: `SELECT … FOR UPDATE` explícito teria o mesmo efeito, mas exige
`$queryRaw` porque o Prisma não expõe lock de linha — mais código, mesmo resultado.

### CSV é endpoint, não geração no cliente

Não existe nenhum export CSV no repo hoje. Como a paginação é server-side e o
critério é "o CSV reflete o recorte filtrado", gerar no cliente exportaria apenas a
página carregada. Logo: endpoint próprio devolvendo `text/csv`, percorrendo o filtro
inteiro.

## Dados

```prisma
enum ChallengeSubmissionStatus {
  PENDING
  APPROVED
  REJECTED
}

model Challenge {
  id          String    @id @default(cuid())
  title       String
  description String
  /// Coins creditados na aprovação. <= 0 não gera lançamento no extrato.
  rewardCoins Int
  active      Boolean   @default(true)
  /// Janela opcional; null dos dois lados = sempre aberto enquanto `active`.
  startsAt    DateTime?
  endsAt      DateTime?
  /// null = desafio da empresa inteira (só ADMIN cria/modera).
  sectorId    String?
  companyId   String    @default("company-emr")
  createdById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  sector      Sector?               @relation(fields: [sectorId], references: [id])
  company     Company               @relation(fields: [companyId], references: [id])
  createdBy   User                  @relation("ChallengesCreated", fields: [createdById], references: [id])
  submissions ChallengeSubmission[]

  @@index([companyId, active])
  @@index([companyId, sectorId])
}

model ChallengeSubmission {
  id              String                    @id @default(cuid())
  challengeId     String
  userId          String
  status          ChallengeSubmissionStatus @default(PENDING)
  note            String?
  /// Chave S3 da evidência opcional; o DTO expõe URL assinada, nunca a chave.
  evidenceKey     String?
  submittedAt     DateTime                  @default(now())
  reviewedAt      DateTime?
  reviewedById    String?
  rejectionReason String?
  companyId       String                    @default("company-emr")

  challenge  Challenge @relation(fields: [challengeId], references: [id], onDelete: Cascade)
  user       User      @relation("ChallengeSubmissions", fields: [userId], references: [id], onDelete: Cascade)
  reviewedBy User?     @relation("ChallengeSubmissionsReviewed", fields: [reviewedById], references: [id], onDelete: SetNull)
  company    Company   @relation(fields: [companyId], references: [id])

  /// Uma submissão ativa por (desafio, pessoa) é garantida por um índice único
  /// PARCIAL que vive só no SQL da migration (WHERE status <> 'REJECTED') — o
  /// Prisma não sabe representar índice parcial, e declará-lo aqui faria todo
  /// `migrate dev` futuro propor recriá-lo sem o WHERE. Violação chega como P2002.
  @@index([companyId, status, submittedAt])
  @@index([challengeId])
  @@index([userId])
}
```

Também na migration: `CoinEvent += CHALLENGE_APPROVED`;
`NotificationType += CHALLENGE_SUBMISSION_APPROVED, CHALLENGE_SUBMISSION_REJECTED`.

`Challenge` e `ChallengeSubmission` entram em `TENANT_SCOPED_MODELS`
(`apps/api/src/lib/tenant-scope.ts`) — sem isso não há isolamento por empresa.

## Contrato — `packages/shared/src/challenge.ts`

Exportado no barril `index.ts`.

```ts
export const CHALLENGE_SUBMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type ChallengeSubmissionStatus = (typeof CHALLENGE_SUBMISSION_STATUSES)[number]

export const CHALLENGE_NOTE_MAX_LENGTH = 500
export const REJECTION_REASON_MIN_LENGTH = 10
export const REJECTION_REASON_MAX_LENGTH = 500
export const CHALLENGE_SUBMISSION_PAGE_SIZE = 20
export const CHALLENGE_EXPORT_MAX_ROWS = 5000

export interface ChallengeDTO {
  id: string
  title: string
  description: string
  rewardCoins: number
  active: boolean
  startsAt: string | null
  endsAt: string | null
  sectorId: string | null
  sectorName: string | null
}

export interface ChallengeSubmissionDTO {
  id: string
  status: ChallengeSubmissionStatus
  note: string | null
  /** URL assinada da evidência, ou null. Nunca a chave crua do S3. */
  evidenceUrl: string | null
  submittedAt: string
  reviewedAt: string | null
  rejectionReason: string | null
  /** Pessoa e desafio já resolvidos: a tabela da fila não faz N+1. */
  user: { id: string; name: string; email: string; avatarUrl: string | null }
  challenge: { id: string; title: string; rewardCoins: number }
  reviewedBy: { id: string; name: string } | null
}

export interface ChallengeSubmissionPage {
  items: ChallengeSubmissionDTO[]
  nextCursor: string | null
}

/** Desafio na visão do colaborador, com o estado da própria submissão. */
export interface MyChallengeDTO extends ChallengeDTO {
  mySubmission: ChallengeSubmissionDTO | null
}

export interface ChallengeBatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}
```

## Serviços

Dois arquivos, para nenhum crescer demais:

- **`challenge-service.ts`** — CRUD do desafio, listagem visível ao colaborador
  (`listMyChallenges`) e `createSubmission`.
- **`challenge-submission-service.ts`** — fila do admin, decisão individual, lote e
  export.

Erros de domínio, seguindo o padrão de `VoteError` (classe tipada com `status`), sob
uma base `ChallengeError`:

| Erro | status | quando |
| --- | --- | --- |
| `ChallengeNotFoundError` | 404 | desafio inexistente ou de outra empresa |
| `ChallengeClosedError` | 409 | desafio inativo ou fora da janela |
| `SubmissionNotFoundError` | 404 | submissão inexistente ou de outra empresa |
| `SubmissionAlreadyOpenError` | 409 | P2002 da unique parcial: já há pendente/aprovada |
| `SubmissionNotPendingError` | 409 | decisão sobre submissão já decidida |
| `ChallengeSectorForbiddenError` | 403 | SUBADMIN mexendo em desafio de outro setor |

### `approveSubmission(id, actor)`

```ts
// 1. Carrega submissão + desafio com findFirst (nunca o findUnique composto).
//    404 se não existir; 403 se actor é SUBADMIN e challenge.sectorId !== actor.sectorId
//    (inclusive quando sectorId é null — desafio da empresa é só do ADMIN).
// 2. Transação:
await prisma.$transaction(async (tx) => {
  const { count } = await tx.challengeSubmission.updateMany({
    where: { id, companyId, status: 'PENDING' },
    data: { status: 'APPROVED', reviewedAt: now, reviewedById: actor.id },
  })
  if (count === 0) throw new SubmissionNotPendingError()

  if (challenge.rewardCoins > 0) {
    await awardFixedCoins({
      userId: submission.userId,
      companyId,
      amount: challenge.rewardCoins,
      event: 'CHALLENGE_APPROVED',
      reference: id,
      tx,
      now,
    })
  }

  await recordAuditLog({ actorId: actor.id, entityType: 'ChallengeSubmission',
    entityId: id, action: 'UPDATE', companyId, before, after, tx })
})
// 3. Fora da transação, best-effort (mesmo padrão da avaliação de selos pós-voto):
notifyChallengeReviewed(…).catch((err) => log.error(err))
```

Um `P2002` no `dedupeKey` dentro da transação vira `SubmissionNotPendingError` — é a
rede de segurança, não o mecanismo principal.

`awardFixedCoins` recebe `tx` e escreve com `companyId` explícito no `data`, igual ao
que `recordAuditLog` já faz dentro de transação alheia (o `tx` cru não passa por
`scopedPrisma`).

### `rejectSubmission(id, actor, reason)`

Mesma forma: `updateMany` condicional em `PENDING` → `REJECTED` gravando
`rejectionReason`, `reviewedAt` e `reviewedById`; **nenhum crédito**; auditoria na
mesma transação; notificação best-effort fora dela.

### `reviewBatch(ids, decision, actor)`

`for … of` sequencial chamando **exatamente** `approveSubmission` /
`rejectSubmission` — o mesmo caminho de código do individual, sem atalho. `try/catch`
por id, acumulando `{ succeeded, failed }`. Nenhum `Promise.all`: erro de um item não
pode sumir nem abortar os outros.

### `listSubmissions(filters)`

Filtros: `status?`, `userId?`, `challengeId?`, `sectorId?` (só ADMIN — no SUBADMIN é
forçado para o próprio setor), `cursor?`, `limit`. Ordem `submittedAt desc, id desc`;
cursor base64url `"<iso>|<id>"`, mesmo formato de `review-service`; busca `limit + 1`
para derivar `nextCursor`.

### `exportSubmissionsCsv(filters)`

Mesma query, sem cursor, com teto de `CHALLENGE_EXPORT_MAX_ROWS`. Separador `;` e BOM
UTF-8 (Excel em pt-BR). Colunas: Pessoa, E-mail, Desafio, Recompensa, Status, Enviado
em, Decidido em, Decidido por, Motivo.

## Rotas

Colaborador (`onRequest: [app.authenticate]`):

- `GET /challenges` → `MyChallengeDTO[]`
- `POST /challenges/:id/submissions` → `{ note?, evidenceKey? }` → `ChallengeSubmissionDTO`

Admin (`onRequest: [app.authenticate, app.requireAdminOrSubadmin]`):

- `GET|POST /admin/challenges`, `PATCH|DELETE /admin/challenges/:id`
- `GET /admin/challenge-submissions` → `ChallengeSubmissionPage`
- `GET /admin/challenge-submissions/export.csv` → `text/csv`
- `POST /admin/challenge-submissions/:id/approve`
- `POST /admin/challenge-submissions/:id/reject` → `{ rejectionReason }`
- `POST /admin/challenge-submissions/batch` → `{ ids, decision, rejectionReason? }` →
  `ChallengeBatchResult`

Rotas finas: Zod `safeParse` → `400 { message, issues }`, chamada ao service,
serialização por `lib/serialize.ts` (`toChallengeDTO`, `toChallengeSubmissionDTO`).
`instanceof ChallengeError` → `reply.code(err.status)`. Registro em `src/app.ts`.

## Notificação

`NotificationType` novo para aprovada e rejeitada, emitido por
`notifyChallengeReviewed` em `notification-service.ts`. Best-effort: falha é logada e
**nunca** desfaz a decisão — mesmo padrão da avaliação de selos pós-voto.

## Web

- `apps/web/src/pages/ChallengesPage.tsx` em `/desafios`: desafios abertos, estado da
  própria submissão (pendente / aprovada / rejeitada + motivo) e formulário de
  participação com nota e evidência opcional. O campo de evidência some quando o
  upload não está configurado (mesmo padrão de `/uploads/config`).
- `apps/web/src/pages/admin/ChallengesSection.tsx` — CRUD do desafio.
- `apps/web/src/pages/admin/ChallengeSubmissionsSection.tsx` — a fila: abas
  Pendentes/Todas, filtros de pessoa e desafio combináveis, `useInfiniteQuery` com
  "Carregar mais" (paginação **server-side** — o portal traz tudo e fatia no cliente;
  não repetir), checkbox de seleção múltipla, barra de ações em lote, modal de
  rejeição com motivo obrigatório e toast com o resumo do lote
  (`3 aprovadas, 1 falhou: …`), alimentado pelo `ChallengeBatchResult`.
- Rotas aninhadas em `App.tsx`; itens no grupo **Comunidade** do `AdminSidebar.tsx`
  (`/admin/desafios` e `/admin/resultados-desafios`). Dados via React Query +
  `apiFetch`.

## Testes

Vitest, colocados ao lado do arquivo.

**API** (Postgres real):

- aprovar pendente credita exatamente `rewardCoins` e marca `APPROVED`;
- aprovar a mesma submissão duas vezes → 409 na segunda e **um** `CoinTransaction`;
- duas aprovações concorrentes (`Promise.allSettled` em duas chamadas) → um crédito;
- aprovar submissão já rejeitada → 409, sem crédito;
- `rewardCoins = 0` aprova sem criar lançamento;
- rejeitar não credita e grava o motivo;
- lote parcial devolve `succeeded` e `failed` corretos;
- filtros por pessoa e desafio funcionam combinados; paginação por cursor não repete
  nem pula item;
- CSV reflete o recorte filtrado;
- 403 para não-admin; 403 para SUBADMIN em desafio de outro setor ou da empresa;
- `GET /challenges` não vaza desafio de outro setor;
- apagar desafio com submissão → 409;
- segunda submissão pendente no mesmo desafio é barrada, e liberada após rejeição;
- notificação que lança não desfaz a aprovação.

**Web:** fila renderiza e pagina; filtros; resumo do lote no toast; motivo de
rejeição obrigatório.

## Critérios de aceite

1. Aprovar submissão pendente credita exatamente a recompensa configurada no desafio
   e marca como aprovada.
2. Aprovar a mesma submissão duas vezes — inclusive em paralelo — credita uma única
   vez.
3. Rejeitar não credita nada e registra o motivo.
4. A pessoa é notificada da decisão; falha no envio não desfaz a decisão.
5. A mesma pessoa não consegue ter duas submissões pendentes no mesmo desafio.
6. A fila é paginada no servidor e os filtros por pessoa e desafio funcionam
   combinados.
7. O CSV exportado reflete o recorte filtrado.

## Nota operacional

O enunciado da task cita `LEGENDS_DB_PORT=5442`. Nesta máquina essa porta está
fechada — o Postgres do Legends responde na **5432** (padrão), então os testes da API
rodam sem essa variável.
