# Programação anual de férias — design

**Origem:** pedido da G&G para trazer ao Portal o **Férias Facilitadas**, o app que
a Karen fez na Lovable, "na aba de Liderança". Base de análise: o zip do projeto
(TanStack Start + Supabase, ~4 mil linhas próprias, 112 linhas de direito, no ar e
mexido até 19/08) e as **respostas da G&G de 25/08**, que fecharam todas as
pendências de regra de negócio da primeira versão deste spec.

## O que a ferramenta da Karen resolve

Não é um cadastro de férias — é uma **campanha anual**. Cada gestor entra, vê o
time e programa o ano seguinte dentro das regras da empresa:

- **direito por pessoa**: período aquisitivo, limite de gozo, saldo em dias;
- **cinco combinações fechadas** para dividir os 30 dias (20 vendendo 10; 10+10
  vendendo 5 em cada; 15+15; 20+10; 30 corridos) — nada fora disso é aceito;
- **regras de data**: início de segunda a quinta, nunca em feriado, com a exceção
  legal de começar 2 dias antes de um feriado próximo; nada antes de 01/10/2026;
  o período tem de terminar até o limite de gozo; aviso de 30 dias de
  antecedência;
- **prazo** e bloqueio manual controlados pelo DP, com desbloqueio pontual para
  exceções; confirmação pelo gestor; **histórico** de alterações com autor e
  **exportação** em três abas de Excel;
- **visão do gestor** restrita ao próprio time, com a cadeia hierárquica abaixo.

Duas coisas ali valem mais que o código: as **regras** (`src/lib/ferias.ts`, funções
puras) e a **redação das telas** — o passo a passo, o "por que isso importa", a
explicação de cada aviso. Isso é trabalho de G&G, e é o que este spec preserva
literalmente.

## Por que não portar o app

A pilha é outra (TanStack Start, Supabase, RLS, shadcn), mas o motivo real é
outro: o app **reconstrói três coisas que o Legends já é dono**.

| No Férias Facilitadas | No Legends |
|---|---|
| tabela `colaboradores` (112 linhas, id = `NOME\|fim_aquisitivo`) | `User` + o direito, abaixo |
| tabela `gestores` + CTE recursiva `gestores_na_minha_estrutura` | `User.managerId` e `team-scope-service` — a mesma cadeia que desenha o organograma |
| `user_roles` (`dp`, `gestor`) + RLS | papéis + bloco de setor `gente-gestao` |
| `historico_alteracoes` | `AdminAuditLog`, que já grava antes/depois |
| lista de feriados cravada (Recife/PE, 2026–2028) | calendário da empresa, categoria `feriado`, importado por planilha |

Trazer as tabelas junto criaria uma segunda árvore de gestão para divergir do
organograma no primeiro remanejamento — exatamente o que a unificação de squad e
área desfez em `team-scope-service`.

Duas coisas a migração precisa **acrescentar**, e nenhuma delas é defeito de quem
construiu para uma campanha:

1. **Não existe o conceito de campanha.** `dp_config` é uma linha fixa (`id = 1`),
   então prazo, bloqueio e correções são globais; e a programação não diz a que
   ano pertence — infere-se do período aquisitivo. Com dois anos abertos ao mesmo
   tempo (2027 fechando, 2028 abrindo) não há como ter dois prazos.
2. **A chave é o nome** (`NOME|fim_aquisitivo`). Corrigir o nome de alguém órfã a
   programação e o histórico dela.

## O reenquadramento: são quatro substantivos, não um

O Legends já tem `Vacation` — um período lançado pelo gestor, que já aparece na
Home (`MonthVacationsCard`), na Liderança (`TeamVacationsPanel`) e no perfil.
Falta o resto da história:

| Substantivo | O que é | Vem de |
|---|---|---|
| **Direito** (`VacationEntitlement`) | período aquisitivo, limite de gozo, saldo | derivado da admissão + exceções da folha |
| **Campanha** (`VacationCampaign`) | o ano em programação: prazo, bloqueio, **e a regra vigente** | G&G abre |
| **Plano** (`VacationPlan` + períodos) | o que o gestor programou | o gestor preenche, a G&G valida |
| **Férias** (`Vacation`, já existe) | o que virou realidade | **a validação do plano** |

