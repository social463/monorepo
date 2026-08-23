# Selo de Tempo de Casa — Design

**Data:** 2026-06-18
**Status:** Aprovado (brainstorming)

## Objetivo

Reconhecer o tempo de empresa de cada colaborador com selos concedidos no
aniversário de entrada na equipe. Os selos são **acumulativos**: ao completar
N anos, a pessoa coleciona os selos de 1, 2, …, N anos. A data de referência é
o `User.joinedAt` já existente (exibido no perfil como "Na equipe desde…").

Catálogo inicial: **1, 2, 3 e 4 anos**. O tipo é genérico, então níveis novos
(5, 10 anos…) podem ser criados depois sem alterar código.

## Decisões de design

- **Gatilho:** avaliação preguiçosa (lazy) no carregamento do perfil. Sem infra
  de agendamento nova.
- **Escopo:** tipo `TENURE` genérico por quantidade de anos; começamos com 1–4.
- **Notificação:** sim, reusando `notifyBadgesEarned` (mesma experiência dos
  selos de voto).
- **Acúmulo:** natural — cada nível é um `Badge` separado e cada conquista é um
  `UserBadge` independente.

## 1. Modelo de dados e contrato

Novo valor no enum `BadgeKind`: **`TENURE`**. Reaproveita a estrutura existente
sem campos novos em `Badge`/`UserBadge`:

- `kind = 'TENURE'`
- `threshold` = anos exigidos (1, 2, 3, 4…)
- `categorySlug = null`
- `iconKey` = ícone por nível

Mudanças:
- `enum BadgeKind` em `apps/api/prisma/schema.prisma:27` → **migration** (novo
  valor de enum; nunca editar migration aplicada — gerar nova com `pnpm db:migrate`).
- `BADGE_KINDS` em `packages/shared/src/enums.ts:12` → adicionar `'TENURE'`.

Selos iniciais criados via `apps/api/prisma/seed.ts` com **upsert idempotente
por slug**:

| slug                   | name              | threshold | iconKey (sugerido) |
|------------------------|-------------------|-----------|--------------------|
| `tempo-de-casa-1-ano`  | 1 ano de casa     | 1         | (medalha)          |
| `tempo-de-casa-2-anos` | 2 anos de casa    | 2         | (medalha)          |
| `tempo-de-casa-3-anos` | 3 anos de casa    | 3         | (troféu)           |
| `tempo-de-casa-4-anos` | 4 anos de casa    | 4         | (troféu)           |

`description`: ex. "Comemora N ano(s) de equipe na EMR". Em produção os selos
podem ser criados pelo mesmo seed ou pela rota admin existente
(`POST /admin/badges`). Os `iconKey` finais serão escolhidos entre o catálogo
de ícones já disponível e podem ser ajustados por admin depois.

## 2. Lógica de avaliação

### 2.1. Cálculo de anos completos (helper puro)

```
completedYears(joinedAt, now):
  years = now.year - joined.year
  if (now.month < joined.month ||
      (now.month === joined.month && now.day < joined.day)) years--
  return max(0, years)
```

- Um ano só conta quando o aniversário **já passou** (comparação mês/dia).
- **29/fev:** em anos não-bissextos o aniversário é considerado atingido em
  01/mar (consequência natural da comparação — em 28/fev `day 28 < day 29`,
  então ainda não conta). Comportamento aceito e documentado.
- Helper isolado e puro para ser testável sem banco.

### 2.2. Qualificação

Em `qualifies()` (`apps/api/src/services/badge-service.ts:28`):

```ts
if (badge.kind === 'TENURE') {
  return completedYears(user.joinedAt, now) >= badge.threshold
}
```

Requer carregar `joinedAt` do usuário (a função passa a precisar da data; passar
o `user`/`joinedAt` por parâmetro ou buscar conforme o padrão da camada).

### 2.3. Concessão

Função dedicada `evaluateTenureBadgesForUser(userId)`:

- Varre **apenas** os selos `kind = 'TENURE'` (não recomputa estatísticas de
  voto a cada visita de perfil).
- Reaproveita o padrão de criação com tratamento de `P2002` (corrida) já usado
  em `evaluateBadgesForUser`.
- **Somente aditivo** — nunca revoga (diferente do `syncFeedbackBadgesForUser`).
- Retorna os selos recém-concedidos (para alimentar a notificação).

## 3. Gatilho (avaliação preguiçosa) + notificação

No caminho de `GET /users/:id/profile` (`apps/api/src/routes/profile.ts` /
profile-service), antes de montar o DTO:

1. `evaluateTenureBadgesForUser(profileUserId)`.
2. `notifyBadgesEarned(profileUserId, novosIds)` para os recém-concedidos.
3. Tudo **best-effort**: try/catch que loga e não derruba o perfil (mesma
   política de `apps/api/src/routes/votes.ts:32`).

Qualquer visita ao perfil (própria ou de terceiros) reavalia o **dono** daquele
perfil; o selo aparece na primeira visualização após o aniversário e a
notificação vai para o dono.

## 4. Exibição no catálogo (progresso)

Em `buildRequirement()` e `computeProgress()`
(`apps/api/src/services/badge-service.ts:160`):

- Requisito legível: **"Complete N ano(s) na equipe"**.
- Progresso: `current = completedYears(joinedAt, now)`, `target = threshold`.

Frontend: a galeria/perfil já renderiza selos genéricos por `iconKey` — sem
mudança estrutural, apenas os ícones novos.

## 5. Testes

- **Unitário `completedYears`:** véspera vs. dia do aniversário, virada de ano,
  29/fev em ano não-bissexto.
- **`evaluateTenureBadgesForUser`:** concede no limiar; acumula níveis (3 anos →
  selos de 1, 2 e 3); idempotente (não duplica em chamadas repetidas); respeita
  selo já possuído.
- **Integração `GET /users/:id/profile`:** usuário com `joinedAt` de 3 anos
  atrás recebe os selos de 1/2/3 anos ao carregar o perfil; dispara notificação.

## Arquivos afetados

| Camada | Arquivo |
|---|---|
| Prisma enum + migration | `apps/api/prisma/schema.prisma`, nova migration |
| Contrato | `packages/shared/src/enums.ts` |
| Seed | `apps/api/prisma/seed.ts` |
| Serviço (helper, qualifies, evaluateTenure, requirement, progress) | `apps/api/src/services/badge-service.ts` |
| Gatilho + notificação | `apps/api/src/routes/profile.ts` (ou profile-service) |
| Testes | `*.test.ts` ao lado do serviço e da rota |

## Fora de escopo (YAGNI)

- Job/cron diário para notificar no dia exato (lazy é suficiente por ora).
- UI de admin específica para selos de tempo de casa (rota admin genérica já
  cobre criação).
- Revogação de selos de tempo de casa.
