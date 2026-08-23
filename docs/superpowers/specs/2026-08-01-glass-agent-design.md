# GlassAgent — avaliações externas — design

Data: 2026-08-01
Branch: `admin-glass-agent-portal`
PBI: [#22282](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/22282)

## Problema

Avaliação externa é o termômetro que a empresa não controla e o que mais pesa em
employer branding. Hoje ela é lida uma a uma, no site: sem série histórica, sem recorte
por setor e sem alerta quando um padrão ruim se repete — exatamente quando ainda dá
tempo de agir.

A origem é o `/app/admin/glass` do portal EMR (`src/routes/app.admin.glass.tsx` +
`src/lib/glass.functions.ts`): um agente que recebe a avaliação colada, extrai os campos,
classifica temas e sentimento, e responde comandos de relatório.

O que **não** se deve copiar do portal:

- **Extração e conversa no mesmo prompt.** O modelo lê o texto colado, extrai os campos
  e responde o relatório na mesma passada. Não há schema, não há validação: o que o
  modelo devolver é o que vira dado.
- **O acumulado é o que coube na janela de contexto.** "Nota média por setor" sai do
  modelo somando de cabeça as avaliações que ainda estão no histórico da conversa.
  Número inventado em relatório de RH é dano real — alguém toma decisão de pessoal em
  cima dele.
- **Concorrentes cravados no prompt.** O Legends é whitelabel; a lista de empresas de
  comparação não pode ser constante de código de um cliente.

## Escopo

Entra:

- **Ingestão** — colar a avaliação no formato esperado, revisar os campos extraídos e
  confirmar a gravação.
- **Classificação** — temas positivos e negativos, sentimento e alertas por avaliação.
- **Acumulado** — nota média, tendência mensal e recortes por setor, cargo, tempo de
  casa e status, tudo agregado no Postgres.
- **Relatórios** — comandos de chat que devolvem o painel completo e os recortes.
- **Alertas** — regras determinísticas que disparam quando o padrão configurado aparece.

Não entra: **scraping do Glassdoor** (contra os termos do site — a avaliação chega
colada por uma pessoa) e **identificação de quem escreveu a avaliação**.

## Audiência e acesso

Igual ao agente de Benchmarking, e pelo mesmo motivo: o "líder de Gente e Gestão" é o
**SUBADMIN** do setor de G&G, e o nome do setor não pode ser cravado no código.

```
onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')]
```

| Papel | Resultado |
|---|---|
| ADMIN global | passa sempre |
| SUBADMIN do setor com `gente-gestao` | passa |
| SUBADMIN de outro setor | 403 |
| Colaborador / terceirizado | 403 |

`requireAdminOrSubadmin` **não** serve: libera o SUBADMIN de Engenharia. `requireFeature`
também não: retorna cedo para todo ADMIN e todo SUBADMIN. Ver `AGENTS.md`.

**Quem passa lê a empresa inteira.** O `sector` da avaliação é o setor **avaliado**, um
campo de dado, não o setor de quem lê. Restringir o SUBADMIN de G&G às avaliações cujo
`sector` fosse "Gente e Gestão" deixaria o painel dele vazio e mataria o recorte por
setor, que é o principal valor da tela. O setor entra como **filtro** do relatório, para
ADMIN e SUBADMIN igualmente. O isolamento que importa aqui é o de **empresa**, via
`scopedPrisma(companyId)`.

Web: rota sob `AdminSectorFeatureOnly feature="gente-gestao"`, item no `AdminSidebar`
com `featureKey: 'gente-gestao'`, dentro do bloco Gente e Gestão.

## Decisão 1 — extração e conversa são caminhos separados

É o ganho central da reimplementação. Dois caminhos que nunca se cruzam:

**Extração** (`lib/glass-extraction.ts`) — uma chamada ao Gemini pedindo **só JSON**,
resposta validada por um `z.object` estrito antes de qualquer coisa:

```
raw (texto colado) → chamada de extração → JSON → Zod → rascunho para revisão
```

- Temas vêm de **vocabulário fechado** (`z.enum` sobre `GLASS_THEMES_POSITIVE/NEGATIVE`);
  tema inventado reprova o schema. Sem vocabulário fechado não existe agregação de tema:
  "liderança", "gestão ruim" e "chefia" viram três linhas no relatório.
- Sentimento é `z.enum(['POSITIVO', 'NEUTRO', 'NEGATIVO'])`.
- `status` e `tenure` são validados contra as listas fechadas do contrato — são
  justamente as colunas dos recortes.
- JSON fora do schema → `AgentError` tratado (502, mensagem em português), **sem retry e
  sem gravação parcial**. Retry automático dobraria o custo para o mesmo texto que já
  falhou; a pessoa reenvia se quiser.
- A rota `/parse` **não escreve nada** — nem a avaliação, nem log, nem conversa.

**Conversa** (`services/agent-service.ts`, agente `glass`) — consome o que já está no
banco. Nenhum número da conversa vem do modelo.

O modelo de extração recebe instrução explícita de **nunca inferir identidade**: se o
texto trouxer nome, apelido ou qualquer traço que aponte para uma pessoa, ele é
descartado, não transcrito. Não há campo no schema onde isso caberia.

## Decisão 2 — nulável no banco, obrigatório na gravação

`sector`, `role` e `tenure` são `String?` na coluna: Glassdoor é anônimo e nem toda
avaliação traz tudo, e um import futuro de histórico parcial não pode esbarrar em
`NOT NULL`.

Mas o `POST /admin/glass/reviews` exige os três (Zod `.min(1)`). O `/parse` devolve
`missingFields` com os que faltaram, e a tela abre esses campos vazios e destacados para
a pessoa completar antes de confirmar.

Resultado: registro incompleto não entra pela porta da frente — que é o critério de
aceite — sem travar o schema para sempre.

## Decisão 3 — alertas em duas famílias

Regras determinísticas em `lib/glass-alerts.ts` (funções puras), **nunca no prompt**.
Constantes e chaves em `@legends/shared`.

**Por avaliação** — dependem só da linha, são calculadas na gravação e ficam em `alerts[]`:

| Chave | Condição |
|---|---|
| `NOTA_BAIXA_ATIVO` | `rating ≤ 2` **e** `status = ATIVO` |
| `PALAVRA_CRITICA_BURNOUT` | palavra do grupo burnout em `negatives`/`advice`/`title` |
| `PALAVRA_CRITICA_ASSEDIO` | idem, grupo assédio |
| `PALAVRA_CRITICA_TOXICO` | idem, grupo clima tóxico |
| `PALAVRA_CRITICA_DEMISSAO` | idem, grupo desligamento em massa |

Nota baixa de quem **ainda está na casa** é o alerta que dá tempo de agir; de
ex-funcionário é diagnóstico do passado. Por isso o `status` entra na regra.

Casamento de palavra-chave é sobre o texto **normalizado** (minúsculas, sem acento, via
`NFD`), com fronteira de palavra — `assediado` casa, `assessoria` não.

O grupo de desligamento só reconhece formulação de **massa** ("demissão em massa",
"layoff", "corte de pessoal"). "Demissão" sozinha aparece em quase toda avaliação de
ex-funcionário e viraria alerta permanente — alerta que sempre dispara não é alerta.

**Agregados** — dependem das avaliações vizinhas, calculados no overview a cada leitura:

| Chave | Condição |
|---|---|
| `QUEDA_CONSECUTIVA` | as 3 avaliações mais recentes (por `reviewDate`) todas abaixo da média geral |
| `SETOR_CRITICO` | setor com 3+ avaliações abaixo do corte de nota |

Essas **não podem** ser gravadas em `alerts[]`: mudariam retroativamente a cada nova
avaliação, e a coluna passaria a mentir sobre linhas antigas. Recalcular na leitura é o
único jeito de elas ficarem corretas.

Limiares em `GLASS_ALERT_RULES` (`@legends/shared`), não espalhados pelo código:

```ts
export const GLASS_ALERT_RULES = {
  lowRatingMax: 2,            // NOTA_BAIXA_ATIVO
  consecutiveBelowAverage: 3, // QUEDA_CONSECUTIVA
  sectorLowRatingCutoff: 3,   // nota abaixo da qual conta para SETOR_CRITICO
  sectorMinLowReviews: 3,     // quantas bastam para o setor virar crítico
} as const
```

## Decisão 4 — agregação no Postgres, sem `$queryRaw`

O overview inteiro sai de **uma** consulta: um `findMany` sob `scopedPrisma(companyId)`
que carrega as linhas da empresa, e daí derivam em memória a média, as taxas, a contagem
de temas, os alertas agregados e os quatro recortes (setor, cargo, tempo de casa, status).

A primeira versão usava `prisma.groupBy` com `_avg`/`_count` por recorte — quatro
consultas além do `findMany`, que já carregava as mesmas linhas para a tendência e os
temas. Como as linhas já estão na memória, três colunas a mais no `select` custam menos
que quatro idas ao banco. O cruzamento (`/cruzamento`) segue como `groupBy` de duas
dimensões: é outro caso de uso, sob demanda, e não se beneficia das linhas já carregadas.

A **tendência mensal** não vira SQL cru. `$queryRaw` **escapa da extensão de tenant** —
a extensão intercepta operações do client, não SQL literal — então um `date_trunc` à mão
furaria o isolamento por empresa em silêncio, que é o pior modo de furar. A tendência sai
de `findMany({ select: { reviewDate: true, rating: true } })` com bucketização por
`AAAA-MM` em memória, função pura e testável. O volume é de centenas de linhas por
empresa; o custo é irrelevante perto do risco.

Avaliação sem `reviewDate` fica **fora da tendência** (não há mês onde colocá-la) mas
entra em todos os outros recortes e na média geral.

## Decisão 5 — comando de chat interceptado antes do modelo

`agent-service.ts` já tem o ponto de plugue marcado (`// O GlassAgent (#22282) pluga
aqui`, linha 72). A assinatura interna `buildSystemPrompt(actor, agent)` vira:

```ts
buildAgentTurn(actor, agent, message) → { systemPrompt, dataBlock?: string }
```

Mensagem começando por `/` nunca chega crua ao modelo. O service reconhece o comando,
roda a agregação e devolve os números prontos em `dataBlock`:

| Comando | Devolve |
|---|---|
| `/relatorio` | painel completo: média, contagem, sentimento, temas, alertas |
| `/tendencia` | série mensal |
| `/criticos` | avaliações com alerta, mais recentes primeiro |
| `/cruzamento [dim] [dim]` | cruzamento de duas dimensões (padrão: setor × tempo de casa) |

O `dataBlock` é anexado ao turno enviado ao provedor, mas **a mensagem persistida no
histórico é a original da pessoa**, sem o bloco. Assim a conversa continua legível, o
histórico não incha com tabelas repetidas, e reabrir a conversa amanhã não reexibe
números de ontem como se fossem de hoje.

O bloco vai cercado e marcado como **dado, não instrução**, igual ao inventário do
benchmark — texto de avaliação é escrito por terceiros e é vetor de prompt injection de
graça.

O benchmark passa `dataBlock: undefined` e não muda de comportamento.

Pergunta livre (sem `/`) segue o fluxo normal, com um resumo agregado compacto já no
system prompt — média, contagem, top temas e alertas ativos. O modelo interpreta; os
números continuam vindo do banco.

## Decisão 6 — prompt escrito no molde do benchmark

O portal de origem não está disponível nesta máquina, então o system prompt é redigido
do zero seguindo `lib/benchmark-prompt.ts`: constante isolada + montagem em **função
pura**, empresa por parâmetro (whitelabel), bloco de dados cercado.

Os concorrentes que o portal cravava viram `GLASS_BENCHMARK_COMPANIES` em
`@legends/shared` — lista vazia por padrão, sem nome de cliente no código. Se o arquivo
original aparecer depois, trocar o texto da constante não mexe em mais nada.

## Contrato — `packages/shared/src/glass.ts`

```ts
export type GlassSentiment = 'POSITIVO' | 'NEUTRO' | 'NEGATIVO'

// Vocabulário fechado. Sem ele não existe agregação de tema.
export const GLASS_THEMES_POSITIVE = [
  'AMBIENTE_EQUIPE', 'LIDERANCA', 'APRENDIZADO', 'FLEXIBILIDADE', 'BENEFICIOS',
  'CULTURA_VALORES', 'ESTABILIDADE', 'PROPOSITO', 'ESTRUTURA_FERRAMENTAS',
  'RECONHECIMENTO', 'REMUNERACAO', 'EQUILIBRIO_VIDA_TRABALHO',
] as const

export const GLASS_THEMES_NEGATIVE = [
  'REMUNERACAO', 'SOBRECARGA', 'LIDERANCA_GESTAO', 'PLANO_DE_CARREIRA',
  'COMUNICACAO_INTERNA', 'PROCESSOS_BUROCRACIA', 'CLIMA_TOXICO', 'ROTATIVIDADE',
  'FALTA_DE_RECONHECIMENTO', 'BENEFICIOS_INSUFICIENTES', 'ASSEDIO', 'SAUDE_MENTAL',
  'FALTA_DE_ESTRUTURA', 'INSTABILIDADE',
] as const

export const GLASS_STATUS = ['ATIVO', 'EX_FUNCIONARIO'] as const
// Faixas contínuas, sem buraco: a versão inicial pulava de "1 a 2" para "3 a 5",
// e uma avaliação de "2 anos e meio" não tinha onde cair num campo obrigatório.
export const GLASS_TENURE_BUCKETS = ['MENOS_DE_1_ANO', 'DE_1_A_3_ANOS',
                                     'DE_3_A_5_ANOS', 'MAIS_DE_5_ANOS'] as const

export const GLASS_ALERT_RULES = { /* ver Decisão 3 */ } as const

export const GLASS_CRITICAL_KEYWORDS = {
  burnout:  ['burnout', 'esgotamento', 'exaustao', 'exausto', 'adoeci'],
  assedio:  ['assedio', 'assediada', 'assediado', 'humilhacao', 'humilhada',
             'humilhado', 'constrangimento'],
  toxico:   ['toxico', 'toxica', 'gritaria', 'perseguicao', 'retaliacao'],
  demissao: ['demissao em massa', 'demissoes em massa', 'layoff', 'corte de pessoal',
             'desligamento em massa', 'onda de demissoes'],
} as const

export const GLASS_BENCHMARK_COMPANIES: readonly string[] = []
export const GLASS_COMMANDS = ['/relatorio', '/tendencia', '/criticos', '/cruzamento']
export const GLASS_BREAKDOWN_DIMENSIONS = ['setor', 'cargo', 'tempo', 'status'] as const

export type GlassAlertKey =
  | 'NOTA_BAIXA_ATIVO' | 'PALAVRA_CRITICA_BURNOUT' | 'PALAVRA_CRITICA_ASSEDIO'
  | 'PALAVRA_CRITICA_TOXICO' | 'PALAVRA_CRITICA_DEMISSAO'    // por avaliação
  | 'QUEDA_CONSECUTIVA' | 'SETOR_CRITICO'                     // agregados

export const GLASS_ALERT_LABELS: Record<GlassAlertKey, string> = { /* em português */ }

export interface GlassReviewDTO { /* campos do model, sem autoria */ }
export interface GlassReviewDraftDTO { /* rascunho do /parse */ }
export interface GlassParseResponse { draft: GlassReviewDraftDTO; missingFields: string[] }
export interface GlassBreakdownRowDTO { key: string; count: number; averageRating: number | null }
export interface GlassAggregateAlertDTO {
  key: GlassAlertKey
  /** Setor em SETOR_CRITICO; ausente em QUEDA_CONSECUTIVA, que é da empresa. */
  scope?: string
  /** Quantas avaliações sustentam o alerta — a tela mostra o porquê, não só o aviso. */
  count: number
}
export interface GlassOverviewDTO {
  totalReviews: number
  averageRating: number | null
  recommendRate: number | null
  leadershipApprovalRate: number | null
  sentimentCounts: Record<GlassSentiment, number>
  trend: { month: string; averageRating: number; count: number }[]
  bySector: GlassBreakdownRowDTO[]
  byRole: GlassBreakdownRowDTO[]
  byTenure: GlassBreakdownRowDTO[]
  byStatus: GlassBreakdownRowDTO[]
  topThemesPositive: { theme: string; count: number }[]
  topThemesNegative: { theme: string; count: number }[]
  alerts: GlassAggregateAlertDTO[]
}
```

Contrato primeiro, barril `index.ts`, e só então os dois lados.

## Modelo

```prisma
enum GlassSentiment { POSITIVO NEUTRO NEGATIVO }

/// Avaliação externa (Glassdoor) colada por um administrador. Anônima por
/// construção: `createdById` é quem COLOU, nunca quem escreveu.
model GlassReview {
  id                 String          @id @default(cuid())
  companyId          String
  reviewDate         DateTime?
  rating             Decimal?        @db.Decimal(2, 1)
  role               String?
  level              String?
  sector             String?
  tenure             String?
  status             String?
  recommends         Boolean?
  leadershipApproval Boolean?
  title              String?
  positives          String?
  negatives          String?
  advice             String?
  sentiment          GlassSentiment?
  themesPositive     String[]
  themesNegative     String[]
  alerts             String[]
  aiSummary          String?
  createdById        String?
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  company   Company @relation(fields: [companyId], references: [id])
  createdBy User?   @relation("GlassReviewsCreated", fields: [createdById], references: [id], onDelete: SetNull)

  @@index([companyId, reviewDate])
  @@index([companyId, sector])
}
```

`status` e `tenure` seguem `String` na coluna (validados contra a lista fechada na
escrita): o Glassdoor pode introduzir uma faixa nova e isso não deve exigir migration.
`rating` é `Decimal(2,1)` — nota é 1,0 a 5,0, e `Float` para média de RH é convite a
`4.199999999999999` na tela.

`GlassReview` entra em `TENANT_SCOPED_MODELS` (`lib/tenant-scope.ts:8`) — **sem isso não
há isolamento nenhum**, a lista é manual por decisão do design de multi-empresa.

Migration nova via `pnpm db:migrate`. Nenhuma migration aplicada é editada.

## Rotas — `apps/api/src/routes/glass.ts`

Todas sob `[app.authenticate, app.requireSectorFeature('gente-gestao')]`. Rota fina:
`safeParse` → `400 { message, issues }`, chama o service, serializa.

| Método | Rota | O que faz |
|---|---|---|
| POST | `/admin/glass/reviews/parse` | extrai e devolve para revisão, **sem gravar** |
| POST | `/admin/glass/reviews` | grava o revisado, com temas/sentimento/alertas |
| GET | `/admin/glass/overview` | agregações + alertas agregados (`from`, `to`, `sector`) |
| GET | `/admin/glass/reviews` | lista paginada (`sector`, `status`, `withAlerts`) |

Erro de domínio é `AgentError` (classe já existente, com `status`), tratado pelo mesmo
`handleAgentError` do `routes/agents.ts`. Mutação grava `recordAuditLog` **dentro da
mesma transação** da escrita.

## Arquivos

```
packages/shared/src/glass.ts                     contrato + constantes (+ barril)
apps/api/prisma/schema.prisma                    model + enum + migration
apps/api/src/lib/tenant-scope.ts                 registra GlassReview
apps/api/src/lib/glass-prompt.ts                 system prompt + montagem pura
apps/api/src/lib/glass-extraction.ts             schema Zod + chamada de extração
apps/api/src/lib/glass-alerts.ts                 regras determinísticas puras
apps/api/src/lib/glass-trend.ts                  bucketização mensal pura
apps/api/src/lib/serialize.ts                    toGlassReviewDTO
apps/api/src/services/glass-review-service.ts    parse / create / list
apps/api/src/services/glass-overview-service.ts  agregações + alertas agregados
apps/api/src/services/agent-service.ts           buildAgentTurn + ramo glass
apps/api/src/routes/glass.ts                     4 rotas
apps/api/src/app.ts                              registra glassRoutes
apps/web/src/lib/glass-api.ts                    cliente HTTP
apps/web/src/pages/admin/glass/GlassAgentSection.tsx  abas
apps/web/src/pages/admin/glass/GlassIngestTab.tsx
apps/web/src/pages/admin/glass/GlassPanelTab.tsx
apps/web/src/pages/admin/glass/GlassChatTab.tsx
apps/web/src/App.tsx                             rota /admin/glass
apps/web/src/pages/admin/AdminSidebar.tsx        item no bloco G&G
```

Web em pasta própria: o `BenchmarkAgentSection.tsx` já tem 16 KB com duas abas; três
abas num arquivo só passaria de 25 KB, e as abas não compartilham estado além da
seleção.

A extração e as agregações ficam em arquivos separados do service de propósito — são as
duas partes com lógica pura densa, e teste de regra de alerta não deve precisar de banco.

## Testes

Vitest ao lado de cada arquivo. API contra Postgres real (`pnpm db:up`; nesta máquina
`LEGENDS_DB_PORT=5442`).

- **Extração** — JSON malformado, tema fora do vocabulário e sentimento inválido são
  recusados com erro tratado; nada é gravado em nenhum dos casos.
- **`/parse` não escreve** — depois da chamada, a contagem de `GlassReview` continua zero.
- **Campo faltando** — avaliação sem setor/cargo/tempo devolve `missingFields` com os
  três; `POST /reviews` sem eles responde 400 e não grava.
- **Alertas por avaliação** — cada regra com um caso que dispara e um que **não**:
  nota 2 de ex-funcionário não alerta; "assessoria" não casa com o grupo assédio;
  "demissão" sozinha não dispara, "demissão em massa" dispara.
- **Alertas agregados** — 3 abaixo da média disparam, 2 não; setor com 3 abaixo do corte
  dispara, com 2 não.
- **Agregações** — média, tendência e cada recorte conferidos contra dados semeados,
  valor a valor; avaliação sem `reviewDate` fora da tendência e dentro da média.
- **Escopo por empresa** — avaliação de outra empresa não aparece em overview, lista nem
  comando.
- **Acesso** — SUBADMIN sem `gente-gestao` leva 403 nas quatro rotas; colaborador idem.
- **Anonimato** — o DTO não expõe `createdById`, e nenhum campo carrega autoria.
- **Comando** — `/relatorio` chama a agregação e o duplo do modelo recebe o `dataBlock`;
  a mensagem persistida é a original, sem o bloco.
- **Web** — ingestão mostra os campos extraídos antes de gravar e destaca os faltantes;
  painel renderiza os recortes; chat reaproveita o componente de conversa.

## Riscos

- **Custo de IA por colagem.** Cada `/parse` é uma chamada. A chave é da empresa
  (`ai-settings-service`), sem fallback de ambiente, então o custo é visível e do dono
  do dado. Sem chave cadastrada, 503 tratado.
- **Vocabulário fechado envelhece.** Tema novo exige mudar a constante e um deploy. É o
  preço de a agregação de tema existir; a alternativa (texto livre) não agrega.
- **Volume.** A bucketização em memória assume centenas de avaliações por empresa. Se
  algum tenant passar de dezenas de milhares, a tendência vira uma view materializada —
  não hoje.