**A validação materializa `Vacation`** — e é esse o ganho de trazer para o Portal.
Hoje a programação morre num Excel: o gestor preenche, o DP baixa a planilha e
**nada chega ao calendário de ninguém**. Aqui ela chega, pelo caminho que já
existe, sem tela nova.

## Modelo

```prisma
model VacationCampaign {
  id, year, companyId
  opensAt, deadline        // prazo para os gestores
  manuallyLocked Boolean
  /// A regra vigente, congelada nesta campanha.
  policy Json
  /// Texto do aviso enviado ao colaborador quando o plano é validado.
  noticeTemplate String
  @@unique([companyId, year])
}

model VacationEntitlement {
  id, userId, companyId
  acquisitionStart, acquisitionEnd, dueDate   // @db.Date
  balanceDays Int
  note String?              // "Programação conforme CIEE"…
  @@unique([companyId, userId, acquisitionEnd])
}

/// Em `User`: a data-base de férias. Null é o caso normal — vale `joinedAt`.
/// Só o afastamento pelo INSS acima de 180 dias a preenche, com a data de volta.
model User {
  vacationAnchorDate DateTime? @db.Date
}

model VacationPlan {
  id, campaignId, entitlementId, companyId
  sellDays Boolean
  note String?
  status VacationPlanStatus    // DRAFT | CONFIRMED | VALIDATED
  confirmedById, confirmedAt   // o gestor
  validatedById, validatedAt   // a G&G
  /// O gestor recusou as datas que já vieram semeadas e vai propor outras.
  /// É o que alimenta a lista de pedidos de alteração da G&G.
  changeRequested Boolean @default(false)
  /// Reabertura pontual depois do prazo, concedida pela G&G.
  unlockedUntil DateTime?
  @@unique([campaignId, entitlementId])
}

model VacationPlanPeriod {
  id, planId, companyId
  startDate, endDate, days, soldDays
  vacationId String?  @unique   // preenchido na materialização
}
```

Cinco decisões que não são gosto:

**O plano é por direito, não por pessoa** — e nisso a ferramenta da Karen já está
certa: a tabela `colaboradores` dela tem **112 linhas para 86 pessoas**, porque 26
têm dois períodos aquisitivos em aberto. Não é caso de borda, é quase um terço do
quadro. O que muda aqui é só a chave: `userId` + fim do aquisitivo, em vez do
nome.

**Período é linha, não `jsonb`.** A sobreposição do time precisa ser consultável
*antes* da validação — é o que sustenta a linha do tempo e o informativo de
coincidência no mês. Guardado em JSON, "quem do meu time está fora em julho?"
vira varredura em memória.

**A campanha guarda a política.** Se a regra morasse só na empresa, reabrir a
campanha de 2027 daqui a dois anos revalidaria os planos com a regra de 2029 e
acusaria erro em quem seguiu a regra certa. Congelada na campanha, cada plano é
julgado pelo que valia quando foi feito.

**Três estados, não dois.** A G&G pediu que o aviso ao colaborador saia **depois
da validação do DP**, não da confirmação do gestor. Sem o terceiro estado, ou o
colaborador é avisado de algo ainda não conferido, ou não é avisado. E a
materialização em `Vacation` acompanha a validação: até lá é plano, e o calendário
da empresa não deve mostrar plano como se fosse fato.

**`Vacation.planPeriodId` é o vínculo, e a campanha ganha do lançamento à mão.**
A G&G decidiu que a programação pode **sobrescrever** o que já está no Portal —
então validar um plano substitui o período avulso que colidir, em vez de recusar.
Duas cercas:

- **só dentro da janela da campanha.** Férias passadas e em curso não são da
  campanha de 2027 e não podem sumir por causa dela. Em homologação, os 6
  períodos lançados até hoje são todos de agosto/setembro de 2026 — nenhum
  encosta na janela —, mas a cerca não pode depender disso continuar verdade;
- **sobrescrever não é sumir em silêncio.** O que foi substituído vai para o
  `AdminAuditLog` (é para isso que ele tem `before`/`after`) e aparece para o
  gestor **na hora de programar**, não depois. Um período lançado à mão costuma
  ter um motivo — atestado, férias já em curso — e quem programou precisa ver que
  está passando por cima dele.

