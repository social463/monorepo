# Comunidade INOVA — Painel Administrativo

Data: 2026-09-05

## Contexto

O levantamento do que falta do projeto original (fonte: `codigo-fonte-inova-emr.zip`) apontou o **painel administrativo executivo** como a maior peça de valor real ainda não portada: métricas de impacto, insights automáticos, gráficos de resultado, visão por setor, e um chat de IA que responde perguntas livres sobre os projetos. Hoje o módulo só tem o kanban com o painel "Evolução das Áreas" (ranking simples por pontos de fase).

Este spec cobre só o painel administrativo. **Fora de escopo, deliberadamente**:

- **Mini-kanban do painel** (3 colunas largas: não iniciados/em andamento/em execução) — redundante com o kanban de 6 fases que já existe em Projetos.
- **`AdminUsersPage`** (promove/rebaixa admin) — o Legends já tem seu próprio sistema de papéis (ADMIN/SUBADMIN + feature de setor); não existe um equivalente "admin do INOVA" à parte.
- **`AnalyticsPage`** (log de acesso por página, visitas únicas) — é analytics de **uso do produto**, não de **impacto dos projetos**. Categoria diferente do que este spec cobre; pode virar uma iniciativa própria depois, aproveitando `AnalyticsEvent`/`AccessLog` que já existem no Legends.
- Módulo "Guia AI First" — já deferido no spec anterior.

## Global Constraints

- Módulo INOVA continua restrito à empresa `emr` (trava dupla já existente: `INOVA_ALLOWED_COMPANY_SLUG` + `inova_module_enabled`) — nada aqui muda essa trava.
- Acesso ao painel: mesmo gate de quem pode criar/editar projeto (`app.requireAdminOrSubadmin` no backend, `canAdminister(user)` no front — já usado para "Novo projeto" e o toggle de prioridade).
- **Sem endpoint de agregação novo.** Todo o cálculo de métricas/gráficos é client-side, a partir de `listInovaProjects({archived: false})` — mesmo padrão já usado no painel "Evolução das Áreas". O volume (dezenas de projetos) não justifica agregação no servidor.
- **Projetos arquivados são excluídos** de todas as métricas, gráficos e do "Overview por Setor" — mesmo critério do ranking.
- **Sem biblioteca de gráficos nova.** Este repo já resolve gráfico com SVG à mão (`apps/web/src/components/analytics/AnalyticsPrimitives.tsx`, usado pelo People Analytics) — decisão de projeto documentada no próprio arquivo: "uma lib de chart traria ~500 KB e um tema paralelo ao design system". Reaproveita-se `StatCard`, `ChartCard`, `EmptyState`, `DistributionBars` como estão; os dois gráficos sem equivalente pronto (valores em R$/horas por setor, e a série temporal de dois traços) ganham componentes novos no mesmo estilo, num arquivo próprio do INOVA (não dentro de `AnalyticsPrimitives.tsx`, que é do People Analytics).
- Textos institucionais específicos da EMR do original (frases fixas por setor, ícone fixo por nome de setor) **não** entram — `Sector` é cadastro do cliente no Legends, não um enum fixo de 8 valores. Fallback genérico em todo lugar que o original tinha copy hardcoded por setor.

## 1. Navegação e página

Nova aba **"Painel"** em `InovaLayout` (`/comunidade-inova/painel`), ao lado de Início/Projetos/Recursos/Como usar — visível só quando `canAdminister(user)`. Página nova: `InovaAdminPanelPage.tsx`.

## 2. Filtro global

Reproduz o filtro do original: **setor** (select, "Todos os setores" + lista de setores presentes nos projetos) e **período** (`all` | `year` | `month`, com selects de ano/mês que só aparecem conforme o modo). Estado local (`useState`), sem persistência em `sessionStorage` nesta leva — é overkill para uma tela que o admin abre pontualmente, diferente do filtro do kanban de Projetos que já existia antes.

```ts
type PeriodMode = 'all' | 'year' | 'month'

function matchesPeriod(project: InovaProjectDTO, mode: PeriodMode, year: string, month: string): boolean {
  if (mode === 'all') return true
  const inRange = (raw: string) => {
    const y = raw.slice(0, 4)
    if (mode === 'year') return y === year
    return y === year && raw.slice(5, 7) === month
  }
  if (inRange(project.createdAt)) return true
  // Só createdAt está disponível no DTO de listagem hoje (sem phaseHistory/diary
  // embutidos) — diferente do original, que testava também phaseHistory e diary.
  // Suficiente para o filtro de período: um projeto "aparece" no painel do mês em
  // que foi criado, que é a leitura que mais importa (quando a comunidade cresceu).
  return false
}
```

