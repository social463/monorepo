# Eu Aprendiz — trilha do programa Jovem Aprendiz

Data: 2026-09-14
Status: em implementação (Fase 1)

## O que é

**Eu Aprendiz** é a área da trilha de desenvolvimento do programa Jovem Aprendiz.
Uma área à parte, no formato da Liderança: entrada própria no menu, layout próprio
com sub-navegação, e um público que não é o da empresa inteira.

Seis encontros ao longo do contrato. Em cada um, o aprendiz preenche fichas,
registra o compromisso do mês, revisa o compromisso do mês anterior e responde
uma pesquisa anônima. A Gente e Gestão (o "facilitador") libera cada encontro,
faz a chamada nominal, agenda reposição e acompanha o andamento.

Origem: protótipo em TanStack Start entregue pela G&G (`Trilha EMR.zip`), sem
backend — todo o estado vivia em memória num provider React, com os aprendizes
cravados no código, um seletor de "perfil de teste" no cabeçalho e um "modo
demonstração" com dados fictícios. Esta spec é a tradução daquilo para o Legends:
o que vira banco, o que vira reuso do que já existe, e o que não vem junto.

## Quem entra

Duas portas, e elas não são a mesma:

- **O aprendiz** — `User.positionCategory === 'Jovem Aprendiz'`. Esse valor já é
  canônico em `POSITION_CATEGORIES` (`packages/shared/src/course-catalog.ts`), então
  não há cadastro novo: quem a planilha de colaboradores marca como Jovem Aprendiz
  entra. Ele vê trilha, encontro, mural, contrato e portfólio — o próprio.
- **O facilitador** — ADMIN pleno, ou SUBADMIN do setor com a feature
  `gente-gestao`. É o bloco de administração por setor que o `AGENTS.md` descreve:
  o painel é de Gente e Gestão, não de qualquer admin de setor. Na rota,
  `app.requireSectorFeature('gente-gestao')`; no front, o guard espelha.

`positionCategory` **não existia** no `PublicUser` nem no JWT — só como snapshot em
treinamentos. Esta feature o expõe no `PublicUser` (e no `toPublicUser`), que é o
que permite o menu e o guard de rota decidirem no cliente.

No servidor, a decisão **não** vai para o JWT. Feature viaja no token e só vale no
próximo refresh (≤ 15 min); cargo mudando de valor no meio de um contrato é raro,
mas o que decide aqui não é só o cargo — é também a turma em que a pessoa está
matriculada, que a rota precisa carregar de qualquer jeito. Então um helper
(`apprenticeContextOf`) lê usuário e matrícula numa consulta só e devolve o
contexto inteiro. Uma consulta a mais por request, sempre correta, sem claim novo.

## O que NÃO vem do protótipo

- **O seletor "Perfil de teste"** — vira o login. Quem você é, é quem está logado.
- **O "Modo demonstração"** — sai inteiro, junto com `emr-demo.ts`. Dado de exemplo
  em produção é dado que alguém confunde com o real. O que substitui é o
  `db:seed`, que popula turmas, encontros e fichas iniciais de verdade.
- **Metade da aba "Acompanhamento da Jornada"** — setor, squad, líder, admissão,
  tempo de casa e férias já são `User.sectorId`, `User.squad`, `User.managerId`,
  `User.joinedAt` e o planejamento de férias da Liderança. Reimplementar aquilo
  seria um segundo cadastro da mesma pessoa, divergindo do primeiro no dia
  seguinte. (Fase 2: só o que é genuinamente novo — fim de contrato previsto,
  atividades sob responsabilidade e histórico de movimentação de setor.)
- **O gateway de IA da Lovable** — o assistente de insights passa a usar o provedor
  e a chave que a empresa cadastra em Administração › Inteligência Artificial, via
  `lib/agent-client.ts`, como o Benchmarking. (Fase 2.)
- **`Compromissos.tsx` e `EncontroCard.tsx`** — código morto no protótipo, ninguém
  os importa. O `Compromisso` atribuído pelo facilitador (com prazo e status) não
  tem tela nenhuma; o que existe de verdade é o **Cartão do Compromisso do Mês**,
  que é ficha preenchida pelo aprendiz. Só esse vem.
- **A marcação de presença por turma** — o protótipo tinha DUAS presenças: um
  booleano por `(encontro, turma)` e a chamada nominal por pessoa, com a nominal
  tendo prioridade sobre a outra. Dois mecanismos para o mesmo fato divergem. Fica
  só a **nominal**.

