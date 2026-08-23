# Assistente de RH com base de conhecimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Legends um canal de autoatendimento de RH — assistente que responde ancorada numa base curada por Gente e Gestão, registra toda pergunta e expõe as lacunas como fila de trabalho.

**Architecture:** Fluxo route → service → Prisma, como o resto do repo. A recuperação é uma função **pura** em TS sobre as entradas ativas carregadas via `scopedPrisma` (SQL cru fura a extensão de isolamento); só o que a busca trouxe vira contexto do Gemini, com instrução explícita de não extrapolar. Sem chave de IA, ou com o Gemini falhando, a resposta degrada para o melhor trecho da base — nunca para erro.

**Tech Stack:** Fastify 4, Prisma 5 + PostgreSQL, Zod, `@google/genai`, React 18 + React Query + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-assistente-rh-base-conhecimento-design.md`

## Global Constraints

- **Camadas:** rota fina (Zod `safeParse` → `400 { message, issues }` → service → `lib/serialize.ts`); regra de negócio só no service; erro de domínio é classe tipada com `status`.
- **Contrato primeiro:** tipos, DTOs e constantes em `packages/shared/src/assistant.ts`, exportados no barril `index.ts`, antes de mexer em api ou web.
- **Multi-empresa:** todo model novo leva `companyId` (+ índice), entra em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`) e toda leitura/escrita passa por `scopedPrisma(companyId)`. `scopedPrisma` **lança erro em `upsert`** — use `findFirst` + `update`/`create`.
- **Migrations:** geradas com `pnpm db:migrate`; nunca editar migration já aplicada.
- **Auditoria:** toda mutação de admin chama `recordAuditLog` (`services/audit-log-service.ts`) dentro da mesma transação.
- **Textos ao usuário em português.**
- **Postgres:** a suíte da API roda contra o container **dedicado deste worktree**, `legends-db-otter`, na porta **5472** — todo comando de teste da API leva `LEGENDS_DB_PORT=5472`. O `legends-db` da 5432 é compartilhado com outros worktrees e já carrega migrations que não existem aqui (cursos, desafios), o que quebra o `truncate` do `test/setup.ts` com erro de foreign key. Subir o container, se preciso: `docker run -d --name legends-db-otter -e POSTGRES_USER=legends -e POSTGRES_PASSWORD=legends -e POSTGRES_DB=legends -p 5472:5432 postgres:16-alpine`.
- **Node ≥ 20** no shell que roda os testes.
- Durante a execução, rodar **apenas o(s) arquivo(s) de teste da task**. A suíte completa é gate final, não a cada passo.
- Commits em português, no padrão do repo (`feat:`, `fix:`, `test:`, `docs:`).

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/shared/src/assistant.ts` | Contrato: DTOs, constantes, mensagens |
| `packages/shared/src/assistant.test.ts` | Trava a `FeatureKey` nova e os limites |
| `apps/api/src/lib/assistant-search.ts` | Normalização, tokenização e ranking — puro, sem I/O |
| `apps/api/src/lib/assistant-search.test.ts` | Testes do ranking e do agrupamento |
| `apps/api/src/lib/assistant-error.ts` | `AssistantError` com `status` |
| `apps/api/src/services/assistant-service.ts` | Perguntar, feedback, CRUD da base, lacunas |
| `apps/api/src/services/assistant-service.test.ts` | Testes do service contra Postgres real |
| `apps/api/src/routes/assistant.ts` | Endpoints + Zod |
| `apps/api/src/routes/assistant.test.ts` | Testes de rota (status, guardas, mensagens) |
| `apps/web/src/components/assistant/AssistantWidget.tsx` | Widget de chat |
| `apps/web/src/components/assistant/AssistantWidget.test.tsx` | Testes do widget |
| `apps/web/src/pages/admin/KnowledgeBaseSection.tsx` | Abas Base + Lacunas |
| `apps/web/src/pages/admin/KnowledgeBaseSection.test.tsx` | Testes da administração |

**Modificar:** `packages/shared/src/index.ts`, `packages/shared/src/third-party.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/lib/tenant-scope.ts`, `apps/api/src/lib/gemini-client.ts` (+ `.test.ts`), `apps/api/src/lib/serialize.ts`, `apps/api/src/app.ts`, `apps/web/src/components/AppLayout.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/admin/AdminSidebar.tsx`.

---

## Task 1: Contrato compartilhado e FeatureKey

**Files:**
- Create: `packages/shared/src/assistant.ts`
- Create: `packages/shared/src/assistant.test.ts`
- Modify: `packages/shared/src/index.ts` (última linha do barril)
- Modify: `packages/shared/src/third-party.ts:1-34` (`FEATURE_KEYS` e `FEATURE_LABELS`)

**Interfaces:**
- Consumes: nada.
- Produces: tudo o que as tasks seguintes importam de `@legends/shared` — constantes `ASSISTANT_*`, `KnowledgeEntryDTO`, `CreateKnowledgeEntryRequest`, `UpdateKnowledgeEntryRequest`, `KnowledgeEntryListResponse`, `AskAssistantRequest`, `AskAssistantResponse`, `AssistantSourceDTO`, `AssistantFeedbackRequest`, `AssistantGapDTO`, `AssistantNegativeEntryDTO`, `AssistantGapsResponse`, `AssistantAnswerSource`, e a `FeatureKey` `'assistente'`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/src/assistant.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'
import {
  ASSISTANT_HOURLY_LIMIT,
  ASSISTANT_MAX_SOURCES,
  ASSISTANT_NOT_FOUND_MESSAGE,
  ASSISTANT_QUESTION_MAX_LENGTH,
} from './assistant'

describe('contrato da assistente', () => {
  it('registra a feature assistente com rótulo em português', () => {
    expect(FEATURE_KEYS).toContain('assistente')
    expect(FEATURE_LABELS.assistente).toBe('Assistente de RH')
  })

  it('tem limites coerentes entre si', () => {
    expect(ASSISTANT_HOURLY_LIMIT).toBeGreaterThan(0)
    expect(ASSISTANT_MAX_SOURCES).toBeGreaterThan(0)
    expect(ASSISTANT_QUESTION_MAX_LENGTH).toBeGreaterThan(10)
  })

  it('a mensagem de "não encontrei" avisa que a pergunta foi registrada', () => {
    expect(ASSISTANT_NOT_FOUND_MESSAGE).toContain('não encontrei')
    expect(ASSISTANT_NOT_FOUND_MESSAGE).toContain('registrada')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/assistant.test.ts`
Expected: FAIL — `Cannot find module './assistant'`.

- [ ] **Step 3: Criar o contrato**

Criar `packages/shared/src/assistant.ts`:

```ts
/**
 * Contrato da assistente de RH: base de conhecimento curada por Gente e Gestão,
 * perguntas em linguagem natural respondidas SOMENTE com base nessa base, e o
 * histórico que alimenta o painel de lacunas.
 */

export const ASSISTANT_QUESTION_MIN_LENGTH = 3
export const ASSISTANT_QUESTION_MAX_LENGTH = 500
export const ASSISTANT_ANSWER_MAX_LENGTH = 5000
export const ASSISTANT_CATEGORY_MAX_LENGTH = 60
export const ASSISTANT_KEYWORD_MAX_LENGTH = 40
export const ASSISTANT_KEYWORDS_MAX_COUNT = 20
export const ASSISTANT_COMMENT_MAX_LENGTH = 500

/** Teto de perguntas por pessoa por hora — a assistente não pode virar torneira de custo de IA. */
export const ASSISTANT_HOURLY_LIMIT = 20

/** Quantas entradas da base entram como contexto da IA (e voltam como `sources`). */
export const ASSISTANT_MAX_SOURCES = 3

/** Janela padrão, em dias, do painel de lacunas. */
export const ASSISTANT_GAPS_DEFAULT_DAYS = 30
export const ASSISTANT_GAPS_MAX_DAYS = 365
export const ASSISTANT_GAPS_DEFAULT_LIMIT = 20

export const ASSISTANT_NOT_FOUND_MESSAGE =
  'Ainda não encontrei essa informação na base de conhecimento. Sua pergunta foi registrada para o time de Gente e Gestão.'

/** Como a resposta foi produzida — a UI diferencia texto de IA de trecho cru da base. */
export const ASSISTANT_ANSWER_SOURCES = ['AI', 'KNOWLEDGE_BASE', 'NONE'] as const
export type AssistantAnswerSource = (typeof ASSISTANT_ANSWER_SOURCES)[number]

export interface KnowledgeEntryDTO {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
  isActive: boolean
  /** null = entrada vale para a empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeEntryRequest {
  category?: string | null
  question: string
  answer: string
  keywords?: string[]
  isActive?: boolean
  sectorId?: string | null
}

export type UpdateKnowledgeEntryRequest = Partial<CreateKnowledgeEntryRequest>

export interface KnowledgeEntryListResponse {
  entries: KnowledgeEntryDTO[]
  /** Categorias já usadas na empresa, para o formulário sugerir em vez de inventar. */
  categories: string[]
}

export interface AskAssistantRequest {
  question: string
}

/** Trecho da base citado na resposta — o que a pessoa vê como "fonte". */
export interface AssistantSourceDTO {
  id: string
  category: string | null
  question: string
  answer: string
}

export interface AskAssistantResponse {
  /** Id da pergunta registrada — é ele que o botão de feedback usa. */
  queryId: string
  answer: string
  /** false quando nada casou: `answer` é o ASSISTANT_NOT_FOUND_MESSAGE. */
  answered: boolean
  source: AssistantAnswerSource
  sources: AssistantSourceDTO[]
}

export interface AssistantFeedbackRequest {
  rating: -1 | 1
  comment?: string | null
}

/** Perguntas iguais (após normalização) agrupadas numa linha só. */
export interface AssistantGapDTO {
  /** Texto normalizado — chave do agrupamento. */
  normalized: string
  /** Uma ocorrência legível, como alguém digitou. */
  sample: string
  count: number
  lastAskedAt: string
}

/** Entrada da base que está recebendo polegar para baixo. */
export interface AssistantNegativeEntryDTO {
  entry: KnowledgeEntryDTO
  negativeCount: number
  comments: string[]
}

export interface AssistantGapsResponse {
  /** Perguntas sem nenhuma entrada casada — o buraco da base. */
  unanswered: AssistantGapDTO[]
  /** Perguntas mais frequentes que tiveram resposta. */
  frequent: AssistantGapDTO[]
  negative: AssistantNegativeEntryDTO[]
}
```

- [ ] **Step 4: Registrar a feature e o barril**

Em `packages/shared/src/third-party.ts`, adicionar `'assistente',` ao final da lista `FEATURE_KEYS` (depois de `'coins'`) e `assistente: 'Assistente de RH',` ao final de `FEATURE_LABELS`.

Em `packages/shared/src/index.ts`, adicionar ao final:

```ts
export * from './assistant'
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/shared exec vitest run src/assistant.test.ts src/sector.test.ts`
Expected: PASS nos dois arquivos (`sector.test.ts` já exige rótulo para toda `FeatureKey`).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/assistant.ts packages/shared/src/assistant.test.ts packages/shared/src/index.ts packages/shared/src/third-party.ts
git commit -m "feat(shared): contrato da assistente de RH e feature assistente"
```

---

## Task 2: Models Prisma e isolamento por empresa

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (novos models ao final + back-relations em `User`, `Sector`, `Company`)
- Modify: `apps/api/src/lib/tenant-scope.ts:8-70` (`TENANT_SCOPED_MODELS`)
- Modify: `apps/api/src/lib/tenant-scope.test.ts` (novo caso)
- Create: `apps/api/prisma/migrations/<timestamp>_assistente_base_conhecimento/migration.sql` (gerada, não escrita à mão)

**Interfaces:**
- Consumes: nada da Task 1 (só o contrato conceitual).
- Produces: os models `KnowledgeEntry`, `AssistantQuery`, `AssistantFeedback` no Prisma Client, com os campos exatos abaixo; `scopedPrisma(companyId).knowledgeEntry` / `.assistantQuery` / `.assistantFeedback` já isolados por empresa.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `apps/api/src/lib/tenant-scope.test.ts`:

```ts
it('isola a base de conhecimento entre empresas', async () => {
  const outra = await prisma.company.create({
    data: { name: 'Outra Empresa', slug: `outra-${Date.now()}` },
  })
  const autor = await prisma.user.create({
    data: { name: 'Autor', email: `autor-kb-${Date.now()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' },
  })

  await scopedPrisma('company-emr').knowledgeEntry.create({
    data: { question: 'Quantos dias de férias?', answer: '30 dias.', keywords: ['ferias'], createdById: autor.id },
  })

  const daEmpresa = await scopedPrisma('company-emr').knowledgeEntry.findMany()
  const daOutra = await scopedPrisma(outra.id).knowledgeEntry.findMany()

  expect(daEmpresa).toHaveLength(1)
  expect(daEmpresa[0]?.companyId).toBe('company-emr')
  expect(daOutra).toHaveLength(0)
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.test.ts
```

Expected: FAIL — `knowledgeEntry` não existe no client.

- [ ] **Step 3: Declarar os models**

Ao final de `apps/api/prisma/schema.prisma`:

```prisma
/// Base de conhecimento curada por Gente e Gestão. `sectorId` null = vale para a
/// empresa inteira. A FK de setor é Cascade de propósito: com SetNull, apagar um
/// setor promoveria suas entradas a entradas da empresa e exporia resposta de RH
/// do setor para toda a companhia (mesma razão do HrDashboard).
model KnowledgeEntry {
  id          String   @id @default(cuid())
  category    String?
  question    String
  answer      String
  keywords    String[]
  isActive    Boolean  @default(true)
  sectorId    String?
  companyId   String   @default("company-emr")
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company   Company @relation(fields: [companyId], references: [id])
  sector    Sector? @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  createdBy User    @relation("KnowledgeEntryAuthor", fields: [createdById], references: [id])

  @@index([companyId, isActive])
  @@index([companyId, sectorId])
}

/// Toda pergunta feita à assistente, com o que foi respondido e quais entradas
/// casaram. `matchedEntryIds` vazio marca uma lacuna da base.
model AssistantQuery {
  id              String   @id @default(cuid())
  userId          String
  question        String
  answer          String?
  matchedEntryIds String[]
  companyId       String   @default("company-emr")
  createdAt       DateTime @default(now())

  company  Company            @relation(fields: [companyId], references: [id])
  user     User               @relation("AssistantQueryAuthor", fields: [userId], references: [id], onDelete: Cascade)
  feedback AssistantFeedback?

  @@index([companyId, createdAt])
  @@index([userId, createdAt])
}

/// Um feedback por pergunta (reclicar atualiza). `rating` é -1 ou 1, validado no Zod.
model AssistantFeedback {
  id        String   @id @default(cuid())
  queryId   String   @unique
  userId    String
  rating    Int
  comment   String?
  companyId String   @default("company-emr")
  createdAt DateTime @default(now())

  company Company        @relation(fields: [companyId], references: [id])
  query   AssistantQuery @relation(fields: [queryId], references: [id], onDelete: Cascade)
  user    User           @relation("AssistantFeedbackAuthor", fields: [userId], references: [id], onDelete: Cascade)

  @@index([companyId, rating])
}
```

Adicionar as back-relations (Prisma exige o outro lado de cada relação):

- em `model User` (perto de `hrDashboards HrDashboard[]`, linha ~197):

```prisma
  knowledgeEntries   KnowledgeEntry[]    @relation("KnowledgeEntryAuthor")
  assistantQueries   AssistantQuery[]    @relation("AssistantQueryAuthor")
  assistantFeedbacks AssistantFeedback[] @relation("AssistantFeedbackAuthor")
```

- em `model Sector` (perto de `hrDashboards`, linha ~396):

```prisma
  knowledgeEntries KnowledgeEntry[]
```

- em `model Company` (perto de `hrDashboards`, linha ~472):

```prisma
  knowledgeEntries   KnowledgeEntry[]
  assistantQueries   AssistantQuery[]
  assistantFeedbacks AssistantFeedback[]
```

- [ ] **Step 4: Gerar a migration**

```bash
DATABASE_URL="postgresql://legends:legends@localhost:5472/legends?schema=public" pnpm db:migrate --name assistente_base_conhecimento
pnpm db:generate
```

Expected: nova pasta em `apps/api/prisma/migrations/`, client regenerado. Não editar o SQL gerado.

- [ ] **Step 5: Registrar no isolamento**

Em `apps/api/src/lib/tenant-scope.ts`, adicionar ao final do `Set` `TENANT_SCOPED_MODELS` (depois de `'HrDashboard'`):

```ts
  'KnowledgeEntry',
  'AssistantQuery',
  'AssistantFeedback',
```

Sem isso a extensão ignora os models e o isolamento simplesmente não existe.

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/lib/tenant-scope.ts apps/api/src/lib/tenant-scope.test.ts
git commit -m "feat(api): models da base de conhecimento e do histórico da assistente"
```

---

## Task 3: Recuperação — ranking puro

**Files:**
- Create: `apps/api/src/lib/assistant-search.ts`
- Create: `apps/api/src/lib/assistant-search.test.ts`

**Interfaces:**
- Consumes: `ASSISTANT_MAX_SOURCES` de `@legends/shared` (Task 1).
- Produces:
  - `interface RankableEntry { id: string; category: string | null; question: string; answer: string; keywords: string[] }`
  - `normalizeQuestion(text: string): string`
  - `tokenize(text: string): string[]`
  - `rankKnowledgeEntries(entries: RankableEntry[], question: string, limit?: number): RankableEntry[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/lib/assistant-search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeQuestion, rankKnowledgeEntries, type RankableEntry } from './assistant-search'

function entrada(over: Partial<RankableEntry> & { id: string }): RankableEntry {
  return {
    category: null,
    question: '',
    answer: '',
    keywords: [],
    ...over,
  }
}

const FERIAS = entrada({
  id: 'ferias',
  category: 'Férias',
  question: 'Quantos dias de férias eu tenho por ano?',
  answer: 'São 30 dias corridos após 12 meses de trabalho.',
  keywords: ['ferias', 'descanso'],
})

const VALE = entrada({
  id: 'vale',
  category: 'Benefícios',
  question: 'Como funciona o vale refeição?',
  answer: 'O crédito do vale refeição cai todo dia 5.',
  keywords: ['vale', 'refeicao', 'beneficio'],
})

describe('normalizeQuestion', () => {
  it('junta variações da mesma dúvida na mesma chave', () => {
    expect(normalizeQuestion('Quantos DIAS de férias?')).toBe('quantos dias de ferias')
    expect(normalizeQuestion('  quantos dias de férias  ')).toBe('quantos dias de ferias')
  })
})

describe('rankKnowledgeEntries', () => {
  it('casa por palavra-chave mesmo com acento e caixa diferentes', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'Preciso saber sobre FÉRIAS')
    expect(result.map((e) => e.id)).toEqual(['ferias'])
  })

  it('casa por termo da pergunta cadastrada', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'como funciona o vale refeição')
    expect(result.map((e) => e.id)).toEqual(['vale'])
  })

  it('casa por termo que só aparece na resposta', () => {
    const result = rankKnowledgeEntries([FERIAS, VALE], 'crédito cai que dia?')
    expect(result.map((e) => e.id)).toEqual(['vale'])
  })

  it('ordena palavra-chave acima de acerto só na resposta', () => {
    const soNaResposta = entrada({
      id: 'outro',
      question: 'Onde vejo meu holerite?',
      answer: 'O holerite fica no portal, junto do saldo de férias e descanso.',
    })
    const result = rankKnowledgeEntries([soNaResposta, FERIAS], 'férias e descanso')
    expect(result.map((e) => e.id)).toEqual(['ferias', 'outro'])
  })

  it('não casa quando a pergunta só tem palavras vazias', () => {
    expect(rankKnowledgeEntries([FERIAS, VALE], 'como faço?')).toEqual([])
  })

  it('não casa quando nada da pergunta aparece na base', () => {
    expect(rankKnowledgeEntries([FERIAS, VALE], 'qual a política de estacionamento')).toEqual([])
  })

  it('respeita o limite de resultados', () => {
    const muitas = Array.from({ length: 10 }, (_, i) =>
      entrada({ id: `e${i}`, question: 'Política de férias', keywords: ['ferias'] }),
    )
    expect(rankKnowledgeEntries(muitas, 'férias', 3)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/assistant-search.test.ts`
Expected: FAIL — `Cannot find module './assistant-search'`.

- [ ] **Step 3: Implementar o ranking**

Criar `apps/api/src/lib/assistant-search.ts`:

```ts
import { ASSISTANT_MAX_SOURCES } from '@legends/shared'

export interface RankableEntry {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
}

/**
 * Palavras que sozinhas não dizem nada sobre o assunto perguntado. Sem essa lista,
 * "como faço para..." casaria com metade da base.
 */
const STOPWORDS = new Set([
  'para', 'como', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'sobre', 'posso',
  'preciso', 'tenho', 'tem', 'uma', 'uns', 'meu', 'minha', 'com', 'sem', 'por', 'que',
  'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'onde', 'quem', 'quando', 'faco', 'fazer',
  'ser', 'esta', 'este', 'esse', 'essa', 'isso', 'aqui', 'mais', 'menos', 'saber',
  'funciona', 'ano', 'ver', 'vejo',
])

const MIN_TOKEN_LENGTH = 3

/**
 * Forma canônica de um texto: minúscula, sem acento, sem pontuação. Usada tanto na
 * busca quanto no agrupamento de perguntas no painel de lacunas — as duas coisas
 * precisam concordar sobre o que é "a mesma pergunta".
 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFD')
    // Escape explícito da faixa de acentos combinantes — nada de caractere invisível no fonte.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokens significativos: sem stopword, sem token curto demais. */
export function tokenize(text: string): string[] {
  return normalizeQuestion(text)
    .split(' ')
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token))
}

const KEYWORD_WEIGHT = 3
const QUESTION_WEIGHT = 2
const ANSWER_WEIGHT = 1

/**
 * Piso de pontuação. Em 3, uma palavra-chave certeira já basta, mas um único termo
 * genérico batendo na resposta não sustenta uma resposta de RH.
 */
const MIN_SCORE = 3

function scoreEntry(entry: RankableEntry, tokens: string[]): number {
  const keywordTokens = new Set(entry.keywords.flatMap((keyword) => tokenize(keyword)))
  const questionTokens = new Set(tokenize(entry.question))
  const answerTokens = new Set(tokenize(entry.answer))

  let score = 0
  for (const token of new Set(tokens)) {
    // Cada token conta uma vez só, pelo campo de maior peso em que aparece.
    if (keywordTokens.has(token)) score += KEYWORD_WEIGHT
    else if (questionTokens.has(token)) score += QUESTION_WEIGHT
    else if (answerTokens.has(token)) score += ANSWER_WEIGHT
  }
  return score
}

/**
 * Entradas mais relevantes para a pergunta, da melhor para a pior. Função pura: quem
 * carrega as entradas (já isoladas por empresa) é o service.
 */
export function rankKnowledgeEntries(
  entries: RankableEntry[],
  question: string,
  limit: number = ASSISTANT_MAX_SOURCES,
): RankableEntry[] {
  const tokens = tokenize(question)
  if (tokens.length === 0) return []

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((scored) => scored.score >= MIN_SCORE)
    // Desempate por texto da pergunta: ordem estável, teste determinístico.
    .sort((a, b) => b.score - a.score || a.entry.question.localeCompare(b.entry.question))
    .slice(0, limit)
    .map((scored) => scored.entry)
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/assistant-search.test.ts`
Expected: PASS nos 8 casos. Se algum caso de fronteira falhar, ajuste a lista de `STOPWORDS` ou o `MIN_SCORE` — **não** relaxe a asserção do teste.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/assistant-search.ts apps/api/src/lib/assistant-search.test.ts
git commit -m "feat(api): ranking da base de conhecimento em função pura"
```

---

## Task 4: Prompt ancorado no contexto

**Files:**
- Modify: `apps/api/src/lib/gemini-client.ts` (acrescentar ao final, sem tocar em `buildCongratsPrompt`)
- Modify: `apps/api/src/lib/gemini-client.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - `interface AssistantPromptEntry { category: string | null; question: string; answer: string }`
  - `interface AssistantPromptInput { question: string; entries: AssistantPromptEntry[] }`
  - `buildAssistantPrompt(input: AssistantPromptInput): string`
  - `buildAssistantAnswer(input: AssistantPromptInput, env?: NodeJS.ProcessEnv): Promise<string>`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `apps/api/src/lib/gemini-client.test.ts`:

```ts
import { buildAssistantPrompt } from './gemini-client'

describe('buildAssistantPrompt', () => {
  const input = {
    question: 'Quantos dias de férias eu tenho?',
    entries: [
      {
        category: 'Férias',
        question: 'Quantos dias de férias por ano?',
        answer: 'São 30 dias corridos após 12 meses de trabalho.',
      },
    ],
  }

  it('inclui a pergunta e os trechos recuperados', () => {
    const prompt = buildAssistantPrompt(input)
    expect(prompt).toContain('Quantos dias de férias eu tenho?')
    expect(prompt).toContain('São 30 dias corridos após 12 meses de trabalho.')
    expect(prompt).toContain('Férias')
  })

  it('manda responder só com base no contexto e admitir quando não souber', () => {
    const prompt = buildAssistantPrompt(input)
    expect(prompt).toContain('exclusivamente')
    expect(prompt).toContain('não encontrei')
    expect(prompt).toContain('Não invente')
  })

  it('é estável — snapshot do texto montado', () => {
    expect(buildAssistantPrompt(input)).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/gemini-client.test.ts`
Expected: FAIL — `buildAssistantPrompt is not a function`.

- [ ] **Step 3: Implementar prompt e chamada**

Acrescentar ao final de `apps/api/src/lib/gemini-client.ts`:

```ts
export interface AssistantPromptEntry {
  category: string | null
  question: string
  answer: string
}

/**
 * Entrada do prompt da assistente. O tipo é a garantia de privacidade: só a pergunta
 * e os campos textuais das entradas recuperadas entram — nome, e-mail ou qualquer
 * dado de terceiro não têm por onde chegar ao Gemini.
 */
export interface AssistantPromptInput {
  question: string
  entries: AssistantPromptEntry[]
}

/**
 * Monta o prompt da assistente de RH. Função pura (testável sem rede). O ancoramento
 * é o ponto: sem ele o modelo inventa política interna, que é o pior resultado
 * possível para RH.
 */
export function buildAssistantPrompt(input: AssistantPromptInput): string {
  const contexto = input.entries
    .map((entry, index) => {
      const titulo = entry.category ? `${entry.category} — ${entry.question}` : entry.question;
      return `[${index + 1}] ${titulo}\n${entry.answer.trim()}`;
    })
    .join("\n\n");

  return [
    `Você é a assistente de Gente e Gestão da empresa, respondendo a um colaborador em português do Brasil.`,
    `Responda usando exclusivamente as informações do CONTEXTO abaixo.`,
    `Se o contexto não responder à pergunta, diga exatamente que não encontrou essa informação na base e sugira procurar o time de Gente e Gestão.`,
    `Não invente número, prazo, valor ou política que não esteja no contexto.`,
    `Seja direto: no máximo 4 frases. Não use markdown, títulos ou emojis. Responda apenas com o texto final.`,
    ``,
    `CONTEXTO:`,
    contexto,
    ``,
    `PERGUNTA: ${input.question.trim()}`,
  ].join("\n");
}

/** Chama o Gemini com o prompt ancorado. Lança se a chave faltar — quem chama decide o fallback. */
export async function buildAssistantAnswer(
  input: AssistantPromptInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada — a assistente responde direto da base.");
  }
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildAssistantPrompt(input),
  });
  const text = (res.text ?? "").trim();
  if (!text) throw new Error("O Gemini não retornou texto para a assistente.");
  return text;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/lib/gemini-client.test.ts`
Expected: PASS; o snapshot é criado na primeira execução (`gemini-client.test.ts.snap`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/gemini-client.ts apps/api/src/lib/gemini-client.test.ts apps/api/src/lib/__snapshots__
git commit -m "feat(api): prompt da assistente ancorado nos trechos da base"
```

---

## Task 5: Service — perguntar, com teto e fallback

**Files:**
- Create: `apps/api/src/lib/assistant-error.ts`
- Create: `apps/api/src/services/assistant-service.ts`
- Create: `apps/api/src/services/assistant-service.test.ts`

**Interfaces:**
- Consumes: `rankKnowledgeEntries` (Task 3), `buildAssistantAnswer` (Task 4), constantes de `@legends/shared` (Task 1), models do Prisma (Task 2).
- Produces:
  - `class AssistantError extends Error { constructor(message: string, status: number) }` com `status: number`
  - `interface AssistantActor { id: string; role: string; sectorId: string; companyId: string }`
  - `interface AskAssistantResult { queryId: string; answer: string; answered: boolean; source: AssistantAnswerSource; sources: RankableEntry[] }`
  - `askAssistant(actor: AssistantActor, question: string): Promise<AskAssistantResult>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/services/assistant-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_HOURLY_LIMIT, ASSISTANT_NOT_FOUND_MESSAGE } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { AssistantError } from '../lib/assistant-error'
import { askAssistant, type AssistantActor } from './assistant-service'

const SECTOR = 'sector-dev-produto'

async function criarUsuario(email: string, role = 'LEGEND', companyId = 'company-emr') {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: role as never, sectorId: SECTOR, companyId },
  })
}

function ator(user: { id: string; role: string; sectorId: string; companyId: string }): AssistantActor {
  return { id: user.id, role: user.role, sectorId: user.sectorId, companyId: user.companyId }
}

async function criarEntrada(autorId: string, over: Record<string, unknown> = {}) {
  return prisma.knowledgeEntry.create({
    data: {
      question: 'Quantos dias de férias eu tenho?',
      answer: 'São 30 dias corridos após 12 meses de trabalho.',
      keywords: ['ferias'],
      createdById: autorId,
      ...over,
    },
  })
}

beforeEach(() => {
  delete process.env.GEMINI_API_KEY
})

describe('askAssistant', () => {
  it('responde com a base e registra as entradas que casaram quando não há IA', async () => {
    const user = await criarUsuario('pergunta-ok@empresa.com')
    const entrada = await criarEntrada(user.id)

    const result = await askAssistant(ator(user), 'quantos dias de férias eu tenho?')

    expect(result.answered).toBe(true)
    expect(result.source).toBe('KNOWLEDGE_BASE')
    expect(result.answer).toBe('São 30 dias corridos após 12 meses de trabalho.')
    expect(result.sources.map((s) => s.id)).toEqual([entrada.id])

    const registrada = await prisma.assistantQuery.findUniqueOrThrow({ where: { id: result.queryId } })
    expect(registrada.userId).toBe(user.id)
    expect(registrada.matchedEntryIds).toEqual([entrada.id])
    expect(registrada.answer).toBe(result.answer)
  })

  it('devolve "não encontrei" e registra a lacuna quando nada casa', async () => {
    const user = await criarUsuario('lacuna@empresa.com')
    await criarEntrada(user.id)

    const result = await askAssistant(ator(user), 'qual a política de estacionamento?')

    expect(result.answered).toBe(false)
    expect(result.source).toBe('NONE')
    expect(result.answer).toBe(ASSISTANT_NOT_FOUND_MESSAGE)
    expect(result.sources).toEqual([])

    const registrada = await prisma.assistantQuery.findUniqueOrThrow({ where: { id: result.queryId } })
    expect(registrada.matchedEntryIds).toEqual([])
  })

  it('ignora entrada inativa e entrada de outro setor', async () => {
    const user = await criarUsuario('escopo@empresa.com')
    const outroSetor = await prisma.sector.create({
      data: { name: 'RH', slug: `rh-${Date.now()}` },
    })
    await criarEntrada(user.id, { isActive: false })
    await criarEntrada(user.id, { sectorId: outroSetor.id })

    const result = await askAssistant(ator(user), 'quantos dias de férias?')

    expect(result.answered).toBe(false)
  })

  it('nunca usa base de outra empresa como contexto', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-${Date.now()}` } })
    const autorOutra = await criarUsuario('autor-outra@empresa.com', 'ADMIN', outra.id)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'Segredo da outra empresa.',
        keywords: ['ferias'],
        createdById: autorOutra.id,
        companyId: outra.id,
      },
    })
    const user = await criarUsuario('isolado@empresa.com')

    const result = await askAssistant(ator(user), 'quantos dias de férias?')

    expect(result.answered).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Segredo da outra empresa.')
  })

  it('recusa com 429 acima do teto de perguntas por hora', async () => {
    const user = await criarUsuario('teto@empresa.com')
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: user.id,
        question: 'oi',
        matchedEntryIds: [],
      })),
    })

    await expect(askAssistant(ator(user), 'quantos dias de férias?')).rejects.toMatchObject({
      status: 429,
    })
    await expect(askAssistant(ator(user), 'quantos dias de férias?')).rejects.toBeInstanceOf(AssistantError)
  })

  it('não conta perguntas de mais de uma hora atrás no teto', async () => {
    const user = await criarUsuario('janela@empresa.com')
    await criarEntrada(user.id)
    const antiga = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: user.id,
        question: 'oi',
        matchedEntryIds: [],
        createdAt: antiga,
      })),
    })

    const result = await askAssistant(ator(user), 'quantos dias de férias?')
    expect(result.answered).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts
```

Expected: FAIL — `Cannot find module './assistant-service'`.

- [ ] **Step 3: Criar o erro de domínio**

Criar `apps/api/src/lib/assistant-error.ts`:

```ts
/** Erro de domínio da assistente. A rota faz `instanceof` e responde com `err.status`. */
export class AssistantError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AssistantError'
  }
}
```

- [ ] **Step 4: Implementar o service**

Criar `apps/api/src/services/assistant-service.ts`:

```ts
import {
  ASSISTANT_HOURLY_LIMIT,
  ASSISTANT_NOT_FOUND_MESSAGE,
  type AssistantAnswerSource,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { AssistantError } from '../lib/assistant-error'
import { rankKnowledgeEntries, type RankableEntry } from '../lib/assistant-search'
import { buildAssistantAnswer } from '../lib/gemini-client'

export interface AssistantActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

export interface AskAssistantResult {
  queryId: string
  answer: string
  answered: boolean
  source: AssistantAnswerSource
  sources: RankableEntry[]
}

const HOUR_MS = 60 * 60 * 1000

/** Teto por pessoa/hora, contado no próprio histórico — sobrevive a restart e vale entre instâncias. */
async function assertWithinHourlyLimit(actor: AssistantActor): Promise<void> {
  const usadas = await scopedPrisma(actor.companyId).assistantQuery.count({
    where: { userId: actor.id, createdAt: { gte: new Date(Date.now() - HOUR_MS) } },
  })
  if (usadas >= ASSISTANT_HOURLY_LIMIT) {
    throw new AssistantError(
      `Você já fez ${ASSISTANT_HOURLY_LIMIT} perguntas na última hora. Tente novamente mais tarde.`,
      429,
    )
  }
}

/**
 * Texto da resposta. Com chave de IA, o Gemini escreve ancorado no contexto; sem
 * chave — ou se o Gemini falhar — cai para a melhor entrada da base. Falha de IA é
 * best-effort: logada e degradada, nunca 500 na cara do usuário.
 */
async function resolveAnswer(
  question: string,
  matched: RankableEntry[],
): Promise<{ answer: string; source: AssistantAnswerSource }> {
  const fallback = { answer: matched[0]!.answer, source: 'KNOWLEDGE_BASE' as const }
  if (!process.env.GEMINI_API_KEY) return fallback
  try {
    const answer = await buildAssistantAnswer({
      question,
      entries: matched.map((entry) => ({
        category: entry.category,
        question: entry.question,
        answer: entry.answer,
      })),
    })
    return { answer, source: 'AI' }
  } catch (err) {
    console.error('[assistant] falha ao gerar resposta com IA, caindo para a base', err)
    return fallback
  }
}

export async function askAssistant(actor: AssistantActor, question: string): Promise<AskAssistantResult> {
  const db = scopedPrisma(actor.companyId)
  await assertWithinHourlyLimit(actor)

  // Só entradas ativas, da empresa (garantido pela extensão) e do escopo da pessoa:
  // as da empresa inteira mais as do setor dela.
  const entries = await db.knowledgeEntry.findMany({
    where: { isActive: true, OR: [{ sectorId: null }, { sectorId: actor.sectorId }] },
  })
  const matched = rankKnowledgeEntries(entries, question)

  if (matched.length === 0) {
    const query = await db.assistantQuery.create({
      data: {
        userId: actor.id,
        question,
        answer: ASSISTANT_NOT_FOUND_MESSAGE,
        matchedEntryIds: [],
      },
    })
    return {
      queryId: query.id,
      answer: ASSISTANT_NOT_FOUND_MESSAGE,
      answered: false,
      source: 'NONE',
      sources: [],
    }
  }

  const { answer, source } = await resolveAnswer(question, matched)
  const query = await db.assistantQuery.create({
    data: {
      userId: actor.id,
      question,
      answer,
      matchedEntryIds: matched.map((entry) => entry.id),
    },
  })
  return { queryId: query.id, answer, answered: true, source, sources: matched }
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts`
Expected: PASS nos 6 casos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/assistant-error.ts apps/api/src/services/assistant-service.ts apps/api/src/services/assistant-service.test.ts
git commit -m "feat(api): assistente responde ancorada na base, com teto por hora"
```

---

## Task 6: Rota de pergunta

**Files:**
- Create: `apps/api/src/routes/assistant.ts`
- Create: `apps/api/src/routes/assistant.test.ts`
- Modify: `apps/api/src/lib/serialize.ts` (acrescentar ao final)
- Modify: `apps/api/src/app.ts` (import junto dos demais, `app.register` junto dos demais)

**Interfaces:**
- Consumes: `askAssistant`, `AssistantActor`, `AssistantError` (Task 5); constantes de `@legends/shared` (Task 1).
- Produces:
  - `toAssistantSourceDTO(entry: RankableEntry): AssistantSourceDTO` em `lib/serialize.ts`
  - `assistantRoutes(app: FastifyInstance)` registrado em `app.ts`
  - `POST /assistant/ask` → `200 AskAssistantResponse`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/routes/assistant.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ASSISTANT_HOURLY_LIMIT } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  delete process.env.GEMINI_API_KEY
  app = buildApp()
  await app.ready()
})

