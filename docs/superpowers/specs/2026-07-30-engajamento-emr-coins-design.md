# Engajamento — EMR Coins, galeria filtrável e hub — Design Spec

- **Data:** 2026-07-30
- **Autor:** matheus.mota
- **Status:** aprovado
- **Card:** PBI 22236 (tasks 22237, 22254)

## Resumo

Hoje o Legends premia **reconhecimento** (voto, selo, Destaque do Mês), mas não devolve nada a quem
simplesmente **participa**: responder o humor todo dia, escrever feedback, reagir ao feedback do
colega. E a informação de engajamento está espalhada — a galeria de selos vive sozinha em `/selos`,
sem filtro, num grid único.

Este PBI entrega três coisas:

1. **EMR Coins** — moeda interna creditada por ação. O **catálogo de eventos é do código**; a
   **regra** (quanto vale, teto, ativa) é dado, com CRUD do admin. Ledger append-only, saldo
   derivado. **Sem loja no MVP** — resgate fica para um segundo passo.
2. **Galeria de selos filtrável** por tipo de selo (`BadgeKind`).
3. **Hub `/engajamento`** — página única com abas *Selos* e *Coins*, mais um chip de saldo no header.

## Decisões

- **Regra é dado; evento é código.** O admin cria/edita/remove regras escolhendo um evento do
  catálogo, definindo valor e teto. Ele **não** cria evento: um evento novo exige instrumentar um
  ponto no código (deploy). Ficou explicitamente fora do escopo qualquer condição sobre o payload do
  evento ("feedback com mais de N caracteres", "humor em dia útil") — isso exigiria evento tipado e
  avaliador de condição, e a leitura foi de que valor + teto cobre o caso real.
- **Uma regra por `(empresa, evento)`** (`@@unique`). Sem condição, duas regras no mesmo evento
  pagariam as duas — não existe critério de desempate legítimo.
- **Eventos do MVP:** `VOTE_CAST`, `FEEDBACK_PUBLISHED`, `FEEDBACK_REACTION` (credita quem **dá** a
  reação, só na adição), `MOOD_ANSWERED`. **Humor de squad não entra**: `squad-mood-service.ts` é só
  leitura/agregação, não existe ação de escrita a premiar.
- **Idempotência por ação, não por período.** Cada lançamento carrega uma `dedupeKey`
  (`${evento}:${referência}`) com unique por usuário. Duas postagens distintas pagam duas vezes;
  a mesma ação nunca paga duas vezes. Referências: voto → `vote.id`; feedback → `feedback.id`;
  reação → `${feedbackId}:${emoji}`; humor → dia civil (`YYYY-MM-DD` em America/Sao_Paulo).
- **Apagar não estorna.** Instrumentar os deletes exigiria débito compensatório, saldo negativo e
  explicação na UI; o teto por janela já contém o abuso de publicar/apagar/publicar.
- **Sem crédito retroativo.** O ledger começa zerado no deploy. Recompor histórico exigiria
  processar eventos passados sem `dedupeKey` confiável.
- **Teto sem crédito parcial.** Se o valor cheio da regra estoura o teto da janela, não credita
  nada. Crédito parcial deixaria o extrato ilegível ("+3" numa regra que vale 5).
- **Janela contada por dia civil de São Paulo**, sobre a coluna `day` (`@db.Date`, mesmo formato de
  `MoodEntry.day`) — nunca sobre `createdAt`. Semana é segunda→domingo.
- **`dedupeKey` NOT NULL**, com `MANUAL:<uuid>` nos ajustes do admin. O repo tem o precedente
  `NULLS NOT DISTINCT` em `UserBadge` (migration `20260612180000`), e **copiá-lo aqui seria bug**:
  com `dedupeKey` nulo nos manuais, o segundo ajuste do mesmo usuário quebraria com P2002.
- **Saldo é `SUM(amount)`**, sem coluna materializada. Volume esperado é de dezenas de lançamentos
  por pessoa/mês; materializar antes de doer é otimização cega.
- **Crédito é best-effort na rota**, não no service — é onde o repo já põe efeito colateral
  (`routes/votes.ts`, `routes/feedback.ts`, `routes/mood.ts`), com um `try/catch` por efeito e
  `request.log.error`. Falha de crédito nunca derruba a ação do usuário.
