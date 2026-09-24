# AGENTS.md — Legends

Guia para agentes de código (Codex, Claude Code, etc.) trabalharem neste repo.
Fonte única de contexto: o `CLAUDE.md` apenas importa este arquivo.

## O que é

**Legends** — plataforma interna de feedback entre pares da engenharia.
Colaboradores dão feedback a colegas por categoria — no dia a dia, pelo mural e
pelo perfil, e uma vez por mês pela votação, que elege o **Destaque do Mês**. O
sistema deriva selos (badges) do feedback recebido, gera um card compartilhável
com IA e mantém o perfil de cada pessoa.

**Reconhecimento e feedback são a mesma coisa, e chamam-se feedback.** Eram dois
vocabulários paralelos (voto + `Category` de um lado, feedback +
`RecognitionCategory` do outro) até
`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`. Hoje:

- **um catálogo de categorias por empresa** (o model ainda se chama
  `RecognitionCategory`; a tela é Administração › Categorias), usado pelo
  feedback **e** pelo voto. Categoria é **desativada**, nunca apagada, e o
  `slug` não acompanha renomeação — é ele que `Badge.categorySlug` referencia;
- **o voto vira feedback na hora de votar**: `createVote` grava voto e
  `Feedback` (privado, ligado por `Feedback.voteId`) na **mesma transação**, e
  quem recebeu vê no perfil ainda com a votação aberta — feedback não espera.
  O que continua guardado até a publicação é **quem foi o Destaque do Mês**, que
  é outro dado. `materializeVoteFeedbacks(periodId)`, na publicação, virou rede
  de segurança para os votos anteriores a essa mudança (idempotente por `voteId`);
- **os selos `CATEGORY`, `IMPACT` e `RECURRENCE` contam feedback recebido**
  (`FeedbackRecipient`, por causa do feedback grupal). `FEEDBACK` continua
  contando feedback **escrito**. Não há mais embargo: como o voto já nasce com o
  feedback junto, o selo de quem recebeu sai na hora do voto, e não na
  publicação. O catálogo de selo, porém, é **dado da empresa** (Administração ›
  Selos) — `Badge.categorySlug` é texto, sem FK e sem criação automática, então
  categoria nova nasce sem selo até alguém criar um. O `Badge.slug` é único **por
  empresa** (`@@unique([companyId, slug])`), não na instância inteira — como
  `Sector.slug` e `Squad.name`/`slug`. Em model tenant-scoped, índice único de
  nome/slug leva `companyId` junto;
- o perfil não tem mais aba "Reconhecimentos": há uma lista só, a de feedbacks.

**Felicitação de aniversário é a exceção: ela NÃO é feedback.** É o único lugar
onde o vocabulário se separa de novo, e de propósito. Dar os parabéns abria o
`FeedbackComposer` com um rascunho, então "Parabéns, Victoria!" nascia com tipo,
categoria, coins e peso de selo, e ia parar no meio da lista de feedbacks da
pessoa. A unificação juntou voto e feedback porque os dois respondem "o que essa
pessoa fez que valeu"; felicitação não responde — não tem situação,
comportamento nem impacto. Hoje é model próprio (`BirthdayGreeting`), fora do
`feedback-service`, e o **mural de aniversário** vive no perfil, ao lado do
feedback (`BirthdayWallCard`), servindo as duas datas: nascimento e tempo de
casa. Um mural é `(pessoa, kind, ano)`, com **uma assinatura editável por
pessoa** (a unique), janela de 3 dias antes a 30 depois decidida pelo
**servidor** (`canSign`), e leitura livre fora dela — é o histórico. Assinar é
de todo mundo menos de si mesmo: `canSignBirthdayWall` não reaproveita
`canWriteFeedbackTo`, que barra o ADMIN. O ❤️ do card de aniversariantes
continua levando ao perfil e ao feedback de sempre. Spec:
`docs/superpowers/specs/2026-08-31-mural-de-aniversarios-design.md`.

A lista do perfil é por **destinatário** (`FeedbackRecipient`), não por
`Feedback.targetId`: no feedback grupal o `targetId` é só o primeiro da lista, e
filtrar pela coluna escondia do perfil o que a pessoa recebeu junto com o time —
que os selos já contavam. Toda linha tem o principal na tabela de destinatários
(`createFeedback` sempre o cria, e a migration `20260817180000` fez o backfill),
então **fixture de teste que insere `Feedback` direto precisa criar o
`recipients` junto**, senão o feedback não aparece em lugar nenhum.

A lista do perfil é **paginada por página** (`PROFILE_FEEDBACK_PAGE_SIZE`, cinco
por vez), e não rolagem infinita: ela só cresce com o tempo, e acumular tudo no
DOM fazia o card esticar sem teto. Consequência: o deep-link do mural
(`/perfil/:id?feedback=<id>`) não tem como adivinhar em que página o item caiu —
quem resolve é o servidor, pelo parâmetro **`anchor`**, que conta quantos
feedbacks são mais recentes que ele e devolve a página que o contém. O filtro por
categoria também é do servidor: filtrar depois de paginar esconderia o resultado
que está na página seguinte.

## Stack & layout

Monorepo **pnpm workspaces** (`apps/*`, `packages/*`), **TypeScript ESM** (`"type": "module"`), **Node ≥ 20**, **pnpm 9.7**.

