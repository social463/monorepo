# Comunidade INOVA — experiência completa (Início, Projetos rico, Criar projeto expandido, Recursos, Como usar)

Data: 2026-09-04

## Contexto

O spec `2026-08-20-...` (na verdade `2026-09-03-comunidade-inova-nativa-design.md`) trouxe o **núcleo funcional** do INOVA — projetos, kanban, diário, tarefas, atividade. Ao testar manualmente, ficou claro que a experiência real do projeto original (fonte: `codigo-fonte-inova-emr.zip`) é bem mais rica do que o que foi entregue: uma landing page institucional ("Início"), navegação interna por abas, um painel de ranking por setor ("Evolução das Áreas"), cards de projeto mais informativos, um formulário de criação com 12 campos + checklist de elegibilidade, e duas páginas de conteúdo (Recursos, Como usar).

Este spec cobre essa segunda leva. **Fora de escopo, deliberadamente**: o módulo "Guia AI First" do projeto original — um subsistema à parte (10 subpáginas, wizard interativo, biblioteca de conteúdo própria) do tamanho do módulo de projetos inteiro. Decisão do usuário: tratar como iniciativa própria depois, com seu próprio brainstorming/spec/plano.

Todo o conteúdo textual abaixo foi extraído literalmente do código-fonte do zip (não é resumo/paráfrase) — é conteúdo institucional hardcoded no projeto original, sem vir de banco de dados.

## Mudança de modelo de dados

`InovaProject.priority` e `InovaProject.leadershipChallenge` foram modelados como `String?` livre na primeira leva. O original trata os dois como **booleano**: `priority` é um toggle (ícone de chama no card, "Prioridade" quando ativo) e "Projeto Desafio Alta Liderança?" é um select Sim/Não no formulário. Migração: os dois campos passam a `Boolean @default(false)`. Sem dado real em produção ainda (feature recém-mesclada), a migração pode alterar o tipo diretamente.

## Navegação interna do módulo

Hoje `/comunidade-inova` é uma rota única (o kanban). Ela vira um **layout com sub-navegação em abas** (`InovaLayout`, `<Outlet/>` + tira de abas no topo, mesmo componente em todas as sub-rotas), com 5 abas: **Início** (`/comunidade-inova`), **Projetos** (`/comunidade-inova/projetos`), **Criar projeto** (`/comunidade-inova/novo` — só visível para quem pode administrar), **Recursos** (`/comunidade-inova/recursos`), **Como usar** (`/comunidade-inova/como-usar`). As rotas de detalhe/edição de projeto (`/comunidade-inova/projetos/:id`, `/comunidade-inova/projetos/:id/editar`) ficam fora do layout de abas (não fazem sentido com a tira de navegação institucional por cima — o usuário está dentro de um projeto específico).

Isso muda os paths existentes: `/comunidade-inova/novo` → mantém; `/comunidade-inova/:id` → vira `/comunidade-inova/projetos/:id`; `/comunidade-inova/:id/editar` → vira `/comunidade-inova/projetos/:id/editar`. O kanban (hoje em `ComunidadeInovaPage.tsx`, direto em `/comunidade-inova`) muda de rota para `/comunidade-inova/projetos`, e `/comunidade-inova` passa a ser a nova página "Início".

## 1. Início (`InovaHomePage.tsx`)

Seções, na ordem, com o texto literal do original:

**Hero** — logo INOVA (`/inova/inova-emr-logo.png`), H1 "Transformando ideias em impacto real", subtítulo "Aqui, cada projeto nasce com propósito e evolui para gerar transformação real. Usamos **Inteligência Artificial** como alavanca para inovar com método, colaboração e excelência.", botão "Explorar projetos da comunidade" → `/comunidade-inova/projetos`, botão "Tirar minha ideia do papel" → `/comunidade-inova/novo`.

**Cultura** — badge "Cultura", título "O que o INOVA tem a ver com a nossa cultura?", subtítulo "O INOVA é onde nossa cultura deixa de ser discurso e vira prática." Duas colunas:
- "Nossa cultura diz que:" — Valorizamos colaboração; Tomamos decisões com base em dados; Buscamos excelência em cada entrega; Incentivamos inovação contínua; Esperamos autonomia e protagonismo das pessoas.
- "O INOVA transforma isso em ação:" — Ideias viram melhorias reais; Testamos soluções em pequena escala; Compartilhamos aprendizados com o time; Evoluímos com base em evidências; Pessoas assumem protagonismo nas mudanças.

Card de destaque: "No INOVA, cada pessoa deixa de apenas executar e passa a contribuir ativamente para a evolução da EMR." Fechamento em itálico: "Cultura forte não se comunica apenas, se constrói no dia a dia."

