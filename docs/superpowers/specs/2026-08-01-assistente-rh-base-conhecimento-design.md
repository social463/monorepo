# Assistente de RH com base de conhecimento — design

Data: 2026-08-01
Branch: `feature-emily-admin-crud`

## Problema

As mesmas perguntas de RH chegam no privado toda semana: férias, benefício, política,
quem procurar. O Legends não tem canal de autoatendimento, e Gente e Gestão não tem
visibilidade do que as pessoas **não** estão encontrando — que é justamente o insumo
para melhorar comunicação e documentação.

A origem é o `/app/admin/emily` do portal EMR: CRUD de base de conhecimento
(`emily_knowledge`: categoria, pergunta, resposta, palavras-chave), com as perguntas em
`emily_queries` e o feedback de utilidade em `emily_feedback` alimentando um relatório
de uso.

## Escopo

Entra:

- **Base curada** — CRUD de pergunta/resposta com categoria e palavras-chave, mantido
  por Gente e Gestão.
- **Assistente** — a pessoa pergunta em linguagem natural e recebe resposta ancorada na
  base, com as fontes usadas.
- **Feedback** — polegar para cima/baixo com comentário opcional na resposta.
- **Lacunas** — painel com perguntas mais frequentes, perguntas sem resposta na base e
  itens com feedback negativo: a fila de trabalho de quem cura a base.

Não entra: integração com Slack/Teams, upload de PDF de política com indexação
automática, voz, e agrupamento de perguntas por similaridade semântica no painel de
lacunas (o agrupamento é por texto normalizado — ver "Lacunas").

## Audiência e acesso

- **Colaborador** (qualquer papel autenticado em setor com a feature ligada) — usa o
  widget de chat, dá feedback na resposta que recebeu.
- **SUBADMIN** — cura a base: enxerga as entradas da empresa (`sectorId = null`) e as do
  próprio setor; **escreve só** nas do próprio setor. Vê o painel de lacunas.
- **ADMIN** — cura tudo e filtra por setor.

O "líder de Gente e Gestão" do enunciado é o SUBADMIN do setor "Gente e Gestão".

A entrega original esboçou `KnowledgeEntry` sem `sectorId` mas pediu, no acesso,
"restringir o SUBADMIN ao próprio sectorId". A contradição se resolve com `sectorId`
nulável, exatamente como `HrDashboard`: `null` = vale para a empresa inteira.

## Gate por setor

Nova `FeatureKey` **`assistente`** em `packages/shared/src/third-party.ts`
(`FEATURE_KEYS` + `FEATURE_LABELS`: "Assistente de RH"). O widget só aparece para quem
está em setor com a feature ligada, e `POST /assistant/ask` fica atrás de
`app.requireFeature('assistente')` — que lê `request.user.features` do JWT. Permite
rollout gradual por setor e mantém `THIRD_PARTY` de fora por padrão.

`requireFeature` **libera ADMIN e SUBADMIN independentemente da feature**
(`app.ts:87`): quem cura a base consegue testar a assistente antes de ligá-la para o
setor. O widget no front espelha essa regra — aparece com a feature ligada **ou** para
ADMIN/SUBADMIN.

As rotas de curadoria **não** passam pelo gate de feature: são protegidas por
`app.requireAdminOrSubadmin`, como as demais rotas de administração.

## Contrato — `packages/shared/src/assistant.ts`

```ts
export const ASSISTANT_QUESTION_MIN_LENGTH = 3
export const ASSISTANT_QUESTION_MAX_LENGTH = 500
export const ASSISTANT_ANSWER_MAX_LENGTH = 5000
export const ASSISTANT_CATEGORY_MAX_LENGTH = 60
export const ASSISTANT_KEYWORD_MAX_LENGTH = 40
export const ASSISTANT_KEYWORDS_MAX_COUNT = 20
export const ASSISTANT_COMMENT_MAX_LENGTH = 500
/** Teto de perguntas por pessoa por hora. */
export const ASSISTANT_HOURLY_LIMIT = 20
/** Quantas entradas da base entram como contexto (e viram `sources`). */
export const ASSISTANT_MAX_SOURCES = 3
export const ASSISTANT_NOT_FOUND_MESSAGE =
  'Não encontrei essa informação na base de conhecimento. Sua pergunta foi registrada para o time de Gente e Gestão.'

export const ASSISTANT_ANSWER_SOURCES = ['AI', 'KNOWLEDGE_BASE', 'NONE'] as const
export type AssistantAnswerSource = (typeof ASSISTANT_ANSWER_SOURCES)[number]

export interface KnowledgeEntryDTO {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
  isActive: boolean
  /** null = entrada da empresa inteira. */
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
  /** false quando nada casou: a resposta é o ASSISTANT_NOT_FOUND_MESSAGE. */
  answered: boolean
  /** Como a resposta foi produzida (a UI diferencia "gerado por IA" de "trecho da base"). */
  source: AssistantAnswerSource
  sources: AssistantSourceDTO[]
}

export interface AssistantFeedbackRequest {
  rating: -1 | 1
  comment?: string | null
}

/** Uma pergunta agrupada pelo texto normalizado. */
export interface AssistantGapDTO {
  /** Texto normalizado (chave do agrupamento). */
  normalized: string
  /** Um exemplo legível, como alguém digitou. */
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

## Dados — Prisma

```prisma
model KnowledgeEntry {
  id          String   @id @default(cuid())
  category    String?
  question    String
  answer      String
  keywords    String[]
  isActive    Boolean  @default(true)
  sectorId    String?
  createdById String
  companyId   String   @default("company-emr")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company   Company @relation(fields: [companyId], references: [id])
  sector    Sector? @relation(fields: [sectorId], references: [id], onDelete: SetNull)
  createdBy User    @relation("KnowledgeEntryAuthor", fields: [createdById], references: [id])

  @@index([companyId, isActive])
  @@index([companyId, sectorId])
}

