# Desenvolvimento — visão do colaborador (Aprendizado, PDI e Avaliações)

PBI [#22238](https://dev.azure.com/EuMedicoResidente/Legends/_workitems/edit/22238) ·
Origem: portal EMR (aba Desenvolvimento do menu do colaborador).

## Problema

O Legends reconhece o que **já aconteceu** — voto, selo, feedback, Destaque do Mês.
Não tem nada sobre **para onde a pessoa está indo**. A conversa de carreira acontece
fora da plataforma e não deixa rastro: o combinado do 1:1 vive num documento solto,
a evidência de que a pessoa aplicou o que aprendeu se perde, e o líder não tem como
validar nada. A Quinta de Desenvolvimento é agenda de evento, não trilha de aprendizado.

## Entrega

Três frentes, independentes entre si:

1. **Aprendizado** — a pessoa encontra cursos e trilhas, se inscreve, assiste, tem o
   progresso salvo, avalia e recebe certificado.
2. **Meu PDI** — a pessoa monta o plano do ciclo com ações, acompanha o progresso e
   conclui cada ação com evidência e reflexão; o líder aprova ou pede ajustes; a
   vitrine do perfil respeita a visibilidade escolhida.
3. **Avaliações e Pesquisas** — atalho externo para o ImpulseUP no menu.

## Modelo de dados

### Aprendizado

`Course`, `CourseModule`, `CourseLesson`, `CourseEnrollment`, `LessonProgress`,
`CourseFavorite` (`@@id([userId, courseId])`), `CourseRating`
(`@@unique([userId, courseId])`, nota 1–5), `LearningTrack`, `LearningTrackCourse`
(`@@unique([trackId, courseId])`, com `sortOrder`) e `Certificate`.

O PBI previa que o schema de curso viesse do irmão **#22272 (Central de Cursos)**.
Como o #22272 ainda não entrou na `main`, os models de curso **nascem aqui** — no
recorte mínimo que a visão do colaborador consome (sem CMS, sem fila de solicitação,
sem analytics de autoria). Quando o #22272 entrar, ele **estende** estes models em
vez de criar outros.

**Decisões deliberadas:**

- **Nada de contador denormalizado.** `average_rating`, `total_ratings` e
  `total_students` do portal viravam desync na primeira falha. Aqui os três são
  agregados por consulta (`groupBy`) na hora de montar o card.
- **Progresso do curso é derivado**: `LessonProgress ÷ total de aulas`, calculado no
  service. `CourseEnrollment` **não tem** coluna `progressPct` — só `status` e
  `completedAt`, que são fato, não cache. `LessonProgress` tem
  `@@unique([userId, lessonId])` e a marcação é idempotente.
- **`Certificate` tem `@@unique([userId, courseId])`**: reconcluir o curso devolve o
  mesmo certificado, com o mesmo código. `code` é `@unique` global porque a
  verificação pública busca só por ele.

### PDI

`PdiPlan`, `PdiAction`, `PdiActionEvidence`, `PdiActionHistory`.

- **Enums em inglês maiúsculo + rótulo pt-BR no shared** (padrão de `MoodLevel`/
  `FeedbackCategory`), e não as strings acentuadas em português que o portal gravava
  no banco (`'Não Iniciado'`, `'Desafio Prático'`).
- `PdiAction.progressPct` é **informado pela pessoa** (slider). É diferente do
  progresso do curso, que é derivado — os dois **não** foram unificados de propósito.
- A exigência de aprovação do líder vai em **`AppSetting`** (`pdi_leader_approval_required`,
  por empresa), não numa tabela de linha única como o `pdi_settings` do portal.
- A visibilidade da vitrine é uma coluna do próprio `User`
  (`pdiShowcaseVisibility`, default `TEAM`) — é preferência da pessoa, não do plano.

## Autorização (regra de negócio, não de tela)

O portal resolvia parte disso no cliente. Aqui vive no service, e cada combinação
tem teste:

| Quem | Pode |
| --- | --- |
| Dono do plano | Ler e escrever tudo |
| Líder do plano (`leaderId`) | **Ler** o plano e **validar** as ações — nunca editar |
| Qualquer outra pessoa | 403 no plano, 403 na ação, plano some da listagem |
| Outra empresa | 404 (nem confirma a existência) |

Vitrine do perfil, conforme a visibilidade escolhida: `ALL` (empresa inteira),
`TEAM` (mesmo setor, mais o líder), `LEADER` (só o líder), `PRIVATE` (só a pessoa).

**Quem pode ser o líder de um plano** segue o organograma: alguém do **mesmo setor**
com papel **acima** na hierarquia `LEGEND → LEAD → MANAGER → HEAD`
(`rolesAboveInHierarchy`, em `@legends/shared`). Lenda escolhe entre Líder, Gerente e
Head; Líder entre Gerente e Head; Gerente só Head; Head não tem ninguém acima e cria
o plano sem validação. Inativo e quem já saiu ficam de fora.

A lista sai de `GET /pdi/leaders`, mas a regra **não é só de tela**: `createPlan` e
`updatePlan` recusam (400) um `leaderId` fora dessa lista — sem isso um POST direto
elegeria qualquer pessoa da empresa como validadora do próprio PDI.

**Admin não tem bypass de leitura de PDI.** Evidência e reflexão são dado sensível;
o admin configura a empresa (`/admin/desenvolvimento`), não lê o plano de ninguém.

## Evidências

Upload pelo presign (`POST /pdi/evidences/presign`), prefixo próprio no bucket
(`pdi-evidences/<companyId>/…`, fora da base pública). O banco guarda **`storageKey`,
nunca a URL**; o download sai por URL assinada de 5 min, emitida só depois que o
service decidiu que quem pediu pode ler a ação. Excluir a ação (ou o plano) apaga os
objetos junto.

## Certificado

PNG renderizado com resvg (`lib/certificate-renderer.ts`, SVG puro e testável) e
guardado no S3 (`lib/certificate-storage.ts`), mesmo caminho do card do Destaque.
O código é público (`EMR-XXXXXXXX`) e verificável em `GET /learning/certificates/code/:code`
+ página `/certificado/:code`, **sem login** — é o link que a pessoa compartilha no
LinkedIn. A geração da imagem é **best-effort**: sem S3 configurado, o certificado
existe e é verificável; só não tem PNG para baixar.

## Selos (integração com o engajamento existente)

A área de Desenvolvimento não cria um sistema de reconhecimento próprio: entra no
de selos que já existe, com dois `BadgeKind` novos — **`COURSE`** (cursos concluídos)
e **`PDI`** (ações de PDI concluídas). Os dois seguem o modelo de `threshold` dos
selos de `FEEDBACK`/`TENURE`/`STREAK`, então o admin cria e ajusta faixas pela tela
de selos de sempre, sem código novo.

- A concessão é **sincronizada, não cumulativa**: `syncThresholdBadges` concede o que
  passou a qualificar e revoga o que deixou de qualificar. A contagem pode cair
  (aula desmarcada, ação devolvida pelo líder), e o selo reflete o estado atual.
  Concessão **MANUAL nunca é tocada** — igual ao comportamento de FEEDBACK.
- **PDI só conta ação em `DONE`.** Com validação do líder ligada, o selo espera a
  aprovação: concluir e ficar na fila não concede nada. Quem ganha o selo é o **dono
  do plano**, nunca quem validou.
- Os gatilhos são **best-effort**, no mesmo padrão da avaliação de selos pós-voto:
  falha ao avaliar ou ao notificar não desfaz a aula marcada nem a decisão do líder.
- A galeria de selos ganha requisito legível (“Conclua 3 cursos”) e barra de
  progresso pelos mesmos `buildRequirement`/`computeProgress`.

## Feature gate

Chaves `aprendizado` e `pdi` em `FEATURE_KEYS`, independentes entre si. A migration
`20260731213000_enable_development_features` habilita as duas em todo setor (a área
vale para a empresa inteira); terceirizados ficam de fora do backfill — PDI é dado
sensível e a allowlist do `THIRD_PARTY` é individual.

O item **Avaliações (ImpulseUP)** não tem feature própria: aparece no menu quando a
empresa tem `impulseup_url` em `AppSetting`, como `<a target="_blank" rel="noopener noreferrer">`.

## Autoria de curso (entrou depois)

O recorte original mandava a autoria para o PBI #22272. Como o #22272 não entrou na
`main` e sem ele não há como cadastrar um curso (nem o link do vídeo da aula), a
**autoria mínima entrou aqui**, a pedido: criar curso, montar módulos e aulas
(com link de vídeo) e publicar, em `/admin/cursos`.

- Curso **nasce em rascunho** e publicar **exige ao menos uma aula** — evita catálogo
  com curso vazio.
- `slug` é gerado do título, único por empresa (sufixo `-2`, `-3`… na colisão).
- **A duração do curso é derivada** da soma das aulas — não existe campo “duração
  total” para digitar, pelo mesmo motivo de nota média e nº de alunos serem agregados.
  A coluna `Course.durationMinutes` foi removida (migration `20260801110000`).
- Não entra aqui o que é de fato do #22272: modelos de certificado, fila de
  solicitações, analytics de autoria, quiz e importação em massa.

O link do vídeo é guardado **como a pessoa colou** (`youtube.com/watch?v=…`,
`youtu.be/…`, `vimeo.com/…`); a conversão para a forma embutível é do player, via
`toVideoEmbedUrl` em `@legends/shared` — a página `/watch` do YouTube recusa iframe,
então sem essa normalização o vídeo não abriria. O formulário do admin mostra a
pré-visualização já convertida.

## Fora deste recorte

- **Autoria avançada de curso** (modelos de certificado, fila de solicitações,
  analytics, quiz) — segue no PBI **#22272**.
- **MentorIA** — depende de `AgentConversation`/`AgentMessage` do PBI **#22281**, que
  ainda não entrou. Sem os models, o painel não tem onde guardar histórico. Fica para
  quando o #22281 aterrissar; o player já tem o espaço lateral previsto no layout.
- **Quiz** (`course_quizzes`/`course_questions`/`quiz_attempts`) — a autoria da
  pergunta é do #22272; sem CMS não há quiz para responder.
- **PDF da avaliação de desempenho como contexto de IA** — deliberadamente fora, como
  o próprio PBI pede. É o dado mais sensível do lote. Se um dia entrar: processar em
  memória, **nunca** persistir o arquivo nem o texto extraído.
- SCORM/xAPI, aula ao vivo, importação de dados do ImpulseUP e ciclo de avaliação de
  desempenho dentro do Legends.