Os quatro models entram em `TENANT_SCOPED_MODELS` e na lista de `deleteMany` do
`test/setup.ts` — obrigatório, sob pena de vazar catálogo entre empresas e de
deixar teste sujando teste.

## As regras viram dado da empresa

As cinco combinações e os feriados de Recife são **política da EMR**, não lei
geral. Num produto white label, cravá-los no código entrega a regra da EMR para o
próximo cliente. Vão para o `policy` da campanha, com o preset da EMR como
semente — a EMR não perde nada e não configura nada.

**As cinco combinações continuam sendo as únicas.** A G&G foi explícita: a lei
permite mais (três períodos, um de no mínimo 14 dias corridos e os outros de 5,
com abono de até 10 dias), mas **as opções atuais são deliberação interna e não
devem ser afrouxadas agora**. Fica registrado aqui para que ninguém "conserte"
isso depois achando que é limitação de implementação: é regra da empresa, e
mudá-la é decisão da G&G, não do código.

**Venda de dias é propriedade da combinação, não uma conta.** O app calcula
`saldo / 3`, o que dá os 10 de sempre só porque o saldo é 30. As combinações já
declaram quanto se vende (10 na primeira, 5+5 na segunda, zero nas outras) — e é
assim que o `policy` guarda. Some junto a dúvida sobre saldo quebrado: **quem já
gozou parte programa o restante num período único, sem venda**, que é exatamente o
que a ferramenta já faz. São 7 pessoas hoje (saldos de 10, 15 e 20).

> O código assume que o abono conta para o tamanho do período — é sob essa leitura
> que "10 + 10 vendendo 5 em cada" satisfaz o mínimo legal de 14 dias corridos,
> porque cada período consome 15 dias do direito. Se a leitura do DP for outra, é
> mudança de regra, não defeito.

**O limite de gozo é margem da empresa, não prazo legal** (confirmado em 25/08).
A CLT dá um período concessivo de **12 meses** depois do fim do aquisitivo para
as férias serem concedidas; a EMR exige que elas **terminem** dentro de **11**.
O mês de diferença é folga deliberada, e é por isso que entra no `policy`
(`grantMarginMonths: 1`) e não no núcleo de regras legais — outra empresa pode
ter margem diferente, ou nenhuma.

Isso muda o que a tela diz ao gestor. Chamar a data de "prazo legal" faria quem
precisa de uma semana a mais desistir de pedir, achando que é lei; ela é uma
decisão da G&G, e portanto negociável com a G&G. A mensagem diz **"a empresa pede
que as férias terminem até…"**, e o bloqueio continua igual — o que muda é saber
a quem recorrer.

**Feriado vem do calendário da empresa**: os `CalendarEvent` cuja categoria é
`feriado`, que a G&G já importa por planilha (`calendar-event-import`). Some a
lista cravada de 2026–2028, e a regra passa a valer para qualquer cidade sem
código novo.

A exceção legal ("havendo feriado próximo, o início ocorre 2 dias antes dele")
continua sendo regra de código: é CLT, não política de empresa.

## De onde vêm os direitos

A G&G respondeu, e a resposta bate com os dados: **o direito é derivável da
admissão**, que o Portal já tem em `User.joinedAt`.

- **Primeiro ciclo**: data-base + 12 meses − 1 dia.
- **A partir do segundo**: mesmo dia e mês, avançando o ano.
- **Limite de gozo**: fim do aquisitivo + 11 meses — margem da empresa sobre o
  período concessivo legal de 12, e não o próprio prazo legal.

Conferi contra as 112 linhas da planilha: o fim do aquisitivo de **112 de 112** é
a véspera do aniversário de admissão — do 1º ao 7º ciclo —, e o limite de gozo
bate em **111 de 111** que têm o dado. A derivação não é hipótese: é o que a
planilha já contém, linha por linha.

**A única exceção é afastamento pelo INSS acima de 180 dias**, que interrompe o
ciclo e recomeça a contagem **a partir da data de volta**. Hoje não há nenhum
caso na base — as 112 linhas seguem a admissão —, mas o formato de como guardar a
exceção importa mais do que parece.

