# Metas e OKRs — design

Data: 2026-09-17 · Status: backend e tela de leitura + check-in implementados

Módulo próprio de metas e OKRs — ciclos, objetivos, key results, check-ins e
permissões — mais um importador one-way que popula o módulo a partir da
ImpulseUp. O modelo de referência é a ImpulseUp, **sem copiar os defeitos
dela**: quatro divergências deliberadas estão na seção 4.

Este documento é também o README do módulo.

## 1. Onde mora

| Camada | Arquivo |
|---|---|
| Schema | `apps/api/prisma/schema.prisma` (models `Okr*`), migration `20260917140000_modulo_metas_okr` |
| Regras puras (cálculo, pesos, semáforo, permissões) e DTOs | `packages/shared/src/okr.ts` |
| Service | `apps/api/src/services/okr-service.ts` |
| Rotas | `apps/api/src/routes/okr.ts` (prefixo `/okr`) |
| Serialização | `apps/api/src/lib/serialize-okr.ts` |
| Leitura da ImpulseUp (rastreio, mapeamento, conferência) | `apps/api/src/lib/impulseup-okr.ts` |
| Gravação idempotente do importador | `apps/api/src/services/okr-import-service.ts` |
| CLI do importador | `apps/api/scripts/import-impulseup-okr.ts` |
| Tela (`/metas`, `/metas/pessoa/:id`) | `apps/web/src/pages/okr/`, cliente em `apps/web/src/lib/okr-api.ts` |

Pessoa é `User`. Não há tabela de pessoa paralela: o importador casa por e-mail
com quem já tem conta na empresa. Todos os models têm `companyId` e estão em
`TENANT_SCOPED_MODELS`.

## 2. Modelo

- **`OkrCycle`** — nome, status (`OPEN`/`CLOSED`/`DRAFT`), datas, comentário
  obrigatório no check-in, janela de atualização, faixas do semáforo e casas
  decimais por tipo de métrica.
- **`OkrObjective`** — árvore de alinhamento (`parentId` + `path` materializado,
  da raiz até ele), escopo, visibilidade, peso no pai, agregação
  (`KR_ONLY`/`WEIGHTED_KRS`/`CHILDREN`/`MANUAL`; `MANUAL` lê `manualProgress`,
  0–1), confiança. Excluir é soft delete da subárvore.
- **`OkrKeyResult`** — tipo de métrica, unidade, **base**, **meta**, **direção**
  (`HIGHER_IS_BETTER`/`LOWER_IS_BETTER`) e peso. **Não tem coluna de valor.**
- **`OkrAssignment`** — papel (`OWNER`/`CREATOR`/`ASSIGNED_TO`) de uma pessoa num
  objetivo ou num KR.
- **`OkrCheckIn`** — **o fato**: valor, numerador/denominador (metas que são
  razão), comentário, autor, **competência** (`effectiveAt`), origem
  (`MANUAL`/`AUTOMATION`/`IMPULSEUP_IMPORT`) e link de origem. Soft delete.
- **`OkrKrDependency`** — KR calculado a partir de outros KRs
  (`AVERAGE`/`SUM`/`WEIGHTED_AVERAGE` sobre `PROGRESS` ou `VALUE`).

Idempotência do importador: `@@unique([companyId, externalSource, externalId])`
em ciclo, objetivo, KR e check-in. NULL é distinto no Postgres, então linha sem
origem externa nunca colide — mesmo efeito do índice único parcial, e o Prisma
entende.

## 3. As duas fórmulas: progresso × atingimento

**Valor atual** = `value` do check-in mais recente por (`effectiveAt`,
`createdAt`), entre os que têm valor e não foram apagados. Derivado, nunca
armazenado. Check-in só de comentário não conta.

**Acumulado da razão** = Σnumerador ÷ Σdenominador × 100 sobre os check-ins do
KR dentro das datas do ciclo (SQL, `groupBy`). Quando existe, é ele que entra no
cálculo; o último valor continua exposto em `currentValue`. Sem
numerador/denominador, o acumulado é nulo e vale o último valor.

**Progresso linear** — só para barra e paridade com a ImpulseUp:

```
progressLinear = (valor − base) / (meta − base) × 100
```

**Atingimento** — responde "cumprimos a meta?":

```
HIGHER_IS_BETTER:  attainment = clamp((valor − base)/(meta − base), 0, 1)
                   overshoot  = max(0, (valor − base)/(meta − base) − 1)
                   goalMet    = valor ≥ meta
LOWER_IS_BETTER:   attainment = 1 se valor ≤ meta (ou valor = 0); senão meta ÷ valor
                   overshoot  = 0
                   goalMet    = valor ≤ meta          (a meta é um TETO)
```

O **semáforo** (`color`) usa atingimento: pontos = 100 + overshoot×100 se a meta
foi cumprida, senão attainment×100 (nunca chega a 100). Faixas com mínimo
inclusivo e máximo exclusivo. Um teto estourado nunca pinta a cor "acima de 100".

**Agregação do objetivo**: `KR_ONLY` copia o único KR (segundo KR é recusado);
`WEIGHTED_KRS` e `CHILDREN` fazem média ponderada do atingimento (e, à parte, do
progresso linear); peso nulo divide igualmente o que sobra até 1; soma de pesos
explícitos acima de 1 é 422. Item sem valor conta como atingimento 0. KR
calculado recebe o valor pela estratégia (`PROGRESS` usa atingimento × 100 dos
dependentes) e recusa check-in manual com 422.

## 4. Quatro divergências deliberadas da ImpulseUp

1. **O check-in é o fato.** Lá o valor mora no KR e o comentário não tem valor:
   não existe série histórica (não há endpoint de histórico). Por isso a
   automação de sprint mantém `history/*.json` local para recalcular acumulado.
2. **Competência separada da escrita.** `effectiveAt` corrige a sprint passada
   sem falsear `createdAt`.
3. **Direção e atingimento.** A ImpulseUp ignora `inverted` no cálculo
   (verificado em 27/27 KRs). No tenant, em 2026-09-17: Churn 15,03 contra teto 10
   aparece 150% azul (aqui: 66,5%, não cumprida); Cycle Time 1,5 contra teto 3
   aparece 50% amarelo (aqui: cumprida); % de Bugs setor 24,5 contra teto 10
   aparece 245% azul (aqui: 40,8%).
4. **Razão guarda numerador e denominador.** Check-ins (3, 45), (1, 38), (4, 52)
   acumulam 8/135 = 5,93%; a média das porcentagens daria 5,66%.

## 5. Permissões

Todo objetivo, KR e check-in devolvido pela API carrega `permissions`, e a
escrita confere **o mesmo predicado** (`packages/shared/src/okr.ts`). O front não
reimplementa regra.

| Comando | Quem |
|---|---|
| `updateObjective`, `deleteObjective`, `createKeyResult` | `OWNER` do objetivo ou admin |
| `updateKeyResult`, `updateKeyResultStatus` | `OWNER` (no KR ou no objetivo) ou admin |
| `createCheckIn` (inclui declarar a confiança do objetivo junto) | `ASSIGNED_TO` (no KR ou no objetivo) dentro da janela; admin a qualquer hora; ninguém em KR calculado |
| `updateCheckIn` (só comentário), `deleteCheckIn` | autor ou admin |
| criar objetivo | admin; ou `OWNER` do objetivo pai (desdobrar o que é seu) |

- **Admin de metas** = ADMIN pleno (inclui acesso delegado) ou SUBADMIN com o
  bloco `gente-gestao`.
- Ciclo `CLOSED` bloqueia toda escrita, inclusive do admin.
- `forceCommentOnCheckIn` → check-in sem comentário é 422.
- Visibilidade: `EVERYONE` todos; `ASSIGNEES` quem tem qualquer papel no
  objetivo; `PRIVATE` só `OWNER`/`CREATOR`. Admin vê tudo. Quem não vê recebe
  404, não 403.
- Terceirizado (`THIRD_PARTY`) não acessa o módulo.

## 6. API

Prefixo `/okr` (o app tem dezenas de grupos de rota; `/cycles` solto seria
ambíguo). Query params em snake_case, como na spec original.