- **Sem ranking e sem notificação** por coin ganho. Ranking mistura "quem participa" com "quem é
  reconhecido" — e reconhecimento já tem Lendas e Destaque do Mês. Notificação por coin viraria
  ruído diário no sino.
- **Débito manual não deixa saldo negativo** (409 com o saldo disponível na mensagem). Sem loja,
  saldo negativo não significa nada.
- **Rotas de admin exigem `ADMIN`** (não `SUBADMIN`): a regra é da empresa inteira, não do setor.
- **Feature key própria `coins`**, ligável por setor. A rota `/engajamento` libera com **qualquer
  uma** das features (`selos` **ou** `coins`) e cada aba é filtrada individualmente — ninguém perde
  o acesso que já tinha à galeria, e `coins` pode ser ligado sem obrigar `selos`.
- **Sem migration de dados ligando `coins`.** Diferente do mural corporativo (que substituiu a
  coluna principal da Home e regrediria sem backfill), aqui a aba é nova: sem a feature ligada, nada
  regride. Ligar é um clique por setor no admin.

## Modelo de dados

```prisma
enum CoinEvent           { VOTE_CAST FEEDBACK_PUBLISHED FEEDBACK_REACTION MOOD_ANSWERED }
enum CoinCapWindow       { NONE DAY WEEK MONTH }
enum CoinTransactionKind { EARN MANUAL_CREDIT MANUAL_DEBIT }

model CoinRule        { event, amount, capWindow, capAmount?, active, companyId  @@unique([companyId, event]) }
model CoinTransaction { userId, kind, event?, ruleId?, amount, reason?, actorId?,
                        dedupeKey, day @db.Date, companyId  @@unique([userId, dedupeKey]) }
```

`event` é **denormalizado** no lançamento e `ruleId` é `SetNull`: apagar uma regra não apaga o
histórico nem estraga o relatório. `amount` negativo é débito manual.

## Motor

`awardCoins({ userId, companyId, event, reference, now? })` → `CoinAwardOutcome`
(`CREDITED | NO_RULE | RULE_INACTIVE | DUPLICATE | CAP_REACHED`).

1. Busca a regra do evento (o `scopedPrisma` injeta a empresa); sem regra ou inativa, sai.
2. Com teto, soma o que **aquela regra** já pagou ao usuário na janela (filtro por `ruleId`, então
   ajuste manual não consome teto). Se `usado + valor > teto`, sai.
3. `create` do lançamento; `P2002` significa "já pago" → `DUPLICATE`.

**Nunca lança por motivo de negócio** — todo "não creditou" volta como status; só falha de infra
sobe, e a rota engole. Sem transação: duas chamadas concorrentes podem estourar o teto em no máximo
um `amount` — corrida aceita e comentada, mesmo pragmatismo de `evaluateBadgesForUser`.

## API

Usuário (`requireFeature('coins')`): `GET /me/coins`, `GET /me/coins/transactions`, `GET /coins/rules`.
Admin (`requireAdmin`): CRUD em `/admin/coins/rules`, `GET /admin/users/:id/coins[/transactions]`,
`POST /admin/users/:id/coins/adjustments`, `GET /admin/coins/report`.

Rotas em arquivo próprio (`routes/coins.ts`), fora do `admin.ts` — que tem 882 linhas e é ímã de
conflito.

## UI

- **`/engajamento`** — abas por `?tab=` (deep-link do chip do header). Aba *Selos*: a galeria atual
  com chips de filtro por tipo (só os tipos presentes no catálogo). Aba *Coins*: saldo, "Como
  ganhar EMR Coins" (regras ativas) e extrato paginado.
- **Header** — chip de saldo ao lado da ofensiva, com painel de saldo + últimos lançamentos.
- **`/selos`** redireciona para `/engajamento`; o item de menu passa a ser "Engajamento".
- **Admin → Reconhecimento → EMR Coins** — regras, saldo/extrato por colaborador, ajuste manual com
  justificativa (auditado) e relatório de quanto cada regra pagou.

## Fora de escopo

Loja/resgate, ranking de coins, transferência entre pessoas, condições na regra, crédito retroativo,
estorno automático, notificação de coin ganho e evento de humor de squad.
