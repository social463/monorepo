# Resenha — Menção `@Todos` (broadcast para o time) — Design Spec

- **Data:** 2026-06-29
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming)
- **Depende de:** [Resenha — Menções com @](2026-06-26-resenha-mencoes-design.md),
  [Notificações Teams](2026-06-26-teams-notifications-design.md) (já em `main`)

## Resumo

Adicionar uma opção `@Todos` no autocomplete de menções da Resenha (resenha e
comentários) para **comunicar todo o time de uma vez**. Ao selecionar `@Todos`, o
token `@Todos ` é inserido no texto e, na publicação, **todos os colegas ativos
não-admin** (exceto o autor) recebem a notificação `REVIEW_MENTION` — in-app **e**
espelhada no Teams, igual às menções diretas. Na exibição, `@Todos` aparece como
destaque (cor primária) **sem** link de perfil, já que não é uma pessoa.

Adicionalmente, fica disponível um opt-out genérico de broadcast no usuário; o
**Guilherme Barboza** entra com esse opt-out ligado (não recebe `@Todos`, mas segue
recebendo menções diretas e demais notificações normalmente).

## Decisões (do brainstorming)

- **Escopo:** `@Todos` na resenha **e** nos comentários.
- **Canal:** in-app **+ Teams** (mesmo caminho das menções normais via
  `notifyReviewMention` → `createNotification` → `mirrorToTeams`).
- **Permissão:** **qualquer** usuário pode usar `@Todos` (sem restrição a admin).
- **Persistência do `@Todos`:** **flag transiente** — o cliente envia
  `mentionEveryone: true` apenas para disparar as notificações na criação; **sem
  coluna nova** para isso. O render do token `@Todos` é feito por texto literal.
- **Exclusão do Guilherme:** **só do broadcast `@Todos`**, via **flag genérica no
  `User`** (`excludeFromBroadcast`), não por nome cravado em código.
- **Cap de menções:** o cap de 10 (`MAX_REVIEW_MENTIONS`) continua valendo **apenas**
  para o array `mentionedUserIds`; `@Todos` é independente (booleano).

## Contrato compartilhado (`packages/shared/src/review.ts`)

```ts
export const MENTION_EVERYONE_TOKEN = '@Todos'   // fonte única front+back
export const MENTION_EVERYONE_LABEL = 'Todos'    // rótulo no dropdown

export interface CreateReviewRequest {
  content: string
  mentionedUserIds?: string[]
  mentionEveryone?: boolean        // novo
}

export interface CreateReviewCommentRequest {
  content: string
  mentionedUserIds?: string[]
  mentionEveryone?: boolean        // novo
}
```

DTOs de resposta (`ReviewDTO`, `ReviewCommentDTO`) **não mudam** — o flag é transiente.

## Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate`.

```prisma
model User {
  // ...
  excludeFromBroadcast Boolean @default(false)   // opt-out de @Todos
}
```

A migration gerada recebe, ao final, SQL custom idempotente para marcar o Guilherme
em produção (roda via `migrate deploy`):

```sql
UPDATE "User" SET "excludeFromBroadcast" = true
WHERE "email" = 'guilherme.barboza@eumedicoresidente.com.br';
```

> O `UPDATE` é no-op em ambientes onde esse email não existe (dev/test), então não
> quebra o seed nem os testes.

## Backend

### Service — `apps/api/src/services/review-service.ts`

- Novo helper, ao lado de `resolveMentions`:

```ts
export async function mentionableUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { not: 'ADMIN' }, excludeFromBroadcast: false },
    select: { id: true },
  })
  return users.map((u) => u.id)
}
```

- `resolveMentions` (menções diretas) **não muda** — Guilherme continua marcável e
  notificável diretamente.

### Routes — `apps/api/src/routes/review.ts`

- Zod `contentSchema` ganha `mentionEveryone: z.boolean().optional()`.
- `POST /reviews` e `POST /reviews/:id/comments`: quando `body.mentionEveryone === true`,
  os destinatários de `notifyReviewMention` passam a ser `await mentionableUserIds()`
  (em vez de só `review.mentions.map(m => m.userId)`). `notifyReviewMention` já
  remove o autor e deduplica, então o autor nunca se auto-notifica.
- Os demais disparos do comentário (`notifyReviewComment` ao autor da resenha,
  `notifyReviewCommentReply` aos comentaristas anteriores) seguem inalterados.
- O broadcast do WebSocket (`feed:changed` / `comments:changed`) segue igual.

## Frontend

### `apps/web/src/components/MentionTextarea.tsx`

- Nova prop opcional `onMentionEveryoneChange?: (v: boolean) => void`.
- A lista do dropdown passa a ser uma união: uma opção sintética **"Todos"** (com
  ícone de grupo) no topo, exibida quando o query é prefixo de `"todos"`
  (`'todos'.startsWith(query.toLowerCase())`), seguida dos colegas filtrados.
  Navegável por teclado como as demais (índice 0 = "Todos" quando presente).
- Ao selecionar "Todos": insere o token `@Todos ` (via mesma mecânica de `select`) e
  chama `onMentionEveryoneChange(true)`.
- O flag é **recalculado a cada mudança de texto**: `onMentionEveryoneChange(
  text.includes(MENTION_EVERYONE_TOKEN))`, espelhando o padrão de `reportMentions`.
  Apagar o token `@Todos` desliga o flag.

### Páginas — `ReviewComments.tsx` e `ReviewComposer.tsx`

- Novo estado `const [mentionEveryone, setMentionEveryone] = useState(false)`.
- `onMentionEveryoneChange={setMentionEveryone}` no textarea.
- Incluir `mentionEveryone` no body da mutation; **resetar** no `onSuccess` junto com
  `text`/`mentionIds`.
- `ReviewComposer` propaga `mentionEveryone` no `onSubmit` (a assinatura passa a ser
  `(content, mentionedUserIds, mentionEveryone) => void`).

### Render — `apps/web/src/lib/mentions.tsx`

- `renderWithMentions` passa a reconhecer também o literal `@Todos`: inclui
  `MENTION_EVERYONE_TOKEN` no conjunto de tokens do regex e, no `map`, quando
  `part === '@Todos'`, renderiza um `<span>` destacado (cor primária, peso de label)
  **sem** `<Link>`. Pessoas continuam virando link de perfil.
- Vale para resenha (`ReviewCard.tsx`) e comentários (`ReviewComments.tsx`), que já
  passam por essa função.

## Testes

- **API** (`routes/review.test.ts` ou service): `POST /reviews` com
  `mentionEveryone: true` cria `REVIEW_MENTION` para **todos** os ativos não-admin
  exceto o autor; um usuário com `excludeFromBroadcast: true` **não** recebe;
  menção direta a esse mesmo usuário (`mentionedUserIds`) **continua** notificando.
- **Web** (`MentionTextarea.test.tsx`): digitar `@` mostra a opção "Todos";
  selecioná-la insere `@Todos ` e dispara `onMentionEveryoneChange(true)`; apagar o
  token chama `onMentionEveryoneChange(false)`.
- **Web** (`mentions` render): `@Todos` vira span destacado **não** clicável.

## Fora de escopo (YAGNI)

- UI de admin para alternar `excludeFromBroadcast` (set inicial vem da migration; mais
  tarde dá pra expor num painel se necessário).
- Restrição de quem pode usar `@Todos` (decidido: liberado a todos).
- Persistir/auditar que uma resenha foi um broadcast (flag transiente é suficiente).
