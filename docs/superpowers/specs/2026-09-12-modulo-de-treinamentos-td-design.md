# Módulo de Treinamentos (T&D) — Design Spec

- **Data:** 2026-09-12
- **Autor:** lucca.secco
- **Status:** implementado (fase 1)

## Resumo

O time de T&D controlava desenvolvimento externo em planilha: quem fez qual
curso, quantas horas, quanto a empresa investiu, se veio do LNT ou do PDI,
quanto tempo entre pedir e concluir. O Legends já tinha **metade** disso, e é
justamente a metade que este spec não duplica.

O módulo entrega o **registro de treinamento** como fato único da empresa, com
os indicadores que a planilha calculava à mão: horas por setor, investimento por
pessoa, cobertura de aprendizagem, SLA de atendimento, distribuição por tipo,
instituição e origem da demanda.

A fonte do desenho é um módulo escrito para outra plataforma (Supabase + RLS +
TanStack Start + recharts). Nada dele entra como está: o que foi aproveitado é o
**domínio** e as **funções puras de cálculo**, reescritos no padrão do repo.

## Decisões

### 1. Registro de treinamento é UM fato, não dois

É a decisão central. O repo já tinha `CertificateRequest` com
`origin = EXTERNAL` — a tela "Envie seu Certificado" (`/aprendizado/enviar-certificado`),
que pergunta nome do curso, tipo, patrocinador, valor investido, motivos
(inclusive PDI e obrigatório) e recebe o certificado anexado no S3. Isso **é** o
registro de um treinamento feito fora do portal, só que sem carga horária, sem
instituição e sem data de conclusão — os três números de que o painel precisa.

Criar `TrainingRecord` ao lado daria ao colaborador **duas portas para o mesmo
ato** e à G&G duas filas, com números que nunca fechariam entre si. É o mesmo
erro que `2026-08-20-unificar-reconhecimento-em-feedback` desfez.

Então: **`TrainingRecord` é o fato, e a porta é uma só.** A tela de enviar
certificado vira **Registrar treinamento**, com os campos que faltavam. A
migration faz o **backfill** dos pedidos externos existentes — nenhum
registro se perde, e o painel nasce com histórico. `CertificateRequest` fica com
o que sempre foi de verdade dele: a emissão do certificado **interno** do
portal, a partir de uma matrícula concluída.

Consequência que fica: o pedido externo antigo era avaliado pela G&G
(`PENDING → APPROVED/REJECTED`). Essa validação **continua** — ela some do
vocabulário de "certificado" e vira `validationStatus` do registro. Perder a
fila seria trocar um problema de duplicidade por um de confiança no dado.

### 2. Duas situações, dois eixos

Elas respondem perguntas diferentes e ter uma só faria o painel mentir:

- **`validationStatus`** (`PENDING`/`APPROVED`/`REJECTED`) — a G&G confere o
  comprovante. Registro de autoatendimento nasce `PENDING`; registro criado pelo
  T&D ou por evento interno nasce `APPROVED`, porque quem cadastrou já é a
  fonte. Indicador conta o que está **aprovado** — número de painel executivo não
  pode se mexer porque alguém anexou um PDF em branco.
- **`participationStatus`** (`Participou`, `Inscrito`, `Não participou`,
  `Ausente`, `Cancelado`) — o eixo do evento interno: inscrever cem pessoas e
  depois marcar quem apareceu é o fluxo, e "inscrito" não é horas de
  aprendizagem. Horas e cobertura contam só `Participou`.

### 3. Snapshot do colaborador na linha, não join

`sectorName`, `squad`, `leaderName`, `position`, `positionCategory`,
`employmentType` são copiados para o registro no momento da escrita, como o
trigger `td_fill_snapshot` da origem fazia. Quem muda de setor em março não
carrega o treinamento de janeiro para o setor novo — o painel responde "qual
área se desenvolveu **naquele** momento".

O snapshot sai do **`User` do Legends**, não de uma tabela paralela de
colaboradores: setor (`Sector.name`), squad, líder pela cadeia `User.managerId`
(a mesma do organograma e de `team-scope-service`), cargo (`position`),
categoria de cargo (`positionCategory`) e vínculo (`employmentType`). A origem
tinha `profiles` + `collaborators` justamente porque não tinha isso.

### 4. Nada de coluna gerada; o derivado é função pura

