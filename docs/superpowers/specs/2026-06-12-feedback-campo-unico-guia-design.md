# Campo único de feedback com guia opcional

Data: 2026-06-12

## Contexto

A primeira iteração da área de feedback no perfil do líder usava três campos
separados (Situação / Comportamento / Impacto — modelo SCI). A disposição em três
campos não agradou. Esta revisão substitui os três campos por **um único campo de
texto**, com um **guia opcional** que orienta a escrita de um feedback de valor sem
forçar estrutura.

Esta mudança ocorre na branch `feat/feedback-perfil-lider`, ainda não mergeada, e
revisa código recém-implementado (modelo `Feedback`, service, rotas, DTOs e o
componente `FeedbackSection`). Não há dados reais de feedback em produção.

## Objetivo

- Coletar e exibir o feedback como **um texto único** (`message`).
- Oferecer um **guia ligável/desligável** que, quando ligado, mostra perguntas
  norteadoras e dicas (estilo SCI) para ajudar a pessoa a estruturar mentalmente o
  feedback — sem checkboxes, sem detecção automática, sem IA.
- O guia é puramente um auxílio de UI: **não altera** o que é enviado/armazenado.

## Decisões de produto

- **Campo:** um único `<textarea>` rotulado "Seu feedback".
- **Validação:** mínimo de caracteres reusando `MIN_FEEDBACK_FIELD_LENGTH` (= 10).
- **Guia:** toggle "Guia de feedback". Inicia **ligado**; a preferência é lembrada
  no navegador (`localStorage`, chave `feedback-guide-enabled`).
- **Conteúdo do guia (quando ligado):** uma linha introdutória
  ("Um bom feedback costuma cobrir três pontos:") seguida de três perguntas
  norteadoras com dica curta:
  - *Situação* — em que contexto/quando aconteceu?
  - *Comportamento* — o que a pessoa fez (ações observáveis, não interpretações)?
  - *Impacto* — que efeito isso gerou no time, no projeto ou em você?
- **Sem marcação de progresso** (sem checkboxes, sem heurística).
- **Regras de autorização inalteradas:** qualquer logado exceto ADMIN cria; não pode
  feedback a si mesmo; autor edita/exclui o próprio; ADMIN exclui qualquer um;
  feedback público no perfil; identificado.

## Arquitetura

### Backend

**Prisma** (`apps/api/prisma/schema.prisma`): no model `Feedback`, substituir os três
campos `situation` / `behavior` / `impact` por um único:

```prisma
  message String
```

(Mantém `id`, `authorId`, `targetId`, `createdAt`, `updatedAt`, relações e índices.)
Gerar uma **nova migration** (`prisma migrate dev --name feedback_single_message`)
que altera a tabela `Feedback` (drop das três colunas, add `message`). A tabela não
tem dados reais; em dev, se houver linhas residuais, limpá-las antes (a migration
adiciona `message NOT NULL`).

**Shared** (`packages/shared/src/feedback.ts`):

```ts
import type { PublicUser } from './auth'

export const MIN_FEEDBACK_FIELD_LENGTH = 10

export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  message: string
}

export type UpdateFeedbackRequest = CreateFeedbackRequest
```

**Service** (`apps/api/src/services/feedback-service.ts`): trocar a validação de três
campos por um campo `message` (trim + min length); `createFeedback`/`updateFeedback`
persistem `message`. Manter as guardas de autorização (self, ADMIN-write, edição só
do autor, exclusão autor/ADMIN) e o tratamento de `P2025` no delete.

**Serialização** (`apps/api/src/lib/serialize.ts`): `toFeedbackDTO` retorna `message`
em vez dos três campos.

**Rotas** (`apps/api/src/routes/feedback.ts`): o zod schema passa a ser
`z.object({ message: z.string().trim().min(MIN_FEEDBACK_FIELD_LENGTH) })`. Rotas e
status inalterados (`GET/POST /users/:id/feedbacks`, `PATCH/DELETE /feedbacks/:id`).

### Frontend

**`FeedbackSection`** (`apps/web/src/pages/profile/FeedbackSection.tsx`):

- Estado do formulário vira `{ message: string }` (e estado `editingId`, `error`).
- **Um `<textarea>`** "Seu feedback" com placeholder orientando ("Escreva um feedback
  específico e construtivo…"). Validação: `message.trim().length >= MIN_FEEDBACK_FIELD_LENGTH`.
- **Toggle do guia:** um botão/switch "Guia de feedback" no topo do formulário.
  Estado inicial lido de `localStorage` (`feedback-guide-enabled`), default `true`;
  ao alternar, grava a preferência. Acessível (botão com `aria-pressed`).
- **Painel do guia** (renderizado só quando ligado): a linha introdutória + os três
  itens (rótulo + pergunta/dica). Apenas texto, sem inputs.
- **Lista:** cada feedback exibe `feedback.message` como parágrafo
  (`text-body-sm text-on-surface`), no lugar do `dl` de três campos. Cabeçalho
  (avatar + nome + data) e botões editar/excluir mantidos.
- `startEdit` carrega `message` no formulário.
- Mutations create/update/delete e estados de loading/erro da query mantidos.

## Tratamento de erros

- Backend: 400 (validação de `message`), 403/404 (autorização/inexistência) como já
  implementado. Mensagens pt-BR.
- Frontend: erros de mutation inline (`role="alert"` + `Icon name="error"`); estados
  de loading/erro da query de lista mantidos.

## Testes

- **API `feedback.test.ts`:** atualizar os payloads de `{ situation, behavior, impact }`
  para `{ message }`. Mesma cobertura: 201 cria; 400 mensagem curta; 403 ADMIN;
  400 self; 404 alvo inexistente; lista desc; editar só autor (200/403); excluir
  autor/ADMIN (204) e terceiro (403); 401 GET sem auth.
- **Web `FeedbackSection.test.tsx`:** campo único ("Seu feedback") visível para quem
  pode escrever; guia visível por padrão (texto introdutório presente); alternar o
  toggle esconde/mostra o painel; envio chama `apiFetch` com `{ method: 'POST' }` e
  body contendo `message`; lista renderiza o `message`; controles editar/excluir
  conforme autor/ADMIN. Mockar `localStorage` quando necessário.
- **Web `ProfilePage.test.tsx`:** sem mudança (fixture de feedbacks vazia; só verifica
  presença do bloco "Feedbacks").

## Fora de escopo

- Detecção automática de cobertura dos aspectos (heurística ou IA) — descartada.
- Persistência da estrutura SCI em campos separados — descartada (texto único).
- Geração de feedback por IA — descartada nesta direção.