```
apps/api        Backend — Fastify 4 + Prisma 5 + PostgreSQL  (porta 3333)
apps/web        Frontend — Vite 5 + React 18 + Tailwind 3    (porta 5173 em dev)
packages/shared Tipos/constantes compartilhados (contrato api⇄web)
docs/superpowers Specs (design) e plans por feature
docker/ nginx/ Dockerfile docker-compose.yml  Infra/deploy
```

Imports cruzados usam o nome do workspace: `@legends/api`, `@legends/web`, `@legends/shared`.

## Comandos

Tudo a partir da raiz, salvo indicação.

```bash
pnpm install                 # instala tudo
pnpm db:up                   # sobe o Postgres (docker compose) na 5432
LEGENDS_DB_PORT=5442 pnpm db:up          # … em outra porta, se a 5432 estiver
                                          # ocupada por outro projeto. Passe a MESMA
                                          # variável nos testes da API:
                                          # LEGENDS_DB_PORT=5442 pnpm --filter @legends/api test
pnpm db:migrate              # aplica migrations (prisma migrate dev)
pnpm db:generate             # regenera o Prisma Client
pnpm --filter @legends/api run db:seed   # popula categorias, selos, usuários, período
                                          # (inclui conta SUPER_ADMIN de dev:
                                          # super-admin@legends.internal / emr2026@,
                                          # nunca usada em produção)
pnpm dev                     # api (3333) + web (5173) em paralelo
pnpm build                   # build de todos os workspaces
pnpm test                    # testes de todos os workspaces
```

Por workspace: `pnpm --filter @legends/api test`, `pnpm --filter @legends/web dev`, etc.

Env: copie `apps/api/.env.example` → `apps/api/.env`. Variáveis: `DATABASE_URL`,
`JWT_SECRET`, `PORT`, e opcionais `GEMINI_API_KEY` / `GEMINI_MODEL` (geração de
texto do Destaque do Mês). `JWT_SECRET` é **obrigatório em produção** (ver `lib/config.ts`).

**Chave de IA dos agentes é por empresa, não do ambiente.** `GEMINI_API_KEY` serve
só ao card do Destaque do Mês. Os agentes (Benchmarking e os próximos) leem provedor,
chave, modelo e URL que cada empresa cadastra em **Administração › Inteligência
Artificial**, guardados cifrados em `AppSetting` (`services/ai-settings-service.ts` +
`lib/crypto.ts`). Não há fallback para o ambiente, de propósito: senão todo tenant sem
chave própria gastaria a cota da EMR em silêncio. Sem chave cadastrada o agente responde
503 com mensagem tratada. A cifra usa `CALENDAR_ENCRYPTION_KEY` — obrigatória em produção.

**A assistente é a exceção: ela não depende de chave.** A fonte da Emily é a base de
conhecimento (`KnowledgeEntry`), e a IA é o que redige melhor em cima dela. Sem
credencial da empresa, `/assistant/chat` degrada para a melhor entrada da base
(`services/assistant-chat-service.ts`), como já fazia a pergunta única de
`/assistant/ask`. Só a **ausência** de credencial degrada: chave recusada (502) e
limite do provedor (429) sobem para o usuário, porque são acionáveis.

**Conversa não é consulta à base.** "oi", "obrigada", "tchau", "ok" e "não
ajudou" não casam com entrada nenhuma, e sem tratamento viravam "Ainda não
encontrei essa informação na base de conhecimento" — resposta de pergunta
factual sem cobertura, nunca de cumprimento. Com chave da empresa quem resolve é
o prompt (`assistant-prompt.ts`); sem chave, `classifySmallTalk`
(`lib/assistant-smalltalk.ts`) responde com texto pronto. O mesmo classificador
tira conversa do painel de lacunas em `listAssistantGaps` — vale nos **dois**
caminhos, porque lá toda pergunta sem entrada casada conta como lacuna e o topo
do painel de G&G virava "oi". Ele é conservador de propósito: só é conversa
quando a mensagem INTEIRA é saudação — "oi, quantos dias de férias?" continua
sendo pergunta.

No chat, a base vai **inteira** para o system prompt enquanto couber no teto
(`selectKnowledgeContext`, `lib/assistant-search.ts`); só quando estoura é que o
ranking volta a recortar, aí considerando também as últimas perguntas da conversa.
Não confunda com `findMatchedEntries`, que responde "o que casou" e continua sendo
o que grava `matchedEntryIds` (painel de lacunas) e o que o fallback sem IA lê
literalmente. Mandar a base inteira para lá diria que toda pergunta foi respondida.
Cumprimento, agradecimento e despedida não consultam a base: o prompt separa
conversa de consulta, senão "oi" recebia "não encontrei essa informação".

O provedor é escolha do admin: **Gemini, OpenAI, Anthropic ou qualquer serviço
compatível com OpenAI** (Groq, DeepSeek, OpenRouter, local…, aí a URL da API também é
cadastrada). O catálogo — rótulo, modelo padrão, sugestões, link da chave — mora em
`@legends/shared` (`ai-settings.ts`) e é a fonte única de api e web; `lib/agent-client.ts`
despacha por provedor e traduz qualquer falha em `AgentError` com mensagem em português.
Trocar de provedor **apaga a chave e o modelo** da empresa (chave da OpenAI não vale no
Gemini). Empresa sem provedor gravado continua no Gemini, que é o que mantém as chaves
cadastradas antes da escolha existir.