model AssistantQuery {
  id              String   @id @default(cuid())
  userId          String
  question        String
  answer          String?
  matchedEntryIds String[]
  companyId       String   @default("company-emr")
  createdAt       DateTime @default(now())

  company  Company            @relation(fields: [companyId], references: [id])
  user     User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  feedback AssistantFeedback?

  @@index([companyId, createdAt])
  @@index([userId, createdAt])
}

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
  user    User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([companyId, rating])
}
```

Migration nova via `pnpm db:migrate`. Os três models entram em `TENANT_SCOPED_MODELS`
(`apps/api/src/lib/tenant-scope.ts`) — a lista é mantida à mão, e model fora dela não
recebe isolamento nenhum.

Decisões que valem registro:

- **`queryId @unique`** — um feedback por pergunta; reclicar atualiza o existente. O
  service faz `findFirst` + `update`/`create`, **não** `upsert`: a extensão de
  isolamento lança `TenantScopeError` em `upsert`.
- **`matchedEntryIds` é `String[]`, não relação** — o histórico registra o que
  aconteceu na hora. Entrada apagada depois deixa id órfão; o painel de lacunas ignora
  id que não resolve mais, em vez de reescrever o passado.
- **`rating Int`** com −1/1 validado no Zod, como pedido na entrega. O banco aceitaria
  outros inteiros; a rota é a fronteira.

## Recuperação — `apps/api/src/lib/assistant-search.ts`

Função pura, sem I/O, testável sem banco:

```ts
export interface RankableEntry {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
}

