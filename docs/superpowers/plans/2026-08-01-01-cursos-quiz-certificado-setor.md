# Cursos — quiz, certificado com fila e recorte por setor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Somar três capacidades à área de Aprendizado já existente na `main`: recorte por setor, quiz com nota de corte e limite de tentativas, e certificado com modelo configurável e fila de aprovação.

**Architecture:** Adição sobre a implementação existente (`c5d8add1`), não redesenho. Models novos não colidem com os dela; o `Course` ganha três colunas nullable/com default. O recorte por setor entra nos serviços existentes (`learning-service.ts`, `course-admin-service.ts`); quiz e certificado ganham serviços próprios.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, TypeScript ESM strict, Vitest, React 18 + React Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-01-cursos-quiz-certificado-setor-design.md`

## Como este plano é escrito — leia antes de começar

**Este plano especifica contrato, regras e critérios de teste. Ele NÃO traz o corpo das funções.**

Isso é deliberado. Na fatia anterior deste épico, o plano trazia implementações completas, e **quatro** defeitos reais nasceram de blocos de código de exemplo que contradiziam a prosa normativa do mesmo documento e foram copiados literalmente — uma escrita aninhada que furava o isolamento entre empresas, uma ordenação que colidia, uma guarda de reordenação que se deixava enganar, e uma corrida que notificava a empresa inteira duas vezes. Nenhum dos testes que aquele plano prescrevia pegava qualquer um deles.

O que este plano dá como **literal e obrigatório**: definições Prisma, assinaturas exportadas, constantes, tabelas de rota, mensagens de erro voltadas ao usuário, e o comportamento que cada teste precisa provar. O **corpo** das funções e dos componentes é seu — escreva olhando o código vizinho, não este documento.

Onde este plano e o spec divergirem, **o spec governa**. Se algo aqui parecer errado, pare e diga, não contorne.

## Global Constraints

- Base: `origin/main` em `046ca626`. A área de Aprendizado já existe — **leia o código antes de escrever**: `apps/api/src/services/learning-service.ts`, `apps/api/src/services/course-admin-service.ts`, `apps/api/src/routes/learning.ts`, `apps/api/src/routes/courses-admin.ts`, `apps/web/src/pages/admin/CoursesSection.tsx`, `apps/web/src/pages/learning/`.
- **Não redesenhar o que já existe.** `Course.category` continua string, `competencies` continua Json, instrutor continua campo no curso, `published` continua booleano, duração continua derivada da soma das aulas. Anexo de aula está fora (`CourseLessonType` tem só VIDEO e TEXT).
- Convenções da casa nos models novos: `companyId String @default("company-emr")`, índice por empresa, entrada em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`), e **`sortOrder`** para ordenação — não `order` — como `CourseLesson` já usa.
- **Escrita aninhada de relação é proibida.** `{ create: [...] }` dentro do create de outro model não passa pela extensão de tenant (ela intercepta só operação de topo) e carimba `companyId` com o default. Toda escrita é `tx.<model>.create/createMany/update` de topo.
- Toda mutação de admin grava `recordAuditLog` dentro da mesma transação da escrita — o `course-admin-service` já faz isso, siga o padrão dele.
- Erro de domínio na autoria é a classe existente `CourseAdminError` com `status`; a rota faz `instanceof`. Fora de alcance responde **404**, nunca 403.
- Textos ao usuário em **português**.
- Migration nova só via `pnpm db:migrate`; nunca editar migration aplicada.
- Testes Vitest ao lado do código. **Neste worktree o Postgres é dedicado: container `legends-db-walrus`, porta 5452.** Prefixe todo comando de teste da API com `LEGENDS_DB_PORT=5452`. A 5432 é compartilhada com outros worktrees e a 5442 é de outro worktree.
- **Não rode `pnpm test`** (suíte completa) durante a implementação — só os arquivos da task. A suíte inteira entra uma vez, no fim.
- Typecheck com o binário direto (`pnpm --filter <pkg> exec tsc --noEmit -p tsconfig.json`), nunca `npx tsc`.

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/shared/src/course-quiz.ts` | DTOs, schema Zod das opções, constantes do quiz |
| `packages/shared/src/course-certificate.ts` | DTOs de modelo e de solicitação de certificado |
| `apps/api/src/services/course-quiz-service.ts` | Autoria e correção de quiz |
| `apps/api/src/services/certificate-request-service.ts` | Modelos e fila de aprovação |
| `apps/api/src/routes/admin-certificates.ts` | HTTP de modelos e fila |
| `apps/web/src/pages/admin/CourseQuizEditor.tsx` | Editor de quiz (extraído, não inflar `CoursesSection`) |
| `apps/web/src/pages/admin/CertificateTemplatesSection.tsx` | Modelos de certificado |
| `apps/web/src/pages/admin/CertificateRequestsSection.tsx` | Fila de solicitações |
| `apps/web/src/pages/learning/QuizPage.tsx` | Responder quiz e ver resultado |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `apps/api/prisma/schema.prisma` | 3 colunas no `Course`, 5 models novos, 1 enum |
| `apps/api/src/lib/tenant-scope.ts` | 5 nomes novos |
| `apps/api/src/services/learning-service.ts` | Recorte por setor nos 4 sítios de leitura + detalhe + inscrição; desvio no `issueCertificate` |
| `apps/api/src/services/course-admin-service.ts` | Ator na assinatura das 11 funções; escopo de escrita |
| `apps/api/src/routes/courses-admin.ts` | Passar o ator; rotas de quiz |
| `apps/api/src/routes/learning.ts` | Rotas de responder quiz |
| `apps/api/src/lib/certificate-renderer.ts` | Aceitar o modelo (cores, assinatura, logo) |
| `apps/api/src/app.ts` | Registrar `admin-certificates` |
| `packages/shared/src/index.ts` | Reexportar os dois arquivos novos |
| `apps/web/src/pages/admin/CoursesSection.tsx` | Seletor de setor (só ADMIN); entrada para o editor de quiz |
| `apps/web/src/pages/learning/CoursePlayerPage.tsx` | Entrada para o quiz |
| `apps/web/src/App.tsx`, `AdminSidebar.tsx` | Rotas e menu do que for novo |

---

### Task 1: Schema, migration e escopo de tenant

**Files:** `apps/api/prisma/schema.prisma`, `apps/api/src/lib/tenant-scope.ts` · Test: `apps/api/src/lib/tenant-scope.test.ts`

**Produces:** enum `CertificateRequestStatus`; models `CourseQuiz`, `CourseQuestion`, `QuizAttempt`, `CertificateTemplate`, `CertificateRequest`; colunas novas em `Course`.

Uma migration só, para as três capacidades. Nenhuma task posterior mexe em migration.

**Colunas novas em `Course`** — todas nullable ou com default, para não quebrar linha existente:

```prisma
  sectorId                    String?
  requiresCertificateApproval Boolean  @default(false)
  certificateTemplateId       String?