```
GET    /okr/cycles                      ?status=
GET    /okr/cycles/:id
GET    /okr/cycles/:id/objectives       ?scope=&person_id=&parent_id=
GET    /okr/cycles/:id/summary
POST   /okr/objectives                  { cycleId, parentId?, name, scope, …, assignments? }
GET    /okr/objectives/:id              inclui keyResults[], assignments, permissions (página da meta)
PATCH  /okr/objectives/:id
DELETE /okr/objectives/:id              soft delete da subárvore
POST   /okr/objectives/:id/key-results  { name, metricType, target, direction?, …, dependencies? }
PATCH  /okr/key-results/:id
GET    /okr/key-results/:id/check-ins   série, effectiveAt DESC
POST   /okr/key-results/:id/check-ins   { value | numerator+denominator, comment, effectiveAt, sourceRef, confidenceLevel? }
PATCH  /okr/check-ins/:id               { comment }
DELETE /okr/check-ins/:id               soft delete
GET    /okr/people/:id/results          ?cycle_id=  (padrão: ciclo OPEN mais recente)
```

Objetivo e KR trazem `currentValue`, `accumulatedValue`, `progressLinear`,
`attainment`, `overshoot`, `goalMet`, `color` e `permissions` calculados. O
cálculo carrega o ciclo inteiro por leitura (KR calculado e `CHILDREN` leem
vizinhos); um ciclo tem centenas de itens, não milhares.

```
POST   /okr/cycles                      { name, startDate, finishDate, … }   admin de metas
PATCH  /okr/cycles/:id                                                        admin de metas
```

Ciclo é da **administração de metas** (a mesma regra do resto: `isOkrAdminSubject`,
no shared, é o que a tela usa para mostrar o botão e o servidor para aceitar a
escrita). Sem semáforo informado, o ciclo nasce com as quatro faixas padrão
(`OKR_DEFAULT_PROGRESS_RANGES`) e duas casas decimais. O semáforo é validado por
`okrProgressRangesError` — contínuo, sem buraco nem sobreposição, começo e fim
abertos —, a janela de atualização precisa caber dentro do ciclo, e
`externalSource`/`externalId` não são editáveis: são do importador, e mexer
neles quebraria a idempotência da próxima importação. Na edição o semáforo só é
conferido quando é ele que muda: ciclo antigo com faixa fora do padrão não pode
travar a troca de nome.

## 7. Importador da ImpulseUp

### Como rodar

Pré-requisito: a sessão da automação de sprint
(`~/automacoes/b2b-sprint-report/impulseup/`). Se expirou:
`node ~/automacoes/b2b-sprint-report/impulseup/login.js`.

```bash
# dry-run (padrão): lê a ImpulseUp, calcula e relata — não grava nada
pnpm --filter @legends/api exec tsx scripts/import-impulseup-okr.ts

# grava
pnpm --filter @legends/api exec tsx scripts/import-impulseup-okr.ts --apply

# mesmo dado no dry-run e no apply: salve o snapshot e reaproveite
pnpm --filter @legends/api exec tsx scripts/import-impulseup-okr.ts --save-snapshot /tmp/iu.json
pnpm --filter @legends/api exec tsx scripts/import-impulseup-okr.ts --snapshot /tmp/iu.json --apply
```

Flags: `--cycle <id>` (padrão: "Ciclo EMR - 2027"), `--email <e-mail>`
(semente extra, repetível), `--company` (padrão `company-emr`),
`--impulseup-dir`, `--max-people` (padrão 150).

Saída: `0` ok · `2` argumento/snapshot inválido · `3` sessão da ImpulseUp
expirada · `4` a conferência com a ImpulseUp não bateu.

### Regras

- **Somente GET.** O crawler recebe uma função `get(path)` — não recebe método.
  O token do Keycloak é lido do localStorage **dentro** da página pelo `lib.js`
  e nunca chega ao processo: não é logado nem gravado.
- **Rastreio.** `individual-result/{ciclo}/{email}` devolve o que aquela pessoa
  enxerga, não a árvore toda. O crawler parte dos e-mails do `config.json` da
  automação (+ `--email`), segue os e-mails dos papéis e busca pai faltante por
  id (`/objectives/{id}`, depois `/no-admin`). Na primeira rodada real
  (2026-09-17) isso deu **238 objetivos** e 238 KRs, não os 36 vistos por uma
  pessoa só. Dependências de KR calculado cujo alvo o rastreio não alcança são
  puladas e relatadas.