export function rankKnowledgeEntries(
  entries: RankableEntry[],
  question: string,
  limit = ASSISTANT_MAX_SOURCES,
): RankableEntry[]
```

Normalização: minúscula, `normalize('NFD')` com remoção de diacríticos, pontuação fora,
split por espaço. Descarta tokens com menos de 3 caracteres e stopwords pt-BR (`para`,
`como`, `qual`, `quanto`, `sobre`, `posso`, …). Pontuação por token presente:
**palavra-chave 3, pergunta 2, resposta 1**. Exige pelo menos um token significativo
casado e um piso mínimo de pontuação; devolve o top N ordenado por pontuação
decrescente, desempatando por `question` (ordem estável, teste determinístico).

**Por que não full-text do Postgres.** A entrega pedia `to_tsvector`, mas `scopedPrisma`
é uma extensão do Prisma Client: `$queryRaw` passa por fora dela e o isolamento por
empresa viraria responsabilidade manual de cada consulta. `corporate-mural-service.ts`
e `coin-admin-service.ts` já recusam SQL cru pelo mesmo motivo. Na escala de um FAQ de
RH (dezenas a poucas centenas de entradas), carregar as entradas ativas da empresa e
ranquear em memória é barato, mantém o isolamento garantido pela extensão e dá teste
determinístico. Se a base crescer a ponto de doer, o caminho é trocar só o interior
desta função — a interface não muda.

## Backend

### Service — `apps/api/src/services/assistant-service.ts`

`askAssistant(actor, question)`:

1. **Teto horário** — `assistantQuery.count({ where: { userId, createdAt: { gte: agora - 1h } } })`
   via `scopedPrisma`; `>= ASSISTANT_HOURLY_LIMIT` lança `AssistantError(429)` com
   mensagem em português. Usa o índice `[userId, createdAt]`.
2. **Candidatas** — `knowledgeEntry.findMany({ where: { isActive: true, OR: [{ sectorId: null }, { sectorId: actor.sectorId }] } })`.
3. **Ranking** — `rankKnowledgeEntries`.
4. **Sem match** — grava `AssistantQuery` com `matchedEntryIds: []` e
   `answer: ASSISTANT_NOT_FOUND_MESSAGE`; responde `answered: false`, `source: 'NONE'`,
   `sources: []`. É o array vazio que marca a lacuna.
5. **Com match e `GEMINI_API_KEY`** — chama o Gemini com o prompt montado (abaixo);
   `source: 'AI'`.
6. **Sem chave, ou erro do Gemini** — devolve a resposta da entrada mais bem pontuada,
   com `source: 'KNOWLEDGE_BASE'` e todas as fontes casadas. Falha da IA é logada e
   degradada, nunca 500 — mesma postura da avaliação de selos pós-voto.

Em todos os casos a `AssistantQuery` é gravada com autor, pergunta, resposta e ids
casados.

`recordAssistantFeedback(actor, queryId, input)` — carrega a query pelo escopo da
empresa (404 se não existir), exige `query.userId === actor.id` (403 caso contrário),
e cria ou atualiza o feedback.

`listKnowledgeEntries` / `createKnowledgeEntry` / `updateKnowledgeEntry` /
`deleteKnowledgeEntry` — CRUD reaproveitando o padrão de `hr-dashboard-service.ts`:
`resolveSectorIdForWrite` (SUBADMIN sem `sectorId` explícito assume o próprio; escopo
diferente é 403) e `assertCanManage`. Cada mutação chama `recordAuditLog` com
`entityType: 'KnowledgeEntry'` **dentro da mesma transação**.

`listAssistantGaps(actor, filtros)` — ver "Lacunas".

Erros de domínio: `AssistantError` com `status`, em `apps/api/src/lib/assistant-error.ts`
(espelha `hr-dashboard-error.ts`). A rota faz `instanceof` e responde com `err.status`;
o resto sobe.

### Prompt — `apps/api/src/lib/gemini-client.ts`

Segue o padrão de `buildCongratsPrompt`: montagem pura, chamada de rede separada.

```ts
export interface AssistantPromptInput {
  question: string
  entries: { category: string | null; question: string; answer: string }[]
}