Dois escopos derivados (mesma separação do original):
- `scopedProjects` — filtrado por setor + período. Alimenta métricas, insights, ROI, gráfico de categoria, overview por setor, chat de IA.
- `filteredForSectorChart` — só por setor (SEM período): "Projetos por Setor" e "Pessoas por Área" mostram a distribuição total, para leitura comparativa entre setores mesmo com um período estreito selecionado. Mesmo comportamento do original (`sectorDistribution`/`peopleBySector` usam `projects`, não `filtered`).

## 3. Métricas (5 `StatCard`s)

Reaproveita `StatCard` de `AnalyticsPrimitives.tsx` (`{icon, label, value, hint}`) num grid `grid-cols-2 lg:grid-cols-5 gap-md`:

| Ícone (Material Symbols) | Label | Valor |
|---|---|---|
| `payments` | Economia Estimada | `R$ ${totalCostReduction.toLocaleString('pt-BR')}` — soma de `costReduction` de `scopedProjects` |
| `schedule` | Horas Economizadas/mês | `${totalHoursSaved}h` — soma de `hoursSaved` de `scopedProjects` |
| `rocket_launch` | Projetos Ativos | `scopedProjects.length` |
| `apartment` | Áreas Participando | `presentSectors.size`/total de setores da empresa — fração (ex. "3/5"), setores com ao menos 1 projeto sobre o total cadastrado, sem escopo de período — é sobre a base toda |
| `groups` | Pessoas na Comunidade | contagem de `responsible1`/`responsible2` únicos em `scopedProjects` |

O card "Áreas Participando" ganha um `hint` com os setores da empresa (via `listSectors`, já existe endpoint) que não aparecem em nenhum projeto: `"Sem projetos ativos: X, Y"` — só quando a lista não é vazia.

## 4. Insights automáticos

Lista de texto (não é gráfico), mesma heurística do original, recalculada a cada mudança de filtro:

```ts
function buildInsights(scoped: InovaProjectDTO[], sectorDistribution: {sector: string; count: number}[], missingSectors: string[], filterSector: string): string[] {
  const list: string[] = []
  if (sectorDistribution.length > 0) {
    const top = sectorDistribution[0]
    list.push(`${top.sector} é o setor com maior número de projetos ativos (${top.count}).`)
  }
  const categoryBreakdown = countBy(scoped, (p) => p.category)
  const automacao = categoryBreakdown.find((c) => c.category === 'Automação de processos')
  if (automacao && scoped.length > 0) {
    const pct = Math.round((automacao.count / scoped.length) * 100)
    list.push(`Automação representa ${pct}% dos projetos ${filterSector === 'all' ? 'ativos' : `em ${filterSector}`}.`)
  }
  if (missingSectors.length > 0) {
    list.push(`${missingSectors.length} ${missingSectors.length === 1 ? 'setor está' : 'setores estão'} sem projetos em andamento.`)
  }
  const phaseBreakdown = countBy(scoped, (p) => p.phase)
  const topPhase = phaseBreakdown[0]
  if (topPhase) {
    list.push(`A maior parte dos projetos está em "${phaseLabel(topPhase.phase)}" (${topPhase.count}).`)
  }
  const totalCost = scoped.reduce((s, p) => s + (p.costReduction ?? 0), 0)
  if (totalCost > 0) {
    list.push(`Economia estimada acumulada: R$ ${totalCost.toLocaleString('pt-BR')}.`)
  }
  return list.slice(0, 5)
}
```

Renderizado como `ul` de cards pequenos (`bg-primary/5 border border-primary/20 rounded-xl p-sm`, ícone `auto_awesome`), dentro de um `ChartCard` "Insights automáticos".

## 5. IA Analista do Painel

### 5.1 Contrato de agente

`packages/shared/src/agent.ts`:

```ts
export type AgentKey = 'benchmark' | 'glass' | 'assistant' | 'inova'

export const AGENT_KEYS: readonly AgentKey[] = ['benchmark', 'glass', 'assistant', 'inova']

export const AGENT_LABELS: Record<AgentKey, string> = {
  benchmark: 'Agente de Benchmarking',
  glass: 'GlassAgent',
  assistant: 'Assistente de RH',
  inova: 'IA Analista do INOVA',
}
```

`apps/api/prisma/schema.prisma` — novo valor no enum existente (migration nova, `pnpm db:migrate`):