Guardá-la como correção **no direito** obrigaria o DP a corrigir aquela pessoa
**todo ano, para sempre**: a interrupção não desloca um ciclo, desloca todos os
seguintes. Por isso ela vira **data-base de férias** na pessoa
(`User.vacationAnchorDate`), que nasce nula e vale `joinedAt`. Na volta do
afastamento o DP grava a data de retorno **uma vez**, e a derivação continua
certa sozinha daí em diante. A troca vai para o `AdminAuditLog`, que é onde mora
o antes/depois de mudança administrativa.

**Quem grava a data-base é a tela, não a planilha** (decidido em 25/08). Na
ficha do direito, em Administração › Férias, a G&G informa a data de volta do
afastamento. E a regra que faz essa escolha valer alguma coisa: **a importação
por planilha nunca escreve `vacationAnchorDate`** — nem para preencher, nem para
limpar. Fosse coluna, apagar a célula sem querer reverteria a pessoa para a
admissão em silêncio, e o erro só apareceria na programação do ano seguinte,
quando ninguém mais lembra de onde veio.

É o mesmo princípio que já vale em Administração › Categorias e no catálogo de
tags: dado que existe uma vez na vida da pessoa não anda junto com a carga em
lote, que é feita para o que muda todo mês.

Falta uma regra de borda que a planilha não responde porque ninguém na empresa
cai nela hoje: **quem tem data-base em 29/02**. "Mesmo dia e mês" não existe em
ano comum. A convenção é usar **28/02**, e ela precisa estar no código antes de
alguém ser admitido num 29 — senão é um defeito que só aparece de quatro em
quatro anos.

Consequência prática: **a planilha do DP encolhe para saldo e exceções.** Nome,
setor, líder e admissão saem do `User`; aquisitivo e limite saem da conta. A
importação reusa o caminho de `user-import-service`, que casa pessoa por
**e-mail** — a chave que evita órfão quando alguém casa, corrige um typo ou tem
xará.

## A experiência

O que segue é o que muda em relação ao app atual. Cada item é barato porque a
encanação já existe no Portal — não porque seria bonito.

### 1. O colaborador deixa de ser o último a saber

Hoje ele não entra no sistema: descobre as próprias férias por e-mail, depois de
decididas. A G&G descreveu o processo real — *"o colaborador pode fazer a
solicitação normalmente, mas a análise, aprovação e programação ficam sob
responsabilidade do gestor"* —, e é exatamente isso que o Portal passa a
representar. No perfil:

- **o próprio direito** — saldo e até quando pode gozar;
- **a solicitação**, que ele registra *antes* de o gestor programar;
- **o aviso automático** quando a programação for validada pela G&G, com as datas
  e o texto padrão que ela escrever.

A solicitação é **pedido, não promessa**, e a tela diz isso com essas palavras.
Quem decide é o gestor.

O aviso é o item que a G&G pediu no lugar do recibo assinado: *"mesmo que o aviso
e o recibo continuem sendo tratados pela Contabilidade, já teríamos uma
comunicação automática e padronizada"*. O texto mora na campanha
(`noticeTemplate`), então muda por ano sem deploy.

### 2. O gestor vê o time, não uma pessoa por vez

O app valida cada cartão isolado. Entra uma **linha do tempo do time**, com os
períodos lado a lado e os feriados marcados — o que resolve de lambuja o pior
momento do formulário atual: hoje a data é recusada com uma mensagem, e o gestor
tenta adivinhar a próxima válida.

Sobre coincidência de férias, a G&G foi clara e o desenho segue a resposta ao pé
da letra: **não existe limite, e não vai existir trava.** *"O gestor é quem avalia
e define se é possível conceder férias para mais de uma pessoa da equipe no mesmo
mês."* O que entra é **um informativo quando houver mais de uma pessoa do mesmo
time no mesmo mês** — só para o gestor ficar ciente.

Isso mata a configuração de "cobertura mínima" que a primeira versão deste spec
propunha: não há percentual, não há número, não há tela para definir nada. E o
informativo **não** entra na lista de erros nem impede salvar — se entrasse,
viraria trava por acidente.

### 3. Quem está prestes a perder férias aparece primeiro

O custo real de uma programação malfeita é **pagamento em dobro**. O dado para
evitá-lo (limite de gozo) já existe na ferramenta e não ordena nada. Aqui a lista
abre por vencimento, com selo de quantos dias faltam.