async function criarUsuario(role: string, email: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never },
  })
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('POST /assistant/ask', () => {
  it('responde com fontes para quem tem a feature liberada', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-ask@empresa.com')
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', 'legend-ask@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias eu tenho?' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.answered).toBe(true)
    expect(body.answer).toBe('São 30 dias corridos.')
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].question).toBe('Quantos dias de férias?')
    expect(typeof body.queryId).toBe('string')
  })

  it('bloqueia quem está em setor sem a feature', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-sem-feature@empresa.com')
    const token = signAccessToken(app, legend, [])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('recusa pergunta vazia com 400 em português', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-vazio@empresa.com')
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Dados inválidos.')
    expect(res.json().issues).toBeDefined()
  })

  it('responde 429 com mensagem em português acima do teto', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-teto@empresa.com')
    await prisma.assistantQuery.createMany({
      data: Array.from({ length: ASSISTANT_HOURLY_LIMIT }, () => ({
        userId: legend.id,
        question: 'oi',
        matchedEntryIds: [],
      })),
    })
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })

    expect(res.statusCode).toBe(429)
    expect(res.json().message).toContain('perguntas na última hora')
  })

  it('exige autenticação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { question: 'quantos dias de férias?' },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/routes/assistant.test.ts`
Expected: FAIL — 404 nas rotas (não registradas).

- [ ] **Step 3: Serializar**

Acrescentar ao final de `apps/api/src/lib/serialize.ts`:

```ts
/** Trecho da base citado numa resposta da assistente. */
export function toAssistantSourceDTO(entry: {
  id: string
  category: string | null
  question: string
  answer: string
}): AssistantSourceDTO {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
  }
}
```

Acrescentar `AssistantSourceDTO` ao bloco de imports de tipo de `@legends/shared` já existente no topo do arquivo.

- [ ] **Step 4: Criar a rota**

Criar `apps/api/src/routes/assistant.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { ASSISTANT_QUESTION_MAX_LENGTH, ASSISTANT_QUESTION_MIN_LENGTH } from '@legends/shared'
import { AssistantError } from '../lib/assistant-error'
import { toAssistantSourceDTO } from '../lib/serialize'
import { askAssistant, type AssistantActor } from '../services/assistant-service'

const askSchema = z.object({
  question: z.string().trim().min(ASSISTANT_QUESTION_MIN_LENGTH).max(ASSISTANT_QUESTION_MAX_LENGTH),
})

/** Erro de domínio → resposta; o resto sobe. */
function handleAssistantError(err: unknown, reply: FastifyReply) {
  if (err instanceof AssistantError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: {
  user: { sub: string; role: string; sectorId: string; companyId: string }
}): AssistantActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

export async function assistantRoutes(app: FastifyInstance) {
  app.post(
    '/assistant/ask',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const parsed = askSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        const result = await askAssistant(actorFrom(request), parsed.data.question)
        return reply.send({
          queryId: result.queryId,
          answer: result.answer,
          answered: result.answered,
          source: result.source,
          sources: result.sources.map(toAssistantSourceDTO),
        })
      } catch (err) {
        return handleAssistantError(err, reply)
      }
    },
  )
}
```

- [ ] **Step 5: Registrar no app**

Em `apps/api/src/app.ts`: `import { assistantRoutes } from './routes/assistant'` junto dos demais imports de rota, e `app.register(assistantRoutes)` junto dos demais `app.register`.

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/routes/assistant.test.ts`
Expected: PASS nos 5 casos.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/assistant.ts apps/api/src/routes/assistant.test.ts apps/api/src/lib/serialize.ts apps/api/src/app.ts
git commit -m "feat(api): rota POST /assistant/ask"
```

---

## Task 7: Feedback da resposta

**Files:**
- Modify: `apps/api/src/services/assistant-service.ts` (acrescentar `recordAssistantFeedback`)
- Modify: `apps/api/src/services/assistant-service.test.ts` (novo `describe`)
- Modify: `apps/api/src/routes/assistant.ts` (nova rota)
- Modify: `apps/api/src/routes/assistant.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `AssistantActor`, `AssistantError` (Task 5); `ASSISTANT_COMMENT_MAX_LENGTH` (Task 1).
- Produces:
  - `recordAssistantFeedback(actor: AssistantActor, queryId: string, input: { rating: -1 | 1; comment?: string | null }): Promise<void>`
  - `POST /assistant/queries/:id/feedback` → `204`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `apps/api/src/services/assistant-service.test.ts`:

```ts
import { recordAssistantFeedback } from './assistant-service'

describe('recordAssistantFeedback', () => {
  it('grava e depois atualiza o feedback da própria pergunta', async () => {
    const user = await criarUsuario('feedback-ok@empresa.com')
    await criarEntrada(user.id)
    const { queryId } = await askAssistant(ator(user), 'quantos dias de férias?')

    await recordAssistantFeedback(ator(user), queryId, { rating: 1 })
    await recordAssistantFeedback(ator(user), queryId, { rating: -1, comment: 'faltou o período aquisitivo' })

    const feedbacks = await prisma.assistantFeedback.findMany({ where: { queryId } })
    expect(feedbacks).toHaveLength(1)
    expect(feedbacks[0]?.rating).toBe(-1)
    expect(feedbacks[0]?.comment).toBe('faltou o período aquisitivo')
  })

  it('recusa feedback em pergunta de outra pessoa', async () => {
    const dono = await criarUsuario('dono-pergunta@empresa.com')
    const intruso = await criarUsuario('intruso@empresa.com')
    await criarEntrada(dono.id)
    const { queryId } = await askAssistant(ator(dono), 'quantos dias de férias?')

    await expect(recordAssistantFeedback(ator(intruso), queryId, { rating: 1 })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('trata pergunta inexistente como 404', async () => {
    const user = await criarUsuario('feedback-404@empresa.com')
    await expect(recordAssistantFeedback(ator(user), 'nao-existe', { rating: 1 })).rejects.toMatchObject({
      status: 404,
    })
  })
})
```

Acrescentar em `apps/api/src/routes/assistant.test.ts`:

```ts
describe('POST /assistant/queries/:id/feedback', () => {
  async function perguntar() {
    const admin = await criarUsuario('ADMIN', `admin-fb-${Date.now()}@empresa.com`)
    await prisma.knowledgeEntry.create({
      data: {
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
        createdById: admin.id,
      },
    })
    const legend = await criarUsuario('LEGEND', `legend-fb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, legend, ['assistente'])
    const ask = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      headers: auth(token),
      payload: { question: 'quantos dias de férias?' },
    })
    return { queryId: ask.json().queryId as string, token }
  }

  it('aceita polegar para baixo com comentário', async () => {
    const { queryId, token } = await perguntar()

    const res = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${queryId}/feedback`,
      headers: auth(token),
      payload: { rating: -1, comment: 'faltou o período aquisitivo' },
    })

    expect(res.statusCode).toBe(204)
  })

  it('recusa rating fora de -1 e 1', async () => {
    const { queryId, token } = await perguntar()

    for (const rating of [0, 2, -2]) {
      const res = await app.inject({
        method: 'POST',
        url: `/assistant/queries/${queryId}/feedback`,
        headers: auth(token),
        payload: { rating },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('recusa feedback de outra pessoa com 403', async () => {
    const { queryId } = await perguntar()
    const outro = await criarUsuario('LEGEND', `outro-fb-${Date.now()}@empresa.com`)
    const tokenOutro = signAccessToken(app, outro, ['assistente'])

    const res = await app.inject({
      method: 'POST',
      url: `/assistant/queries/${queryId}/feedback`,
      headers: auth(tokenOutro),
      payload: { rating: 1 },
    })

    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: FAIL — `recordAssistantFeedback` não existe; rota devolve 404.

- [ ] **Step 3: Implementar no service**

Acrescentar em `apps/api/src/services/assistant-service.ts`:

```ts
export interface AssistantFeedbackInput {
  rating: -1 | 1
  comment?: string | null
}

/**
 * Registra o polegar da pessoa na resposta que ela recebeu. Um feedback por pergunta:
 * reclicar atualiza. Não usa `upsert` — a extensão de isolamento não suporta.
 */
export async function recordAssistantFeedback(
  actor: AssistantActor,
  queryId: string,
  input: AssistantFeedbackInput,
): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  // findFirst (e não findUnique): a extensão acrescenta companyId ao where, e não
  // existe unique composto (id, companyId). Pergunta de outra empresa vira 404.
  const query = await db.assistantQuery.findFirst({ where: { id: queryId } })
  if (!query) throw new AssistantError('Pergunta não encontrada.', 404)
  if (query.userId !== actor.id) {
    throw new AssistantError('Você só pode avaliar as respostas das suas próprias perguntas.', 403)
  }

  const comment = input.comment?.trim() ? input.comment.trim() : null
  const existente = await db.assistantFeedback.findFirst({ where: { queryId } })
  if (existente) {
    await db.assistantFeedback.update({
      where: { id: existente.id },
      data: { rating: input.rating, comment },
    })
    return
  }
  await db.assistantFeedback.create({
    data: { queryId, userId: actor.id, rating: input.rating, comment },
  })
}
```

- [ ] **Step 4: Implementar a rota**

Acrescentar em `apps/api/src/routes/assistant.ts` — no topo, junto dos outros schemas:

```ts
const idParamsSchema = z.object({ id: z.string().min(1) })

const feedbackSchema = z.object({
  // Só -1 e 1: o banco aceitaria qualquer inteiro, a rota é a fronteira.
  rating: z.union([z.literal(-1), z.literal(1)]),
  comment: z.string().trim().max(ASSISTANT_COMMENT_MAX_LENGTH).nullable().optional(),
})
```

e dentro de `assistantRoutes`:

```ts
  app.post(
    '/assistant/queries/:id/feedback',
    { onRequest: [app.authenticate, app.requireFeature('assistente')] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
      const parsed = feedbackSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        await recordAssistantFeedback(actorFrom(request), params.data.id, parsed.data)
        return reply.code(204).send()
      } catch (err) {
        return handleAssistantError(err, reply)
      }
    },
  )
```

Ajustar os imports do arquivo: `ASSISTANT_COMMENT_MAX_LENGTH` de `@legends/shared` e `recordAssistantFeedback` do service.

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/assistant-service.ts apps/api/src/services/assistant-service.test.ts apps/api/src/routes/assistant.ts apps/api/src/routes/assistant.test.ts
git commit -m "feat(api): feedback de utilidade nas respostas da assistente"
```

---

## Task 8: CRUD da base de conhecimento

**Files:**
- Modify: `apps/api/src/services/assistant-service.ts` (CRUD + guardas de setor)
- Modify: `apps/api/src/services/assistant-service.test.ts` (novo `describe`)
- Modify: `apps/api/src/routes/assistant.ts` (rotas `/admin/knowledge`)
- Modify: `apps/api/src/routes/assistant.test.ts` (novo `describe`)
- Modify: `apps/api/src/lib/serialize.ts` (`toKnowledgeEntryDTO`)

**Interfaces:**
- Consumes: `AssistantActor`, `AssistantError` (Task 5); DTOs de `@legends/shared` (Task 1); `recordAuditLog` de `services/audit-log-service.ts`.
- Produces:
  - `type KnowledgeEntryWithSector = KnowledgeEntry & { sector: { id: string; name: string } | null }`
  - `listKnowledgeEntries(actor, filters: { q?: string; category?: string; sectorId?: string; isActive?: boolean }): Promise<{ entries: KnowledgeEntryWithSector[]; categories: string[] }>`
  - `createKnowledgeEntry(actor, input: CreateKnowledgeEntryRequest): Promise<KnowledgeEntryWithSector>`
  - `updateKnowledgeEntry(actor, id: string, input: UpdateKnowledgeEntryRequest): Promise<KnowledgeEntryWithSector>`
  - `deleteKnowledgeEntry(actor, id: string): Promise<void>`
  - `toKnowledgeEntryDTO(entry: KnowledgeEntryWithSector): KnowledgeEntryDTO`
  - Rotas `GET|POST /admin/knowledge`, `PATCH|DELETE /admin/knowledge/:id`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `apps/api/src/services/assistant-service.test.ts`:

```ts
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
} from './assistant-service'

describe('CRUD da base de conhecimento', () => {
  it('ADMIN cria entrada da empresa inteira e grava auditoria', async () => {
    const admin = await criarUsuario('crud-admin@empresa.com', 'ADMIN')

    const criada = await createKnowledgeEntry(ator(admin), {
      category: 'Férias',
      question: 'Quantos dias de férias?',
      answer: 'São 30 dias corridos.',
      keywords: ['ferias'],
    })

    expect(criada.sectorId).toBeNull()
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'KnowledgeEntry', entityId: criada.id } })
    expect(log?.action).toBe('CREATE')
    expect(log?.actorId).toBe(admin.id)
  })

  it('SUBADMIN cria no próprio setor mesmo sem informar o escopo', async () => {
    const subadmin = await criarUsuario('crud-sub@empresa.com', 'SUBADMIN')

    const criada = await createKnowledgeEntry(ator(subadmin), {
      question: 'Como peço reembolso?',
      answer: 'Pelo portal, até o dia 20.',
    })

    expect(criada.sectorId).toBe(subadmin.sectorId)
  })

  it('SUBADMIN não escreve fora do próprio setor', async () => {
    const subadmin = await criarUsuario('crud-sub-403@empresa.com', 'SUBADMIN')

    await expect(
      createKnowledgeEntry(ator(subadmin), {
        question: 'X',
        answer: 'Y',
        sectorId: null,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('SUBADMIN não edita entrada da empresa inteira', async () => {
    const admin = await criarUsuario('crud-admin-2@empresa.com', 'ADMIN')
    const daEmpresa = await createKnowledgeEntry(ator(admin), { question: 'X', answer: 'Y' })
    const subadmin = await criarUsuario('crud-sub-edit@empresa.com', 'SUBADMIN')

    await expect(updateKnowledgeEntry(ator(subadmin), daEmpresa.id, { answer: 'Z' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('lista com filtro de categoria e devolve as categorias em uso', async () => {
    const admin = await criarUsuario('crud-lista@empresa.com', 'ADMIN')
    await createKnowledgeEntry(ator(admin), { category: 'Férias', question: 'A', answer: 'a' })
    await createKnowledgeEntry(ator(admin), { category: 'Benefícios', question: 'B', answer: 'b' })

    const todas = await listKnowledgeEntries(ator(admin), {})
    expect(todas.entries).toHaveLength(2)
    expect(todas.categories.sort()).toEqual(['Benefícios', 'Férias'])

    const soFerias = await listKnowledgeEntries(ator(admin), { category: 'Férias' })
    expect(soFerias.entries.map((e) => e.question)).toEqual(['A'])
  })

  it('apaga e registra auditoria de DELETE', async () => {
    const admin = await criarUsuario('crud-delete@empresa.com', 'ADMIN')
    const criada = await createKnowledgeEntry(ator(admin), { question: 'X', answer: 'Y' })

    await deleteKnowledgeEntry(ator(admin), criada.id)

    expect(await prisma.knowledgeEntry.findUnique({ where: { id: criada.id } })).toBeNull()
    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'KnowledgeEntry', entityId: criada.id, action: 'DELETE' },
    })
    expect(log).not.toBeNull()
  })
})
```

Acrescentar em `apps/api/src/routes/assistant.test.ts`:

```ts
describe('rotas de curadoria da base', () => {
  it('LEGEND não acessa a base', async () => {
    const legend = await criarUsuario('LEGEND', `legend-kb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, legend, ['assistente'])

    const res = await app.inject({ method: 'GET', url: '/admin/knowledge', headers: auth(token) })
    expect(res.statusCode).toBe(403)
  })

  it('ADMIN cria, edita, lista e apaga entrada', async () => {
    const admin = await criarUsuario('ADMIN', `admin-kb-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/knowledge',
      headers: auth(token),
      payload: {
        category: 'Férias',
        question: 'Quantos dias de férias?',
        answer: 'São 30 dias corridos.',
        keywords: ['ferias'],
      },
    })
    expect(criada.statusCode).toBe(201)
    const id = criada.json().entry.id as string

    const editada = await app.inject({
      method: 'PATCH',
      url: `/admin/knowledge/${id}`,
      headers: auth(token),
      payload: { isActive: false },
    })
    expect(editada.statusCode).toBe(200)
    expect(editada.json().entry.isActive).toBe(false)

    const lista = await app.inject({ method: 'GET', url: '/admin/knowledge', headers: auth(token) })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().entries).toHaveLength(1)
    expect(lista.json().categories).toEqual(['Férias'])

    const apagada = await app.inject({
      method: 'DELETE',
      url: `/admin/knowledge/${id}`,
      headers: auth(token),
    })
    expect(apagada.statusCode).toBe(204)
  })

  it('recusa pergunta vazia com 400', async () => {
    const admin = await criarUsuario('ADMIN', `admin-kb-400-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/knowledge',
      headers: auth(token),
      payload: { question: '', answer: 'Y' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Dados inválidos.')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: FAIL — funções de CRUD inexistentes; rotas 404.

- [ ] **Step 3: Implementar o CRUD no service**

Acrescentar em `apps/api/src/services/assistant-service.ts` (e ajustar imports: `Prisma`, `KnowledgeEntry` de `@prisma/client`; `CreateKnowledgeEntryRequest`, `UpdateKnowledgeEntryRequest` de `@legends/shared`; `recordAuditLog` de `./audit-log-service`):

```ts
const sectorInclude = { sector: { select: { id: true, name: true } } } as const

export type KnowledgeEntryWithSector = KnowledgeEntry & { sector: { id: string; name: string } | null }

export interface KnowledgeEntryFilters {
  q?: string
  category?: string
  sectorId?: string
  isActive?: boolean
}

/** SUBADMIN só gerencia entrada do próprio setor — nem as da empresa, nem as de outro setor. */
function assertCanManage(actor: AssistantActor, sectorId: string | null): void {
  if (actor.role === 'SUBADMIN' && sectorId !== actor.sectorId) {
    throw new AssistantError('Você só pode gerenciar entradas do seu setor.', 403)
  }
}

/**
 * Escopo de destino de uma escrita. Para o SUBADMIN, `sectorId` omitido assume o setor
 * dele; qualquer escopo explícito diferente (inclusive `null`, que é a entrada da
 * empresa) é 403.
 */
function resolveSectorIdForWrite(actor: AssistantActor, requested: string | null | undefined): string | null {
  if (actor.role === 'SUBADMIN') {
    if (requested === undefined || requested === actor.sectorId) return actor.sectorId
    throw new AssistantError('Você só pode gerenciar entradas do seu setor.', 403)
  }
  return requested ?? null
}

async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new AssistantError('Setor não encontrado.', 404)
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!keywords) return []
  return [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))]
}

export async function listKnowledgeEntries(
  actor: AssistantActor,
  filters: KnowledgeEntryFilters,
): Promise<{ entries: KnowledgeEntryWithSector[]; categories: string[] }> {
  const db = scopedPrisma(actor.companyId)

  // Escopo e busca textual são DOIS predicados independentes e vão em `AND`. Espalhar
  // duas chaves `OR` no mesmo literal faria a segunda apagar a primeira em silêncio —
  // e o SUBADMIN que buscasse por texto passaria a enxergar todos os setores.
  const scopeFilter: Prisma.KnowledgeEntryWhereInput | null =
    actor.role === 'SUBADMIN'
      ? { OR: [{ sectorId: null }, { sectorId: actor.sectorId }] }
      : filters.sectorId
        ? { sectorId: filters.sectorId }
        : null

  const textFilter: Prisma.KnowledgeEntryWhereInput | null = filters.q
    ? {
        OR: [
          { question: { contains: filters.q, mode: 'insensitive' } },
          { answer: { contains: filters.q, mode: 'insensitive' } },
        ],
      }
    : null

  const and = [scopeFilter, textFilter].filter(
    (clause): clause is Prisma.KnowledgeEntryWhereInput => clause !== null,
  )

  const where: Prisma.KnowledgeEntryWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  }

  const entries = await db.knowledgeEntry.findMany({
    where,
    include: sectorInclude,
    orderBy: [{ category: 'asc' }, { question: 'asc' }],
  })

  const comCategoria = await db.knowledgeEntry.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ['category'],
  })
  const categories = comCategoria
    .map((row) => row.category)
    .filter((category): category is string => category !== null)
    .sort((a, b) => a.localeCompare(b))

  return { entries, categories }
}

export async function createKnowledgeEntry(
  actor: AssistantActor,
  input: CreateKnowledgeEntryRequest,
): Promise<KnowledgeEntryWithSector> {
  const db = scopedPrisma(actor.companyId)
  const sectorId = resolveSectorIdForWrite(actor, input.sectorId)
  await assertSectorExists(actor.companyId, sectorId)

  return db.$transaction(async (tx) => {
    const created = await tx.knowledgeEntry.create({
      data: {
        category: input.category?.trim() ? input.category.trim() : null,
        question: input.question.trim(),
        answer: input.answer.trim(),
        keywords: normalizeKeywords(input.keywords),
        isActive: input.isActive ?? true,
        sectorId,
        createdById: actor.id,
      },
      include: sectorInclude,
    })
    // Mesmo cast dos outros services: o tx da extensão não é um TransactionClient
    // cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateKnowledgeEntry(
  actor: AssistantActor,
  id: string,
  input: UpdateKnowledgeEntryRequest,
): Promise<KnowledgeEntryWithSector> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.knowledgeEntry.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new AssistantError('Entrada não encontrada.', 404)
  assertCanManage(actor, before.sectorId)

  const data: Prisma.KnowledgeEntryUncheckedUpdateInput = {}
  if (input.category !== undefined) data.category = input.category?.trim() ? input.category.trim() : null
  if (input.question !== undefined) data.question = input.question.trim()
  if (input.answer !== undefined) data.answer = input.answer.trim()
  if (input.keywords !== undefined) data.keywords = normalizeKeywords(input.keywords)
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.sectorId !== undefined) {
    const nextSectorId = resolveSectorIdForWrite(actor, input.sectorId)
    await assertSectorExists(actor.companyId, nextSectorId)
    data.sectorId = nextSectorId
  }

  return db.$transaction(async (tx) => {
    await tx.knowledgeEntry.update({ where: { id }, data })
    const after = await tx.knowledgeEntry.findUniqueOrThrow({ where: { id }, include: sectorInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

export async function deleteKnowledgeEntry(actor: AssistantActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.knowledgeEntry.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new AssistantError('Entrada não encontrada.', 404)
  assertCanManage(actor, before.sectorId)

  await db.$transaction(async (tx) => {
    await tx.knowledgeEntry.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}
```

- [ ] **Step 4: Serializar**

Acrescentar ao final de `apps/api/src/lib/serialize.ts` (e `KnowledgeEntryDTO` ao import de tipos):

```ts
/** Entrada da base de conhecimento como o admin a vê. */
export function toKnowledgeEntryDTO(entry: KnowledgeEntryWithSector): KnowledgeEntryDTO {
  return {
    id: entry.id,
    category: entry.category,
    question: entry.question,
    answer: entry.answer,
    keywords: entry.keywords,
    isActive: entry.isActive,
    sectorId: entry.sectorId,
    sectorName: entry.sector?.name ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}
```

Importar o tipo `KnowledgeEntryWithSector` de `../services/assistant-service` — mesmo padrão de `HrDashboardWithSector`.

- [ ] **Step 5: Implementar as rotas**

Acrescentar em `apps/api/src/routes/assistant.ts`:

```ts
const knowledgeBaseSchema = {
  category: z.string().trim().max(ASSISTANT_CATEGORY_MAX_LENGTH).nullable().optional(),
  question: z.string().trim().min(1).max(ASSISTANT_QUESTION_MAX_LENGTH),
  answer: z.string().trim().min(1).max(ASSISTANT_ANSWER_MAX_LENGTH),
  keywords: z
    .array(z.string().trim().min(1).max(ASSISTANT_KEYWORD_MAX_LENGTH))
    .max(ASSISTANT_KEYWORDS_MAX_COUNT)
    .optional(),
  isActive: z.boolean().optional(),
  sectorId: z.string().min(1).nullable().optional(),
}
const createKnowledgeSchema = z.object(knowledgeBaseSchema)
const updateKnowledgeSchema = z.object(knowledgeBaseSchema).partial()

const knowledgeListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  sectorId: z.string().min(1).optional(),
  isActive: z.enum(['true', 'false']).optional(),
})
```

e, dentro de `assistantRoutes`:

```ts
  const adminGuard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/knowledge', adminGuard, async (request, reply) => {
    const query = knowledgeListQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const { entries, categories } = await listKnowledgeEntries(actorFrom(request), {
      q: query.data.q,
      category: query.data.category,
      sectorId: query.data.sectorId,
      isActive: query.data.isActive === undefined ? undefined : query.data.isActive === 'true',
    })
    return reply.send({ entries: entries.map(toKnowledgeEntryDTO), categories })
  })

  app.post('/admin/knowledge', adminGuard, async (request, reply) => {
    const parsed = createKnowledgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createKnowledgeEntry(actorFrom(request), parsed.data)
      return reply.code(201).send({ entry: toKnowledgeEntryDTO(created) })
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })

  app.patch('/admin/knowledge/:id', adminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    const parsed = updateKnowledgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateKnowledgeEntry(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ entry: toKnowledgeEntryDTO(updated) })
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })

  app.delete('/admin/knowledge/:id', adminGuard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ message: 'Parâmetros inválidos.' })
    try {
      await deleteKnowledgeEntry(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleAssistantError(err, reply)
    }
  })
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/assistant-service.ts apps/api/src/services/assistant-service.test.ts apps/api/src/routes/assistant.ts apps/api/src/routes/assistant.test.ts apps/api/src/lib/serialize.ts
git commit -m "feat(api): CRUD da base de conhecimento com auditoria e escopo por setor"
```

---

## Task 9: Painel de lacunas

**Files:**
- Modify: `apps/api/src/services/assistant-service.ts` (`listAssistantGaps`)
- Modify: `apps/api/src/services/assistant-service.test.ts` (novo `describe`)
- Modify: `apps/api/src/routes/assistant.ts` (`GET /admin/assistant/gaps`)
- Modify: `apps/api/src/routes/assistant.test.ts` (novo caso)

**Interfaces:**
- Consumes: `normalizeQuestion` (Task 3), `toKnowledgeEntryDTO` (Task 8), tipos de lacuna de `@legends/shared` (Task 1).
- Produces:
  - `listAssistantGaps(actor: AssistantActor, options: { days: number; limit: number }): Promise<AssistantGapsResult>`
  - `interface AssistantGapsResult { unanswered: AssistantGapDTO[]; frequent: AssistantGapDTO[]; negative: { entry: KnowledgeEntryWithSector; negativeCount: number; comments: string[] }[] }`
  - `GET /admin/assistant/gaps` → `200 AssistantGapsResponse`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `apps/api/src/services/assistant-service.test.ts`:

```ts
import { listAssistantGaps } from './assistant-service'

describe('listAssistantGaps', () => {
  const opcoes = { days: 30, limit: 20 }

  it('agrupa perguntas sem match pela forma normalizada', async () => {
    const user = await criarUsuario('lacuna-agrupa@empresa.com')
    const admin = await criarUsuario('lacuna-admin@empresa.com', 'ADMIN')
    await prisma.assistantQuery.createMany({
      data: [
        { userId: user.id, question: 'Quantos dias de licença paternidade?', matchedEntryIds: [] },
        { userId: user.id, question: 'quantos dias de licenca paternidade', matchedEntryIds: [] },
        { userId: user.id, question: 'Como peço reembolso?', matchedEntryIds: [] },
      ],
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered[0]?.count).toBe(2)
    expect(gaps.unanswered[0]?.normalized).toBe('quantos dias de licenca paternidade')
    expect(gaps.unanswered[0]?.sample).toContain('licen')
    expect(gaps.unanswered).toHaveLength(2)
  })

  it('separa as respondidas na lista de mais frequentes', async () => {
    const user = await criarUsuario('lacuna-frequente@empresa.com')
    const admin = await criarUsuario('lacuna-admin-2@empresa.com', 'ADMIN')
    const entrada = await criarEntrada(admin.id)
    await prisma.assistantQuery.createMany({
      data: [
        { userId: user.id, question: 'Férias quantos dias?', matchedEntryIds: [entrada.id] },
        { userId: user.id, question: 'férias quantos dias', matchedEntryIds: [entrada.id] },
      ],
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered).toHaveLength(0)
    expect(gaps.frequent[0]?.count).toBe(2)
  })

  it('lista entradas com feedback negativo, com os comentários', async () => {
    const user = await criarUsuario('lacuna-negativo@empresa.com')
    const admin = await criarUsuario('lacuna-admin-3@empresa.com', 'ADMIN')
    const entrada = await criarEntrada(admin.id)
    const query = await prisma.assistantQuery.create({
      data: { userId: user.id, question: 'férias?', matchedEntryIds: [entrada.id] },
    })
    await prisma.assistantFeedback.create({
      data: { queryId: query.id, userId: user.id, rating: -1, comment: 'faltou o período aquisitivo' },
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.negative).toHaveLength(1)
    expect(gaps.negative[0]?.entry.id).toBe(entrada.id)
    expect(gaps.negative[0]?.negativeCount).toBe(1)
    expect(gaps.negative[0]?.comments).toEqual(['faltou o período aquisitivo'])
  })

  it('ignora id de entrada já apagada', async () => {
    const user = await criarUsuario('lacuna-orfa@empresa.com')
    const admin = await criarUsuario('lacuna-admin-4@empresa.com', 'ADMIN')
    const query = await prisma.assistantQuery.create({
      data: { userId: user.id, question: 'férias?', matchedEntryIds: ['entrada-apagada'] },
    })
    await prisma.assistantFeedback.create({
      data: { queryId: query.id, userId: user.id, rating: -1 },
    })

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.negative).toHaveLength(0)
  })

  it('não enxerga histórico de outra empresa', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-gaps-${Date.now()}` } })
    const daOutra = await criarUsuario('gaps-outra@empresa.com', 'LEGEND', outra.id)
    await prisma.assistantQuery.create({
      data: { userId: daOutra.id, question: 'segredo da outra', matchedEntryIds: [], companyId: outra.id },
    })
    const admin = await criarUsuario('gaps-admin-isolado@empresa.com', 'ADMIN')

    const gaps = await listAssistantGaps(ator(admin), opcoes)

    expect(gaps.unanswered).toHaveLength(0)
  })
})
```

Acrescentar em `apps/api/src/routes/assistant.test.ts`, dentro do `describe` de curadoria:

```ts
  it('devolve as três listas de lacunas para o admin', async () => {
    const admin = await criarUsuario('ADMIN', `admin-gaps-${Date.now()}@empresa.com`)
    const token = signAccessToken(app, admin)
    await prisma.assistantQuery.create({
      data: { userId: admin.id, question: 'Como peço reembolso?', matchedEntryIds: [] },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/assistant/gaps', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().unanswered[0].count).toBe(1)
    expect(res.json().frequent).toEqual([])
    expect(res.json().negative).toEqual([])
  })
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: FAIL — `listAssistantGaps` não existe; rota 404.

- [ ] **Step 3: Implementar as lacunas**

Acrescentar em `apps/api/src/services/assistant-service.ts` (importar `normalizeQuestion` de `../lib/assistant-search` e `AssistantGapDTO` de `@legends/shared`):

```ts
export interface AssistantGapsOptions {
  days: number
  limit: number
}

export interface AssistantGapsResult {
  unanswered: AssistantGapDTO[]
  frequent: AssistantGapDTO[]
  negative: { entry: KnowledgeEntryWithSector; negativeCount: number; comments: string[] }[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Agrupa perguntas pela forma normalizada: a mesma dúvida repetida vira uma linha com contador. */
function groupQuestions(
  queries: { question: string; createdAt: Date }[],
  limit: number,
): AssistantGapDTO[] {
  const groups = new Map<string, { sample: string; count: number; lastAskedAt: Date }>()
  for (const query of queries) {
    const normalized = normalizeQuestion(query.question)
    if (normalized === '') continue
    const current = groups.get(normalized)
    if (!current) {
      groups.set(normalized, { sample: query.question, count: 1, lastAskedAt: query.createdAt })
      continue
    }
    current.count += 1
    // O exemplo legível é sempre a ocorrência mais recente.
    if (query.createdAt > current.lastAskedAt) {
      current.lastAskedAt = query.createdAt
      current.sample = query.question
    }
  }

  return [...groups.entries()]
    .map(([normalized, group]) => ({
      normalized,
      sample: group.sample,
      count: group.count,
      lastAskedAt: group.lastAskedAt.toISOString(),
    }))
    .sort((a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt))
    .slice(0, limit)
}

/**
 * Fila de trabalho de quem cura a base: o que ninguém achou, o que mais perguntam e
 * o que está recebendo polegar para baixo.
 */
export async function listAssistantGaps(
  actor: AssistantActor,
  options: AssistantGapsOptions,
): Promise<AssistantGapsResult> {
  const db = scopedPrisma(actor.companyId)
  const since = new Date(Date.now() - options.days * DAY_MS)

  const queries = await db.assistantQuery.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, question: true, createdAt: true, matchedEntryIds: true },
    orderBy: { createdAt: 'desc' },
  })

  const unanswered = groupQuestions(
    queries.filter((query) => query.matchedEntryIds.length === 0),
    options.limit,
  )
  const frequent = groupQuestions(
    queries.filter((query) => query.matchedEntryIds.length > 0),
    options.limit,
  )

  const negatives = await db.assistantFeedback.findMany({
    where: { rating: -1, createdAt: { gte: since } },
    select: { queryId: true, comment: true },
  })
  const matchedByQuery = new Map(queries.map((query) => [query.id, query.matchedEntryIds]))

  const porEntrada = new Map<string, { negativeCount: number; comments: string[] }>()
  for (const feedback of negatives) {
    for (const entryId of matchedByQuery.get(feedback.queryId) ?? []) {
      const current = porEntrada.get(entryId) ?? { negativeCount: 0, comments: [] }
      current.negativeCount += 1
      if (feedback.comment) current.comments.push(feedback.comment)
      porEntrada.set(entryId, current)
    }
  }

  // Entrada apagada depois da pergunta deixa id órfão no histórico: some da fila em
  // vez de reescrever o passado.
  const entries = porEntrada.size
    ? await db.knowledgeEntry.findMany({
        where: { id: { in: [...porEntrada.keys()] } },
        include: sectorInclude,
      })
    : []

  const negative = entries
    .map((entry) => ({
      entry,
      negativeCount: porEntrada.get(entry.id)!.negativeCount,
      comments: porEntrada.get(entry.id)!.comments,
    }))
    .sort((a, b) => b.negativeCount - a.negativeCount)
    .slice(0, options.limit)

  return { unanswered, frequent, negative }
}
```

- [ ] **Step 4: Implementar a rota**

Acrescentar em `apps/api/src/routes/assistant.ts`:

```ts
const gapsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(ASSISTANT_GAPS_MAX_DAYS).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
```

e dentro de `assistantRoutes`:

```ts
  app.get('/admin/assistant/gaps', adminGuard, async (request, reply) => {
    const query = gapsQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: query.error.issues })
    }
    const gaps = await listAssistantGaps(actorFrom(request), {
      days: query.data.days ?? ASSISTANT_GAPS_DEFAULT_DAYS,
      limit: query.data.limit ?? ASSISTANT_GAPS_DEFAULT_LIMIT,
    })
    return reply.send({
      unanswered: gaps.unanswered,
      frequent: gaps.frequent,
      negative: gaps.negative.map((item) => ({
        entry: toKnowledgeEntryDTO(item.entry),
        negativeCount: item.negativeCount,
        comments: item.comments,
      })),
    })
  })
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `LEGENDS_DB_PORT=5472 pnpm --filter @legends/api exec vitest run src/services/assistant-service.test.ts src/routes/assistant.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/assistant-service.ts apps/api/src/services/assistant-service.test.ts apps/api/src/routes/assistant.ts apps/api/src/routes/assistant.test.ts
git commit -m "feat(api): painel de lacunas da base de conhecimento"
```

---

## Task 10: Widget de chat no app

**Files:**
- Create: `apps/web/src/components/assistant/AssistantWidget.tsx`
- Create: `apps/web/src/components/assistant/AssistantWidget.test.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx` (montar o widget dentro do `<div>` externo, logo depois de `</main>`, por volta da linha 349)

**Interfaces:**
- Consumes: `AskAssistantResponse`, `AssistantFeedbackRequest`, `ASSISTANT_QUESTION_MAX_LENGTH` de `@legends/shared`; `apiFetch`/`ApiError` de `src/lib/api`; `useAuth` de `src/auth/AuthContext`.
- Produces: `export function AssistantWidget(): JSX.Element | null`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/components/assistant/AssistantWidget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const mockAuth = vi.hoisted(() => ({ role: 'LEGEND' as string, sectorFeatures: ['assistente'] as string[] }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Pessoa', role: mockAuth.role, sectorFeatures: mockAuth.sectorFeatures },
  }),
}))

import { AssistantWidget } from './AssistantWidget'

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantWidget />
    </QueryClientProvider>,
  )
}

const RESPOSTA = {
  queryId: 'q1',
  answer: 'São 30 dias corridos após 12 meses.',
  answered: true,
  source: 'KNOWLEDGE_BASE',
  sources: [
    { id: 'k1', category: 'Férias', question: 'Quantos dias de férias?', answer: 'São 30 dias corridos.' },
  ],
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockAuth.role = 'LEGEND'
  mockAuth.sectorFeatures = ['assistente']
})

describe('AssistantWidget', () => {
  it('não aparece para quem não tem a feature', () => {
    mockAuth.sectorFeatures = []
    renderWidget()
    expect(screen.queryByRole('button', { name: /assistente/i })).toBeNull()
  })

  it('aparece para admin mesmo sem a feature ligada no setor', () => {
    mockAuth.sectorFeatures = []
    mockAuth.role = 'ADMIN'
    renderWidget()
    expect(screen.getByRole('button', { name: /assistente/i })).toBeTruthy()
  })

  it('responde e mostra as fontes usadas', async () => {
    apiFetchMock.mockResolvedValue(RESPOSTA)
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByLabelText('Sua pergunta'), {
      target: { value: 'quantos dias de férias?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))

    expect(await screen.findByText('São 30 dias corridos após 12 meses.')).toBeTruthy()
    expect(screen.getByText('Fontes consultadas')).toBeTruthy()
    expect(screen.getByText('Quantos dias de férias?')).toBeTruthy()
  })

  it('envia o feedback negativo com comentário', async () => {
    apiFetchMock.mockResolvedValue(RESPOSTA)
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))
    await screen.findByText('São 30 dias corridos após 12 meses.')

    apiFetchMock.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Não ajudou' }))
    fireEvent.change(screen.getByLabelText('Comentário (opcional)'), {
      target: { value: 'faltou o período aquisitivo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar avaliação' }))

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/assistant/queries/q1/feedback',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText('Obrigado pelo retorno!')).toBeTruthy()
  })

  it('mostra a mensagem da API quando estoura o limite por hora', async () => {
    const { ApiError } = await import('../../lib/api')
    apiFetchMock.mockRejectedValue(new ApiError(429, 'Você já fez 20 perguntas na última hora.'))
    renderWidget()

    fireEvent.click(screen.getByRole('button', { name: /assistente/i }))
    fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: 'férias?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Perguntar' }))

    expect(await screen.findByText('Você já fez 20 perguntas na última hora.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/assistant/AssistantWidget.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o widget**

Criar `apps/web/src/components/assistant/AssistantWidget.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ASSISTANT_QUESTION_MAX_LENGTH,
  type AskAssistantResponse,
  type AssistantFeedbackRequest,
} from '@legends/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'

/**
 * Assistente de RH: pergunta em linguagem natural, resposta ancorada na base e
 * feedback. Espelha a regra do backend — `requireFeature` libera ADMIN e SUBADMIN
 * mesmo sem a feature no setor, para quem cura a base conseguir testar antes de ligar.
 */
export function AssistantWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<AskAssistantResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rating, setRating] = useState<-1 | 1 | null>(null)
  const [comment, setComment] = useState('')
  const [thanks, setThanks] = useState(false)

  const ask = useMutation({
    mutationFn: (value: string) =>
      apiFetch<AskAssistantResponse>('/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question: value }),
      }),
    onSuccess: (data) => {
      setResult(data)
      setError(null)
      setRating(null)
      setComment('')
      setThanks(false)
    },
    onError: (err: unknown) => {
      setResult(null)
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível falar com a assistente agora.',
      )
    },
  })

  const sendFeedback = useMutation({
    mutationFn: (payload: AssistantFeedbackRequest & { queryId: string }) =>
      apiFetch<void>(`/assistant/queries/${payload.queryId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ rating: payload.rating, comment: payload.comment }),
      }),
    onSuccess: () => setThanks(true),
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível registrar sua avaliação agora.',
      )
    },
  })

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUBADMIN'
  // THIRD_PARTY carrega allowlist individual do convite; os demais, as features do
  // setor — mesmo critério do FeatureGate em App.tsx.
  const features = user?.role === 'THIRD_PARTY' ? user.enabledFeatures : user?.sectorFeatures
  const hasFeature = (features ?? []).includes('assistente')
  if (!user || (!hasFeature && !isAdmin)) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Assistente de RH"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg"
      >
        ?
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
          <h2 className="text-lg font-semibold">Assistente de RH</h2>

          <label className="flex flex-col gap-xs text-sm">
            Sua pergunta
            <textarea
              value={question}
              maxLength={ASSISTANT_QUESTION_MAX_LENGTH}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              className="rounded-lg border border-outline-variant/40 bg-surface p-sm"
            />
          </label>

          <button
            type="button"
            disabled={ask.isPending || question.trim() === ''}
            onClick={() => ask.mutate(question.trim())}
            className="rounded-lg bg-primary px-md py-sm text-on-primary disabled:opacity-50"
          >
            Perguntar
          </button>

          {error && <p className="text-sm text-error">{error}</p>}

          {result && (
            <div className="flex flex-col gap-sm">
              <p className="text-sm">{result.answer}</p>

              {result.sources.length > 0 && (
                <div className="flex flex-col gap-xs">
                  <p className="text-xs font-semibold uppercase text-on-surface-variant">
                    Fontes consultadas
                  </p>
                  <ul className="flex flex-col gap-xs">
                    {result.sources.map((source) => (
                      <li key={source.id} className="rounded-lg bg-surface p-sm text-xs">
                        <p className="font-medium">{source.question}</p>
                        {source.category && (
                          <p className="text-on-surface-variant">{source.category}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {thanks ? (
                <p className="text-sm text-on-surface-variant">Obrigado pelo retorno!</p>
              ) : (
                <div className="flex flex-col gap-xs">
                  <div className="flex gap-sm">
                    <button type="button" onClick={() => setRating(1)} className="rounded-lg border px-sm py-xs text-sm">
                      Ajudou
                    </button>
                    <button type="button" onClick={() => setRating(-1)} className="rounded-lg border px-sm py-xs text-sm">
                      Não ajudou
                    </button>
                  </div>

                  {rating !== null && (
                    <>
                      <label className="flex flex-col gap-xs text-sm">
                        Comentário (opcional)
                        <input
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          className="rounded-lg border border-outline-variant/40 bg-surface p-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          sendFeedback.mutate({
                            queryId: result.queryId,
                            rating,
                            comment: comment.trim() === '' ? null : comment.trim(),
                          })
                        }
                        className="rounded-lg bg-primary px-md py-sm text-on-primary"
                      >
                        Enviar avaliação
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Montar no layout autenticado**

Em `apps/web/src/components/AppLayout.tsx`: importar `import { AssistantWidget } from './assistant/AssistantWidget'` e inserir `<AssistantWidget />` logo depois de `</main>` (por volta da linha 349), ainda dentro do `<div>` externo.

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/components/assistant/AssistantWidget.test.tsx`
Expected: PASS nos 5 casos.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/assistant apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): widget da assistente de RH no layout autenticado"
```

---

## Task 11: Administração — base e lacunas

**Files:**
- Create: `apps/web/src/pages/admin/KnowledgeBaseSection.tsx`
- Create: `apps/web/src/pages/admin/KnowledgeBaseSection.test.tsx`
- Modify: `apps/web/src/App.tsx` (import junto dos demais + `<Route path="base-conhecimento" …>` no bloco `/admin`, perto da linha 431)
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx` (item no grupo "Cultura")

**Interfaces:**
- Consumes: `KnowledgeEntryDTO`, `KnowledgeEntryListResponse`, `AssistantGapsResponse`, `CreateKnowledgeEntryRequest` de `@legends/shared`; `apiFetch`; `useAuth`; `Panel`/`inputCls` de `./shared`.
- Produces: `export function KnowledgeBaseSection(): JSX.Element`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/pages/admin/KnowledgeBaseSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string, sectorId: 'sector-admin' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockAuth.role, name: 'Admin', sectorId: mockAuth.sectorId } }),
}))

import { KnowledgeBaseSection } from './KnowledgeBaseSection'

const ENTRADA = {
  id: 'k1',
  category: 'Férias',
  question: 'Quantos dias de férias?',
  answer: 'São 30 dias corridos.',
  keywords: ['ferias'],
  isActive: true,
  sectorId: null,
  sectorName: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

const GAPS = {
  unanswered: [
    {
      normalized: 'quantos dias de licenca paternidade',
      sample: 'Quantos dias de licença paternidade?',
      count: 5,
      lastAskedAt: '2026-07-30T12:00:00.000Z',
    },
  ],
  frequent: [],
  negative: [{ entry: ENTRADA, negativeCount: 4, comments: ['não diz do período aquisitivo'] }],
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeBaseSection />
    </QueryClientProvider>,
  )
}

function mockApi(entries = [ENTRADA]) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith('/admin/knowledge')) {
      return Promise.resolve({ entries, categories: ['Férias'] })
    }
    if (path.startsWith('/admin/assistant/gaps')) return Promise.resolve(GAPS)
    return Promise.resolve({ sectors: [] })
  })
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockAuth.role = 'ADMIN'
})

describe('KnowledgeBaseSection', () => {
  it('lista as entradas da base', async () => {
    mockApi()
    renderSection()

    expect(await screen.findByText('Quantos dias de férias?')).toBeTruthy()
    expect(screen.getByText('Férias')).toBeTruthy()
  })

  it('cria uma entrada nova', async () => {
    mockApi([])
    renderSection()
    await screen.findByRole('button', { name: 'Nova entrada' })

    fireEvent.click(screen.getByRole('button', { name: 'Nova entrada' }))
    fireEvent.change(screen.getByLabelText('Pergunta'), { target: { value: 'Como peço reembolso?' } })
    fireEvent.change(screen.getByLabelText('Resposta'), { target: { value: 'Pelo portal, até o dia 20.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/admin/knowledge',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('mostra as lacunas agrupadas com contagem', async () => {
    mockApi()
    renderSection()
    await screen.findByText('Quantos dias de férias?')

    fireEvent.click(screen.getByRole('button', { name: 'Lacunas' }))

    expect(await screen.findByText('Quantos dias de licença paternidade?')).toBeTruthy()
    expect(screen.getByText('5×')).toBeTruthy()
    expect(screen.getByText('não diz do período aquisitivo')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/KnowledgeBaseSection.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar a seção**

Criar `apps/web/src/pages/admin/KnowledgeBaseSection.tsx` seguindo o padrão de `HrDashboardsSection.tsx` (mesmos `Panel`/`inputCls` de `./shared`, mesmas mutations com `queryClient.invalidateQueries`):

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ASSISTANT_GAPS_DEFAULT_DAYS,
  type AssistantGapsResponse,
  type CreateKnowledgeEntryRequest,
  type KnowledgeEntryDTO,
  type KnowledgeEntryListResponse,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Panel, inputCls } from './shared'

type Tab = 'base' | 'gaps'

interface FormState {
  id: string | null
  category: string
  question: string
  answer: string
  keywords: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  category: '',
  question: '',
  answer: '',
  keywords: '',
  isActive: true,
}

function toRequest(form: FormState): CreateKnowledgeEntryRequest {
  return {
    category: form.category.trim() === '' ? null : form.category.trim(),
    question: form.question.trim(),
    answer: form.answer.trim(),
    keywords: form.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== ''),
    isActive: form.isActive,
  }
}

export function KnowledgeBaseSection() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('base')
  const [form, setForm] = useState<FormState | null>(null)

  const base = useQuery({
    queryKey: ['admin', 'knowledge'],
    queryFn: () => apiFetch<KnowledgeEntryListResponse>('/admin/knowledge'),
  })

  const gaps = useQuery({
    queryKey: ['admin', 'assistant-gaps'],
    queryFn: () =>
      apiFetch<AssistantGapsResponse>(`/admin/assistant/gaps?days=${ASSISTANT_GAPS_DEFAULT_DAYS}`),
  })

  const salvar = useMutation({
    mutationFn: (state: FormState) =>
      state.id
        ? apiFetch(`/admin/knowledge/${state.id}`, {
            method: 'PATCH',
            body: JSON.stringify(toRequest(state)),
          })
        : apiFetch('/admin/knowledge', { method: 'POST', body: JSON.stringify(toRequest(state)) }),
    onSuccess: () => {
      setForm(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge'] })
    },
  })

  const apagar = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/knowledge/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge'] }),
  })

  const entries: KnowledgeEntryDTO[] = base.data?.entries ?? []

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex gap-sm">
        <button type="button" onClick={() => setTab('base')} aria-pressed={tab === 'base'}>
          Base
        </button>
        <button type="button" onClick={() => setTab('gaps')} aria-pressed={tab === 'gaps'}>
          Lacunas
        </button>
      </div>

      {tab === 'base' && (
        <Panel title="Base de conhecimento">
          <button type="button" onClick={() => setForm({ ...EMPTY_FORM })}>
            Nova entrada
          </button>

          {form && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                salvar.mutate(form)
              }}
              className="flex flex-col gap-sm"
            >
              <label className="flex flex-col gap-xs">
                Pergunta
                <input
                  className={inputCls}
                  value={form.question}
                  onChange={(event) => setForm({ ...form, question: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs">
                Resposta
                <textarea
                  className={inputCls}
                  value={form.answer}
                  onChange={(event) => setForm({ ...form, answer: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs">
                Categoria
                <input
                  className={inputCls}
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs">
                Palavras-chave (separadas por vírgula)
                <input
                  className={inputCls}
                  value={form.keywords}
                  onChange={(event) => setForm({ ...form, keywords: event.target.value })}
                />
              </label>
              <button type="submit">Salvar</button>
            </form>
          )}

          <ul className="flex flex-col gap-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border p-sm">
                <p className="font-medium">{entry.question}</p>
                {entry.category && <p className="text-sm">{entry.category}</p>}
                <p className="text-sm">{entry.answer}</p>
                <div className="flex gap-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        id: entry.id,
                        category: entry.category ?? '',
                        question: entry.question,
                        answer: entry.answer,
                        keywords: entry.keywords.join(', '),
                        isActive: entry.isActive,
                      })
                    }
                  >
                    Editar
                  </button>
                  <button type="button" onClick={() => apagar.mutate(entry.id)}>
                    Apagar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === 'gaps' && (
        <>
          <Panel title="Sem resposta na base">
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.unanswered ?? []).map((gap) => (
                <li key={gap.normalized} className="flex items-center justify-between gap-sm">
                  <span>{gap.sample}</span>
                  <span>{gap.count}×</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('base')
                      setForm({ ...EMPTY_FORM, question: gap.sample })
                    }}
                  >
                    Criar entrada
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Perguntas mais frequentes">
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.frequent ?? []).map((gap) => (
                <li key={gap.normalized} className="flex justify-between gap-sm">
                  <span>{gap.sample}</span>
                  <span>{gap.count}×</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Com mais feedback negativo">
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.negative ?? []).map((item) => (
                <li key={item.entry.id} className="flex flex-col gap-xs">
                  <span className="font-medium">{item.entry.question}</span>
                  <span>−1 ×{item.negativeCount}</span>
                  {item.comments.map((comment, index) => (
                    <span key={index} className="text-sm">
                      {comment}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  )
}
```

### Elementos de UI obrigatórios (o snippet acima é um esqueleto reduzido)

O código de exemplo desta task **não** cobre tudo o que o design exige. A seção só está
completa com:

1. **Seletor de escopo de setor** no formulário (`sectorId` em `FormState` e em
   `toRequest`). ADMIN escolhe entre "Toda a empresa" e cada setor; para SUBADMIN o
   campo fica travado no próprio setor — é isso que justifica o `useAuth()` na seção,
   sem ele a variável é morta. Setores vêm da mesma rota que `HrDashboardsSection.tsx`
   já usa para popular o seletor dela.
2. **Campo "ativo"** — checkbox no formulário, para desativar uma entrada sem apagá-la.
   `isActive` já existe no estado; falta o controle.
3. **Confirmação na exclusão** — `window.confirm` antes de disparar a mutation, no
   padrão das outras seções de admin.
4. **Setor e status na listagem** — cada linha mostra também o setor (ou "Toda a
   empresa") e se está ativa.
5. **Seletor de janela nas Lacunas** — a pessoa escolhe o período (o `days` da query),
   em vez de ficar cravado no padrão.

`Panel` de `./shared` tem assinatura `{ title: string; action?: ReactNode; children: ReactNode }` (`apps/web/src/pages/admin/shared.tsx:7`) e `inputCls` é a classe padrão dos campos — use os dois como acima, sem estilizar por fora.

- [ ] **Step 4: Ligar rota e menu**

Em `apps/web/src/App.tsx`: `import { KnowledgeBaseSection } from './pages/admin/KnowledgeBaseSection'` junto dos demais imports de admin e, dentro do bloco `<Route path="/admin" …>`:

```tsx
                    <Route path="base-conhecimento" element={<KnowledgeBaseSection />} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo `Cultura`, acrescentar:

```ts
      { to: '/admin/base-conhecimento', label: 'Base de conhecimento', featureKey: 'assistente' },
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/KnowledgeBaseSection.test.tsx src/pages/admin/AdminSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/KnowledgeBaseSection.tsx apps/web/src/pages/admin/KnowledgeBaseSection.test.tsx apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): administração da base de conhecimento e painel de lacunas"
```

---

## Task 12: Verificação final

**Files:** nenhum novo — é o gate antes de abrir PR.

**Interfaces:**
- Consumes: tudo.
- Produces: evidência de que a suíte e o typecheck passam.

- [ ] **Step 1: Typecheck**

```bash
./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json
./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
```

Expected: sem saída. Use o **binário direto** — `npx tsc` é interceptado pelo proxy e não é confiável aqui.

- [ ] **Step 2: Suíte completa**

```bash
LEGENDS_DB_PORT=5472 pnpm test
```

Expected: verde. Se a suíte da API vier com falhas em massa sem relação com a mudança, confira se outro worktree está rodando vitest contra o mesmo `legends_test` — os bancos de teste colidem entre worktrees.

- [ ] **Step 3: Checklist dos critérios de aceite**

Confirmar, com o teste que cobre cada um:

- [ ] Pergunta coberta responde com fontes — `routes/assistant.test.ts`
- [ ] Pergunta sem cobertura responde "não encontrei" e registra a lacuna — `services/assistant-service.test.ts`
- [ ] Toda pergunta fica registrada com autor, resposta e entradas casadas — `services/assistant-service.test.ts`
- [ ] Painel lista sem-match e feedback negativo — `services/assistant-service.test.ts`
- [ ] Sem `GEMINI_API_KEY` responde da base — `services/assistant-service.test.ts`
- [ ] Acima do teto responde 429 em português — `routes/assistant.test.ts`
- [ ] Base/histórico de outra empresa nunca vazam — `services/assistant-service.test.ts`, `lib/tenant-scope.test.ts`
- [ ] Só admin/subadmin edita a base — `routes/assistant.test.ts`

- [ ] **Step 4: Commit final se algo foi ajustado**

```bash
git add -A
git commit -m "test: verificação final da assistente de RH"
```
