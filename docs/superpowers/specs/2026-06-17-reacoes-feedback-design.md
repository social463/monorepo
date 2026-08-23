# Reações a feedbacks — Design

Data: 2026-06-17

## Objetivo

Permitir que usuários reajam a um feedback com emojis, no estilo Slack: cada
usuário pode aplicar várias reações diferentes ao mesmo feedback (uma de cada
tipo), e clicar de novo na própria reação a remove (toggle).

## Conjunto de reações

Conjunto fixo de 12 emojis, definido em `@legends/shared` e validado no servidor:

```
👏 ❤️ 🎯 💡 🚀 👍 🎉 🙌 🔥 💪 🧠 🙏
```

## Regras de negócio

- Qualquer usuário autenticado que **consegue ver** o feedback pode reagir —
  incluindo o autor, o alvo e ADMINs. Reações respeitam a visibilidade por
  categoria já existente (feedbacks privados só são visíveis a autor, alvo e
  ADMIN; ver `listFeedbacksForUser`).
- Um usuário pode ter no máximo uma reação de cada emoji por feedback
  (constraint único).
- Toggle: aplicar um emoji que o usuário já tem o remove; caso contrário, adiciona.
- Emojis fora da lista permitida são rejeitados (400).

## Banco de dados (Prisma)

Novo modelo:

```prisma
model FeedbackReaction {
  id         String   @id @default(cuid())
  feedbackId String
  userId     String
  emoji      String
  createdAt  DateTime @default(now())

  feedback Feedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id])

  @@unique([feedbackId, userId, emoji])
  @@index([feedbackId])
}
```

Relações adicionadas:
- `Feedback.reactions FeedbackReaction[]`
- `User.feedbackReactions FeedbackReaction[]`

`onDelete: Cascade` garante limpeza das reações ao excluir o feedback.

Migration nova gerada via Prisma.

## Tipos compartilhados (`packages/shared/src/feedback.ts`)

```ts
export const FEEDBACK_REACTIONS = ['👏','❤️','🎯','💡','🚀','👍','🎉','🙌','🔥','💪','🧠','🙏'] as const
export type FeedbackReactionEmoji = (typeof FEEDBACK_REACTIONS)[number]

export interface ReactionSummary {
  emoji: FeedbackReactionEmoji
  count: number
  reactedByMe: boolean
  users: { id: string; name: string }[] // para o tooltip de nomes
}

export interface ToggleReactionRequest {
  emoji: FeedbackReactionEmoji
}
```

`FeedbackDTO` ganha o campo:

```ts
reactions: ReactionSummary[]
```

## API

Endpoint único de toggle (evita emoji na URL):

```
POST /feedbacks/:id/reactions/toggle
body: { emoji: FeedbackReactionEmoji }
resposta: { reactions: ReactionSummary[] }
```

Comportamento:
- 400 se o emoji não estiver na lista permitida.
- 404 se o feedback não existir ou não for visível ao usuário (não vazamos a
  existência de feedbacks privados).
- 200 com a lista de reações atualizada do feedback.

A listagem `GET /users/:id/feedbacks` passa a incluir as reações (com os
usuários que reagiram). `toFeedbackDTO` recebe o `viewerId` para computar
`reactedByMe` em cada resumo.

## Serviço (`feedback-service.ts`)

- `feedbackInclude` passa a incluir `reactions: { include: { user: true } }`.
- Nova função `toggleReaction({ feedbackId, userId, emoji, viewerRole })`:
  1. Valida o emoji contra `FEEDBACK_REACTIONS` (400 se inválido).
  2. Busca o feedback; verifica visibilidade ao viewer reaproveitando a regra
     de `listFeedbacksForUser` (autor/alvo/ADMIN veem tudo; demais só públicos
     ou os que escreveram). Se não visível → erro 404.
  3. Faz toggle: se existe `(feedbackId, userId, emoji)`, deleta; senão cria.
  4. Retorna o feedback recarregado com reações.
- Helper de visibilidade extraído para ser reutilizado entre listagem e toggle.

## Serialização

`toFeedbackDTO(feedback, viewerId)` agrupa as reações por emoji, produzindo
`ReactionSummary[]` com `count`, `reactedByMe` (algum reaction.userId === viewerId)
e `users` (id + name). A ordem segue a ordem de `FEEDBACK_REACTIONS` para
estabilidade visual.

## Frontend (`apps/web/src/pages/profile/FeedbackSection.tsx`)

- Abaixo da mensagem de cada feedback: chips das reações com `count > 0`
  (ex.: `👏 3`), com a reação do usuário atual destacada (borda/cor `primary`).
- Botão `+` (ícone) abre um popover com a paleta dos 12 emojis. Selecionar um
  emoji dispara o toggle e fecha o popover.
- Hover em um chip → tooltip listando os nomes de quem reagiu.
- Clicar num chip existente também faz toggle (adiciona/remove a própria reação).
- Mutation react-query de toggle com **atualização otimista** no cache da
  `useInfiniteQuery` (atualiza `reactions` do feedback alvo), com rollback em
  erro e `invalidate` ao final.

## Testes

Serviço (`feedback-service.test.ts` ou novo arquivo):
- toggle adiciona quando não existe e remove quando já existe (idempotência do toggle).
- emoji inválido → erro 400.
- reação em feedback não visível ao viewer → erro 404.
- cascade: deletar feedback remove as reações.

Rota (`feedback.test.ts`):
- 200 no toggle retornando `reactions` atualizado com `reactedByMe`.
- 400 emoji inválido.
- 404 sem visibilidade / feedback inexistente.

## Fora de escopo

- Notificações ao autor/alvo quando alguém reage.
- Reações em votos ou outros objetos (só feedbacks).
- Customização do conjunto de emojis por usuário/admin.