```

mais `sector Sector? @relation("CourseSector", fields: [sectorId], references: [id], onDelete: SetNull)`, `certificateTemplate CertificateTemplate? @relation(fields: [certificateTemplateId], references: [id], onDelete: SetNull)`, e `@@index([companyId, sectorId])`.

**Models novos** — campos exatos no spec, seção "Modelo de dados". Pontos que o spec fixa e que o teste vai cobrar:

- `CourseQuiz.lessonId String? @unique` — nulo é o quiz final do curso. O `@unique` numa coluna nullable aceita vários `NULL` no Postgres, então garante "uma aula, no máximo um quiz" sem impedir que cada curso tenha o seu final. **"Um quiz final por curso" o índice NÃO cobre** — é regra de service (Task 5).
- `QuizAttempt` leva `@@unique([quizId, userId, attemptNumber])`.
- `CertificateRequest` leva `enrollmentId String @unique`.

Relações inversas em `Company`, `User` e `Sector` são obrigatórias — o Prisma recusa o schema sem elas.

- [ ] **Step 1: Teste que falha** — acrescentar ao `describe` existente em `tenant-scope.test.ts` um caso que exige os cinco nomes novos em `TENANT_SCOPED_MODELS`. A constante já é exportada nesta base? Confira; se não for, exporte.
- [ ] **Step 2: Rodar e confirmar RED** — `LEGENDS_DB_PORT=5452 pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.test.ts`
- [ ] **Step 3: Schema** — enum, colunas do `Course`, cinco models, relações inversas.
- [ ] **Step 4: `TENANT_SCOPED_MODELS`** — cinco nomes novos.
- [ ] **Step 5: Migration** — `pnpm db:migrate`, nome `quiz_certificado_setor`. Confira que o SQL só **acrescenta**: nenhuma coluna existente alterada ou removida.
- [ ] **Step 6: GREEN** — mesmo comando do Step 2.
- [ ] **Step 7: Commit** — `feat(api): schema de quiz, modelo de certificado e setor no curso`

---

### Task 2: Contrato compartilhado

**Files:** criar `packages/shared/src/course-quiz.ts` e `course-certificate.ts`; modificar `index.ts` · Test: `packages/shared/src/course-quiz.test.ts`

**Produces, em `course-quiz.ts`:**

- `QUIZ_MIN_PASSING_SCORE = 0`, `QUIZ_MAX_PASSING_SCORE = 100`, `QUIZ_MAX_QUESTIONS = 50`, `QUIZ_MAX_OPTIONS_PER_QUESTION = 6`, `QUIZ_STATEMENT_MAX_LENGTH = 2_000`
- `quizOptionSchema` / `quizOptionsSchema` — Zod, para `[{ id, text, correct }]`. **Exportado do shared** porque api valida na escrita e web valida no formulário.
- `CourseQuizDTO` (com `questionCount`, sem questões), `QuizQuestionForAuthorDTO` (com `correct` e `explanation`), `QuizQuestionForRespondentDTO` (**sem `correct`, sem `explanation`**), `QuizForRespondentDTO`, `QuizAttemptResultDTO` (score, passed, `attemptNumber`, `attemptsLeft`, feedback por questão com `explanation`), tipos de request de autoria.

**Produces, em `course-certificate.ts`:** `CertificateTemplateDTO`, `CertificateRequestDTO` (com `status`, `reviewedBy`, `rejectionReason`), `CERTIFICATE_REQUEST_STATUSES` + labels em pt-BR, e os requests de criar/editar modelo e de aprovar/recusar.

**A separação entre `QuizQuestionForAuthorDTO` e `QuizQuestionForRespondentDTO` é o mecanismo que impede o gabarito de vazar.** Não crie um DTO único com campos opcionais.

- [ ] **Step 1: Teste que falha** — provar que `quizOptionsSchema` recusa lista sem nenhuma opção correta, recusa lista com uma opção só, aceita a forma válida; e que `CERTIFICATE_REQUEST_STATUSES` tem rótulo em português para cada valor.
- [ ] **Step 2: RED** — `pnpm --filter @legends/shared exec vitest run src/course-quiz.test.ts`
- [ ] **Step 3: Implementar** os dois arquivos e reexportar no barril.
- [ ] **Step 4: GREEN** + `pnpm --filter @legends/shared exec tsc --noEmit -p tsconfig.json`
- [ ] **Step 5: Commit** — `feat(shared): contrato de quiz e de certificado com fila`

---

### Task 3: Recorte por setor na leitura

**Files:** `apps/api/src/services/learning-service.ts` · Test: `apps/api/src/services/learning-service.sector.test.ts`

**Esta é a task de maior risco do plano.** O recorte não é um filtro num lugar: `learning-service.ts` filtra `published: true` em **quatro** sítios — `listCourses` (~:148), `myLearning` (~:477), o resumo de obrigatórios (~:500) e `listTracks` (~:546). `getCourseDetail` (~:205) e `enrollInCourse` (~:234) também precisam recusar curso fora do setor. Um sítio esquecido é um vazamento silencioso.

**Regra:** a pessoa enxerga curso com `sectorId` nulo **ou** igual ao `sectorId` dela. Curso fora do alcance responde **404**, nunca 403 — não vaza existência. Extraia o predicado num único lugar e use nos seis; não repita o `OR` seis vezes.

Confirme as linhas por leitura, não pelos números acima — a base pode ter andado.

- [ ] **Step 1: Testes que falham** — um caso por sítio, todos com a mesma montagem: pessoa do setor A, curso publicado do setor B, curso publicado sem setor. Provar: o curso do setor B **não** aparece no catálogo, não aparece em "meus cursos", não conta como obrigatório, não aparece na trilha; `getCourseDetail` responde 404; `enrollInCourse` responde 404. E o curso sem setor aparece nos quatro e abre normalmente.
- [ ] **Step 2: RED** — confirme que **cada** teste falha, não só o primeiro. Se algum passar antes da implementação, ele não está provando nada — conserte-o.
- [ ] **Step 3: Implementar** o predicado e aplicá-lo nos seis pontos.
- [ ] **Step 4: GREEN** — o arquivo novo e também `LEGENDS_DB_PORT=5452 pnpm --filter @legends/api exec vitest run src/services/learning-service.test.ts` (a suíte existente não pode regredir).
- [ ] **Step 5: Teste de preservação** — curso existente tem `sectorId` nulo, logo continua visível para todo mundo. Prove isso com um teste, não com raciocínio: é a garantia de que a feature em produção não muda de comportamento.
- [ ] **Step 6: Commit** — `feat(api): catálogo de aprendizado respeita o setor do curso`

---

### Task 4: Recorte por setor na escrita

**Files:** `apps/api/src/services/course-admin-service.ts`, `apps/api/src/routes/courses-admin.ts` · Test: `apps/api/src/services/course-admin-service.sector.test.ts`

As 11 funções exportadas do `course-admin-service` recebem hoje só `companyId`. Passam a receber o ator.

**Produces:** `interface CourseActor { id: string; role: string; sectorId: string; companyId: string }` e dois predicados **com nomes distintos** — leitura e escrita não podem compartilhar o mesmo, foi exatamente esse compartilhamento que gerou o furo de segurança na fatia anterior.

**Regra:**
- Leitura: SUBADMIN alcança curso do próprio setor **e** curso sem setor.
- Escrita: SUBADMIN alcança **só** curso do próprio setor. Curso criado por ele nasce com o setor dele; `sectorId` pedido para outro setor é ignorado, não recusado.
- ADMIN e SUPER_ADMIN alcançam tudo e escolhem o setor, inclusive nulo.
- Fora de alcance: **404**.

Aplique a regra de escrita a **todas** as funções mutantes, inclusive as de módulo e aula — elas resolvem o curso e escapam se você só cobrir as de curso.

- [ ] **Step 1: Testes que falham** — SUBADMIN **lê** curso da empresa; SUBADMIN recebe 404 ao editar, apagar, publicar esse mesmo curso, e ao criar/editar/apagar módulo e aula dele; curso criado por SUBADMIN nasce no setor dele mesmo pedindo outro; ADMIN escolhe o setor livremente.
- [ ] **Step 2: RED** em todos.
- [ ] **Step 3: Implementar** — ator na assinatura, predicados, propagação nas rotas.
- [ ] **Step 4: GREEN** + a suíte existente de admin de cursos, que não pode regredir.
- [ ] **Step 5: Commit** — `feat(api): SUBADMIN autora curso só do próprio setor`

---

### Task 5: Quiz — autoria

**Files:** criar `apps/api/src/services/course-quiz-service.ts` · Test ao lado

**Produces:** CRUD de quiz (de aula e final) e de questões, com reordenação por `sortOrder`. Escopo do curso vem da Task 4 — reuse, não reimplemente.

**Regras que o teste cobra:**
- Um quiz final por curso — o índice não cobre isso, o service cobre. Segunda tentativa: **409**, *"Este curso já tem um quiz final."*
- Uma aula, no máximo um quiz — aqui o índice cobre; mapeie o `P2002` para 409 com mensagem clara.
- `passingScore` entre 0 e 100; `maxAttempts` nulo ou ≥ 1.
- Questão precisa de ao menos duas opções e ao menos uma correta — valide pelo `quizOptionsSchema` do shared, não por regra escrita à mão aqui.
- Posição de item novo é `max(sortOrder) + 1` dentro do pai. **Não use `count()`**: com item apagado no meio, `count` colide.
- Reordenar exige a lista completa de ids daquele pai. Id faltando, sobrando, **repetido**, ou de outro pai → **400**, *"A ordem enviada não corresponde aos itens atuais. Recarregue a página."* Cuidado: comparar conjuntos deduplicando os ids recebidos deixa passar `[a,a,b,c]`.
- Toda mutação auditada, dentro da transação.

- [ ] **Step 1..5:** teste RED → implementação → GREEN → commit, como nas anteriores. Cubra explicitamente o caso do id repetido na reordenação e o caso de criar quiz depois de apagar uma questão do meio.
- Commit: `feat(api): autoria de quiz de aula e quiz final`

---

### Task 6: Quiz — rotas de autoria

**Files:** `apps/api/src/routes/courses-admin.ts` · Test ao lado

Acrescente ao módulo existente, sob o `gate` que ele já define. Rota fina: Zod `safeParse` → 400 `{ message, issues }` → service → DTO.

| Método | Rota |
| --- | --- |
| POST | `/admin/courses/:id/quizzes` (final, ou de aula via `lessonId` no corpo) |
| GET / PATCH / DELETE | `/admin/course-quizzes/:id` |
| POST | `/admin/course-quizzes/:id/questions` |
| PATCH / DELETE | `/admin/course-questions/:id` |
| PUT | `/admin/course-quizzes/:id/questions/order` |

Os caminhos seguem o estilo já usado por ele (`/admin/course-modules/:id`, `/admin/course-lessons/:id`), não invente outro.

- [ ] Teste RED → implementação → GREEN → commit `feat(api): rotas de autoria de quiz`. Cubra 401 sem token, 403 para LEGEND, 404 para curso fora do setor, 400 com `issues`.

---

### Task 7: Quiz — responder

**Files:** `apps/api/src/services/course-quiz-service.ts` (estender), `apps/api/src/routes/learning.ts` · Test ao lado

**Rotas:** `GET /learning/quizzes/:id` e `POST /learning/quizzes/:id/attempts`, atrás da feature `aprendizado`, exigindo inscrição no curso.

**Regras que o teste cobra:**
- O DTO devolvido a quem responde **não contém `correct` nem `explanation`**. Este é o teste mais importante da task: afirme sobre o JSON serializado, não sobre o objeto do service.
- Correção é no servidor. `attemptNumber` deriva das tentativas anteriores daquela pessoa naquele quiz.
- Acima do limite: **409**, *"Você já usou todas as N tentativas deste quiz."* — com o N real.
- `maxAttempts` nulo é ilimitado.
- `passed` é `score >= passingScore`.
- O resultado devolve o feedback por questão, aí sim com `explanation`.
- Quiz de curso em que a pessoa não está inscrita: **404**.

- [ ] Teste RED → implementação → GREEN → commit `feat(api): responder quiz com nota de corte e limite de tentativas`

---

### Task 8: Certificado — modelos

**Files:** criar `apps/api/src/services/certificate-request-service.ts` e `apps/api/src/routes/admin-certificates.ts`; modificar `apps/api/src/lib/certificate-renderer.ts`, `app.ts` · Test ao lado

CRUD de `CertificateTemplate`, **restrito a ADMIN** (`requireAdmin`, não `requireAdminOrSubadmin`) — modelo de certificado é documento da empresa.

O `certificate-renderer` passa a aceitar o modelo: cores, assinatura e logo vêm dele. **Cadeia de fallback obrigatória:** modelo do curso → modelo `isDefault` da empresa → visual atual embutido. Um certificado emitido antes desta entrega, re-renderizado, precisa sair igual — prove com teste.

Só um modelo `isDefault` por empresa; marcar um novo desmarca o anterior, na mesma transação.

- [ ] Teste RED → implementação → GREEN → commit `feat(api): modelo configurável de certificado`

---

### Task 9: Certificado — fila de aprovação

**Files:** `apps/api/src/services/certificate-request-service.ts` (estender), `apps/api/src/services/learning-service.ts`, `apps/api/src/routes/admin-certificates.ts` · Test ao lado

O desvio entra em `issueCertificate` (`learning-service.ts:350`), **no começo**, sem alterar o caminho de renderizar/salvar/gerar código que já existe.

**Ordem das guardas:**
1. `course.certificateEnabled` falso → nada, como hoje.
2. Inscrição não concluída → nada, como hoje.
3. Curso tem quiz final e a pessoa não passou nele → nada.
4. `course.requiresCertificateApproval` → cria `CertificateRequest` PENDING e devolve `null`. Idempotente pelo `@@unique([enrollmentId])`: chamar de novo não duplica nem quebra.
5. Caso contrário → emite pelo caminho existente.

**Fila:** listar por status, aprovar (emite pelo mesmo caminho e notifica), recusar com motivo obrigatório. Recusar permite nova solicitação depois. Aprovação segue o escopo de setor do curso.

**Notificação de aprovado** é best-effort: falha logada, **não** derruba a aprovação — o repo já usa esse padrão na avaliação de selos pós-voto. E a decisão de emitir precisa ser atômica: duas aprovações simultâneas não podem emitir dois certificados.

- [ ] Teste RED → implementação → GREEN → commit `feat(api): fila de aprovação de certificado`
- Cubra: pendente não emite; aprovar emite; recusar guarda motivo e permite nova; quiz final reprovado não emite; solicitação não duplica.

---

### Task 10: Web — setor no formulário de curso

**Files:** `apps/web/src/pages/admin/CoursesSection.tsx` · Test ao lado

Seletor de setor no formulário, **visível só para ADMIN** (`useAuth()`, padrão de `CategoriesSection.tsx`). SUBADMIN não vê o campo — o servidor força o setor dele de qualquer forma.

Convenções desta base que a fatia anterior aprendeu na marra: consumir a chave de query direto do objeto de chaves, nunca copiar o literal; toda mutation com `onError` mostrando `ApiError.message` num banner `role="alert"`; `mutationFn` embrulhado numa arrow que repassa só `variables` (o React Query 5.101 chama `mutationFn(variables, context)`); texto com nós irmãos envolvido em elemento próprio, senão o `getByText` do RTL não acha.

- [ ] Teste RED → implementação → GREEN → commit `feat(web): seleção de setor do curso para o admin`

---

### Task 11: Web — editor de quiz

**Files:** criar `apps/web/src/pages/admin/CourseQuizEditor.tsx`; modificar `CoursesSection.tsx` · Test ao lado

`CoursesSection.tsx` já tem 24 KB. **Crie o editor em arquivo próprio** e ligue a partir dela; não infle o existente.

Criar quiz final e de aula, questões com opções e marcação da correta, nota de corte, limite de tentativas, reordenação por ↑/↓ (esta base não tem biblioteca de drag-and-drop; botão é testável em jsdom sem simular ponteiro). Cada clique manda a lista **completa** de ids na ordem nova — é o que o service exige.

- [ ] Teste RED → implementação → GREEN → commit `feat(web): editor de quiz no admin de cursos`

---

### Task 12: Web — responder quiz

**Files:** criar `apps/web/src/pages/learning/QuizPage.tsx`; modificar `CoursePlayerPage.tsx`, `App.tsx` · Test ao lado

Responder, enviar, ver resultado com nota, aprovação e explicação por questão. Tentativas restantes visíveis antes de enviar. Esgotado o limite, a mensagem do servidor aparece no banner — não esconda o botão sem explicar.

- [ ] Teste RED → implementação → GREEN → commit `feat(web): responder quiz no player de aula`

---

### Task 13: Web — modelos e fila de certificado

**Files:** criar `CertificateTemplatesSection.tsx` e `CertificateRequestsSection.tsx`; modificar `App.tsx`, `AdminSidebar.tsx` · Test ao lado

Modelos só para ADMIN — use o mesmo mecanismo de restrição que o `AdminSidebar` já usa para itens `adminOnly`. Fila para ADMIN e SUBADMIN, escopada pelo servidor.

Na fila: filtro por status, aprovar, recusar com motivo obrigatório (botão desabilitado sem motivo).

**Sobre a ordem das rotas:** não escreva teste alegando que a ordem de declaração decide entre caminho literal e paramétrico. No React Router 6 não decide — segmento estático pontua acima de dinâmico e a ordem só desempata quando a pontuação empata. Um teste desses passa dos dois jeitos e não prova nada.

- [ ] Teste RED → implementação → GREEN → commit `feat(web): modelos e fila de certificado`

---

## Fechamento

Depois da Task 13, rode a suíte inteira **uma vez** com `LEGENDS_DB_PORT=5452 pnpm test`, e o typecheck dos três workspaces. Só então abra o PR.

**Avise o autor da área de Aprendizado antes do PR.** A Task 4 muda a assinatura de 11 funções do `course-admin-service.ts` dele, e a Task 3 muda o comportamento do catálogo em produção. Nenhuma das duas quebra o que existe — curso sem setor continua visível para todos, e para ADMIN nada muda —, mas ele merece saber antes de encontrar na revisão.

## Cobertura do spec

| Seção do spec | Task |
| --- | --- |
| Modelo de dados (3 colunas, 5 models, 1 enum) | 1 |
| Contrato | 2 |
| Recorte por setor — leitura (6 pontos) | 3 |
| Recorte por setor — escrita (ator, 11 funções) | 4 |
| Quiz — autoria | 5, 6 |
| Quiz — resposta, gabarito protegido, tentativas | 7 |
| Certificado — modelo e fallback de renderização | 8 |
| Certificado — fila, guardas de emissão, notificação | 9 |
| Front | 10–13 |