**Marca por empresa (white label).** Nome, logo, domínios e paleta de cada cliente.
Quem edita é o **SUPER_ADMIN**, no console interno, na página da empresa
(`/super-admin/companies/:id`) — não o ADMIN do cliente: num produto white label a
identidade faz parte do que o fornecedor entrega. As rotas são
`/super-admin/companies/:id/branding`. Informa-se **uma** cor de marca; o servidor
deriva os 35 tokens Material 3 em OKLCH (`packages/shared/src/branding.ts`) e grava
tudo num JSON único em `AppSetting` sob a chave `branding`.

A empresa é resolvida pelo `Host`, nesta ordem: **domínio próprio** cadastrado
(`hosts`, ex. `legends.eumedicoresidente.com.br`), depois subdomínio sob o host de
`APP_BASE_URL` (`emr.<host>`), depois a marca do produto. O domínio próprio é o que
dispensa DNS wildcard e certificado curinga.

`primary` **nunca** recebe a cor institucional crua — recebe o tom legível do mesmo
matiz. O verde da EMR (`#35bd78`) rende 2.3:1 como texto, e `text-primary` aparece
~1080 vezes no front; a cor exata fica em `surface-tint`, para preenchimento e
decoração. `checkBrandContrast` trava os pares críticos, e o teste do shared exige que
a rampa conserte qualquer cor de marca nos dois esquemas.

O `tailwind.config.ts` não tem hex: cada token é
`rgb(var(--brand-<token>, <fallback do produto>) / <alpha-value>)`. Canal RGB, e não
hex, porque `bg-primary/30` precisa de `<alpha-value>`. Quem injeta é o
`BrandProvider`, acima do `AuthProvider` — a tela de login precisa da marca antes de
existir token. Por isso `GET /branding` é **público** e resolve o tenant pelo `Host`
(domínio próprio, ou subdomínio do host de `APP_BASE_URL` — sem env nova), com
`?slug=` como escape em dev e `applyCachedBranding()`
no `main.tsx` para não piscar. Tema claro/escuro é do tenant e é só troca de valor
das mesmas variáveis: o app usa `dark:` em apenas 6 lugares.

Nas telas, use `<BrandLogo>` / `<BrandName>` / `<BrandTagline>` — não crave
`/illustration/*.png`. Exceção deliberada: o `SuperAdminLayout` mantém a marca do
produto, porque é o console interno que administra todas as empresas.

No servidor, o card do Destaque do Mês deriva as cores dele da marca
(`cardBrandFrom`), o rodapé do Teams usa `teamsBrandFor` e o **certificado** usa
`certificateBrandFor`. Os três derivam da mesma cor institucional e cada um
escolhe o tom que o próprio fundo pede: o certificado é impresso em papel claro,
então entra o tom legível do matiz da marca, e não a cor crua — a mesma
armadilha do `primary`. A logo do certificado é a do esquema **claro** (o papel
é branco), e o que ela descarta é só **caminho relativo**, que não resolve fora
do navegador. **SVG entra**, ao contrário do card do Teams: aqui quem desenha é
o resvg, que rasteriza SVG dentro de `<image>` — e a logo embutida do
certificado sempre foi um SVG. Descartar SVG aqui deixaria a empresa com a logo
cadastrada e o certificado sem ela (as logos da EMR em produção são SVG).

No **card do Teams** quem desenha é a Microsoft, que não rasteriza SVG: logo em
SVG vira ícone de imagem quebrada e o `altText` ainda rouba a linha do rodapé
(`isTeamsRenderableLogo`, no `teams-client`). Só que descartá-la assinava o card
da empresa com a arte do produto — a EMR ficou meses com "Portal EMR" ao lado do
punho do Legends. Então a API converte: `teamsBrandFor` manda a URL pública de
`GET /branding/logo.png`, que baixa a logo cadastrada e devolve o mesmo desenho
em PNG (`lib/logo-raster.ts`, resvg, com cache por URL de origem). A rota é
**pública** porque quem busca a imagem é o servidor da Microsoft, e leva
`?company=` porque a URL nasce do `APP_BASE_URL`, não do Host do tenant. Quem já
cadastrou PNG/JPEG/GIF continua indo direto, sem o round-trip.

No certificado a marca é o **padrão** e o modelo (`CertificateTemplate`) é a
**exceção**: `accentColor` e `logoUrl` nulos herdam, preenchidos mandam. Quem
aplica a herança é `toCertificateTemplateVisual` — o renderer só recebe
`CertificateTemplateVisual` já resolvido. Duas coisas ficam de fora: a
**assinatura**, que é de uma pessoa e não da empresa, e o certificado **sem
modelo nenhum**, que sai com o visual embutido de sempre para que um certificado
antigo, re-renderizado, não mude de cara.

