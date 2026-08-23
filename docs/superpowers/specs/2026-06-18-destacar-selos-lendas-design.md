# Design — Destacar selos na tela de Lendas

- **Data:** 2026-06-18
- **Autor:** lucca.secco (via Claude Code)
- **Status:** aprovado para planejamento

## Problema

O card de cada pessoa na galeria de **Lendas** (`/lendas`) exibe os 3 primeiros
selos do usuário, ordenados por `awardedAt DESC`, mais um contador `+N` com o
restante. O usuário não tem nenhum controle sobre **quais** selos aparecem em
destaque — quem conquista muitos selos não consegue evidenciar os que considera
mais relevantes.

## Objetivo

Permitir que cada usuário escolha, no próprio perfil, **até 3 selos** (dos que já
conquistou) para destacar no card da galeria de Lendas. Os selos não escolhidos
continuam contando no `+N`.

### Decisões de produto (definidas no brainstorming)

- **Escopo do controle:** escolher os selos *destacados*. Os demais permanecem no
  contador `+N`; nada some da tela.
- **Onde gerencia:** na própria página de perfil (`ProfilePage` / `BadgeGallery`),
  em modo edição, visível apenas quando o perfil aberto é o do próprio usuário.
- **Limite:** máximo de **3** destaques (igual ao número de slots que o card já
  mostra hoje).
- **Fallback:** se o usuário ainda não escolheu nenhum destaque, o card mantém o
  comportamento atual (3 selos mais recentes).
- **Ordenação:** dentro do card, os destaques seguem a ordem existente
  (`awardedAt DESC`). Ordenação manual está **fora de escopo**.

## Abordagem escolhida

**Flag `featured` em `UserBadge`** (Approach A). A marcação de destaque vive na
própria linha do selo conquistado, então "destacar" é apenas alternar um booleano.
Não há segunda fonte de verdade: revogar um selo remove o destaque naturalmente, e
não há risco de a lista de destaques apontar para selos que o usuário não possui.

Alternativa descartada: `featuredBadgeIds String[]` em `User` — daria ordenação de
graça, mas duplica a relação que `UserBadge` já modela e exige validar/podar a
lista quando selos são revogados.

## Mudanças por camada

### 1. Schema / migration (`apps/api/prisma`)

- Adicionar `featured Boolean @default(false)` ao model `UserBadge`.
- Gerar nova migration com `pnpm db:migrate`. O default `false` cobre todas as
  linhas existentes — sem backfill; todo mundo começa no fallback atual.
- **Não** editar migrations já aplicadas.

### 2. Contrato (`packages/shared/src/badge.ts`)

- `AwardedBadgeDTO` ganha o campo `featured: boolean`.
- Nova constante `MAX_FEATURED_BADGES = 3` (fonte única, consumida por API e web).
- Tipo do payload do endpoint de atualização:
  `interface UpdateFeaturedBadgesPayload { badgeIds: string[] }`, onde
  `badgeIds` são `UserBadge.id` (= `AwardedBadgeDTO.id`).

### 3. API (`apps/api/src`)

- **Serialização** (`lib/serialize.ts`): `toAwardedBadgeDTO` passa a incluir
  `featured` a partir de `UserBadge.featured`.
- **Rota** `PUT /me/featured-badges` em `routes/profile.ts`
  (`onRequest: [app.authenticate]`). Rota fina: valida o corpo com Zod
  (`badgeIds: z.array(z.string()).max(MAX_FEATURED_BADGES)`), retornando
  `400 { message, issues }` em falha; chama o service; serializa a saída
  (retorna a lista atualizada de selos do usuário como `AwardedBadgeDTO[]`).
- **Service** `setFeaturedBadges(userId, badgeIds)` em
  `services/profile-service.ts`:
  - Confere que **todos** os `badgeIds` pertencem ao `userId`. Se algum não
    pertencer, lança erro de domínio tipado com `status` HTTP (padrão do repo,
    p.ex. `400`), tratado por `instanceof` na rota.
  - Numa transação, seta `featured = true` nos selos escolhidos e
    `featured = false` em todos os demais selos do usuário (substituição
    idempotente do conjunto de destaques).
- **Showcase** (`listShowcase()`): ao montar `badges` por usuário, ordenar por
  `featured DESC, awardedAt DESC`. O card já corta em 3, então os destaques sobem
  naturalmente; o `+N` continua contando o total. Usuários sem destaque caem no
  `awardedAt DESC` atual (fallback automático).

### 4. Frontend (`apps/web/src`)

- **`BadgeGallery`** (usado em `ProfilePage`): quando `isOwnProfile`, exibir botão
  "Escolher destaques" que entra em **modo edição**:
  - Cada selo vira clicável (toggle de destaque), com realce visual de
    "destacado" e contador `X/3`.
  - Ao atingir `MAX_FEATURED_BADGES`, desabilitar seleção de novos (mantendo a
    possibilidade de desmarcar).
  - Botões **Salvar** e **Cancelar**.
  - Salvar chama `apiFetch('/me/featured-badges', { method: 'PUT', body: { badgeIds } })`
    e invalida as queries `["profile", id]` e `["showcase"]` para refletir de
    imediato na galeria de Lendas.
- **`LegendsPage` / `LegendCard`:** sem mudança de lógica — já exibem os 3
  primeiros selos; como o backend ordena os destaques primeiro, passa a funcionar
  automaticamente. (Realce visual novo no card está fora de escopo.)

### 5. Testes

- **API** (Vitest contra Postgres real):
  - `profile-service`: destaques sobem no showcase; fallback sem destaque
    (3 mais recentes); rejeita `badgeId` de selo de outro usuário; respeita o
    limite de 3; substituição idempotente do conjunto.
  - Rota `PUT /me/featured-badges`: `200` no caminho feliz, `400` para corpo
    inválido / id inválido, exige autenticação.
- **Web** (jsdom + Testing Library):
  - `BadgeGallery` em modo edição: toggle de destaque, respeito ao limite de 3,
    corpo correto enviado ao salvar.

## Fora de escopo

- Ordenação manual dos selos destacados.
- Qualquer mudança no que aparece na própria página de perfil (a escolha afeta
  apenas a tela de Lendas).
- Novo realce visual do destaque no card de Lendas.
