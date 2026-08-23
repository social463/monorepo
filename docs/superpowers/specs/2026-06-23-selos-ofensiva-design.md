# Selos de ofensiva — Design Spec

**Data:** 2026-06-23
**Status:** aprovado para implementação
**Slug:** selos-ofensiva

## Contexto

A **Ofensiva** (streak) já existe e, após a entrega de
[ofensiva em dias úteis](2026-06-23-ofensiva-dias-uteis-design.md), calcula `bestStreak`
(recorde) em **dias úteis**. Queremos premiar a consistência com **selos** ao atingir marcos
de ofensiva — uma nova família de selos no sistema de badges existente.

Pré-requisito (já entregue): o motor de dias úteis. As metas dos selos significam **dias
úteis** automaticamente, porque derivam de `bestStreak`.

## Escopo

- Novo tipo de selo `BadgeKind = STREAK`, concedido quando o **recorde de ofensiva**
  (`bestStreak`) atinge o limiar do selo.
- 4 níveis (aditivos, permanentes, nunca revogam — igual ao Tempo de Casa).
- Concessão automática **ao registrar o Humor do Dia** (gatilho best-effort) + notificação.
- Catálogo de selos mostra requisito e progresso (`bestStreak / threshold`).
- Opção `STREAK` no admin (criar selos desse tipo manualmente, se desejado).

### Fora de escopo

- Mudanças no painel/indicador da ofensiva.
- Selos por `currentStreak` (usamos só o recorde — selo permanente não deve sumir quando a
  sequência quebra).
- Reavaliação em massa de todos os usuários (o gatilho por registro basta; o TENURE tem
  varredura em massa por causa da galeria de Lendas, o que não se aplica aqui).

## Níveis

| Slug | Nome | `threshold` (dias úteis) | `iconKey` |
|---|---|---|---|
| `ofensiva-7-dias-uteis` | Em chamas | 7 | `fe-fire` |
| `ofensiva-14-dias-uteis` | Imparável | 14 | `fe-voltage` |
| `ofensiva-30-dias-uteis` | Incandescente | 30 | `fe-rocket` |
| `ofensiva-60-dias-uteis` | Lendária | 60 | `fe-crown` |

Os quatro `iconKey` já existem em `apps/web/src/lib/badge-art.ts`. Descrição de cada selo:
`"Seu recorde de ofensiva atingiu N dias úteis consecutivos."`

## Mecânica

- **Critério**: `bestStreak >= threshold`, onde `bestStreak` vem de
  `getStreakSummary(userId)` (já em dias úteis).
- **Aditivo/permanente**: ao bater 30, o usuário recebe também 7, 14 e 30 (todos os níveis
  já atingidos). Nunca revoga (mesmo se a sequência atual cair) — recorde só sobe.
- **Concessão**: novo avaliador dedicado `evaluateStreakBadgesForUser`, espelhando
  `evaluateTenureBadgesForUser` (best-effort, P2002-safe, só aditivo). **Não** se adiciona
  `STREAK` ao `qualifies()` genérico — assim há um único caminho de concessão, como o TENURE.

## Arquitetura — backend (`apps/api`)

### Enum `BadgeKind`

- `packages/shared/src/enums.ts`: adicionar `'STREAK'` a `BADGE_KINDS`.
- `apps/api/prisma/schema.prisma`: adicionar `STREAK` ao enum `BadgeKind`.
- Migration **aditiva** gerada por `pnpm db:migrate` (`ALTER TYPE "BadgeKind" ADD VALUE 'STREAK'`).
  Migration aplicada nunca é editada.

### `src/services/badge-service.ts`

- `evaluateStreakBadgesForUser(userId: string, todayYmd?: string): Promise<UserBadge[]>`
  - Carrega selos `kind: 'STREAK'` + selos já possuídos (`periodId: null`).
  - `bestStreak = (await getStreakSummary(userId, todayYmd)).bestStreak`.
  - Concede os `STREAK` com `threshold <= bestStreak` ainda não possuídos; aditivo;
    trata `P2002` (corrida) silenciosamente. Retorna os recém-concedidos.
  - `todayYmd` opcional repassado a `getStreakSummary` para testes determinísticos.
- `buildRequirement()`: caso `STREAK` → `"Mantenha uma ofensiva de N dias úteis"`
  (singular "dia útil" quando `threshold === 1`).
- `computeProgress()`: caso `STREAK` → `{ current: (await getStreakSummary(userId)).bestStreak, target: threshold }`.

### Gatilho — `src/routes/mood.ts`

No handler `PUT /me/mood/today`, após `setTodayMood`, **best-effort** (try/catch que loga e
não derruba o registro), igual ao padrão do TENURE no perfil:

```
const awarded = await evaluateStreakBadgesForUser(userId)
if (awarded.length > 0) await notifyBadgesEarned(userId, awarded.map((b) => b.badgeId))
```

### Seed — `prisma/seed.ts`

Upsert idempotente por slug dos 4 selos da tabela acima (`kind: 'STREAK'`, `threshold`,
`iconKey`, `description`), seguindo o bloco existente do Tempo de Casa.

### Admin — `src/routes/admin.ts`

Adicionar `'STREAK'` ao `badgeKindSchema` (Zod) usado na criação de selos.

## Arquitetura — frontend (`apps/web`)

- **Admin `BadgesSection`**: adicionar a opção `{ value: "STREAK", label: "Ofensiva (dias úteis consecutivos)" }`
  ao seletor de tipo de selo.
- Catálogo (`BadgesPage`) e perfil já renderizam selos genericamente por `iconKey`/`kind` e
  exibem `requirement`/`progress` — **sem mudança extra**.

## Contrato compartilhado (`packages/shared`)

Apenas a adição de `'STREAK'` a `BADGE_KINDS` (e, por consequência, ao tipo `BadgeKind`).
`BadgeDTO`/`BadgeCatalogEntryDTO` não mudam de forma.

## Tratamento de erros

- Gatilho no registro de humor é **best-effort**: falha na avaliação de selos é logada e não
  afeta a resposta do `PUT /me/mood/today` (mesmo princípio do TENURE).
- Concessão concorrente tratada por `P2002` (igual aos demais avaliadores).

## Testes

- **API (Postgres real):**
  - `evaluateStreakBadgesForUser`: com `MoodEntry` semeados em dias úteis e `todayYmd` fixo,
    concede exatamente os níveis cujo `threshold <= bestStreak`; é aditivo/idempotente
    (rodar 2× não duplica); não revoga quando o `currentStreak` cai mas o recorde permanece.
  - Catálogo: selo `STREAK` traz `requirement` correto e `progress = { current: bestStreak, target }`.
  - Gatilho: `PUT /me/mood/today` que eleva o recorde concede o selo e cria a notificação
    `BADGE_EARNED`; falha do avaliador não derruba o registro (best-effort).
  - Seed: os 4 slugs existem com `kind STREAK` e thresholds 7/14/30/60.
- **Web (jsdom):** o seletor do admin `BadgesSection` oferece a opção "Ofensiva (dias úteis
  consecutivos)".

## Nomenclatura

Selos chamados pelos nomes da tabela (Em chamas / Imparável / Incandescente / Lendária).
Mensagens ao usuário em **português**.