**Quem lidera quem é `User.managerId`.** Fonte única: é a cadeia que desenha o
organograma (`organization-service`) **e** que recorta a área de Liderança —
humor do time, férias e indicadores, todos por `team-scope-service`. Squad
(`Squad.leaderId`) e área (`User.area`) não definem time; `PdiPlan.leaderId` é
o líder **daquele plano**, outro conceito. Ao mexer no escopo, use
`listManagedGroups` (os **diretos**, é o que os painéis listam) e `managesUser`
(a **subárvore**, porque líder de líderes autoriza quem está mais abaixo) — e a
elegibilidade vem de `ORGANIZATION_MEMBER_WHERE`, exportado do organograma.
Consequência operacional: **empresa sem `managerId` preenchido fica com os
painéis da Liderança vazios** (cadastro em Administração › Organização › Lendas
ou pela importação por planilha). O organograma pela entrada da Liderança
(`/lideranca/organograma` → `GET /organization/direct-reports`) mostra só os
diretos; a empresa inteira continua em `/time`. Spec:
`docs/superpowers/specs/2026-08-17-organograma-da-lideranca-e-escopo-por-manager-design.md`.

**Treinamento é UM registro, não dois.** `TrainingRecord` é o fato do módulo de
T&D: uma pessoa fez uma ação de desenvolvimento, em tal data, com tanta carga
horária e tanto investimento. Ele SUCEDE o envio de certificado externo
(`CertificateRequest` com `origin = EXTERNAL`), que era a mesma coisa sem carga
horária, instituição nem data de conclusão — a migration
`20260912161148_modulo_treinamentos_td` fez o backfill e apagou as linhas
copiadas. `CertificateRequest` ficou só com o que sempre foi dele: a emissão do
certificado INTERNO, a partir de matrícula concluída. `/aprendizado/enviar-certificado`
redireciona para `/treinamentos`.

Quatro consequências que se pagam ao mexer nele:

- **Snapshot, não join.** `sectorName`, `squad`, `leaderName`, `position`,
  `positionCategory` e `employmentType` são copiados na escrita. Quem muda de
  setor em março não leva o treinamento de janeiro para o setor novo.
- **Dois eixos de situação.** `validationStatus` (`PENDING`/`APPROVED`/`REJECTED`)
  é a G&G conferindo o comprovante; `participationStatus` (Participou, Inscrito,
  Ausente…) é presença na ação. **Indicador conta o validado**; a Central mostra
  tudo, porque é lá que a pendência é resolvida. Registro de autoatendimento
  nasce `PENDING`; o que o T&D cadastra nasce `APPROVED`.
- **Derivado é função pura.** Ano, trimestre, semestre e SLA não são coluna (na
  ferramenta de origem eram `GENERATED ALWAYS AS`): saem de `trainingYear`,
  `trainingQuarter`, `trainingSemester` e `trainingSlaDays`, em
  `@legends/shared` (`training.ts`), junto dos agregados do painel
  (`computeTrainingKpis`, `groupTrainingBy`, `computeTrainingCoverage`) — que
  rodam no SERVIDOR, sobre as linhas que o filtro já recortou.
- **SLA só onde há prazo.** Ele conta os dias entre `requestDate` e
  `completionDate`, e só vale para o que veio de LNT, PDI ou pedido do líder
  (`isDemandDrivenTraining`) — curso feito por conta própria não tem prazo de
  ninguém, e contá-lo afundaria o indicador do time sem que houvesse falha. O
  prazo é da empresa: `training_sla_days` em `AppSetting`, padrão 90.