### 4. O sistema cobra, o DP não

A tela atual termina pedindo "confirme e nos sinalize por e-mail". O Portal já tem
agendador, sino e Teams: o gestor com pendências recebe lembrete a X dias do prazo
(`VACATION_PLAN_DEADLINE`, no molde de `calendar-event-reminders`), e a G&G vê
**progresso por área** em vez de caçar gestor.

### 5. A programação chega ao calendário

Validada, vira `Vacation` — e portanto Home, Liderança, perfil e busca. Sem tela
nova.

**Consequência que precisa ser tratada, não descoberta em produção:**
`createVacation` recusa período sobreposto para a mesma pessoa. Como a campanha
ganha do lançamento à mão, a materialização **substitui** em vez de esbarrar nessa
regra — mas a colisão continua sendo mostrada **na hora de programar**, e não na
validação. Não por causa do erro, que deixou de existir: porque o gestor precisa
saber que está passando por cima de algo que alguém lançou de propósito.

### 6. Rascunho, confirmado e validado são estados visíveis

O salvamento automático do app é bom e fica. O que falta é dizer **o que mudou
desde a última confirmação**, para o gestor que reabre a programação em novembro
não precisar comparar de cabeça.

O **desbloqueio pontual** que a Karen implementou fica, e melhora: em vez de
liberar o sistema inteiro, a G&G reabre **um plano** (`unlockedUntil`). Assim a
exceção de uma pessoa não abre a porta para todo mundo.

## O assistente de programação (fase 3)

A Karen sugeriu um chat que proponha um "mapa-base" de férias para o time. A ideia
é boa e o Portal tem a infraestrutura — os agentes já leem provedor e chave **por
empresa** (`ai-settings-service`) e degradam com 503 tratado quando não há
credencial. Mas o pedido, do jeito que está escrito, mistura três coisas
diferentes, e vale separá-las antes de construir:

**O que é conta, não conversa.** Priorizar quem está mais perto do limite legal,
evitar duas pessoas do mesmo time no mesmo mês, respeitar as combinações e as
regras de data, olhar o formato usado no ano anterior — isso é um problema de
restrição, resolvido de forma **determinística e mais confiável do que um modelo
de linguagem**. É o mapa-base de verdade, e não precisa de IA nenhuma.

**O que o Portal não sabe.** "Processos e meses mais críticos da área", "pessoas
cuja presença é indispensável", "relações de cobertura entre funções" não existem
cadastrados em lugar nenhum do sistema. Ou o gestor informa, ou a sugestão ignora
— e uma sugestão que ignora justamente o que trava férias na prática vira ruído.
Aqui a IA ajuda de verdade: absorver esse contexto em **texto livre** do gestor
("julho é fechamento, e o Pedro cobre a Ana") é o que ela faz melhor que
formulário.

**O que ela nunca faz.** Decidir. A própria Karen já escreveu isso no prompt:
*"não trate as datas como definitivas; apresente uma sugestão inicial para o
gestor validar"*. A proposta entra como rascunho editável, e nada é gravado sem o
gestor confirmar.

Ordem sugerida: o mapa-base determinístico primeiro (útil sozinho, e é o que
sustenta o assistente), a camada de conversa depois.

**Manual de boas práticas não precisa de feature.** Cultura › Manuais já existe e
já é do bloco de G&G — é publicar o conteúdo.

## Onde mora

| Tela | Quem entra |
|---|---|
| **Liderança › Férias** | quem tem liderado direto (`managerId`), ADMIN, bloco de G&G |
| **Administração › Férias** | ADMIN pleno e SUBADMIN com `gente-gestao` |
| **Perfil › Minhas férias** | qualquer pessoa logada, sobre si mesma |

A aba **Férias** da Liderança **absorve o `TeamVacationsPanel`**, que hoje é um
bloco dentro de "Meu time". Lançar um período avulso e programar a campanha são a
mesma pergunta — "quando meu time sai?" — e mantê-los em dois lugares repetiria a
duplicidade que a desduplicação do termômetro desfez. Sem campanha aberta, a aba é
exatamente o painel de hoje.