export function buildAssistantPrompt(input: AssistantPromptInput): string
export function buildAssistantAnswer(
  input: AssistantPromptInput,
  env?: NodeJS.ProcessEnv,
): Promise<string>
```

O prompt instrui, em português: responder **exclusivamente** com base nos trechos
fornecidos; quando os trechos não cobrirem a pergunta, dizer que não encontrou em vez
de completar com conhecimento próprio; não inventar número, prazo ou política; não usar
markdown. Sem esse ancoramento a assistente inventa política interna — o pior resultado
possível para RH.

**Privacidade garantida pela assinatura**: `AssistantPromptInput` só admite a pergunta e
os campos textuais das entradas. Nome, e-mail ou qualquer dado de terceiro não têm por
onde entrar no prompt. O histórico é sempre lido por `scopedPrisma(companyId)`, então
base e perguntas de outra empresa nunca chegam ao contexto.

### Lacunas

`listAssistantGaps` lê as `AssistantQuery` da empresa numa janela (padrão: 30 dias) e
agrupa pelo texto normalizado da pergunta — a mesma normalização da busca, exposta como
`normalizeQuestion` em `assistant-search.ts` e testada à parte. Para cada grupo:
`count`, `lastAskedAt` e um `sample` legível (a ocorrência mais recente).

- `unanswered` — grupos cujas queries têm `matchedEntryIds` vazio, ordenados por
  `count` desc.
- `frequent` — grupos com match, ordenados por `count` desc.
- `negative` — feedbacks `rating: -1` da janela; para cada um, os `matchedEntryIds` da
  query são contabilizados por entrada. Entradas ordenadas por número de negativos, com
  os comentários deixados. Ids que não resolvem mais (entrada apagada) são ignorados.

A mesma dúvida repetida por 20 pessoas vira **uma** linha com contador — o que afoga uma
fila de curadoria é a lista crua.

### Rotas — `apps/api/src/routes/assistant.ts`

Rota fina: `safeParse` → `400 { message, issues }`, chama o service, serializa com
`lib/serialize.ts` (`toKnowledgeEntryDTO`, `toAssistantSourceDTO`). Registrada em
`src/app.ts`.

| Método | Rota | Guarda |
| --- | --- | --- |
| POST | `/assistant/ask` | `authenticate` + `requireFeature('assistente')` |
| POST | `/assistant/queries/:id/feedback` | `authenticate` |
| GET | `/admin/knowledge` | `authenticate` + `requireAdminOrSubadmin` |
| POST | `/admin/knowledge` | `authenticate` + `requireAdminOrSubadmin` |
| PATCH | `/admin/knowledge/:id` | `authenticate` + `requireAdminOrSubadmin` |
| DELETE | `/admin/knowledge/:id` | `authenticate` + `requireAdminOrSubadmin` |
| GET | `/admin/assistant/gaps` | `authenticate` + `requireAdminOrSubadmin` |

`rating` é validado com `z.union([z.literal(-1), z.literal(1)])` — `0` e `2` são 400.
`GET /admin/knowledge` aceita `q`, `category`, `sectorId` e `isActive` como filtros
opcionais; `GET /admin/assistant/gaps` aceita `days` (padrão 30) e `limit`.

## Frontend

### Widget — `apps/web/src/components/assistant/AssistantWidget.tsx`

Botão flutuante montado no `AppLayout`, renderizado só quando a feature `assistente`
está nas features do usuário. Painel com campo de pergunta, resposta, bloco de fontes
("Fontes consultadas", uma por entrada casada) e os botões 👍/👎 com campo de comentário
opcional. Estado da conversa é local ao painel (não persiste entre recarregamentos —
o histórico serve à curadoria, não ao usuário).

Dados via React Query + `apiFetch`. O `429` mostra a mensagem de limite vinda da API,
não um erro genérico.

### Administração — `apps/web/src/pages/admin/KnowledgeBaseSection.tsx`

Duas abas, no padrão do `CorporateMuralReachTab`:

- **Base** — tabela com pergunta, categoria, setor e status; formulário de criação e
  edição (pergunta, resposta, categoria, palavras-chave, escopo de setor, ativo);
  exclusão com confirmação. Para SUBADMIN o seletor de setor fica travado no próprio.
- **Lacunas** — as três listas (sem resposta, mais frequentes, feedback negativo) com
  seletor de janela. Cada linha de "sem resposta" tem atalho para criar uma entrada já
  com a pergunta preenchida — é a fila virando trabalho.

Rota aninhada `/admin/base-conhecimento` em `App.tsx` sob `/admin`; item "Base de
conhecimento" no grupo **Cultura** do `AdminSidebar.tsx`, com
`featureKey: 'assistente'`.

## Testes

Vitest, arquivos ao lado do código. A API roda contra Postgres real — subir com
`pnpm db:up` na porta padrão 5432.

- `lib/assistant-search.test.ts` — casa por palavra-chave e por termo da pergunta;
  acento e caixa são irrelevantes; stopword sozinha não casa; ordenação por peso
  (palavra-chave acima de pergunta, pergunta acima de resposta); `normalizeQuestion`
  agrupa variações da mesma dúvida.
- `lib/gemini-client.test.ts` — snapshot de `buildAssistantPrompt`; teste garantindo que
  o prompt contém a instrução de não extrapolar o contexto.
- `services/assistant-service.test.ts` — pergunta coberta devolve resposta com fontes;
  pergunta sem cobertura devolve o "não encontrei" e registra a lacuna; sem
  `GEMINI_API_KEY` devolve a melhor resposta da base em vez de erro; acima do teto
  horário lança 429; base e histórico de outra empresa nunca entram no contexto nem nas
  lacunas; SUBADMIN não escreve fora do próprio setor; mutação grava auditoria.
- `routes/assistant.test.ts` — `rating: 0` e `rating: 2` → 400; feedback em pergunta de
  outra pessoa → 403; LEGEND em `/admin/knowledge` → 403; feature desligada em
  `/assistant/ask` → 403; `429` responde com mensagem em português.
- `pages/admin/KnowledgeBaseSection.test.tsx` — lista, cria e apaga entrada; aba de
  lacunas mostra contagem agrupada.
- `components/assistant/AssistantWidget.test.tsx` — renderiza fontes da resposta, envia
  feedback, e mostra a mensagem de limite no 429.

## Critérios de aceite

- Pergunta coberta pela base recebe resposta ancorada e lista as fontes usadas.
- Pergunta sem cobertura recebe "não encontrei" explícito — a assistente não inventa
  política interna.
- Toda pergunta fica registrada com quem perguntou, o que foi respondido e quais
  entradas casaram.
- O painel de lacunas lista perguntas sem match e respostas com feedback negativo.
- Sem `GEMINI_API_KEY`, a assistente devolve os melhores resultados da base em vez de
  erro.
- Acima do teto de perguntas por hora, a API responde 429 com mensagem em português.
- Base e histórico de outra empresa nunca são usados como contexto.
- Só ADMIN e SUBADMIN editam a base; SUBADMIN só no próprio setor.