Não confunda com `training-analytics-service.ts`, que é outra pergunta: lá o
fato é a conclusão de curso do CATÁLOGO INTERNO (`CourseEnrollment.completedAt`),
para a aba Desenvolvimento & IA do People Analytics. Spec:
`docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.

**Eu Aprendiz é a área do programa Jovem Aprendiz, e quem a abre é o CARGO.**
Área à parte, no formato da Liderança (`/eu-aprendiz`, layout próprio com
`Outlet`): trilha de seis encontros, fichas, mural, contrato e portfólio. Entra
quem tem `User.positionCategory === 'Jovem Aprendiz'` — valor que já era canônico
em `POSITION_CATEGORIES` —, mais quem facilita: ADMIN pleno ou SUBADMIN com
`gente-gestao` (é o painel, `app.requireSectorFeature`). Não é feature de setor:
`positionCategory` não é feature nenhuma, daí a flag `apprenticeOnly` no menu, ao
lado de `leadershipOnly`. No servidor a decisão também **não** vai para o JWT
(`apprenticeContextOf` lê usuário e matrícula numa consulta): cargo mudando não
espera os 15 min do refresh, e a rota precisa da turma de qualquer jeito.

Quatro coisas que se pagam ao mexer:

- **Toda ficha é dinâmica.** Inclusive Mapa de Forças e Linha do Tempo, que no
  protótipo eram componentes fixos. `ApprenticeActivity.schema` é JSON
  (`ApprenticeActivitySchema`, no shared) e o `kind` dá o comportamento:
  `COMMITMENT` é o Compromisso do Mês, `REVIEW` é a revisão do compromisso do
  encontro ANTERIOR — a única ficha que olha para trás, e por isso só existe a
  partir do 2º. Renomear `vou` ou `status` quebra a revisão e o indicador.
- **O status do encontro é derivado da data** (`meetingStatusesOf`), como os
  períodos de votação. E a trava do encontro (`isMeetingUnlocked`) morde só
  depois da chamada: ausência de lançamento NÃO bloqueia — no protótipo
  bloqueava, e um esquecimento do facilitador parava a turma inteira. Quem
  faltou volta a passar quando a chamada é corrigida; a reposição agendada não
  destrava sozinha.
- **A pesquisa é anônima no banco, não na tela.** `ApprenticeSurveyResponse` não
  tem `userId`; quem já respondeu fica em `ApprenticeSurveyReceipt`, outra
  tabela, sem coluna ligando as duas. Com três aprendizes, porém, o texto livre
  identifica quem escreveu — a garantia é estrutural, não estatística.
- **O mural mostra status, nunca conteúdo.** O que a pessoa escreveu é dela e do
  facilitador; `ApprenticeWallEntryDTO` não carrega texto de ficha.

No acompanhamento da jornada, `ApprenticeJourney` guarda **só o que o cadastro
não tem**: fim previsto do contrato, atividades sob responsabilidade e
observações. Setor, squad, líder e admissão são lidos de `User` a cada consulta,
nunca copiados. E `ApprenticeSectorMove` existe por um motivo só: sem o
histórico, a elegibilidade de troca de setor contaria da admissão, e quem trocou
mês passado pareceria elegível por estar há um ano na empresa. Ela **avisa, não
barra** — o registro grava a mudança que aconteceu.

A área **veste as cores do programa**, e não as da empresa — exceção deliberada ao
white label, como o `SuperAdminLayout`. O `EuAprendizLayout` redefine as variáveis
`--brand-*` no próprio contêiner (`pages/eu-aprendiz/program-theme.ts`, paleta da
versão 2.0 do manual: branco, menta `#E4F9EB`, verde vivo `#6CE190`, verde mata
`#16603C` e verde profundo `#264641`), então todo token do Tailwind lá dentro herda
dali. A cor é do programa, mas o **esquema é da pessoa**: há uma paleta clara e uma
escura, escolhidas por `useBrandContext().scheme`. A fonte é **Poppins** e as cores
seguem o Manual de Marca do Eu Aprendiz (G&G, 2026).
A arte oficial mora em `apps/web/public/eu-aprendiz/` e foi toda trocada no pacote de
setembro/2026, que trouxe duas coisas que faltavam: a **trilha negativa** (o escuro
ficava sem grafismo) e os **selos dos encontros em PNG**. O selo conquistado agora é a
arte; `MeetingSeal` só desenha o que a arte não tem, que é estado — bloqueado e em
andamento. A cor do selo é fixa por encontro e não segue o tema, porque o manual proíbe
trocar cor e ordem.
O verde vivo é só preenchimento (1.8:1 como texto, menos ainda que o `#35BD78` de
antes): **texto verde na área é `text-on-primary-container`**, nunca `text-primary`.
Modal da área não pode usar portal para fora do contêiner, senão perde o tema.

O **quadro de gestão** (`ApprenticeTask`) é do facilitador e nunca aparece para o
aprendiz — não confunda com `ApprenticeActivity`, que é a ficha que ele preenche.

O **portfólio do facilitador é o da turma**, não o dele: ele não é aprendiz e não tem
portfólio próprio, então pedir o do próprio id devolvia 404 e a aba abria vazia.
`GET /apprentice/portfolio/overview` responde a situação de entrega de todo mundo —
nunca o conteúdo da ficha, que continua no portfólio individual, autorizado caso a
caso.

O **assistente** é mais um `AgentKind`, na rota genérica `/admin/agents/:agent/ask`:
nenhuma tabela nova, porque o que muda entre agentes é o system prompt, não o
armazenamento. O chat mora em `components/AgentChat`, compartilhado com o
Benchmarking.

Não confunda com Treinamentos (`TrainingRecord`), que é ação de desenvolvimento
de qualquer colaborador. Spec:
`docs/superpowers/specs/2026-09-14-eu-aprendiz-design.md`.

**Metas e OKRs: o check-in é o fato, e o KR não tem coluna de valor.** O valor
atual sai do check-in mais recente por **competência** (`effectiveAt`, não
`createdAt`), e meta que é razão guarda numerador e denominador para que o
acumulado do ciclo seja Σnum ÷ Σden — a média das porcentagens não é a
porcentagem do total. Progresso linear (`progressLinear`) existe só por paridade
com a ImpulseUp; quem decide cor e "cumprimos?" é o **atingimento**, que respeita
`direction`: em `LOWER_IS_BETTER` a meta é um teto, e a ImpulseUp, que ignora
`inverted`, pintava churn estourado de azul. Regras puras e `permissions` moram
em `@legends/shared` (`okr.ts`) e a escrita confere o MESMO predicado que o DTO
devolve. Os dados vêm da ImpulseUp por `scripts/import-impulseup-okr.ts`
(one-way, só GET, dry-run por padrão, idempotente por `externalId`). Spec e
README: `docs/superpowers/specs/2026-09-17-modulo-metas-okr-design.md`.

**Blocos de administração por setor.** Partes do `/admin` pertencem a um time
específico. Quem entra: o ADMIN global sempre, e o SUBADMIN do setor com a feature de
bloco ligada (`Sector.enabledFeatures`). Duas hoje:

| Feature | Bloco | Telas |
|---|---|---|
| `gente-gestao` | Gente e Gestão | People Analytics, Painéis de RH, Termômetro de humor, Cursos, Treinamentos (T&D), Manifesto, Manuais, Benefícios, Benchmarking, Avaliações externas |
| `desenvolvimento-produto` | Desenvolvimento de Produto | Retrospectivas, Quinta de Dev |

Use `app.requireSectorFeature(key)` na rota e `AdminSectorFeatureOnly` no front —
`requireFeature`/`FeatureGate` **não** servem, porque liberam todo ADMIN e todo SUBADMIN.

Não confunda com as features de **colaborador**, que dizem quem consome/participa e
continuam valendo: `cultura` (manuais), `aprendizado` (cursos), `retrospectivas` e
`quinta-desenvolvimento` (participação nas dinâmicas). Ter a feature de colaborador não
dá direito de administrar.

Manifesto e Benefícios são exceção deliberada na leitura: **todo usuário logado lê**,
sem feature nenhuma (são a identidade da empresa). Só a edição é do bloco de G&G.

O ADMIN liga/desliga tudo isso em **Administração › Setores**. Como a feature viaja no
JWT, a mudança vale no próximo refresh do access token (≤ 15 min) ou no próximo login.

**Analytics de uso.** Três registros vizinhos, propósitos distintos — não fundir:
`AccessLog` é navegação (base do People Analytics), `AdminAuditLog` é ação de admin
sobre entidade com before/after, e **`AnalyticsEvent`** é uso de produto, que sustenta
o painel de adoção em `/super-admin/adocao`. Spec:
`docs/superpowers/specs/2026-08-11-analytics-adocao-por-empresa-design.md`.

Os nomes de evento são fonte única em `@legends/shared` (`analytics.ts`) e o teste ao
lado trava as restrições do GA4 — nome inválido lá é **descartado em silêncio**.
Na API, instrumente com `captureFor(request, nome, props)`
(`lib/analytics/request.ts`): empresa e setor saem do JWT sozinhos, e `sectorId` é
gravado como snapshot, nunca derivado por join (quem muda de setor não pode levar o
histórico junto). `capture()` devolve `void` de propósito — **não coloque `await`**,
senão a latência do sink externo vira latência da request.

Dois destinos: **Postgres é a fonte de verdade** (painel do super-admin, série
completa) e o **GA4** é para exploração de comportamento — ele retém evento por só 14
meses. Sem `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` (api) ou `VITE_GA4_MEASUREMENT_ID`
(web), o sink some e nada quebra: ausência de chave **não** derruba o boot, ao
contrário de `JWT_SECRET`. Ao configurar, use `GA4_DEBUG=true` — fora do debug o GA4
responde 204 mesmo para payload inválido.

Nada de PII: só UUID, nunca nome, e-mail ou texto escrito por pessoa. E o front só
pode emitir o que está em `WEB_ANALYTICS_EVENT_NAMES` — evento de domínio vindo do
navegador deixaria qualquer um inflar a adoção da própria empresa.

## Arquitetura — backend (`apps/api`)

Fluxo de uma request: **route → service → Prisma**. Camadas finas e separadas.

- **`src/routes/*.ts`** — registram endpoints, validam entrada com **Zod** (`safeParse`,
  retornando `400 { message, issues }` em falha), chamam o service e serializam a
  saída. Sem regra de negócio aqui. Registradas em `src/app.ts` (`buildApp`).
- **`src/services/*.ts`** — regra de negócio. Erros de domínio são classes tipadas
  com `status` HTTP (padrão `VoteError`); a route faz `instanceof` e responde com
  `err.status`. Erros inesperados sobem (`throw`).
- **`src/lib/*.ts`** — utilidades: `prisma.ts` (singleton do client), `serialize.ts`
  (entidade Prisma → DTO de `@legends/shared`, ex. `toPublicUser`, `toVoteDTO`),
  `config.ts`, `card-renderer.ts` (SVG→PNG via resvg + fontes em `assets/`),
  `gemini-client.ts`, `highlight-storage.ts`, `period-state.ts`, `password.ts` (bcrypt).
- **Auth** — `@fastify/jwt`. Access token **15 min**; rotas protegidas com
  `onRequest: [app.authenticate]`; rotas admin com `app.requireAdmin`. Refresh token
  em **cookie httpOnly** (`@fastify/cookie`), rotacionado em `/auth/refresh`
  (`refresh-token-service`). `request.user.sub` = id do usuário; `request.user.role`.
- **Highlights** — cards do Destaque do Mês são renderizados em PNG e salvos em
  `storage/highlights` (disco), servidos como estáticos sob `/highlights/`.
- **Prisma** — schema único em `apps/api/prisma/schema.prisma`. Models: `User`,
  `RefreshToken`, `Category`, `VotingPeriod`, `Vote`, `Badge`, `UserBadge`,
  `Feedback`, `FeedbackReaction`. **Nunca edite uma migration já aplicada** — gere
  uma nova com `pnpm db:migrate`.

## Arquitetura — frontend (`apps/web`)

- **React Router** (`react-router-dom` 6) + **React Query** (`@tanstack/react-query`).
- `src/pages/*` (telas), `src/components/*` (UI reutilizável), `src/lib/*` (helpers),
  `src/auth/*` (`AuthContext`, `ProtectedRoute`).