**Comitê de IA** — badge "Governança", título "Comitê de IA", subtítulo "Como transformamos iniciativas em decisões estratégicas". Fluxo de 6 passos: Times/Setores ("Iniciativas surgem dos times") → Encontro de Alinhamento ("Compartilhamento entre áreas") → Consolidação de insights ("Resumo das oportunidades") → Comitê Executivo ("Avaliação e priorização") → Decisões estratégicas ("Definição do que escalar") → Direcionamento para os times ("Retorno às áreas com clareza"). Duas colunas de lista:
- "Encontro de Alinhamento": Representantes de cada área compartilham projetos; Visibilidade do que está acontecendo na empresa; Identificação de oportunidades de colaboração; Redução de retrabalho entre times; Geração de um resumo consolidado.
- "Comitê Executivo": Avaliação dos projetos levantados; Priorização de iniciativas; Direcionamento de investimentos; Abertura de novas frentes.

Citação: "O Comitê de IA conecta o que está sendo feito com o que realmente deve escalar."

**Memórias** — badge "Memórias", título "O caminho que já percorremos", subtítulo "Cada edição é um passo na nossa evolução. Relembre os momentos que marcaram o INOVA 2025." Dois banners (grid 2 colunas, imagens em `apps/web/public/inova/`): `inova-2025-linkedin.png` (alt "Ganhadores INOVA EMR 2025") e `festival-inova.jpg` (alt "Festival INOVA EMR 2025"). Sem lightbox nesta leva (simplificação aceitável — o original abre um modal de imagem ampliada; aqui os banners abrem a imagem em nova aba via link, suficiente para o conteúdo).

**Impacto** — título "Inovação que gera resultado de verdade", subtítulo "Cada área com pelo menos **2 projetos estratégicos** com IA até **junho de 2026**, porque evoluir com propósito é evoluir juntos." 4 cards: Mais eficiência, menos retrabalho; Experiências que fazem diferença; Recursos bem aplicados; Novas formas de gerar valor.

**Jornada de transformação** — título "Sua jornada de transformação", subtítulo "Cada etapa é uma oportunidade de crescer, aprender e gerar impacto." 4 passos numerados 01-04: Faça parte da Comunidade ("Conecte-se com outros protagonistas e comece sua jornada de transformação."); Aprenda e colabore ("Troque experiências no Teams, aprenda com o time e fortaleça suas ideias."); Tire ideias do papel ("Desenvolva seu projeto com propósito, método e suporte contínuo da comunidade."); Mostre seu impacto ("Apresente seus resultados no evento INOVA e inspire toda a organização.").

**Card "Projetos de Impacto"** — "🏆 Projetos de Impacto INOVA EMR" — "As iniciativas que chegam à etapa final passam por um processo de avaliação e podem ser premiadas por seu impacto e evolução com propósito."

**CTAs finais** — dois cards lado a lado:
- "Quer tirar uma ideia do papel?" — "Se você tem uma ideia, mas ainda não sabe por onde começar, a gente te ajuda. Fale com o time de **Gente & Gestão** para entender como transformar sua ideia em um projeto real." Card de contato "Mariana Venancio" / "Analista de T&D, EMR". "Não precisa ter tudo pronto. O importante é começar, e aqui ninguém constrói sozinho." Botão "Falar no Teams" → mesmo link de Teams do card de contato de suporte já existente (reaproveita `inovaTeamsWebhookUrl`? Não — este é um link de **conversa pessoal** fixo do original, não o webhook de notificação. Decisão: hardcoded como link institucional, igual ao resto do conteúdo desta página, não como config por empresa — é conteúdo estático da página, não uma integração).
- "O futuro da EMR é construído por você." — "Assuma o protagonismo. Lance seu projeto e faça parte da transformação." Botão "Começar agora" → `/comunidade-inova/novo`.

## 2. Projetos (`InovaBoardPage.tsx`, renomeado de `ComunidadeInovaPage.tsx`, rota `/comunidade-inova/projetos`)

**Evolução das Áreas** — painel acima do kanban. Cálculo **client-side**, a partir da lista de projetos já carregada (sem endpoint novo): para cada setor, soma os pontos de fase (`PHASE_POINTS`) de todos os projetos não arquivados daquele setor, e conta quantos projetos. `PHASE_POINTS`: IDEA=1, EXPLORING_SOLUTION=2, TESTING_SOLUTION=3, ROUTINE_USE=4, EXPANDING=5, COMPLETED=6 — vai para `packages/shared/src/inova.ts` como constante exportada (`INOVA_PHASE_POINTS`), ao lado de `INOVA_PROJECT_PHASES`. Top 3 setores em destaque (medalhas 🥇🥈🥉, barra de progresso relativa ao maior); os demais em lista simples. Link "Como funciona?" abre um texto explicativo simples (tooltip ou parágrafo abaixo do painel — sem página `/ranking` própria nesta leva, é overkill para uma explicação de fórmula).