```prisma
enum AgentKind {
  BENCHMARK
  GLASS
  ASSISTANT
  INOVA
}
```

`agent-service.ts`: `AGENT_KEY_TO_KIND` ganha `inova: 'INOVA'`.

### 5.2 Rota dedicada — por que não `/admin/agents/:agent/ask`

A rota genérica (`apps/api/src/routes/agents.ts`) está gated por `app.requireSectorFeature('gente-gestao')` — é o bloco de administração de Gente & Gestão, sem relação com o INOVA. **Não** se reaproveita essa rota: o gate errado deixaria qualquer SUBADMIN de Gente & Gestão falar com o analista do INOVA (mesmo sem ser admin do INOVA), e um SUBADMIN de Produto (que administra INOVA) sem a feature de G&G ficaria de fora.

Rotas novas em `apps/api/src/routes/inova.ts` (mesmo arquivo das demais rotas do módulo), guarda `[app.authenticate, app.requireAdminOrSubadmin]` — igual às rotas de criar/editar projeto:

```
POST /inova/admin/chat/ask                     → { conversationId?, message } → { conversation }
GET  /inova/admin/chat/conversations           → { conversations }
GET  /inova/admin/chat/conversations/:id       → { conversation }
```

As três chamam **as mesmas funções genéricas** `askAgent`/`listConversations`/`getConversation` de `agent-service.ts`, com `agent: 'inova'` fixo — a rota só traduz HTTP, a lógica de conversa (limite de mensagens, persistência, erro de IA) já existe e não muda.

### 5.3 Prompt e contexto

Novo `apps/api/src/lib/inova-admin-prompt.ts`:

```ts
export interface InovaAdminPromptInput {
  companyName: string
  projects: Array<{
    title: string
    sector: string
    category: string
    phase: string
    createdAt: string
    costReduction: number | null
    hoursSaved: number | null
    responsible1: string | null
    responsible2: string | null
  }>
}

export function buildInovaAdminSystemPrompt({ companyName, projects }: InovaAdminPromptInput): string {
  // Mesmo formato dos outros prompts do arquivo `benchmark-prompt.ts`: papel do
  // agente + regras de resposta (português, direto, cita números quando existem,
  // nunca inventa projeto que não está na lista) + o snapshot dos projetos
  // serializado (JSON compacto), igual ao `snapshot` que o `AdminAnaliseChat`
  // original montava antes de chamar a edge function.
}
```

Em `agent-service.ts`, `buildAgentTurn` ganha um branch:

```ts
if (agent === 'inova') {
  await ensureInovaModuleEnabled(actor.companyId) // já existe em inova-service.ts — mesma trava de todo o módulo
  const projects = await scopedPrisma(actor.companyId).inovaProject.findMany({
    where: { archived: false },
    select: { title: true, sector: true, category: true, phase: true, createdAt: true, costReduction: true, hoursSaved: true, responsible1: true, responsible2: true },
  })
  return { systemPrompt: buildInovaAdminSystemPrompt({ companyName, projects: projects.map(toInovaAdminPromptProject) }) }
}
```

`ensureInovaModuleEnabled` já lança `AgentError`-compatível (verificar tipo exato do erro que ela lança hoje em `inova-service.ts` e alinhar com `AgentError` usado pelas rotas de agente, para a resposta HTTP sair certa — ver Task correspondente no plano).

Sem `dataBlock` (diferente do GlassAgent): o snapshot inteiro já vai no system prompt, porque o volume é pequeno (dezenas de projetos, não milhares de eventos).

### 5.4 Frontend

`apps/web/src/lib/inova-api.ts` ganha 3 funções novas, mesma forma de `agent-api.ts` mas com o path fixo do INOVA:

```ts
export function askInovaAdminChat(body: AskAgentRequest) {
  return apiFetch<AskAgentResponse>('/inova/admin/chat/ask', { method: 'POST', body: JSON.stringify(body) })
}
export function listInovaAdminChatConversations() {
  return apiFetch<AgentConversationListResponse>('/inova/admin/chat/conversations')
}
export function getInovaAdminChatConversation(id: string) {
  return apiFetch<AskAgentResponse>(`/inova/admin/chat/conversations/${id}`)
}
```

UI: **reaproveita o padrão de `BenchmarkAgentSection.tsx` → `ChatTab()`** quase literal (sidebar de conversas + composer + bolhas de mensagem com `ReactMarkdown`... — checar se `react-markdown` já é dependência do `apps/web`; se não for, a resposta do agente pode ser renderizada como texto simples com `whitespace-pre-line`, já que o design de resposta é curto/direto, não markdown rico. **Decisão: texto simples, sem `react-markdown`** — evita dependência nova para um caso que não precisa de tabela/link renderizado.).

