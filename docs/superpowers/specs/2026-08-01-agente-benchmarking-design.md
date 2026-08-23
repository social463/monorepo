# Agente de Benchmarking de cultura — design

Data: 2026-08-01
Branch: `feat/22281-agente-benchmarking`
PBI: [#22281](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/22281)

## Problema

Gente e Gestão precisa comparar o que a empresa faz com o que o mercado faz, e hoje
isso é pesquisa manual esporádica. Além disso, as práticas internas não estão
inventariadas em lugar nenhum — nem para comparar com o mercado, nem para lembrar do
que já foi feito no ano passado.

A origem é o `/app/admin/benchmark` do portal EMR (`src/routes/app.admin.benchmark.tsx`
+ `src/lib/benchmark.functions.ts`): um chat com agente especializado em benchmarking de
cultura, employer branding e experiência do colaborador, com as práticas internas
cadastradas entrando como contexto.

O que **não** se deve copiar do portal:

- A conversa vive só no `useState` — recarregou a página, perdeu o histórico.
- A resposta do modelo vai para o DOM via `dangerouslySetInnerHTML` com um
  "markdown leve" escrito à mão. Texto vindo de LLM é conteúdo não confiável; isso é
  XSS esperando acontecer.
- A chave da IA é um `process.env` único do deploy. O Legends é whitelabel: cada
  empresa precisa da própria chave.

## Escopo

Entra:

- **Inventário** — CRUD de práticas internas (categoria, título, descrição, canal, tags).
- **Agente** — chat que responde no formato executivo fixo, usando o inventário como contexto.
- **Histórico** — conversas persistidas por pessoa, retomáveis com o histórico completo.
- **Chave de IA por empresa** — cada tenant cadastra a própria chave Gemini, cifrada em repouso.

Não entra: crawler/scraping de LinkedIn, Glassdoor ou GPTW (o agente trabalha com o que
o modelo sabe + o inventário interno); streaming token a token; anexos na conversa.

## Audiência e acesso

O "líder de Gente e Gestão" é o **SUBADMIN** do setor Gente e Gestão; o **ADMIN** global
também entra. Colaborador comum recebe 403 — não há tela fora de `/admin`.

`requireAdminOrSubadmin` **não** serve aqui: ele libera qualquer SUBADMIN, de qualquer
setor. E cravar o nome "Gente e Gestão" no código quebraria o whitelabel — outra empresa
chama esse time de outra coisa, ou nem tem um.

A saída é o mecanismo que o repo já tem: `Sector.enabledFeatures`. Nasce a feature
**`gente-gestao`**, e com ela o decorator `app.requireSectorFeature(key)`:

| Papel | Resultado |
|---|---|
| ADMIN global | passa sempre |
| SUBADMIN do setor com `gente-gestao` | passa |
| SUBADMIN de outro setor | 403 |
| Colaborador / terceirizado | 403 |

Cada empresa liga a feature no setor que faz o papel de G&G — dado, não código.

Note que `gente-gestao` é diferente das outras feature keys: as demais liberam **tela de
colaborador**; esta libera **a administração** de um bloco do `/admin`. Por isso o
decorator é novo — `requireFeature` retorna cedo para todo ADMIN **e todo SUBADMIN**, o
que não restringe nada. No front, `AdminSectorFeatureOnly` espelha a mesma regra, para o
subadmin de outro setor não abrir a tela pela URL e só descobrir pelo 403 de cada request.

### O bloco de Gente e Gestão

A mesma feature governa as seis áreas de G&G, não só o Benchmarking:

| Área | Rota web | Guarda de API alterada |
|---|---|---|
| People Analytics | `/admin/pessoas` | `routes/people-analytics.ts` |
| Painéis de RH | `/admin/paineis` | `routes/hr-dashboards.ts` |
| Termômetro de humor | `/admin/clima` | `routes/squad-mood.ts` (`/admin/mood/overview`) |
| Cursos | `/admin/cursos` | `routes/courses-admin.ts` |
| Manuais | `/admin/cultura/manuais` | `routes/culture.ts` (`manualsAdminGuard`) |
| Benchmarking | `/admin/benchmarking` | `routes/agents.ts`, `routes/benchmark-practices.ts` |

Só o lado **administrativo** muda. O colaborador continua fazendo curso por
`aprendizado` e registrando humor em `/me/mood/today` — e o líder de squad segue
acompanhando o próprio time por `/me/led-squads/moods`.

**Manifesto e Benefícios** entraram no bloco depois: a gestão saiu do ADMIN global e
passou a G&G (o time que produz o conteúdo estava de fora do que produz), e a **leitura
foi aberta a todo usuário logado**, sem feature nenhuma — são a identidade da empresa,
não documento operacional. Só Manuais segue na feature `cultura`, e a aba some do hub
para quem não a tem.

### O bloco espelho: Desenvolvimento de Produto

Mesmo mecanismo, feature `desenvolvimento-produto`, para as telas que pertencem ao time
de produto:

| Área | Rota web | Guarda de API |
|---|---|---|
| Retrospectivas | `/admin/retrospectivas` | `/admin/retro/rooms*` |
| Quinta de Dev | `/admin/quinta-dev` | `/admin/development-thursday/settings` |

Aqui a distinção entre administrar e participar fica explícita: `retrospectivas` e
`quinta-desenvolvimento` continuam dizendo quais setores **participam** das dinâmicas;
`desenvolvimento-produto` diz quem as **administra**. Ter a primeira não dá a segunda —
há teste travando isso.

### Quem controla

O ADMIN liga e desliga as features de bloco em **Administração › Setores**, que já
tinha o checklist dirigido por `FEATURE_KEYS` — as chaves novas aparecem sozinhas. Como
a feature viaja no JWT, a mudança vale no próximo refresh do access token (≤ 15 min) ou
no próximo login; `/auth/refresh` relê `sectorFeaturesFor(sectorId)`.

O recorte por setor que já existia dentro de cada área (SUBADMIN vê só o próprio setor em
People Analytics, Painéis e Clima) **continua valendo** — a feature decide quem entra, o
recorte decide o que a pessoa enxerga lá dentro.

O inventário de práticas é **da empresa inteira**, não do setor: uma prática de
endomarketing não pertence a um setor, e o agente compara a empresa com o mercado. Por
isso `BenchmarkPractice` não tem `sectorId` e não há recorte por setor no service — o
recorte que existe é o de **empresa**, via `scopedPrisma(companyId)`.

Conversas são **por pessoa**: cada usuário só enxerga as próprias
(`userId = request.user.sub`), inclusive entre dois SUBADMINs da mesma empresa.

A **chave de IA** é mais restrita que o agente: só **ADMIN** (`requireAdmin`) lê o
estado e grava a chave. Um SUBADMIN usa o agente mas nunca vê nem edita a credencial.

## Decisão 1 — modelo de chat genérico, não específico do benchmark

`AgentConversation` / `AgentMessage` nascem genéricos, discriminados por `agent`
(`AgentKind.BENCHMARK` | `GLASS`). O GlassAgent (PBI #22282) e a Assistente interna
(#22280) reaproveitam a mesma tabela em vez de clonarem uma estrutura quase igual.

O que é específico do benchmark fica em **um lugar só**: o system prompt e a montagem do
contexto (`lib/benchmark-prompt.ts`). Trocar de agente é trocar o prompt e a fonte de
contexto, não o armazenamento.

`agent` e `role` são **enums do Prisma** (`AgentKind`, `AgentMessageRole`), não `String`
livre — segue o padrão do resto do schema e garante no banco que não entra papel inválido.

## Decisão 2 — chave Gemini por empresa, cifrada, sem fallback de ambiente

Este é o requisito de "qualquer empresa adiciona a própria chave de forma segura". O
repo já tem exatamente esse padrão em produção nas credenciais OAuth de calendário
(`services/calendar-settings-service.ts`), e ele é reaproveitado sem inventar mecânica nova:

- **Onde mora** — `AppSetting`, cuja PK é composta `(key, companyId)`. Chave
  `ai_gemini_api_key_enc` por empresa. Nada de coluna nova numa tabela global.
- **Como é guardada** — `encryptSecret` de `lib/crypto.ts`: AES-256-GCM com formato
  versionado `v1:iv:tag:ciphertext`. A chave de cifra vem de `CALENDAR_ENCRYPTION_KEY`
  (32 bytes base64), obrigatória em produção. Um dump do banco sem essa variável não
  entrega chave de API nenhuma.
- **Como sai** — **nunca sai.** O DTO expõe `geminiConfigured: boolean` e nada mais.
  Não há endpoint que devolva a chave, nem mascarada. Salvar é write-only: campo vazio
  mantém o valor atual, e a remoção é explícita.
- **Auditoria** — gravada com `recordAuditLog`, com `before`/`after` sendo os DTOs (que
  por construção não carregam segredo).
- **Sem fallback de `process.env`.** Decisão consciente: a `GEMINI_API_KEY` existente
  continua servindo **só** ao card do Destaque do Mês. Se o agente caísse nela quando a
  empresa não configurasse a sua, todo tenant novo gastaria a cota da EMR em silêncio, e
  o custo de IA de um cliente apareceria na fatura de outro. Sem chave da empresa, o
  agente responde "não configurado" — falha visível e barata, não vazamento de custo.

Resolução em runtime:

```
resolveGeminiCredentials(companyId):
  1. AppSetting['ai_gemini_api_key_enc', companyId] → decryptSecret
  2. ausente → AgentError(503, 'Agente de IA não configurado...')
```

O modelo (`ai_gemini_model`, default `gemini-2.5-flash`) é configurável junto, em texto
puro — não é segredo.

### Onde o admin configura

Página nova `/admin/ia` ("Inteligência Artificial"), no grupo **Sistema** do
`AdminSidebar`, ao lado de Calendário e Auditoria, `adminOnly`. Fica fora da tela do
agente de propósito: a mesma chave vai servir o GlassAgent (#22282) e a Assistente
interna (#22280), e configuração de credencial não é assunto da tela de uso.

## Decisão 3 — markdown do agente sem `dangerouslySetInnerHTML`

O prompt manda o agente usar tabelas markdown, e o `components/Markdown.tsx` atual não
suporta tabelas. Duas saídas: (a) adicionar `react-markdown` + `remark-gfm` +
`rehype-sanitize`; (b) estender o renderer que já existe.

Escolhido **(b)**. O `Markdown.tsx` do repo já resolve a classe inteira de XSS por
construção — ele parseia para **elementos React**, então o que o parser não reconhece
vira texto, e nenhum HTML do conteúdo chega ao DOM como markup. Não há sanitizador para
configurar errado. Adicionar três dependências e uma allowlist de tags para ganhar
tabelas seria trocar uma garantia estrutural por uma configuração. A extensão é o bloco
`table` (linhas `| a | b |` com separador `|---|`), com as células passando pelo mesmo
`renderInline` já existente.

Isso vale ainda mais aqui do que no conteúdo institucional: o texto vem de um LLM, e
prompt injection via prática cadastrada é um vetor real — uma prática com
`<img onerror=...>` na descrição volta ecoada na resposta do agente.

## Decisão 4 — limites e tratamento de erro

Limites no contrato compartilhado, validados por Zod na rota:

| Constante | Valor | Porquê |
|---|---|---|
| `AGENT_MESSAGE_MAX_LENGTH` | 4.000 | Pergunta de análise, não colagem de documento |
| `AGENT_CONVERSATION_MAX_MESSAGES` | 40 | Teto do portal; a conversa inteira vai no request a cada turno |
| `AGENT_CONVERSATION_TITLE_MAX_LENGTH` | 120 | Título derivado da 1ª pergunta |
| `BENCHMARK_PRACTICE_*` | 120 / 2.000 / 80 / 10 tags | Título, descrição, canal, tags |

Estouro → `400 { message, issues }`.

Falha da IA **nunca** vira 500. `AgentError` tipado com `status`, mensagem já em
português, e a rota faz `instanceof`:

| Situação | Status | Mensagem |
|---|---|---|
| Chave não cadastrada | 503 | "Agente de IA não configurado. Peça a um administrador para cadastrar a chave da API Gemini em Administração › Inteligência Artificial." |
| Timeout (55s) | 504 | "A análise demorou demais para responder. Tente uma pergunta mais específica." |
| 429 do provedor | 429 | "Limite de requisições da IA atingido. Tente novamente em instantes." |
| 401/403 do provedor | 502 | "A chave da API Gemini foi recusada. Verifique a configuração em Administração › Inteligência Artificial." |
| Qualquer outra falha | 502 | "Tive um problema técnico ao consultar a IA. Tente novamente em instantes." |

A pergunta do usuário só é persistida **junto** com a resposta, numa transação: turno que
falhou não deixa mensagem órfã na conversa, e reenviar não duplica.

## Fluxo

```
Admin cadastra práticas  →  BenchmarkPractice (companyId)
                                   │
Usuário pergunta  →  POST /admin/agents/benchmark/ask
                        │
                        ├─ Zod: tamanho da mensagem
                        ├─ carrega/cria conversa (userId + companyId + agent)
                        ├─ teto de mensagens da conversa → 400
                        ├─ resolveGeminiCredentials(companyId) → decryptSecret
                        ├─ buildBenchmarkSystemPrompt(práticas da empresa)
                        ├─ Gemini (systemInstruction + histórico), timeout 55s
                        └─ $transaction: grava pergunta + resposta, toca updatedAt
```

## Testes

- `buildBenchmarkSystemPrompt` com e sem práticas — snapshot da montagem (função pura).
- Mensagem acima do limite e conversa no teto → 400.
- Colaborador comum → 403 em todas as rotas do agente e do CRUD.
- SUBADMIN → 200 no agente, **403** em `/admin/ai-settings`.
- Falha do provedor (client injetado no service) → status tipado com mensagem em
  português, nunca 500.
- Prática/conversa de outra empresa nunca aparece; a chave de uma empresa não é lida por outra.
- `AiSettingsDTO` não contém a chave em nenhum caminho; auditoria não grava o segredo.
- Markdown: tabela vira `<table>`; `<script>` numa célula vira texto.

## Fora de escopo / dívida assumida

- Sem streaming: a resposta chega inteira depois de até 55s, com estado de "analisando".
- Sem paginação de conversas — o teto de 40 mensagens e o volume esperado não pedem.
- Rotação da chave de cifra (`CALENDAR_ENCRYPTION_KEY`) segue manual, como já é para o
  calendário; o prefixo `v1:` existe justamente para permitir isso depois.
- O nome `CALENDAR_ENCRYPTION_KEY` fica genérico demais para o uso — renomear para
  `SECRET_ENCRYPTION_KEY` exigiria migração de deploy e não entra neste PBI.