**Card de projeto enriquecido** — emoji de categoria (mapa fixo `INOVA_CATEGORY_ICONS` em `@legends/shared`: Automação de processos ⚡, Experiência do cliente 💬, Análise de dados 📊, Marketing/conteúdo 📢, Educação/ensino 🎓, Produtividade interna 🚀, Outro 💡 — mesma lista de sugestão que já existia como `INOVA_SUGGESTED_SECTORS` faz para setor, aqui para categoria), botão de prioridade (chama, toggle direto no card via `PATCH` — precisa de endpoint novo `PATCH /inova/projects/:id/priority`), título, descrição truncada (2 linhas), resultado (se houver, 1 linha), setor, responsáveis, badge de fase.

**Filtros** — mantém "Ver arquivados" (já existe no backend via `listInovaProjects({archived})`) e adiciona "Só prioridade" (filtra client-side por `priority === true`, já que a lista inteira já está carregada).

> **Adendo (2026-09-12).** Este recorte deixou de fora o painel de **Filtros** do
> app original (botão que abre Setor, Categoria, Fase, Responsável e Desafio Alta
> Liderança, mais "Limpar filtros"), e a falta foi sentida em produção. Ele voltou
> em `ComunidadeInovaPage.tsx`: mesmos cinco recortes, persistidos em
> `sessionStorage` — a volta do detalhe do projeto é o caminho mais comum do
> kanban, e perder o recorte a cada ida e volta era o que mais incomodava. As
> opções de setor e categoria saem dos projetos carregados, e não de constante:
> os dois são texto livre no backend, então lista fixa esconderia valor digitado
> fora do catálogo. Responsável filtra por id de usuário e casa com os DOIS
> responsáveis, não só com o primeiro da dupla.

## 3. Criar projeto (`InovaProjectFormPage.tsx`, expandido)

**Bloco de critérios** (só no modo criação) — título "Critérios para cadastrar um projeto no INOVA", subtítulo "Antes de cadastrar, confira se o seu projeto atende aos requisitos abaixo:". 4 critérios: "O projeto precisa utilizar Inteligência Artificial" / "A solução deve envolver o uso de IA, como automações inteligentes, análise de dados, agentes, chatbots ou outras aplicações de inteligência artificial."; "O projeto deve automatizar ou melhorar um processo do setor" / "O objetivo é resolver um problema real do dia a dia, seja na sua função ou em alguma atividade da equipe."; "Máximo de duas pessoas responsáveis pelo projeto" / "Cada projeto pode ter até dois responsáveis, que serão os donos da iniciativa e responsáveis por atualizar o andamento."; "Para apresentar no evento INOVA o projeto precisa estar na fase final" / 'Somente projetos que chegarem na etapa "Expandindo para Mais Pessoas" poderão ser apresentados no evento de encerramento do INOVA.' Checkbox obrigatório: "Li e entendi os critérios para cadastro de projetos no INOVA" — desabilita o submit até marcado.