- **Mapeamento**: tabela da §7.3 da especificação original (`inverted` →
  `direction`, `@class` → `metricType`, `spreadsheetId` → `code`, papéis por
  e-mail; `REVIEWING`/`ENDORSEMENT`, `progress`, `permissions`, cópia de
  `cycleConfiguration` e campos de aprovação são ignorados). Visibilidade
  desconhecida entra como `ASSIGNEES` (fecha, não abre).
- **Check-ins (§7.4)**: um por comentário, sem valor; o comentário a menos de 5 s
  de `lastProgressUpdate` recebe `metricValue` (o mais próximo); sem nenhum,
  nasce um sintético `synthetic:{krId}:{lastProgressUpdate}`. KR calculado não
  recebe valor. Competência = data de `createdAt` em America/Sao_Paulo.
- **Idempotente.** Reimportar o mesmo snapshot conta tudo como inalterado. A
  origem manda nos itens importados: papéis e dependências são sincronizados
  como conjunto, e objetivo apagado no Legends volta se ainda existe lá. Item
  criado no Legends (sem `externalId`) nunca é tocado.
- **Relatório**: criado/atualizado/inalterado/removido por entidade; check-ins
  sem valor (dívida de dados herdada, não erro); e-mails sem conta no Legends;
  conferência do progresso linear de cada KR com valor contra o `progress` da
  ImpulseUp e do `dashboard/objectives` por nome; e a lista de KRs em que a cor
  muda com a direção. KRs calculados ficam fora da paridade de propósito (lá a
  média é de progresso linear, aqui de atingimento).

Primeira rodada real, num banco local descartável: KRs com valor **49/49**
batem com a ImpulseUp, `dashboard/objectives` **21/21**; 101 check-ins, 52 sem
valor, 10 sintéticos; segunda passada 100% inalterada.

## 8. Não verificado (trate como suposição)

- Peso com 2+ KRs por objetivo: todo objetivo do tenant tem um KR só. A regra da
  §3 é decisão nossa.
- `progressConfiguration.strategy` diferente de `KR_ONLY`: nunca observado; o
  mapeamento para `WEIGHTED_KRS`/`CHILDREN`/`MANUAL` é por nome e avisa.
- `accumulatedValue`/`accumulatedGoal`, `expression`, `rulesExpression`,
  `milestones`: nulos no tenant, não modelados.
- `dashboard.total`/`totalRealized`: só exibidos no relatório.

## 9. Tela

No formato da ImpulseUp, que é o que as pessoas já conhecem. `/metas` (menu
Desenvolvimento, some para terceirizado) tem filtros de **Ciclo** e **Visão**
(`?aba=minhas` usa `/okr/people/:me/results`; `?aba=ciclo` lista o ciclo, com
busca sem acento por meta, código, KR ou pessoa). `/metas/pessoa/:id` mostra as
metas de alguém, só o que quem vê pode enxergar. O ciclo vem de `?ciclo=`,
senão o aberto mais recente.

- **Resultados**: resultado no ciclo e por escopo, com média simples do
  atingimento de quem tem valor (`okrAverageAttainment`, a mesma regra do resumo
  do ciclo). A ImpulseUp pondera por peso; nenhuma meta do tenant tem peso.
- **Exibição de resultado** (`?resultado=`), como na ImpulseUp: **acumulado**
  (padrão) é o que o servidor calcula — meta que é razão soma o ciclo inteiro —,
  e **por ciclo** é o último check-in, recalculado na tela com as mesmas funções
  puras do shared (`okr-view.ts`). Objetivo de vários KRs não muda com o
  seletor: vale a agregação do servidor, e refazê-la aqui duplicaria a regra.
  Sem check-in com numerador e denominador as duas exibições coincidem — é o
  caso de todo o tenant hoje.