Diferença deliberada do original: o original tinha um chat **efêmero** (estado só em memória, botão "Limpar"); aqui a conversa **persiste** (mesmo padrão do Benchmarking/GlassAgent) — é estritamente melhor (histórico sobrevive a um refresh) e custa zero esforço extra, porque é o mesmo mecanismo genérico.

Sugestões de pergunta (chips, mesmo texto do original, clicáveis, preenchem e enviam):
- "O que mudou de abril para maio?"
- "Compare maio e junho em projetos, economia e horas."
- "Qual setor mais avançou no último mês?"
- "Faça uma análise geral do cenário atual."

## 6. Gráficos

### 6.1 Reaproveitados como estão (`DistributionBars`, `{key, label, count}[]`)

- **Projetos por Setor** — `filteredForSectorChart` agrupado por `sector`, ordenado desc.
- **Tipos de Projetos** (categoria) — `scopedProjects` agrupado por `category`, ordenado desc. Clique num item expande (`<details>`, sem lib nova) a lista de títulos de projeto daquela categoria — troca o tooltip-no-hover do original (não acessível, não testável em jsdom) por um disclosure clicável.
- **Projetos por Fase** — `scopedProjects` agrupado por `phase` (as 6 fases, na ordem de `INOVA_PROJECT_PHASES`, incluindo fase com 0 projetos).
- **Pessoas por Área** — `filteredForSectorChart` agrupado por setor, contando responsáveis únicos; `<DistributionBars slices={...} showShare={false} emptyMessage="Nenhum projeto ainda." />`.

### 6.2 Novo: `ValueBars` (`apps/web/src/components/inova/InovaAdminCharts.tsx`)

Mesma forma visual do `DistributionBars`, mas o valor à direita é formatado (moeda ou "Nh"), não contagem+%:

```tsx
export function ValueBars({
  items,
  formatValue,
  emptyMessage,
}: {
  items: { key: string; label: string; value: number }[]
  formatValue: (value: number) => string
  emptyMessage: string
}) {
  const withValue = items.filter((i) => i.value > 0)
  if (withValue.length === 0) return <EmptyState message={emptyMessage} />
  const max = Math.max(...withValue.map((i) => i.value))
  return (
    <ul className="flex flex-col gap-sm">
      {withValue.map((item) => (
        <li key={item.key} className="flex items-center gap-md">
          <span className="w-32 shrink-0 truncate font-label text-label-sm text-on-surface-variant" title={item.label}>{item.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="w-28 shrink-0 text-right font-label text-label-sm text-on-surface">{formatValue(item.value)}</span>
        </li>
      ))}
    </ul>
  )
}
```

Usado duas vezes, em "Impacto por Setor": economia (`R$ ${v.toLocaleString('pt-BR')}`) e horas (`${v}h`) por setor, a partir de `scopedProjects` agrupado por setor.

### 6.3 Novo: `TimelineChart` (mesmo arquivo)

Modelado diretamente em cima de `MoodTrendChart`/`AccessSeriesChart` de `AnalyticsPrimitives.tsx` (mesma constante `CHART_WIDTH/CHART_HEIGHT`, mesmo `viewBox` escalável, mesmo `useId()` pro gradiente) — mas com **dois traços** (`polyline` dupla, sem segmentação por buraco: aqui não há "dia sem dado", é contagem por mês, então mês sem projeto novo é `0`, não `null`):

```tsx
export function InovaTimelineChart({ points }: {
  points: { month: string; novosProjetos: number; avancosFase: number }[]
}) {
  // eixo X = meses (mais antigo → mais recente), duas linhas coloridas
  // (bg-primary e bg-on-surface-variant do design system, não hex cru),
  // legenda simples abaixo do SVG (não dentro dele — mais fácil de estilizar
  // com classes do design system do que o <Legend> do recharts original).
}
```

Dados: agrupa `scopedProjects` por `createdAt.slice(0,7)` (mês de criação → `novosProjetos`) e por `phaseHistory` — **atenção**: `listInovaProjects` não traz `phaseHistory` embutido hoje (só o detalhe de um projeto traz). Duas opções:
1. Simplificar: **só "Novos projetos" por mês**, sem "Avanços de fase" (que precisaria de uma consulta agregada nova).
2. Adicionar ao DTO de listagem um campo agregado (`phaseAdvanceCount` ou similar) — exige mudar `listInovaProjects`/`InovaProjectDTO`.

