# Cursos — quiz, certificado com fila e recorte por setor — Design Spec

- **Data:** 2026-08-01
- **Autor:** waghnerreis
- **Status:** aprovado
- **Base:** `origin/main` em `046ca626`, sobre a área de Aprendizado entregue em `c5d8add1`

## Resumo

A área de **Aprendizado** já existe na `main` (catálogo, inscrição, player com progresso,
avaliação, favoritos, trilhas, certificado em PNG com código verificável, autoria em
`/admin/cursos`). Esta entrega **soma três coisas que ela não faz**, sem redesenhar nada
do que já está lá:

1. **Recorte por setor** — hoje todo curso é da empresa inteira.
2. **Quiz** — inexistente.
3. **Certificado com modelo configurável e fila de aprovação** — hoje a emissão é
   automática, controlada por um booleano.

## O que esta entrega deliberadamente NÃO toca

A implementação existente decidiu, e as decisões ficam:

- `Course.category` é **string livre**; `Course.competencies` é **Json** (array de
  strings); instrutor são os campos `instructorName`/`instructorBio` no próprio curso.
  Transformar isso em entidades geridas migra dado e reescreve telas — é proposta para o
  autor da feature, não commit lateral.
- `Course.published` é **booleano**, não máquina de estados.
- A duração do curso é **derivada da soma das aulas**, com comentário explícito no schema
  explicando por quê. Não introduzir total digitado.
- `CourseLessonType` tem só `VIDEO` e `TEXT`. Anexo fica fora.

## Decisões

- **O quiz final condiciona o certificado, não a conclusão da aula.** Acoplar quiz à
  conclusão exigiria alterar `setLessonCompletion` (`learning-service.ts:261`), que é onde
  a emissão de certificado já mora — mudar aquilo é alterar comportamento da feature
  existente. Quiz de aula é formativo: registra tentativa, não bloqueia. Custo aceito: uma
  pessoa pode concluir todas as aulas sem acertar nada; o quiz final é o que barra o
  certificado quando o curso o exige.
- **`Course.sectorId` nullable**, no mesmo desenho do resto do repo: nulo é curso da
  empresa, preenchido restringe ao setor. Uma coluna, sem tabela de junção.
- **O ator entra na assinatura do `course-admin-service`.** As 11 funções recebem hoje só
  `companyId`. Escopo por setor exige saber quem age, então passam a receber um
  `CourseActor { id, role, sectorId, companyId }`. É refactor de assinatura, não de
  comportamento: para ADMIN nada muda.
- **`CertificateRequest` é uma por inscrição** (`@@unique([enrollmentId])`), espelhando o
  `@@unique([userId, courseId])` que `CourseEnrollment` já tem.
- **A emissão continua sendo a existente.** `issueCertificate` ganha um desvio no começo;
  o caminho de renderizar, salvar e gerar o `code` público não muda. Certificado aprovado
  reusa exatamente o mesmo fluxo.
- **Modelo de certificado é só de ADMIN** — documento da empresa, `requireAdmin`.
- **A fila é de ADMIN e de SUBADMIN**, com o SUBADMIN restrito ao próprio setor, tanto para
  ver quanto para aprovar. Listar mais do que se pode aprovar produziria uma fila cujas
  linhas dão 404 ao clicar — foi a assimetria leitura/escrita que já causou furo nesta
  mesma épico. *(Este item dizia "fila e modelos são de ADMIN"; contradizia o próprio spec,
  que dá escopo de setor à aprovação, e foi decidido pelo dono do projeto em 02/08/2026.)*

## Modelo de dados

Nenhum model novo colide com os existentes. Convenções da casa: `companyId` com default,
índice por empresa, entrada em `TENANT_SCOPED_MODELS`, e `sortOrder` (não `order`) para
ordenação, como `CourseLesson` já usa.

### Alterações em models existentes

- **`Course`** ganha três colunas nullable/com default: `sectorId String?`,
  `requiresCertificateApproval Boolean @default(false)`, `certificateTemplateId String?`.
  Índice novo `@@index([companyId, sectorId])`. Nenhuma coluna existente muda.

### Models novos

- **`CourseQuiz`** — `courseId`, `lessonId String? @unique` (nulo = quiz final do curso;
  preenchido = quiz daquela aula), `title`, `passingScore Int @default(70)`,
  `maxAttempts Int?` (nulo = ilimitado). O `@unique` numa coluna nullable aceita vários
  `NULL` no Postgres, então garante "uma aula, no máximo um quiz" sem impedir que cada
  curso tenha o seu final. **"Um quiz final por curso" não é coberto pelo índice** — fica
  como regra de service, com teste.
- **`CourseQuestion`** — `quizId`, `statement`, `options Json`, `explanation String?`,
  `sortOrder`. As opções são `[{ id, text, correct }]`, validadas por schema Zod exportado
  do `@legends/shared`. O gabarito **nunca** sai no DTO de leitura de quem responde.
- **`QuizAttempt`** — `quizId`, `userId`, `attemptNumber`, `score`, `passed`,
  `answers Json`. `@@unique([quizId, userId, attemptNumber])`.
- **`CertificateTemplate`** — `name`, `title`, `backgroundUrl?`, `accentColor`,
  `signatureName`, `signatureRole`, `signatureImageUrl?`, `logoUrl?`, `isDefault`.