- **Metas por escopo**: os três escopos aparecem sempre (Empresa, Time,
  Individual), mesmo vazios e então já recolhidos; 20 linhas por vez. Colunas: nome, tipo, responsável (quem tem
  `ASSIGNED_TO`, senão o dono), prazo, valor atual, meta (`≤` quando é teto),
  progresso, peso e evolução. Objetivo de um KR só mostra o KR na linha; com
  vários, cada KR vira sub-linha.
- **Progresso** é de **atingimento**, nunca de progresso linear: teto
  estourado não aparece cheio. O rótulo soma o overshoot (131% numa meta
  superada, `okrResultRatio`), mas a barra para em 100%. A cor é o semáforo do
  ciclo (dado da empresa); o texto do rótulo escolhe preto ou branco por
  contraste. Abaixo, a confiança declarada (`confidenceLevel`).
- **Atualizar** (só com `permissions.createCheckIn`) abre "Atualizar progresso
  da meta", como na ImpulseUp: controle deslizante da base à meta (esticado até
  o valor atual, porque num teto estourado o atual fica fora da faixa), ou
  "Informar valor" (vírgula decimal, ou numerador e denominador), comentário,
  competência ("Referente a"), link de origem e **status de confiança**.
  Comentário obrigatório e denominador zero são barrados antes do envio; o resto
  a API responde.
- Os campos de filtro usam o `Select` do projeto (`components/Select.tsx`), não
  `<select>` nativo: o menu do sistema não segue a paleta do tenant.
- **Página da meta** (`/metas/objetivo/:id`, aberta pelo nome na tabela), como
  a da ImpulseUp: Voltar, **Meta pai** e **Submetas** recolhíveis com contador
  (`parent_id` na lista do ciclo), e a meta com as abas **Meta** (pessoas,
  prazo, escopo, ciclo, código, métrica e descrição; à direita, o quadro de
  progresso com "Atualizar progresso") e **Atualizações** (a série de
  check-ins). Ações, contramedidas, anexos, árvore e etiquetas não existem no
  módulo e ficam de fora.
- **Evolução** abre os números do KR, o **gráfico da série** e a lista de
  check-ins, com o botão "Atualizar progresso" para quem pode. O gráfico
  (`OkrEvolutionChart`) é uma série só: linha da marca, meta como linha
  tracejada neutra, cruz e tooltip no hover, e a mesma série em tabela (Meta /
  Atingido / Resultado) logo abaixo — é ela que torna o dado legível sem
  enxergar cor. Check-in só de comentário não vira ponto: um zero no gráfico
  diria que a meta desabou.
- A confiança viaja no próprio check-in (`confidenceLevel` em
  `CreateOkrCheckInRequest`) e grava no objetivo na mesma transação. Pede a
  permissão do check-in, e não a de dono: é o responsável quem declara a
  confiança, como na ImpulseUp. Ausente não mexe; a tela só manda quando muda.
- A tabela rola dentro do próprio card no celular. O contêiner é `relative`:
  sem isso o `sr-only` das células escapa do corte e alarga a página.

## 10. Administração

- **Metas** (`/metas` e a página da meta): "Nova meta" aparece para a
  administração de metas com o ciclo aberto; na página da meta, **Editar**,
  **Submeta**, **Key result** e **Excluir** seguem o `permissions` do DTO — é
  assim que o dono desdobra a meta dele sem ser admin. Excluir confirma antes,
  porque leva a subárvore junto. Dono e responsável são dois campos com o
  `TargetPicker` do projeto; `assignments` substitui o conjunto inteiro, então a
  edição manda os dois sempre.
- **Ciclos** (Administração › Metas e OKRs, bloco `gente-gestao`): lista, cria e
  edita ciclo — vigência, situação, janela de atualização, "exige comentário",
  casas decimais e semáforo. A edição manda só o que mudou: o PATCH trata campo
  ausente como "não mexa", e reenviar tudo sobrescreveria o que outra pessoa
  acabou de salvar.
- Fechar o ciclo (`status = CLOSED`) trava toda a escrita, inclusive do admin;
  reabrir é o mesmo caminho de volta.

## 11. Fora do escopo

Escrita de volta na ImpulseUp, fluxo de aprovação, excluir key result,
dependências de KR calculado pela tela e importação por planilha.