O papel "DP" do app da Karen é o **bloco de G&G**, com
`app.requireSectorFeature('gente-gestao')` e `AdminSectorFeatureOnly` — não
`requireAdmin`, que liberaria todo SUBADMIN de qualquer setor.

Listar é raso e autorizar é fundo, como no resto da Liderança: a tela mostra os
**diretos** (`listManagedGroups`) e `managesUser` autoriza qualquer pessoa da
subárvore. É o que atende o "gestores acima visualizarem toda a cadeia hierárquica
abaixo deles" da lista da Karen — sem código novo, porque a regra já é essa em
humor do time e nos indicadores.

## Quando

**A campanha de 2027 não entra.** O prazo cravado na ferramenta é **31/08/2026** —
seis dias depois desta data. Migrar no meio da campanha moveria dados que os
gestores já preencheram para ganhar zero: a campanha fecha antes de a migração
ficar pronta.

O caminho é deixar 2027 fechar onde está, **importar o resultado** (uma tabela de
112 linhas) para o Portal já mostrar as férias planejadas no calendário de cada
um, e construir aqui para o ciclo seguinte.

A G&G confirmou que a importação **pode sobrescrever o que já está no Portal** —
não é preciso conciliar com o que os gestores lançaram à mão. Isso tira do caminho
a parte mais chata da importação, que seria decidir quem ganha em cada colisão.
Continua valendo a cerca da janela.

## Inventário: tudo o que a ferramenta faz

Varredura arquivo por arquivo do zip. A migração só é segura se nada sumir sem
alguém ter decidido que sumisse — então cada comportamento aparece aqui com
destino.

### Regras de validação (`ferias.ts`) — vão inteiras

| Regra | Destino |
|---|---|
| As cinco combinações; saldo quebrado vira período único sem venda | `policy` da campanha |
| Início de segunda a quinta; nunca em feriado; exceção de 2 dias antes do feriado próximo | regra de código (CLT) + calendário da empresa |
| Data mínima de início da campanha (01/10/2026 em 2027) | `policy` |
| Início só depois do fim do aquisitivo | derivado do direito |
| O período tem de **terminar** até o limite de gozo | direito + margem no `policy` |
| Soma dos dias acima do saldo é erro; abaixo, aviso de "falta programar" | validação do plano |
| Períodos sobrepostos da mesma pessoa | já é regra do `createVacation` |
| Venda distribuída por período, e saldo restante após a programação | `VacationPlanPeriod.soldDays` |
| **Aviso de 30 dias de antecedência** do início | validação do plano — é aviso, não erro |

### Fluxo do cartão — o que faltava no desenho

**"Já existe programação para este período aquisitivo"** com os botões *Confirmar
estas datas* / *Preciso alterar*. São **22 das 112 linhas** hoje. O gestor não
recebe um formulário em branco: recebe o que o DP já tinha e decide. E pedir
alteração **alerta a G&G** — o painel do DP tem uma lista própria de "colaboradores
cujo gestor pediu alteração".

Isso não estava no spec e entra: o plano nasce **semeado** com o que já se sabe, e
ganha `changeRequested`. Sem o pedido explícito, a G&G teria de comparar planos
para descobrir quem mexeu no que já estava combinado.

**Saldo zero não pede nada.** São **15 das 112**: o cartão diz "este período
aquisitivo não tem saldo a programar" e não mostra formulário. Sem isso, 15 pessoas
ficariam eternamente como pendência na barra de progresso do gestor.

**Dois períodos em aberto avisam na tela** — a pessoa aparece em dois cartões, e
cada um diz até quando aquele precisa ser usufruído. São 26 pessoas; sem o aviso, o
gestor acha que é duplicidade.

**A observação do DP aparece para o gestor** ("Programação conforme CIEE"), e o
gestor tem a própria observação por pessoa.

### Painel de acompanhamento — vai como está

Cinco números (períodos da equipe, prontos, pendentes, dias programados, dias
vendidos), busca por pessoa/líder/área, lista somente leitura ordenada por centro
de custo e nome, e o carimbo "Conferido/Autorizado por X em Y". O gestor baixa a
planilha **da própria área**, não só a G&G a consolidada.

### Ações de fechamento

