# Resenha — Menções com @ — Design Spec

- **Data:** 2026-06-26
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming)
- **Depende de:** [Resenha](2026-06-26-resenha-design.md) (já implementada e mergeada em `main`)

## Resumo

Permitir **marcar pessoas com `@`** numa resenha e nos comentários. Ao digitar `@`,
abre um autocomplete dos colegas ativos; ao selecionar, o nome é inserido no texto e
o usuário fica vinculado. Quem é marcado é **notificado** ("Fulano te marcou numa
resenha"), espelhado no Teams como as demais notificações. Na exibição, as menções
viram **links para o perfil**, com destaque visual.

## Decisões (do brainstorming)

- **Escopo:** menções na resenha **e** nos comentários.
- **Notificação:** o marcado é notificado (novo tipo `REVIEW_MENTION`); sem
  notificar a si mesmo; best-effort + espelho no Teams.
- **Abordagem (A):** menções selecionadas + tabela de relação. O texto guarda
  `@Nome Sobrenome` (digitação limpa); o cliente envia também `mentionedUserIds`; o
  servidor grava uma relação de menção (com snapshot do nome) usada para notificar e
  para renderizar.
- **Cap:** máximo **10** menções por resenha/comentário.
- **Fonte do autocomplete:** usuários **ativos não-admin** (os "colegas" com perfil
  navegável; admins não têm perfil em `/perfil/:id`).

## Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate`.
Back-relations no `User` (`reviewMentions`, `reviewCommentMentions`).

```prisma
model ReviewMention {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  name      String   // snapshot do nome no momento da menção (casa @nome no texto)
  createdAt DateTime @default(now())

  review Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reviewId, userId])
  @@index([reviewId])
}

model ReviewCommentMention {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  name      String
  createdAt DateTime @default(now())

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId])
  @@index([commentId])
}
```

`NotificationType` ganha `REVIEW_MENTION` (enum Prisma **e** `NOTIFICATION_TYPES` em
`@legends/shared` — manter os dois em sincronia, como já feito para os outros tipos).
`test/setup.ts` trunca as duas novas tabelas (antes de `review.deleteMany()`,
ordem FK-safe).

## Contrato compartilhado (`packages/shared/src/review.ts`)

```ts
export const MAX_REVIEW_MENTIONS = 10

export interface MentionDTO {
  userId: string
  /** Nome exibido na menção; é o texto que aparece como "@<name>" no conteúdo. */
  name: string
}

// ReviewDTO e ReviewCommentDTO ganham:
//   mentions: MentionDTO[]

// Payloads de criação ganham:
//   mentionedUserIds?: string[]
```

`CreateReviewRequest` → `{ content: string; mentionedUserIds?: string[] }`.
`CreateReviewCommentRequest` → `{ content: string; mentionedUserIds?: string[] }`.

## Backend (`apps/api`)

- **Service** (`review-service.ts`):
  - `createReview` e `createComment` aceitam `mentionedUserIds?: string[]`. O service
    **deduplica** os ids, **busca os usuários** correspondentes, **mantém só ativos e
    não-admin**, **limita a `MAX_REVIEW_MENTIONS`**, e cria as linhas de menção numa
    transação junto com a resenha/comentário (gravando `name` = nome atual do usuário).
    Ids desconhecidos/inativos/admin são **ignorados silenciosamente** (lenientes — o
    cliente é responsável por enviar só ids que inseriu).
  - `reviewInclude`/`reviewCommentInclude` passam a incluir `mentions: true` (o
    snapshot `name` + `userId` bastam; não precisa incluir `user`). Como
    `createReview` retorna `ReviewWithRelations` e `createComment` retorna o objeto
    com `comment` (ambos já com `mentions`), a **route deriva os destinatários** da
    própria relação criada: `recipientIds = entity.mentions.map(m => m.userId)`. Não
    é preciso campo de retorno extra.
- **Serialize** (`serialize.ts`): `toReviewDTO`/`toReviewCommentDTO` mapeiam
  `mentions` → `MentionDTO[]` (`{ userId, name }`).
- **Notificação** (`notification-service.ts`): `notifyReviewMention({ recipientIds,
  actorId, reviewId })` — tipo `REVIEW_MENTION`, título `"<ator> te marcou numa
  resenha"`, link `/resenha#<reviewId>`, dedup, **não notifica a si mesmo**, best-effort
  + Teams (via `createNotification`). Para menções em comentário, o link também é
  `/resenha#<reviewId>` (a resenha-pai).
- **Routes** (`review.ts`): os schemas Zod de `POST /reviews` e `POST
  /reviews/:id/comments` ganham `mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional()`.
  Após criar, a route dispara `notifyReviewMention` em try/catch independente
  (best-effort), como os demais notificadores.

## Frontend (`apps/web`)

- **Fonte de colegas:** hook `useColleagues` (ou reuso direto) sobre
  `GET /users` → `{ users: PublicUser[] }`, filtrando `active && role !== 'ADMIN'`,
  espelhando o `ColleagueSearch`.
- **Composer com menção:** um componente/hook `MentionTextarea` que envolve o
  `<textarea>`:
  - Detecta o gatilho `@` e a "query" (caracteres após o `@` até espaço/quebra).
  - Mostra um dropdown com os colegas que casam com a query (por nome,
    case-insensitive); navegação por teclado (↑/↓/Enter) e clique; `Esc` fecha.
  - Ao selecionar, substitui `@query` por `@<Nome Completo> ` e registra o `userId`.
  - Expõe, no submit, os `mentionedUserIds` = ids registrados cujo `@<Nome>` ainda
    está presente no texto (remoções manuais somem da lista).
  - Usado tanto no `ReviewComposer` quanto no composer de `ReviewComments`. Mantém o
    contador de 280, `aria-label`s e validações já existentes.
- **Renderização:** helper `renderWithMentions(content, mentions)` que quebra o texto
  e transforma cada ocorrência de `@<name>` (apenas dos `mentions` recebidos) num
  `<Link to={/perfil/<userId>}>` com destaque (`text-primary`), preservando o resto do
  texto (incl. `whitespace-pre-wrap`). Usado no `ReviewCard` e na exibição de cada
  comentário.

## Testes

### API (Vitest + Postgres real — `pnpm db:up` antes)

- Criar resenha com `mentionedUserIds` persiste a relação (1 linha por id distinto) e
  o DTO retorna `mentions`.
- Notifica cada marcado (`REVIEW_MENTION`) e **não** notifica a si mesmo.
- Ids duplicados → dedup; ids inválidos/inativos/admin → ignorados; acima de 10 →
  truncado para 10.
- Idem para comentário (`createComment` + notificação com link da resenha-pai).
- Cascade: excluir a resenha/comentário apaga as menções.

### Web (jsdom + Testing Library)

- `MentionTextarea`: digitar `@` filtra colegas; selecionar insere `@Nome ` e o submit
  inclui o `userId`; remover o `@Nome` do texto remove o id do envio.
- `renderWithMentions`: linka os nomes mencionados para o perfil e deixa o resto do
  texto intacto (incl. quando o `@nome` não está na lista de menções).

## Bônus: card de notificação no Teams (seguir o modelo do nudge)

Hoje o card genérico (`buildNotificationCard` em `lib/teams-client.ts`, usado por
`mirrorToTeams` para espelhar todas as notificações, incl. as da Resenha) é pobre:
um header fixo "🔔 Legends" + o título no corpo + botão. O nudge de ofensiva
(`buildStreakAtRiskCard`) é o modelo desejado: header colorido com a manchete em
negrito, corpo, e um botão de ação claro.

**Mudança:** redesenhar `buildNotificationCard` para seguir esse modelo, mantendo a
mesma estrutura visual do nudge:

- `TeamsNotification` ganha campos opcionais `emoji?: string` (default `🔔`) e
  `body?: string`.
- Card: `Container` com `style: 'accent'` e `bleed`, contendo um `TextBlock`
  **Bolder/Medium** = `${emoji} ${title}` (a manchete); se houver `body`, um
  `TextBlock` `wrap` com o corpo; e a action `Action.OpenUrl` com `ctaLabel`/`ctaUrl`.
- `createNotification` (em `notification-service.ts`) passa para `mirrorToTeams` um
  **emoji por tipo** de notificação (ex.: `💬` comentário, `❤️` reação, `📣`
  compartilhamento/broadcast de período, `@` menção, `🏅` selo, `🏆` destaque, `🔔`
  default). O título da notificação vira a manchete do header; sem `body`, o card
  fica header + botão (já fiel ao modelo — o corpo é opcional, como no nudge).
- `mirrorToTeams` e `broadcastToActive` continuam passando `ctaLabel: 'Abrir no
  Legends'`; nenhuma assinatura pública quebra (campos novos são opcionais).
- O `buildStreakAtRiskCard` permanece como está (já é o modelo).

**Testes:** `buildNotificationCard` inclui o emoji + título no header em negrito,
renderiza o `body` quando presente e o omite quando ausente, e mantém o botão de CTA;
o mapeamento tipo→emoji é coberto por um teste do `notification-service`/helper.

## Fora de escopo (YAGNI)

- Menções em qualquer outro lugar fora da Resenha (feedbacks, retros, etc.).
- Notificação agregada/"resumo" de menções; cada menção gera sua notificação.
- Hovercard/preview de perfil ao passar o mouse na menção (só link).
- Edição de menções após publicar (não há edição de resenha/comentário).
