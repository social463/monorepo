# Selo de Feedback — Design

**Data:** 2026-06-17
**Status:** Aprovado para planejamento

## Problema

Os selos automáticos atuais (`CATEGORY`, `IMPACT`, `RECURRENCE`) são concedidos com base em
**votos recebidos** pelo usuário. Falta um selo cuja métrica seja a **atividade de dar feedback**:
quanto mais feedbacks a pessoa faz, mais perto fica de ganhar o selo. O admin precisa poder criar
esses selos e definir o limiar (número de feedbacks feitos).

## Decisões tomadas

- **Métrica:** total de feedbacks feitos (count em `Feedback` onde `authorId = usuário`).
- **Escopo da contagem:** todo feedback conta +1, para qualquer alvo, repetidos inclusive.
  Auto-feedback já é impossível: `createFeedback` rejeita `authorId === targetId`
  (`feedback-service.ts:64`). Logo `count where authorId` já é "todo feedback feito".
- **Permanência:** o selo de feedback é **revogável**. Se um feedback é apagado e a contagem do
  autor cai abaixo do limiar, o selo automático é retirado. Isto é um comportamento **novo**,
  exclusivo dos selos `FEEDBACK` — os selos de voto continuam permanentes.

## Arquitetura

### 1. Modelo de dados

Adicionar `FEEDBACK` ao enum `BadgeKind` no schema Prisma. **Nenhuma tabela nova** — reutiliza o
modelo `Badge` existente:

- `kind = FEEDBACK`
- `threshold` = número de feedbacks feitos necessário
- `categorySlug = null` (não se aplica)

Migration apenas adiciona o valor `FEEDBACK` ao enum `BadgeKind`. Múltiplos selos de feedback com
limiares diferentes (ex.: 5/15/30) são suportados sem nada extra, igual aos selos `IMPACT`.

### 2. Lógica de qualificação e sincronização

Em `apps/api/src/services/badge-service.ts`:

- `countFeedbacksAuthored(userId)` → `prisma.feedback.count({ where: { authorId: userId } })`.
- `qualifies()` ganha o ramo `FEEDBACK`: `countFeedbacksAuthored(userId) >= badge.threshold`.
- Nova função **`syncFeedbackBadgesForUser(authorId)`** que faz as duas direções com uma única
  leitura de contagem:
  - **Concede** (cria `UserBadge` AUTO, periodId null) os selos `FEEDBACK` que o usuário passou a
    qualificar e ainda não possui. Mantém o tratamento de corrida `P2002` já usado em
    `evaluateBadgesForUser`.
  - **Revoga** (deleta `UserBadge`) os selos `FEEDBACK` AUTO com `periodId = null` cujo limiar não
    é mais atendido.
  - **Só** mexe em concessões `source = AUTO`. Concessões `MANUAL` do admin nunca são revogadas
    nem duplicadas por esta função.

**Separação por kind:** `evaluateBadgesForUser` (disparada por voto) passa a **ignorar** selos
`FEEDBACK`; `syncFeedbackBadgesForUser` só considera selos `FEEDBACK`. Assim os selos de voto
seguem permanentes (comportamento atual intacto) e a revogação fica isolada ao feedback.

### 3. Gatilhos

Mesmo padrão de chamada pós-ação de `apps/api/src/routes/votes.ts:30`:

- `POST` feedback (`apps/api/src/routes/feedback.ts`), após criar → `syncFeedbackBadgesForUser(author)` — pode conceder.
- `DELETE` feedback, após apagar → `syncFeedbackBadgesForUser(author)` — pode revogar.
- `PATCH` (editar) **não** dispara — não altera a contagem.

O `authorId` para a sync no DELETE deve vir do feedback removido (o service de exclusão precisa
expor/retornar o `authorId`, já que a checagem de permissão garante autor ou admin).

### 4. Admin / API

- Adicionar `'FEEDBACK'` aos enums `badgeKindSchema` em `apps/api/src/routes/admin.ts:56`
  (usado em create e update). Admin cria e define limiar pelo `/admin/badges` existente — sem
  endpoint novo.
- Frontend admin `apps/web/src/pages/admin/BadgesSection.tsx`: incluir a opção
  `{ value: "FEEDBACK", label: "Feedback (total de feedbacks feitos)" }` na lista de tipos. O campo
  de categoria já é exibido só para `CATEGORY`, então nada muda lá.

## Testes

- `badge-service`: `qualifies()` para `FEEDBACK` (abaixo, igual, acima do limiar);
  `syncFeedbackBadgesForUser` concede ao cruzar o limiar; revoga ao cair abaixo; **não** revoga
  selo `MANUAL`; `evaluateBadgesForUser` ignora selos `FEEDBACK`.
- Rotas de feedback: criar feedback que cruza o limiar concede o selo; apagar feedback que derruba
  abaixo do limiar revoga o selo; editar não altera selos.
- Admin: criar/editar selo com `kind = FEEDBACK` é aceito (e rejeita kind inválido como antes).

## Não-objetivos (YAGNI)

- Selo de feedback por categoria (`POSITIVO`/`ORIENTACAO`/`ELOGIO`/`MELHORIA`).
- Guarda anti-spam além do `MIN_FEEDBACK_FIELD_LENGTH` já existente.
- Revogação para selos de voto (segue permanente).