- **`src/lib/api.ts`** é o cliente HTTP. Todas as chamadas vão para `/api...`
  (proxy do nginx → Fastify). Padrão de auth: **access token só em memória** (some no
  reload, restaurado por refresh silencioso single-flight); refresh em cookie. Em
  `401`, `apiFetch` tenta refresh uma vez e repete. Só envia `Content-Type: application/json`
  quando há corpo (Fastify rejeita POST/DELETE vazio com esse header).
- **Tailwind** para estilo; personagem pixel-art **LPC** (assets completos do
  gerador em `apps/web/public/lpc` (catálogo gerado em `@legends/shared`,
  `scripts/vendor-lpc.mjs`), créditos obrigatórios em `/lpc/CREDITS.txt`).

### Mobília do escritório (catálogo de assets)

A paleta de mobília do escritório mostra **assets nomeados** (Mesa, Cadeira,
Computador…), não tiles crus. O catálogo é estático em
`packages/shared/src/office-asset-catalog.json` — cada asset mapeia um
`sheet` builtin + região de tiles (`col/row/cols/rows`, iguais nos 3 tamanhos).
Colocado como **grupo atômico** (asset fatiado nasce/arrasta/apaga junto).

**Adicionar assets (dev, pontual):** ver `scripts/curate-office-assets.mjs`.
Fluxo: registre o tileset no tileset-catalog → `node scripts/curate-office-assets.mjs
detect <sheet>` (detecta objetos por pixel, gera contact sheet + rascunho) →
revise o contact sheet e preencha `category/name` no rascunho → `merge <sheet>` →
`pnpm --filter @legends/shared test office-asset-catalog` (valida regiões/ids).
Use só as categorias de `OFFICE_ASSET_CATEGORIES` (canônicas, ordem das abas) — o
teste trava categoria fora dela. Revisão de nomes/categorias por outro modelo:
`node scripts/curate-office-assets.mjs verify all` + `codex exec -i <contact-sheet>`.

## Contrato compartilhado (`packages/shared`)

Tipos de DTO, enums e constantes que **api e web** compartilham vivem aqui
(`src/{auth,vote,badge,feedback,highlight,mural,profile,...}.ts`, barril em `index.ts`).
Ao mudar o formato de um payload, **altere o tipo em `@legends/shared` primeiro** e
ajuste os dois lados — é a única fonte de verdade do contrato. Ex.:
`MIN_JUSTIFICATION_LENGTH`, `FEEDBACK_REACTIONS`, `PublicUser`, `VoteDTO`.

## Testes

- **Vitest**, arquivos `*.test.ts(x)` **colocados ao lado** do código.
- A API testa contra **Postgres real** (banco `legends_test`): `test/global-setup.ts`
  cria o banco e roda `prisma migrate deploy`; `test/setup.ts` **trunca todas as
  tabelas em `beforeEach`**. `fileParallelism: false`. Logo: **o Postgres precisa
  estar de pé** (`pnpm db:up`) para rodar os testes da API.
- Web usa `jsdom` + Testing Library.
- **Escreva/atualize testes** ao mexer em comportamento. Durante a implementação, rode só o(s)
  arquivo(s) de teste do que foi alterado (ex.: `pnpm --filter @legends/web exec vitest run
  src/arquivo.test.ts`) — a suíte completa (`pnpm test`) é lenta e só entra como verificação
  final, antes de concluir/commitar, não a cada iteração.

## Convenções

- TypeScript **strict**, ESM puro (use extensão correta nos imports relativos onde aplicável; `moduleResolution: bundler`).
- Mensagens voltadas ao usuário em **português** (o produto é pt-BR).
- Código novo segue o padrão da camada vizinha (route fina, lógica no service, DTO no serialize).
- Não commitar segredos; `.env` é local (use `.env.example` como base).

## Ferramentas de design (MCP e skills)

Configuradas no repo, para trabalho de frontend:

| O quê | Onde | Para quê |
|---|---|---|
| **shadcn** (MCP) | `.mcp.json` | catálogo de componentes prontos para consultar e adaptar |
| **chrome-devtools** (MCP) | `.mcp.json` | abrir o app num Chrome de verdade: console, rede, performance, screenshot |
| **frontend-design** (skill) | plugin oficial, ligado em `.claude/settings.json` | direção visual: tipografia, paleta, o que não fazer para não sair "cara de IA" |
| **web-design-guidelines** (skill) | `.claude/skills/` | revisar a tela contra as Web Interface Guidelines da Vercel |

Três avisos que se pagam ao usar:

- **Componente de fora não entra como está.** O shadcn vem com Tailwind 4, Radix
  e as variáveis dele (`--background`, `--muted-foreground`). Aqui é Tailwind 3 e
  a paleta é **por empresa**, em tokens Material (`bg-surface`, `text-on-surface`,
  `border-outline-variant`). Traga a estrutura e o comportamento; a cor é sempre
  a nossa. Hex cravado em componente é regressão de white label.
- **O `components.json` da raiz é só para o MCP do shadcn**, que o exige para
  subir. Não instalamos shadcn: `npx shadcn add` escreveria em `components/ui`
  com a config dele. Copie o que interessa para `apps/web/src/components`.