- **`CertificateRequest`** — `enrollmentId @unique`, `userId`, `courseId`, `status`
  (`PENDING | APPROVED | REJECTED`), `reviewedById?`, `reviewedAt?`, `rejectionReason?`.

Enum novo: `CertificateRequestStatus`.

## Recorte por setor — onde exatamente

O ponto de risco não é o model, é a quantidade de lugares que leem catálogo. O
`learning-service.ts` filtra `published: true` em **quatro** sítios — linhas 148
(`listCourses`), 477 (`myLearning`), 500 (obrigatórios do resumo) e 546 (`listTracks`).
**Cada um** precisa do mesmo recorte, ou o curso de setor vaza por ali. `getCourseDetail`
(`:205`) e `enrollInCourse` (`:234`) também precisam recusar curso fora do setor — com
404, nunca 403.

Regra: a pessoa enxerga curso com `sectorId` nulo ou igual ao seu. Na autoria, SUBADMIN lê
o próprio setor e os da empresa, mas **escreve** só no próprio; ADMIN escolhe o setor.

## Quiz — fluxo

**Autoria** (ADMIN/SUBADMIN, escopado pelo curso): criar quiz de aula ou final, com nota
de corte e limite de tentativas; CRUD de questões com reordenação por `sortOrder`.

**Resposta** (pessoa inscrita, atrás da feature `aprendizado`): `GET` do quiz devolve
enunciado e opções **sem `correct`**; `POST` de tentativa corrige no servidor, grava
`QuizAttempt` com `attemptNumber` derivado das tentativas anteriores, e devolve
`score`, `passed` e o feedback por questão (incluindo `explanation`). Tentativa acima do
limite é recusada com mensagem clara — *"Você já usou todas as N tentativas deste quiz."*

## Certificado — fluxo

Concluir a última aula continua fechando a inscrição como hoje. Em seguida
`issueCertificate` decide:

- curso com `requiresCertificateApproval` → cria `CertificateRequest` PENDING (idempotente
  pelo `@@unique([enrollmentId])`) e **não** emite;
- curso com quiz final e sem aprovação aprovada do quiz → não emite;
- caso contrário → emite como hoje.

G&G vê a fila, aprova ou recusa com motivo. Aprovar emite pelo caminho existente e
notifica. Recusar guarda o motivo e permite nova solicitação depois.

O `CertificateTemplate` alimenta o `certificate-renderer` existente: cores, assinatura e
logo passam a vir do modelo escolhido no curso, com fallback no `isDefault` da empresa e,
na ausência dele, no visual atual — **nenhum certificado já emitido muda**.

## API

- **`routes/learning.ts`** (existente) ganha as rotas de quiz do lado de quem responde.
- **`routes/courses-admin.ts`** (existente) ganha autoria de quiz e questões.
- **`routes/admin-certificates.ts`** (novo) — modelos de certificado e a fila.
- Services novos: `course-quiz-service.ts`, `certificate-request-service.ts`. O
  `course-admin-service.ts` e o `learning-service.ts` existentes recebem o recorte por
  setor.

Erro de domínio segue a classe existente `CourseAdminError` no lado de autoria; o lado de
consumo segue o padrão do `learning-service`. Toda mutação de admin grava
`recordAuditLog`, como o `course-admin-service` já faz.

## Front

- `apps/web/src/pages/admin/CoursesSection.tsx` (existente, 24 KB) ganha a aba/seção de
  quiz do curso. **Se crescer demais, extrair o editor de quiz para arquivo próprio no
  mesmo diretório** em vez de inflar o arquivo.
- `apps/web/src/pages/learning/CoursePlayerPage.tsx` (existente) ganha a tela de responder
  quiz e ver resultado.
- Telas novas de admin: modelos de certificado e fila de solicitações.
- Seletor de setor no formulário de curso, visível só para ADMIN.

## Testes

Vitest ao lado do código. A API roda contra Postgres real; **neste worktree, container
dedicado `legends-db-walrus` na porta 5452** (`LEGENDS_DB_PORT=5452`) — os worktrees
compartilham o `legends-db` da 5432 e se atrapalham.

Casos que precisam de teste nomeado:

1. Curso de um setor não aparece no catálogo de pessoa de outro setor — nos **quatro**
   sítios de leitura, não só no principal.
2. SUBADMIN lê curso da empresa mas recebe 404 ao editar, publicar ou apagar.
3. Tentativa de quiz acima do limite é recusada; abaixo da nota de corte não aprova.
4. O DTO do quiz entregue a quem responde não contém o gabarito.
5. Um quiz final por curso.
6. Certificado não sai enquanto a solicitação está pendente, e sai após o aceite.
7. Recusar guarda o motivo e permite nova solicitação.
8. Nenhum dado cruza empresas em nenhum dos models novos.

## Riscos

- **O recorte por setor altera comportamento de uma feature em produção.** Cursos hoje
  visíveis para todos passam a depender de `sectorId` — que nasce nulo em todos os cursos
  existentes, então o comportamento atual é preservado por construção. Vale confirmar isso
  no seed e num teste.
- **Assinatura das 11 funções do `course-admin-service` muda.** Refactor mecânico, mas
  toca código de outra pessoa; convém avisar antes do PR.
- O `CoursesSection.tsx` já tem 24 KB. Acrescentar quiz sem extrair vai deixá-lo grande
  demais para trabalhar com segurança.