| Ação | Destino |
|---|---|
| **Confirmar programação** — em lote, a área inteira de uma vez | fica; confirmar pessoa a pessoa em 15 cartões é atrito puro |
| **Sinalizar por e-mail** (`mailto:`) | **sai**, substituída pelo lembrete automático e pelo progresso por área |
| **Imprimir / PDF** (`window.print`, com `no-print` no que é controle) | fica — gestor imprime para conversar com a equipe |
| **Copiar resumo** em texto | fica — é o que vai para o WhatsApp do time |

### Administração do DP

| O que a ferramenta faz | No Portal |
|---|---|
| Prazo, bloqueio manual, e desbloqueio pontual | campanha (`deadline`, `manuallyLocked`, `unlockedUntil` por plano) |
| Corrigir aquisitivo, limite e saldo, **com Desfazer** | tela de correção do direito — o Desfazer vem junto |
| Alterar setor, cargo e gestor, com antes/depois no histórico | **já existe**: Administração › Organização + `AdminAuditLog` |
| Cadastrar gestores e montar a estrutura | **já existe**: o organograma, por `managerId` |
| Perfis de acesso (`dp`/`gestor`), vincular usuário, ativar/desativar | **já existe**: papéis, bloco `gente-gestao` e Lendas |
| Histórico com autor, área, ação e detalhe, exportável em Excel | `AdminAuditLog` + exportação |

As quatro linhas marcadas como "já existe" são a maior parte do `GestaoDP.tsx`
(520 linhas) e do `gestao.functions.ts` (288). É o que a migração **não**
reescreve — e é por isso que trazer as regras custa menos do que parece olhando o
tamanho do projeto.

### Planilhas

Três abas, e os cabeçalhos vão como estão porque é o formato que o DP já lê:
**Programação Geral** e **Controle Geral** (Empregado, Centro de Custo, Squad,
Líder, Data Admissão, Início/Fim Aquisitivo, Limite p/ gozo, 1º e 2º período com
dias/início/término/venda, Saldo disponível, Observação) e **Histórico** (Data e
hora, Autor, Colaborador, Área, Ação, Detalhe).

### Filtros e conforto

Filtro por área e por líder na aba de programação, salvamento automático com
espera antes de gravar, e prazo encerrado deixando o gestor em somente leitura
enquanto a G&G continua editando. Tudo fica.

## Escopo

| Entra | Não entra |
|---|---|
| Direito, campanha, plano e materialização em `Vacation` | Integração com folha de pagamento |
| Regras no `policy` da campanha, feriado do calendário da empresa | Combinações fora das cinco (deliberação da G&G) |
| Tela do gestor com linha do tempo e informativo de mês coincidente | Trava por coincidência de férias — é informativo, nunca impeditivo |
| Solicitação do colaborador e aviso automático após a validação | Aviso e recibo de férias assinados (ficam com a Contabilidade) |
| Lembrete de prazo, progresso por área, desbloqueio pontual | Cálculo de saldo por afastamento (vem da folha) |
| Importação dos direitos por planilha (por e-mail) | Campanha de 2027, que fecha em 31/08 |
| Tela de correção do direito, onde a G&G grava a data-base | Data-base como coluna de planilha |
| Exportação consolidada e por área, nos cabeçalhos de hoje | Assistente que decide sozinho |
| Imprimir/PDF, copiar resumo, confirmar em lote | Sinalizar por e-mail (`mailto:`), que o lembrete substitui |
| Mapa-base sugerido (fase 3) | |

Faseamento: **(1)** direito + campanha + tela do gestor + validação da G&G +
materialização; **(2)** colaborador, linha do tempo, lembretes e consolidado;
**(3)** mapa-base sugerido e assistente. A fase 1 já substitui a ferramenta atual.

## Pendências

Nenhuma questão de desenho em aberto. Restam duas de conteúdo:

1. **Texto padrão do aviso ao colaborador** — a G&G escreve. Ele mora na campanha
   (`noticeTemplate`), então não bloqueia a implementação: entra um texto
   provisório e a G&G troca sem deploy.
2. **Aviso e recibo assinados** ficam com a Contabilidade. A G&G registrou
   interesse futuro; é feature à parte porque envolve dado pessoal, valores e
   assinatura das duas partes — fluxo de documento, não tela.
