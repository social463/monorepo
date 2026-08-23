# Catálogo de Selos (requisito + progresso + imagem) — Design

**Data:** 2026-06-17
**Status:** Aprovado para planejamento

## Problema

Os usuários precisam ver, em um só lugar, todos os selos da plataforma com: a imagem do selo,
a descrição, **o que é preciso para conquistar** e **o quanto já progrediram** rumo a cada um.

Hoje já existe `GET /badges` (autenticado) retornando todos os selos como `BadgeDTO`
(`name`, `description`, `kind`, `threshold`, `categorySlug`, `iconKey`) e a página
`apps/web/src/pages/BadgesPage.tsx` lista todos, mostra a descrição e marca os conquistados
(via `GET /users/:id/badges`). Faltam dois elementos: um **requisito legível derivado** de
`kind`+`threshold` (hoje só existe se o admin escreveu no texto livre da `description`), o
**progresso do usuário** rumo a cada selo, e a **imagem do selo** na listagem.

## Decisões tomadas

- Enriquecer o endpoint `GET /badges` existente (em vez de criar rota nova) — é autenticado e
  tem um único consumidor (a `BadgesPage`).
- Requisito **derivado** server-side de `kind`+`threshold` (+ nome da categoria para `CATEGORY`),
  fonte única de verdade.
- Progresso = contagem atual do usuário logado vs `threshold`. `HIGHLIGHT` (manual) não tem
  progresso (`null`).
- A listagem mostra a **imagem do selo** reusando o componente `BadgeEmblem`.
- Não alterar o estado "conquistado" (já funciona via `GET /users/:id/badges`, que cobre também
  concessões `MANUAL`).

## Arquitetura

### 1. API — enriquecer `GET /badges`

Nova função em `apps/api/src/services/badge-service.ts`:

```
getBadgeCatalog(userId: string): Promise<BadgeCatalogEntry[]>
```

Reusa os helpers de contagem já existentes no arquivo: `countVotesInCategory`,
`countTotalVotes`, `countDistinctMonths`, `countFeedbacksAuthored`. Para cada selo, devolve os
campos do `BadgeDTO` + dois novos:

- **`requirement: string`**, derivado de `kind` (+ `threshold`, + nome da categoria):
  - `FEEDBACK` → `Faça {threshold} feedbacks`
  - `IMPACT` → `Receba {threshold} votos no total`
  - `RECURRENCE` → `Receba votos em {threshold} meses diferentes`
  - `CATEGORY` → `Receba {threshold} votos em {nomeDaCategoria}` (nome via `categorySlug`;
    fallback para o próprio `categorySlug` se a categoria não for encontrada; se `categorySlug`
    for `null`, `Receba {threshold} votos em uma categoria`)
  - `HIGHLIGHT` → `Seja o destaque do mês`
- **`progress: { current: number; target: number } | null`**:
  - `current` = contagem atual do usuário para aquele `kind`; `target` = `threshold`
  - `FEEDBACK` → feedbacks feitos; `IMPACT` → votos recebidos no total;
    `RECURRENCE` → meses distintos com voto recebido; `CATEGORY` → votos recebidos na categoria
  - `HIGHLIGHT` → `null`
  - `current` é a contagem real (pode exceder o `target`; a UI trava a barra em 100%).

A categoria-slug→nome é resolvida com um único `prisma.category.findMany` (mapa em memória).
A ordem da listagem permanece `orderBy: { name: 'asc' }`, como hoje.

**Shape compartilhado:** `toBadgeDTO` permanece intacto (usado pelo admin e por outros DTOs).
Novo tipo em `packages/shared/src/badge.ts`:

```ts
export interface BadgeProgress {
  current: number
  target: number
}
export interface BadgeCatalogEntryDTO extends BadgeDTO {
  requirement: string
  progress: BadgeProgress | null
}
```

Um serializador `toBadgeCatalogEntryDTO` (em `apps/api/src/lib/serialize.ts`) monta a entrada a
partir do `Badge` + `requirement` + `progress`. O handler `GET /badges`
(`apps/api/src/routes/badges.ts`) passa a chamar `getBadgeCatalog(request.user.sub)` e devolver
`{ badges: BadgeCatalogEntryDTO[] }`. Continua autenticado (`onRequest: [app.authenticate]`).

### 2. Web — `BadgesPage`

`apps/web/src/pages/BadgesPage.tsx` consome o novo shape `BadgeCatalogEntryDTO[]`. Cada card:

- **Imagem do selo** no topo, centralizada: `<BadgeEmblem badge={badge} size={72} />`
  (o componente já existe e cai num motivo geométrico se o PNG falhar).
- Nome (+ tag "conquistado" quando aplicável, como hoje).
- Descrição (`description`), como hoje.
- **Requisito** (`requirement`) em texto secundário.
- **Progresso**: quando o selo NÃO está conquistado e `progress != null`, uma barra
  (largura = `min(100%, current/target*100%)`) + texto `{min(current,target)}/{target}`.
  Quando conquistado, não exibe a barra (mantém só a tag "conquistado").

Mantém o tratamento de `isLoading`/`isError` e o esmaecido (`opacity-60`) dos não conquistados
que já existem. O estado "conquistado" segue vindo de `GET /users/:id/badges` (inalterado).

### 3. Testes

- **`badge-service`** (`badge-service.test.ts`): `getBadgeCatalog` gera o `requirement` correto por
  kind — incluindo o nome da categoria para `CATEGORY` e o fallback quando a categoria não existe —
  e o `progress` correto (ex.: usuário com 3 feedbacks → `{ current: 3, target: 5 }` no selo de 5;
  `HIGHLIGHT` → `progress: null`).
- **rota** (`badges.test.ts`): `GET /badges` exige autenticação (401 sem token) e retorna entradas
  com `requirement` e `progress`.
- **web** (`BadgesPage.test.tsx`): atualizar para o novo shape; assertar que o requisito, o texto de
  progresso e o emblema do selo (`role="img"` / `aria-label` do nome) são renderizados.

## Não-objetivos (YAGNI)

- Não alterar o estado "conquistado" (já funciona).
- Sem progresso para selos `HIGHLIGHT`/manuais.
- Sem cache/otimização de contagem além dos helpers existentes.
- Sem mudança no endpoint `/admin/badges` nem no `toBadgeDTO`.