Decisão: **opção 1**. "Avanços de fase" exigiria trazer `phaseHistory` de todos os projetos na listagem (hoje só o detalhe traz) ou uma consulta agregada nova no service — desproporcional para uma segunda linha no gráfico. O gráfico fica com uma linha só (Novos Projetos por mês); título ajustado para "Novos Projetos ao Longo do Tempo".

### 6.4 ROI (4 `StatCard`s + aviso)

```ts
const totalInvestment = scopedProjects.reduce((s, p) => s + parseBRL(p.projectCosts), 0)
const estimatedReturn = scopedProjects.reduce((s, p) => s + (p.costReduction ?? 0), 0)
const roi = totalInvestment > 0 ? (estimatedReturn / totalInvestment).toFixed(1) : '-'
```

`parseBRL` reaproveita a mesma heurística do original (extrai tokens numéricos de texto livre como "R$ 5.000" ou "$70 para transcrição" — `projectCosts` é campo de texto livre no schema, igual no original). 4 `StatCard`s: Investimento total, Retorno (economia), ROI (`${roi}x`), Horas economizadas — mais uma linha de aviso (`bg-tertiary-container/40`, ícone `info`) com o mesmo texto do original sobre a estimativa não ser garantida.

## 7. Overview por Setor

Novo componente `InovaSectorOverview.tsx`. A partir de `scopedProjects` filtrados só pelas fases avançadas (`TESTING_SOLUTION`, `ROUTINE_USE`, `EXPANDING`, `COMPLETED` — via `INOVA_PHASE_POINTS` ≥ 3, não uma lista hardcoded de strings em português como o original):

- Busca por nome de setor, filtro por tag (IA/Automação/Dados/Produtividade/Outros — mapa `CATEGORY_TO_TAG` fixo, baseado na `INOVA_PROJECT_CATEGORIES` que já existe em `@legends/shared`) e ordenação (mais projetos / mais recente / mais ativo).
- Card por setor: ícone **genérico** (`domain`, Material Symbols — sem mapa por nome de setor), contagem de projetos, tags, resumo **genérico** ("Iniciativas conduzidas pela área de X"), bloco de resultados (economia/horas se houver, até 3 destaques com `results`/`otherMetrics` não vazios), barra de "Atividade" (soma de `INOVA_PHASE_POINTS` dos projetos do setor, relativa ao setor mais ativo).

## 8. Testes

- `InovaAdminPanelPage.test.tsx`: métricas somam certo com fixture de 3+ projetos em setores/fases diferentes; filtro de setor/período recalcula; setor sem projeto aparece no hint; insights batem com a heurística (pelo menos 1 caso de cada regra).
- `InovaAdminCharts.test.tsx`: `ValueBars` renderiza vazio corretamente (`emptyMessage`) e com dados (barra proporcional, texto formatado); `InovaTimelineChart` idem.
- `InovaSectorOverview.test.tsx`: filtro de fase avançada exclui IDEA/EXPLORING_SOLUTION; busca e ordenação.
- Backend: `agent-service.test.ts` (ou arquivo próprio `agent-service.inova.test.ts`) — turno com `agent: 'inova'` monta o prompt certo, respeita `ensureInovaModuleEnabled` (empresa não-EMR recebe o erro, não chama o provedor de IA), inclui só projetos não arquivados no snapshot. `inova.test.ts` (rotas): as 3 rotas novas respeitam o guard `requireAdminOrSubadmin` (LEGEND/LEAD recebem 403).
- `inova-admin-prompt.test.ts`: formato do prompt, nenhum projeto arquivado vaza pro snapshot mesmo se a query esquecer o filtro (teste de regressão direto na função pura).

## Fora de escopo (confirmado)

- Mini-kanban do painel (redundante com o kanban de Projetos).
- Página/gestão de admin do INOVA (`AdminUsersPage`) — usa o sistema de papéis do Legends.
- Analytics de uso/acesso por página (`AnalyticsPage` original) — categoria diferente (uso do produto, não impacto de projeto); iniciativa própria futura se fizer sentido.
- "Avanços de fase" na série temporal — precisaria de uma consulta agregada nova; fica só "Novos Projetos" por mês nesta leva.
- Ícone e frase descritiva fixos por setor no Overview — genéricos, porque `Sector` é dado da empresa, não um enum fixo de 8 valores como no original.
- `react-markdown` na resposta do chat — texto simples (`whitespace-pre-line`), sem dependência nova.