## Modelo

Treze models, todos tenant-scoped (`companyId`, registrados em
`TENANT_SCOPED_MODELS`).

**Turma e matrícula.** `ApprenticeClass` (nome, turno, ativa) e
`ApprenticeEnrollment` (aprendiz × turma). A turma é model, e não enum `A | B`,
porque ela é do ciclo: o próximo tem outras, e um enum obrigaria migration para
abrir uma turma da tarde.

**Encontro.** `ApprenticeMeeting` — `order` (1..6, único por empresa), título,
tema, objetivos, entregável, data, `accessReleased`, `surveyOpen`, link de slides.
`ApprenticeMeetingMaterial` guarda os materiais complementares.

O **status** (Concluído / Próximo / Futuro) do protótipo era campo editável. Aqui
é **derivado da data**, como os períodos de votação: passou, é Concluído; o
primeiro que não passou é o Próximo; o resto é Futuro. Campo de status editável ao
lado de uma data é campo que alguém esquece de mudar.

**Ficha.** `ApprenticeActivity` — um schema JSON declarativo (blocos, campos) com
`kind` em `ACTIVITY | COMMITMENT | REVIEW`, e `ApprenticeSubmission` — a resposta
de um aprendiz (`values` JSON, `submittedAt` nulo enquanto é rascunho), única por
`(activity, user)`.

Decisão: **tudo é ficha dinâmica**, inclusive o Mapa de Forças e a Linha do Tempo
do Encontro 1, que no protótipo eram componentes fixos em código. Um caminho de
renderização só, e a G&G muda uma pergunta sem deploy. O que a Linha do Tempo
exigia e o schema não tinha é campo de **lista repetível** (os cinco eventos) —
foi acrescentado como `tipo: 'lista'`, com subcampos.

`COMMITMENT` é o Compromisso do Mês, um por encontro. `REVIEW` é a revisão do
compromisso do encontro anterior, existe a partir do encontro 2 e lê a submissão
`COMMITMENT` do encontro de ordem anterior — é a única ficha que olha para trás.

**Presença.** `ApprenticeAttendance` por `(encontro, aprendiz)`: presente,
justificativa, precisa de reposição. `ApprenticeMakeup` + `ApprenticeMakeupAttendee`
para a reposição agendada.

**Pesquisa.** `ApprenticeSurveyResponse` **não tem `userId`** — nota, o que leva, o
que melhorar, se aprendeu. Quem já respondeu fica em `ApprenticeSurveyReceipt`,
uma tabela separada, sem nenhuma coluna que ligue uma linha à outra.

Isto protege o anonimato no banco, e não na tela: com três aprendizes numa turma,
ler as respostas em texto livre identifica quem escreveu, por escrita e por
contexto. O produto exibe assim mesmo, porque é o que a G&G pediu e o que o
protótipo fazia — mas quem mexer aqui precisa saber que a garantia é estrutural,
não estatística.

**Contrato.** `ApprenticeContract` (as cláusulas, uma linha por empresa) e
`ApprenticeContractSignature` (quem assinou, quando).

## Liberação e progresso

`encontroLiberado(encontro, aprendiz)`:

1. facilitador → sempre;
2. `!accessReleased` → não;
3. `order === 1` → sim;
4. senão, olha a presença no encontro **anterior**: constou ausente → bloqueado.

O passo 4 tem uma diferença deliberada em relação ao protótipo: ausência de
lançamento **não** bloqueia. Lá, quem ainda não tinha chamada lançada ficava
travado, o que transforma um esquecimento do facilitador em turma inteira parada.
Aqui o portão só morde depois que a chamada aconteceu.

Quem faltou volta a passar quando o facilitador **corrige a chamada** depois da
reposição. A reposição agendada não libera sozinha: ela é um compromisso de
agenda, não um registro de que a pessoa compareceu.

**Etapa concluída** = todas as fichas do encontro enviadas **e** a pesquisa
respondida. É o que move a linha do tempo da trilha e o que o portfólio conta.

## Telas

`/eu-aprendiz` com layout e `Outlet`, no padrão do `InovaLayout`:

| Rota | Tela |
|---|---|
| `/eu-aprendiz` | Trilha — linha do tempo dos seis encontros e os cartões |
| `/eu-aprendiz/encontro/:id` | Encontro — detalhe, materiais, fichas, revisão, pesquisa |
| `/eu-aprendiz/mural` | Mural — o que cada turma entregou, com filtros |
| `/eu-aprendiz/contrato` | Contrato da trilha e assinaturas |
| `/eu-aprendiz/portfolio` | Portfólio — uma página por encontro |
| `/eu-aprendiz/painel` | Painel do facilitador (só G&G) |

O conteúdo das fichas é privado: só o próprio aprendiz e o facilitador leem. No
mural entra o **status** da entrega, nunca o texto escrito.

Os selos dos seis encontros, a logo "eu aprendiz" e a ilustração da trilha não
vieram no zip (`src/assets/*.asset.json` são ponteiros para o CDN da Lovable). Até
os arquivos chegarem, o selo é o número do encontro sobre a cor da marca e o
cabeçalho usa `<BrandLogo>`. Trocar é soltar os PNGs — nenhuma mudança de código.

## Fases

**Fase 1 (esta)** — modelos, trilha, encontro, fichas com rascunho e envio, mural,
contrato, portfólio, e o painel com liberação de acesso, chamada nominal,
reposição, andamento nominal e pesquisa anônima.

**Fase 2 (entregue)** — jornada, movimentações de setor, quadro de gestão do RH,
assistente de insights e arquivo de verdade em material e apresentação.

### Jornada: o que é do módulo e o que é do cadastro

`ApprenticeJourney` guarda **três coisas**: fim previsto do contrato, atividades
sob responsabilidade e observações. Setor, squad, líder e admissão são LIDOS de
`User` a cada consulta — nunca copiados. Um segundo cadastro da mesma pessoa
diverge do primeiro no dia seguinte, e a tela diz isso em voz alta ("edite em
Administração › Organização, não aqui").

Etapa da jornada, tempo de casa e dias até o fim do contrato são **derivados**,
não colunas — funções puras no shared, como o SLA de treinamentos.

`ApprenticeSectorMove` é o histórico de troca de setor, e existe por um motivo
específico: sem ele, a elegibilidade de mudança contaria sempre da admissão, e
quem trocou de setor no mês passado pareceria elegível por já estar há um ano na
empresa. A permanência conta da ÚLTIMA MUDANÇA.

A elegibilidade **avisa, não barra**: o registro grava a mudança que de fato
aconteceu, mesmo antes dos seis meses. Quem pede confirmação é a tela; o banco
guarda o fato. Os seis meses são constante no shared, e não `AppSetting` — hoje
uma empresa só usa. O cálculo já recebe o valor por parâmetro, então promover
depois é trocar a origem, não a conta.

### Quadro de gestão

`ApprenticeTask` + `ApprenticeTaskItem`: o que o facilitador precisa fazer para o
encontro acontecer. Nunca aparece para o aprendiz — não confunda com
`ApprenticeActivity`, que é a ficha que ele preenche. "Atrasada" é derivado do
prazo (e concluída nunca está), pelo dia civil de **São Paulo**.

O campo é `boardColumn`, e não `column`: palavra reservada em SQL só funciona
entre aspas, e não vale o risco.

### Assistente

Entra como mais um `AgentKind`, reusando `AgentConversation`/`AgentMessage` e a
rota genérica `/admin/agents/:agent/ask` — que já tem o guard de `gente-gestao`.
Nenhuma tabela nova: o que muda de um agente para outro é o system prompt e a
fonte de contexto, não o armazenamento. Provedor e chave são os que a empresa
cadastra em Administração › Inteligência Artificial; sem chave, 503 tratado.

O protótipo deixava a facilitadora subir os documentos oficiais da trilha para a
IA cruzar. Isso **não vem**: a trilha virou dado estruturado (encontros,
objetivos, entregáveis, presença, pesquisa), e é isso que vai no contexto —
melhor do que um PPTX de onde a IA teria de adivinhar o mesmo. O conteúdo das
fichas fica de fora, porque é privado.

O chat em si foi extraído para `components/AgentChat`: era idêntico ao do
Benchmarking, que passou a usá-lo. Uma implementação, dois agentes.

### Arquivo no S3

Material e apresentação aceitam **link externo OU arquivo**, exatamente um dos
dois. A chave nasce no servidor (`apprentice-materials/<companyId>/<uuid>.<ext>`)
e é conferida pelo prefixo antes de gravar — sem isso, alguém anexaria ao
encontro o arquivo de outra empresa. A leitura sai como URL assinada e
temporária, nunca a chave, como o comprovante de treinamento.