- **Nada de MCP que dependa de chave paga** no `.mcp.json` versionado: ele vale
  para todo mundo que clona o repo, e servidor que exige credencial pessoal
  sobe quebrado para quem não a tem.

## Fluxo de feature (docs/superpowers)

**Antes de escrever a primeira linha de qualquer feature ou correção:**

1. **Confira se alguém já está no assunto.** Liste os PRs do repo (**incluindo
   drafts**) e as branches remotas recentes que toquem os mesmos arquivos. O board
   não é fonte confiável: card em `To Do` sem responsável costuma significar só que
   ninguém moveu o card — PR aberto é o sinal real.
2. **Tire uma branch nova de `origin/main` atualizada:**

```bash
git fetch origin && git switch -c <tipo>/<slug> origin/main
```

Nunca continue em cima da branch da tarefa anterior nem de um `main` local velho. O
projeto anda rápido: partir de uma base defasada custa conflito na hora do merge e,
pior, faz reimplementar algo que já entrou na `main` — dá pra escrever uma feature
inteira que já existe lá, ou duplicar o trabalho de um colega e jogar os dois fora.

Antes de implementar uma feature relevante, há a convenção de registrar um **design
spec** em `docs/superpowers/specs/AAAA-MM-DD-<slug>-design.md` e um **plan** em
`docs/superpowers/plans/AAAA-MM-DD-NN-<slug>.md`. Ao trabalhar numa feature, **leia o
spec/plan correspondente** se existir; ao criar uma nova, siga esse formato. Um spec
sem plan **não** quer dizer que a feature está pendente — confira o código (e a
`main`) antes de assumir que falta implementar.

## Deploy

Imagem Docker **única** (multi-stage): builda api + web, runner roda Fastify (3333)
+ **nginx** (80) servindo o `web` estático e fazendo proxy de `/api/` e `/highlights/`
para a API. Entrega via **AWS CodeDeploy** (`appspec.yml` → `clean.sh` no stop,
`start.sh` no after-install) numa EC2. Branch de deploy: **`main`**.

## Gotchas

- Testes da API falham sem Postgres rodando (`pnpm db:up`). O alvo é sempre o
  Postgres **local** e o banco `legends_test` (cravado em `vitest.config.ts`, não
  lido do `.env` — `test/setup.ts` trunca todas as tabelas a cada teste); só a
  porta do host é configurável, por `LEGENDS_DB_PORT`.
- Teste de web que estoura memória em vez de falhar geralmente é
  render→setState→render: `setState` incondicional num efeito que depende da
  **identidade** de um array/objeto que nasce novo a cada render (props inline em
  `renderHook`, `?? []` no call site, default `= []` na assinatura). Compare antes
  de setar (ver `sameRemotes`/`sameDesks`). O worker tem teto de heap em
  `apps/web/vite.config.ts` justamente para isso falhar em segundos.
- **Caminhada automática do escritório** (Seguir, aceitar chamada, clique
  direito, Ctrl/Cmd+D) é **Dijkstra** em `packages/shared/src/office-pathfinding.ts`,
  sobre uma **grade rasterizada do documento** (`officeWalkGrid`), não sobre
  `document.objects`. A grade é memoizada pela IDENTIDADE do array
  `document.objects` (+ tamanho): mapa novo sempre traz array novo
  (`cloneDocument`, `{...doc, objects}`), então mutar um documento no lugar sem
  trocar o array serviria grade velha. O que o Dijkstra devolve, porém, deixou
  de ser executado como passo: com o movimento livre, o `FollowController`
  persegue os tiles como **waypoints**, esterçando para o centro do próximo
  como se segurasse a tecla (`bridge.emitAutoWalk`) — quem vira isso em
  deslocamento é a mesma amostragem de input do teclado, na cena. Ele esterça
  pela posição **prevista** (`bridge.onSelfBody`, na cadência do input), não
  pelo snapshot: o snapshot chega um round-trip atrasado, e o personagem
  viraria depois da esquina. Corolário: quem termina uma caminhada (chegada,
  falha, `cancel`) tem de **soltar a tecla** — `emitAutoWalk(null)` —, senão
  ele sai andando sozinho. E como o esterço viaja pelo MESMO `input` do teclado,
  o `emitInput` carrega a procedência (`OfficeInputSource`): quem cancela o
  Seguir porque "alguém assumiu o controle" só pode reagir a `keyboard` — reagir
  a `auto` é a caminhada se autocancelando no primeiro quadro (um passo e para).
  O que o cliente **não** tem como prever é a recusa de entrada em sala
  (trancada, lotada, allowlist). Ele descobre por dois caminhos, e os dois
  alimentam `blocked` no recálculo: `room-entry-denied` (preciso, e o único
  aviso de recusa que sobreviveu ao fim do `sync`) e **não sair do lugar** com a
  tecla segurada, que também cobre kart recém-estacionado e tile cujo CENTRO o
  Dijkstra deu por livre mas em que o corpo não cabe.
- `JWT_SECRET` ausente: usa fallback em dev, **lança erro em produção**.
- Front sempre fala com a API por `/api` (nginx proxy) — não cravar `localhost:3333`.
- Avaliação de selos pós-voto é **best-effort** (falha logada, não derruba o voto).
- Períodos de votação ativam/encerram **por data** (janela `startsAt`/`endsAt`), não por ação manual.