Ano, trimestre, semestre e dias de SLA eram `GENERATED ALWAYS AS` no Postgres da
origem. Aqui são funções puras em `@legends/shared`
(`trainingYear`, `trainingQuarter`, `trainingSemester`, `trainingSlaDays`,
`trainingSlaStatus`), usadas pelo serialize e pelos agregados — Prisma não
expressa coluna gerada, e o mesmo cálculo precisa valer no filtro do servidor e
no rótulo da tela.

Pelo mesmo motivo, **os agregados do painel também são funções puras**
(`computeTrainingKpis`, `groupTrainingBy`, `trainingMonthlySeries`): elas rodam
no **servidor**, sobre as linhas que o filtro já recortou, e o navegador recebe
DTO pronto. A origem baixava 5.000 linhas e somava no cliente; num produto
multi-empresa isso é vazamento de escopo e KPI que muda com a paginação.

### 5. Dinheiro em centavos, horas em decimal

`investmentCents Int`, como `CertificateRequest.investedAmountCents` e o resto
do repo — real em ponto flutuante acumula erro de arredondamento. Horas é
`Decimal(6,2)`: meia hora é comum e `1.5` não tem representação em inteiro sem
inventar uma unidade nova.

### 6. SLA é configuração da empresa

`training_sla_days` em `AppSetting` (padrão 90), como as outras configurações por
empresa. Model próprio para guardar um inteiro seria uma tabela de uma linha.

O que o SLA mede: dias entre a **solicitação** (`requestDate`) e a **conclusão**
(`completionDate`), e ele só conta para o que **veio de uma demanda** — LNT,
PDI ou pedido do líder. Curso que a pessoa fez por conta não tem prazo a ser
cumprido por ninguém, e misturá-lo afunda o indicador do time.

### 7. Quem vê o quê

Nada de RLS: o recorte é do serviço, com as regras que o repo já tem.

| Quem | Vê | Como |
|---|---|---|
| Colaborador | os próprios registros | `userId = viewer` |
| Líder | os próprios + a **subárvore** | `managesUser` / `listManagedGroups` (`team-scope-service`) |
| ADMIN global | a empresa inteira | — |
| SUBADMIN de G&G | a empresa inteira | `app.requireSectorFeature('gente-gestao')` |

Administrar o módulo é bloco de **Gente e Gestão**: `requireFeature` não serve,
porque liberaria SUBADMIN de qualquer setor.

A linha do líder é a única que a fase 1 **não** expõe: ela chega com a tela
"Minha Equipe", na fase 2. Até lá ninguém enxerga o time por essa porta — o que
não implementa nada pela metade, só adia.

### 8. Evento interno cadastra participação em massa

`TrainingEvent` existe desde a fase 1 no schema (a tela é fase 2): o registro
nasce dele, herdando nome, carga horária, modalidade e instituição, e o
investimento total pode ser **rateado** entre os participantes. É o que evita o
T&D digitar a mesma palestra oitenta vezes.

O model entra agora e não depois porque `TrainingRecord.eventId` é FK: adicioná-la
em outra migration custaria uma segunda alteração de tabela sem nada em troca.

### 9. Gráfico é SVG à mão

Como o People Analytics (`2026-07-31-people-analytics-design.md`): os painéis
reusam `AnalyticsPrimitives` (`StatCard`, `ChartCard`, `DistributionBars`,
`DonutChart`, `RateBar`). O módulo de origem trazia recharts, shadcn/ui, lucide,
sonner e date-fns — cinco dependências e um tema paralelo ao design system, para
telas que o repo já sabe desenhar.

### 10. Extração do certificado por IA fica de fora

A origem lia o PDF com `pdfjs-dist` no navegador e mandava para um gateway de IA
com chave de ambiente. As duas coisas contrariam o repo: chave de IA aqui é **da
empresa** (`ai-settings-service`), e `lib/agent-client.ts` hoje só manda **texto**
— não há caminho multimodal. Sugerir campo a partir do certificado é item
separado, depois que o módulo estiver de pé.

## Fora de escopo (fase 2)

Tela de Eventos Internos, painel da Liderança ("Minha Equipe"), insights por IA e
a tela de Relatórios. O CSV da Central cobre a necessidade imediata de relatório.

## Navegação

- **Colaborador:** `/treinamentos` — "Meus treinamentos" e "Registrar", no grupo
  Desenvolvimento, ao lado de Aprendizado. Sem feature: registrar o próprio
  desenvolvimento vale para todo mundo, inclusive quem não consome o catálogo
  interno. `/aprendizado/enviar-certificado` passa a redirecionar para lá.
- **Administração:** `/admin/treinamentos` — abas Painel e Central, no bloco
  Gente e Gestão.