**Campos** (aba única nesta leva — sem abas "Dados Básicos"/"Fase"/"Impacto" separadas, é uma simplificação aceitável: tudo num formulário só, mais direto):
1. Título do Projeto * — texto
2. Setor * — combobox com sugestão (já existe)
3. Responsável pelo Projeto * — texto livre (sem combobox de colaborador nesta leva — o Legends não tem um seletor de colaborador reutilizável pronto para isso fora do fluxo de squads; texto livre é suficiente e já é o que existe hoje)
4. Responsável 2 (opcional) — texto livre
5. Representante do setor (opcional) — texto livre
6. Categoria * — combobox com sugestão (`INOVA_CATEGORY_ICONS` como fonte da lista)
7. Projeto Desafio Alta Liderança? * — select Sim/Não (boolean, default Não)
8. Descrição do Projeto * — textarea (sem editor rico nesta leva — o Legends não tem um rich-text-editor genérico fora do feed corporativo; textarea simples é consistente com o resto do form)
9. Qual problema ou operação este projeto resolve? * — textarea
10. Qual o prazo para finalizar o projeto? (estimado) * — texto livre (não é um campo de data no original — é texto livre tipo "30/06/2026 ou 3 meses"; mantém como texto, **não** usa o campo `deadline: DateTime` do schema para isso — `deadline` no schema já existe como Date real, mas o campo do formulário original é texto livre de prazo estimado. Decisão: mapear para `deadline` mesmo assim seria forçar um texto livre num campo Date — ao invés disso, este campo de texto livre vai para... não há campo equivalente no schema atual. Resolução: adicionar `estimatedDeadline: String?` ao schema, campo novo, distinto do `deadline: DateTime?` que já existe (esse continua existindo mas sem uso nesta leva do formulário — é para uma eventual functionality futura de data real).
11. Quais ferramentas você está usando ou usou? * — textarea (mapeia para `toolsUsed`, já existe)
12. Quais custos o projeto tem/teve? (estimado) * — textarea (mapeia para `projectCosts`, já existe)

**Validação** — sequencial, client-side, mensagens específicas por campo (replicando o original): critérios não aceitos → "Você precisa aceitar os critérios para cadastrar o projeto."; título/setor/descrição vazios → "Preencha todos os campos obrigatórios."; responsável 1 vazio → "Selecione um responsável para o projeto." (ajustado: "Informe um responsável para o projeto."); problema vazio → "Este campo é obrigatório para continuar. Descreva qual problema o projeto resolve."; prazo vazio → "Informe o prazo estimado para finalizar o projeto."; ferramentas vazio → "Informe quais ferramentas você está usando ou usou."; custos vazio → "Informe os custos estimados do projeto."

**Pós-cadastro** — modal de sucesso na primeira vez (controlado por `localStorage`, chave `inova_onboarding_seen`): "Projeto cadastrado com sucesso! 🚀", corpo com o texto do original, botões "Como usar a Plataforma INOVA" → `/comunidade-inova/como-usar` e "Ir para os projetos" → `/comunidade-inova/projetos`.

## 4. Recursos (`InovaResourcesPage.tsx`, rota `/comunidade-inova/recursos`)

Título "Recursos para evoluir", subtítulo "Ferramentas, conhecimento e pessoas para fortalecer sua jornada de inovação". 4 cards: "Mentorias da Viver de IA" (texto do original); "Cursos e trilhas" (texto do original); "Comunidade de protagonistas" (texto do original); "Trilha AI First, Impulse UP" (texto do original, botão "Acessar" → link real do Impulse UP da EMR, mesmo do zip). CTA final "Aprendizado contínuo é parte do nosso DNA" → botão "Acessar Viver de IA" → link real do Viver de IA da EMR, mesmo do zip.

Os dois links externos (Impulse UP, Viver de IA) são **hardcoded nesta página**, não config por empresa — são conteúdo institucional específico da EMR, igual ao resto do texto da página, não uma integração White Label.

## 5. Como usar (`InovaHowToPage.tsx`, rota `/comunidade-inova/como-usar`)

Título "Como participar da transformação", subtítulo "Um guia simples para você usar o site da Comunidade INOVA". Seções, com o texto literal do original: vídeo institucional (o original embute um YouTube — aqui, **sem vídeo** nesta leva, é conteúdo de terceiro específico da EMR que não temos direito/necessidade de replicar; a seção de texto ao redor do vídeo permanece, só o embed sai); "Como tirar sua ideia do papel" (5 passos); "Como evoluir seu projeto" (4 passos); "Registre sua jornada no diário" (4 passos); "Organize a execução com o Kanban" (5 passos); "Como acompanhamos a evolução" (3 blocos); "Boas práticas para gerar impacto" (4 itens).

## Fora de escopo (confirmado)

- Módulo "Guia AI First" inteiro (10 subpáginas, wizard, biblioteca de conteúdo) — iniciativa própria futura.
- Editor de texto rico nos campos de descrição/problema/ferramentas/custos — textarea simples.
- Combobox de colaborador para responsáveis — texto livre.
- Lightbox de imagem ampliada nos banners de Memórias.
- Vídeo institucional embutido em Como usar.
- Página `/ranking` própria explicando a fórmula de pontos — fica como texto inline.
- Aba "Impacto" do formulário de edição (Resultados Obtidos/Horas Economizadas/Redução de Custo/Outros Indicadores) — os campos já existem no schema (`results`, `hoursSaved`, `costReduction`, `otherMetrics`) mas ficam sem UI nesta leva; podem entrar numa leva futura de "editar impacto do projeto".
- **Medalhas/barra de progresso/explicação da fórmula em "Evolução das Áreas".** A seção original descrevia top-3 em destaque com medalhas 🥇🥈🥉, barra de progresso relativa ao líder, e um link "Como funciona?" explicando a fórmula de pontos. O que foi implementado (revisão final da leva) é uma lista simples de `setor — N proj · N pts`, sem destaque visual nem explicação — o cálculo (soma de `INOVA_PHASE_POINTS` por setor, só projetos não arquivados) está correto, só a apresentação foi simplificada. Registrado aqui como decisão explícita, não como lacuna descoberta depois: a versão rica pode entrar numa leva futura, junto com a aba "Impacto" acima.
