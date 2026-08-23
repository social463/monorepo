# Agente de Benchmarking de cultura — Implementation Plan

**Goal:** Entregar o agente de benchmarking de cultura no Legends — inventário de práticas
internas, chat persistido no formato executivo fixo, e chave Gemini própria por empresa,
cifrada em repouso.

**Architecture:** Contrato em `@legends/shared` primeiro; modelos de chat **genéricos**
(`AgentConversation`/`AgentMessage`, discriminados por `AgentKind`) reaproveitáveis pelo
GlassAgent (#22282) e pela Assistente interna (#22280); credencial de IA por empresa em
`AppSetting` cifrada com `lib/crypto.ts`, sem fallback de `process.env`; system prompt e
montagem de contexto numa função pura testável; rotas finas sob `requireAdminOrSubadmin`
(configuração da chave sob `requireAdmin`); front em `/admin/benchmarking` e `/admin/ia`,
com o `Markdown.tsx` existente ganhando suporte a tabelas.

**Tech Stack:** TypeScript ESM strict, Fastify 4, Prisma 5 + PostgreSQL, Zod,
`@google/genai` 2.8, React 18 + React Query + Tailwind, Vitest.

Spec: `docs/superpowers/specs/2026-08-01-agente-benchmarking-design.md`

## Global Constraints

- Fluxo obrigatório: **route → service → Prisma**. Rota valida com Zod (`safeParse` →
  `400 { message, issues }`), chama o service, serializa em `lib/serialize.ts`.
- Todo model novo entra em `TENANT_SCOPED_MODELS` (`lib/tenant-scope.ts`) e em
  `test/setup.ts`. `AppSetting` **não** passa por `scopedPrisma` (PK composta) — o
  `companyId` vai explícito nos dois lados, como no `calendar-settings-service`.
- Mutação de admin grava `recordAuditLog`, dentro da transação quando houver.
- Migration só via `pnpm db:migrate`; **nesta máquina `LEGENDS_DB_PORT=5442`**.
- Erro de domínio é classe tipada com `status`; a rota faz `instanceof`. Erro de IA
  **nunca** vira 500.
- A chave da API **nunca** entra em DTO, log ou payload de auditoria.
- Mensagens ao usuário em português.
- Limites, valores exatos: `AGENT_MESSAGE_MAX_LENGTH = 4000`,
  `AGENT_CONVERSATION_MAX_MESSAGES = 40`, `AGENT_CONVERSATION_TITLE_MAX_LENGTH = 120`,
  `BENCHMARK_PRACTICE_TITLE_MAX_LENGTH = 120`,
  `BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH = 2000`,
  `BENCHMARK_PRACTICE_CHANNEL_MAX_LENGTH = 80`, `BENCHMARK_PRACTICE_MAX_TAGS = 10`,
  `BENCHMARK_PRACTICE_TAG_MAX_LENGTH = 40`, `AI_GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'`,
  `AGENT_TIMEOUT_MS = 55_000`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/agent.ts` (criar) | `AgentKey`, DTOs de conversa/mensagem, request/response, limites |
| `packages/shared/src/benchmark.ts` (criar) | `BenchmarkPracticeDTO`, categorias, limites, requests |
| `packages/shared/src/ai-settings.ts` (criar) | `AiSettingsDTO` (só `geminiConfigured` + `model`), request |
| `packages/shared/src/index.ts` (modificar) | Barril |
| `apps/api/prisma/schema.prisma` (modificar) | `BenchmarkPractice`, `AgentConversation`, `AgentMessage`, enums, back-relations |
| `apps/api/src/lib/tenant-scope.ts` (modificar) | Registrar os 3 models |
| `apps/api/test/setup.ts` (modificar) | Truncar os 3 models |
| `apps/api/src/lib/agent-error.ts` (criar) | `AgentError` tipado com `status` |
| `apps/api/src/lib/benchmark-prompt.ts` (criar) | System prompt + `buildBenchmarkSystemPrompt` (pura) |
| `apps/api/src/lib/gemini-agent-client.ts` (criar) | Chamada ao Gemini com timeout e tradução de erro |
| `apps/api/src/services/ai-settings-service.ts` (criar) | Chave por empresa: leitura, escrita cifrada, auditoria |
| `apps/api/src/services/benchmark-practice-service.ts` (criar) | CRUD do inventário |
| `apps/api/src/services/agent-service.ts` (criar) | Conversas, limites, orquestração do turno |
| `apps/api/src/lib/serialize.ts` (modificar) | `toBenchmarkPracticeDTO`, `toAgentConversationDTO`, `toAgentMessageDTO` |
| `apps/api/src/routes/ai-settings.ts` (criar) | `GET`/`PUT /admin/ai-settings` sob `requireAdmin` |
| `apps/api/src/routes/benchmark-practices.ts` (criar) | CRUD sob `requireAdminOrSubadmin` |
| `apps/api/src/routes/agents.ts` (criar) | `ask`, `conversations`, `conversation/:id` |
| `apps/api/src/app.ts` (modificar) | Registrar as 3 rotas |
| `apps/web/src/components/Markdown.tsx` (modificar) | Bloco `table` |
| `apps/web/src/lib/agent-api.ts` (criar) | Cliente HTTP do agente + práticas |
| `apps/web/src/lib/ai-settings-api.ts` (criar) | Cliente HTTP da configuração |
| `apps/web/src/pages/admin/BenchmarkAgentSection.tsx` (criar) | Abas Chat / Práticas |
| `apps/web/src/pages/admin/AiSettingsSection.tsx` (criar) | Formulário da chave |
| `apps/web/src/App.tsx` (modificar) | Rotas `/admin/benchmarking` e `/admin/ia` |
| `apps/web/src/pages/admin/AdminSidebar.tsx` (modificar) | Itens de menu |
| `apps/api/.env.example` (modificar) | Documentar que a chave do agente é por empresa |

---

## Fase 1 — Contrato

- [x] `packages/shared/src/agent.ts`, `benchmark.ts`, `ai-settings.ts` + barril.
- [x] Testes: `isAgentKey` aceita só `benchmark`/`glass`; categorias sem duplicata.

## Fase 2 — Persistência

- [x] Models + enums no `schema.prisma`, back-relations em `Company` e `User`.
- [x] `TENANT_SCOPED_MODELS` e `test/setup.ts`.
- [x] `LEGENDS_DB_PORT=5442 pnpm db:migrate` e `pnpm db:generate`.

## Fase 3 — Chave de IA por empresa

- [x] `ai-settings-service.ts`: `getAiSettings`, `updateAiSettings` (auditada),
      `resolveGeminiCredentials` (lança `AgentError` 503 se ausente).
- [x] `routes/ai-settings.ts` sob `requireAdmin`.
- [x] Testes: chave nunca no DTO nem na auditoria; empresa A não lê a chave de B;
      SUBADMIN recebe 403; limpar a chave desconfigura.

## Fase 4 — Agente

- [x] `agent-error.ts`, `benchmark-prompt.ts` (pura), `gemini-agent-client.ts`.
- [x] `agent-service.ts` com o client injetável para teste.
- [x] `benchmark-practice-service.ts` + `routes/benchmark-practices.ts` + `routes/agents.ts`.
- [x] Registrar em `app.ts`; DTOs em `serialize.ts`.
- [x] Testes: prompt com/sem práticas; 400 nos limites; 403 para não-admin; falha da IA
      vira status tipado; isolamento por empresa e por usuário.

## Fase 5 — Web

- [x] Tabelas no `Markdown.tsx` (+ teste de tabela e de `<script>` em célula).
- [x] `BenchmarkAgentSection.tsx` e `AiSettingsSection.tsx`.
- [x] Rotas em `App.tsx` (`/admin/ia` sob `StrictAdminOnly`) e itens no `AdminSidebar`.

## Fase 6 — Verificação

- [x] `LEGENDS_DB_PORT=5442 pnpm test`.
- [x] `.env.example` e `AGENTS.md` documentando a chave por empresa.
