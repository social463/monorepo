# Design — Voto em múltiplas categorias

- **Data:** 2026-06-18
- **Status:** Aprovado (brainstorming)
- **Escopo:** Permitir que o votante reconheça um colega em mais de uma categoria numa única submissão.

## Problema

Hoje cada votante registra **um voto por período**: um colega, **uma** categoria, uma
justificativa. O modelo é rígido demais — frequentemente um colega merece reconhecimento
em mais de um eixo (ex.: "Mentoria" e "Qualidade"). Queremos permitir marcar **mais de uma
categoria** para o mesmo colega, sem distorcer a eleição do Destaque do Mês nem os rankings.

## Decisões de produto

| Tema | Decisão |
|------|---------|
| Modelo | **Um colega, várias categorias** por período (inalterado: um colega por período). |
| Limite | **1 a 3 categorias** por submissão (`MIN_VOTE_CATEGORIES = 1`, `MAX_VOTE_CATEGORIES = 3`). |
| Justificativa | **Uma única**, compartilhada por todas as categorias (mín. 10 chars). Não é replicada no banco. |
| Pós-voto | **Trava após enviar** — uma submissão por votante por período (comportamento atual mantido). |
| Peso | **Vale 1 reconhecimento** independente de quantas categorias. Não infla Destaque do Mês, vitrine nem selo de Impacto. As categorias só detalham "em quê". |

## Modelo de dados

O `Vote` **continua sendo a unidade de reconhecimento** (um por votante/período, guarda a
justificativa). A categoria deixa de ser um campo único e vira uma relação N‑N.

```prisma
model Vote {
  id            String   @id @default(cuid())
  voterId       String
  votedId       String
  periodId      String
  justification String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  voter      User           @relation("VotesGiven", fields: [voterId], references: [id])
  voted      User           @relation("VotesReceived", fields: [votedId], references: [id])
  period     VotingPeriod   @relation(fields: [periodId], references: [id])
  categories VoteCategory[]

  @@unique([voterId, periodId], name: "one_vote_per_voter_period") // inalterado
  @@index([periodId])
  @@index([votedId])
}

model VoteCategory {
  voteId     String
  categoryId String

  vote     Vote     @relation(fields: [voteId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id])

  @@id([voteId, categoryId])
  @@index([categoryId])
}
```

- Remove o campo `Vote.categoryId`.
- `Category.votes Vote[]` passa a ser `Category.voteCategories VoteCategory[]`.

**Consequência feliz:** toda contagem que hoje conta **linhas de `Vote`** por `votedId`
(eleição do Destaque, vitrine, selo Impacto, meses distintos, coleta de justificativas do
highlight) **fica intacta** — continua 1 voto por votante. Só o que é "por categoria" passa
a contar pela join `VoteCategory`.

### Migration

Migration única (`pnpm db:migrate`):
1. Cria a tabela `VoteCategory`.
2. Copia cada `Vote.categoryId` existente para uma linha `VoteCategory(voteId, categoryId)`.
3. Remove a coluna `Vote.categoryId`.

Sem votos no seed; o único dado a migrar são votos reais já gravados. Nunca editar migration
já aplicada — gerar nova.

## Contrato compartilhado (`@legends/shared`)

`packages/shared/src/vote.ts`:

```ts
export const MIN_VOTE_CATEGORIES = 1
export const MAX_VOTE_CATEGORIES = 3

export interface CreateVoteRequest {
  votedId: string
  categoryIds: string[]   // antes: categoryId: string
  justification: string
}

export interface VoteDTO {
  id: string
  voter: VoteUserRef
  voted: VoteUserRef
  categories: VoteCategoryRef[]   // antes: category: VoteCategoryRef
  justification: string
  createdAt: string
  periodId: string
  monthRef: string
}
```

Alterar o tipo aqui primeiro e ajustar os dois lados (regra do contrato único).

## Backend (`apps/api`)

### Route `POST /votes` (`routes/votes.ts`)
Zod: `categoryIds: z.array(z.string().min(1)).min(MIN_VOTE_CATEGORIES).max(MAX_VOTE_CATEGORIES)`
(dedup defensivo). Mensagem 400 em pt-BR. Repassa `categoryIds` ao service.

### `voting-service.createVote`
- Assinatura recebe `categoryIds: string[]`.
- Mantém todas as regras atuais (sem auto-voto, votante ativo não-admin, período aberto,
  alvo DEV ativo).
- Valida que **cada** categoria existe e está ativa (`findMany` + checagem de count/active);
  categoria inválida → `VoteError('Categoria inválida.', 400)`.
- Cria numa **transação** (`prisma.$transaction`): um `Vote` + N `VoteCategory`.
- P2002 em `[voterId, periodId]` → `VoteError('Você já registrou seu voto neste período.', 409)`.
- `voteInclude` passa a incluir `categories: { include: { category: true } }`.

### `badge-service`
- `countVotesInCategory(userId, slug)` → conta `prisma.voteCategory.count({ where: { category: { slug }, vote: { votedId: userId } } })`.
- `countTotalVotes`, `countDistinctMonths` → **inalterados** (contam `Vote`).

### `profile-service`
- `getUserProfile` breakdown por categoria → `prisma.voteCategory.groupBy({ by: ['categoryId'], where: { vote: { votedId: userId } }, _count: { _all: true } })`.
- `totalVotesReceived` / `monthsRecognized` / `listShowcase` groupBy → **inalterados**.
- `listVotesReceived` filtro `categorySlug` → `where: { votedId, categories: { some: { category: { slug } } } }`; `include` com categorias.

### `highlight-service`
- `electWinner` e coleta de justificativas → **inalterados** (operam sobre `Vote`).

### `serialize.toVoteDTO`
- `categories: vote.categories.map(vc => ({ id: vc.category.id, name: vc.category.name, slug: vc.category.slug }))`.

### `admin`
- Listagem de votos (`GET /admin/votes`) inclui `categories`; exibição mostra múltiplas categorias.
- `DELETE /admin/votes/:id` — `onDelete: Cascade` cuida das `VoteCategory`.

## Frontend (`apps/web` — `pages/VotePage.tsx`)

- Estado `categoryId: string` → `categoryIds: string[]`.
- Categorias: `input type="radio"` → `type="checkbox"`. Ao atingir `MAX_VOTE_CATEGORIES`,
  as não selecionadas ficam desabilitadas com aviso ("Você pode escolher até 3 categorias").
- Validação no `handleSubmit`: 1..MAX categorias + justificativa ≥ mín. Mensagens pt-BR.
- Mutation envia `categoryIds`. Reset limpa o array.
- Listagem de "meus votos" / perfil renderiza `categories` como chips.

## Testes

- `voting-service` / route `POST /votes`: votar em N categorias; teto (4 → 400); mínimo
  (0 → 400); categoria inválida; trava após enviar (P2002 → 409); peso unitário
  (3 categorias = 1 reconhecimento na eleição/contagem).
- `badge-service`: selo de categoria contabiliza por `VoteCategory`; Impacto continua por `Vote`.
- `profile-service`: breakdown por categoria; filtro por `categorySlug`.
- `serialize`: `toVoteDTO` com array de categorias.
- Web: VotePage com checkboxes, teto, submissão de `categoryIds`, render de chips.

## Fora de escopo (YAGNI)

- Editar/adicionar categorias depois de enviar (decidido: trava após enviar).
- Justificativa por categoria.
- Votar em colegas diferentes por categoria (modelo matriz).
- Teto configurável por admin em runtime (constante em `@legends/shared` por ora).
