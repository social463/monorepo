# Mural de Feedbacks — 2ª rodada de ajustes da G&G — Design Spec

- **Data:** 2026-08-17
- **Autor:** lucca.secco
- **Status:** implementado

## Resumo

Item 3.2 do documento do Portal EMR. O que existe hoje é a página
**"Feedbacks entre colegas"** (`/mural-feedbacks`): formulário no topo, lista de
feedbacks compartilhados embaixo, um destinatário por feedback, categoria única
vinda de um enum de 4 valores, e compartilhamento decidido por **quem recebeu**.

A entrega fecha seis lacunas:

1. **Nome e formato** — vira "Mural de Feedbacks", em **abas**
   (Mural · Enviar · Recebidos · Enviados); o mural é o conteúdo principal e o
   envio sai da frente.
2. **Busca e filtro** — busca por colega, categoria ou trecho, e filtro por
   competência.
3. **Interação** — reação (já existe) e **comentário** (novo), visível para
   todos que enxergam o feedback.
4. **Feedback grupal** — um feedback para N pessoas.
5. **Categorias de reconhecimento** — catálogo de 13 competências
   **administrável pela G&G**, seleção múltipla, mais categoria personalizada.
6. **Público/privado na origem** — o toggle "Tornar público no mural" passa a
   ser de **quem escreve**, no envio.

E ajusta o XP: **+10 por feedback enviado, até 3 por semana**.

## Decisões

### 1. Grupal é UM feedback com N destinatários, não N feedbacks

Decisão do time (opção "b"). `FeedbackRecipient` pendura os destinatários no
feedback; o card mostra "para Ana, Bruno e mais 2" e a conversa (reações e
comentários) fica **uma só** — que é o ponto de reconhecer um time junto. N
linhas independentes dariam N conversas paralelas sobre o mesmo texto.

O preço é que "Recebidos" deixa de ser `where targetId = eu` e passa a ser
`where recipients.some(userId = eu)`. Para o resto do sistema não quebrar,
`Feedback.targetId` **continua existindo** como o destinatário principal (é
`NOT NULL` e está em `@@index([targetId, category])`, no perfil, na Quinta de
Dev e na avaliação de selos). A migration faz o backfill inserindo **uma linha
de `FeedbackRecipient` por feedback existente**, e o destinatário principal
entra na tabela **junto com os demais** — duplicação deliberada, para toda
leitura de "quem recebeu" ter um caminho só.

### 2. O catálogo de competências é administrável, e o enum antigo fica

Decisão do time. Model novo `RecognitionCategory` (nome, ordem, ativo, empresa)
com CRUD em **Administração › Reconhecimento**, no padrão de `Category` (a de
votação). As 13 competências do documento entram como **seed**, não como
constante cravada.

O enum `FeedbackCategory` (POSITIVO/ORIENTACAO/ELOGIO/MELHORIA) **não é
removido**: ele carrega a Quinta de Dev, o filtro do perfil e — o que mais
importa — a regra de visibilidade atual (`PUBLIC_FEEDBACK_CATEGORIES`). Tirá-lo
agora seria trocar duas coisas ao mesmo tempo. Feedback novo nasce com
`category: 'ELOGIO'` (reconhecimento) e carrega as competências de verdade em
`FeedbackRecognitionCategory` + `customCategory`.

### 3. Público/privado passa a ser do autor, e `sharedAt` é a coluna

Hoje quem compartilha é **quem recebeu** (`POST /feedbacks/:id/share`, guard
`existing.targetId !== userId`). O documento inverte: quem escreve marca
"Tornar público no mural" no envio.

Sem coluna nova: `sharedAt` já significa "está no mural", então o envio público
grava `sharedAt: now()` na criação. O que muda é **quem pode mexer**: o autor
(no envio e depois), e a rota de compartilhar continua valendo para o
destinatário — feedback antigo, recebido em privado, segue podendo ser
publicado por quem o recebeu. Duas portas para a mesma coluna, com dono
diferente, é intencional e está testado.

`canViewFeedback` ganha o caso do documento: feedback **não público** é visível
para autor, **destinatários** e ADMIN/G&G — ninguém mais.

### 4. Comentário de feedback reusa o desenho do mural corporativo

`FeedbackComment` é o mesmo formato de `CorporatePostComment` (autor, texto,
`createdAt`), sem anexo e sem menção: o pedido é "a resposta fica visível para
todos", não uma segunda timeline. Quem enxerga o feedback enxerga os
comentários — a checagem é a mesma `canViewFeedback`, então não há caminho
paralelo de visibilidade para manter em dia.

### 5. Busca é no servidor, não filtro no cliente

O mural pagina por offset (`FEEDBACK_WALL_PAGE_SIZE`). Filtrar no cliente
esconderia resultado que está na página 3 e faria a busca mentir. Então `q` e
`categoryId` entram como query da rota do mural, e o `where` do Prisma resolve:
`q` bate em nome do autor, nome de destinatário, texto e nome de competência
(`mode: 'insensitive'`), `categoryId` bate na competência.

### 6. XP: +10 com teto semanal, sem código novo

`XpRule` já tem `capWindow: WEEK` e `capAmount`. O pedido "até 3 ganhos por
semana" é `amount: 10, capWindow: WEEK, capAmount: 30` no evento
`FEEDBACK_PUBLISHED` que já existe — muda o **default do seed**, não o motor. A
mensagem de "você já bateu o limite da semana" sai do `status: CAP_REACHED` que
`awardXp` já devolve.

Feedback grupal paga **uma vez**, não uma por destinatário: a referência do
dedupe é o id do feedback, e reconhecer quatro pessoas de uma vez não vale
quatro vezes mais.

### 7. "Escrever com IA" reusa o caminho do Feed Corporativo

Mesmo mecanismo do comunicado (`resolveAiCredentials` + `requestAgentCompletion`
+ prompt próprio em `lib/feedback-prompt.ts`), com o contexto certo: nome de
quem vai receber, competências escolhidas e um rascunho opcional. Sem chave
cadastrada pela empresa, 503 tratado.

## Modelo de dados (Prisma)

```prisma
model RecognitionCategory {          // catálogo administrável da G&G
  id        String  @id @default(cuid())
  name      String
  order     Int     @default(0)
  active    Boolean @default(true)
  companyId String  @default("company-emr")
  @@unique([companyId, name])
}

model FeedbackRecipient {            // N destinatários por feedback
  feedbackId String
  userId     String
  @@unique([feedbackId, userId])
}

model FeedbackRecognitionCategory {  // N competências por feedback
  feedbackId String
  categoryId String
  @@unique([feedbackId, categoryId])
}

model FeedbackComment {              // resposta pública ao feedback
  id         String @id @default(cuid())
  feedbackId String
  authorId   String
  message    String
}
```

`Feedback` ganha `customCategory String?`. Os quatro models novos entram em
`TENANT_SCOPED_MODELS`.

## Contrato (`packages/shared`)

- `recognition.ts` — `RecognitionCategoryDTO`, `RECOGNITION_CATEGORY_SEED` (as
  13 do documento, usadas pelo seed), `MAX_FEEDBACK_RECIPIENTS`,
  `MAX_RECOGNITION_CATEGORIES_PER_FEEDBACK`, `CUSTOM_CATEGORY_MAX_LENGTH`.
- `feedback.ts` — `SharedFeedbackDTO` ganha `targets: PublicUser[]`,
  `categories: RecognitionCategoryRef[]`, `customCategory`, `commentCount`;
  `CreateFeedbackRequest` ganha `targetIds`, `categoryIds`, `customCategory`,
  `isPublic`; DTO e request de comentário.

## Backend

- `feedback-service`: `createFeedback` com N destinatários, competências e
  `sharedAt` na origem; `listSharedFeedbacks` com busca e filtro;
  `listSentFeedbacks` (aba Enviados); comentários; `canViewFeedback` pelo
  público/privado.
- `recognition-category-service`: CRUD da G&G, com auditoria.
- Rotas: `GET/POST /feedbacks/:id/comments`, `DELETE /feedbacks/comments/:id`,
  `GET /recognition-categories`, CRUD em `/admin/recognition-categories`,
  `POST /feedbacks/ai/generate`, e `GET /feedbacks/mural?q=&categoryId=`.

## Frontend

- `MuralFeedbacksPage` em abas (Mural · Enviar · Recebidos · Enviados), com a
  busca e o filtro na aba Mural.
- `NewFeedbackForm`: múltiplos destinatários (com filtro por setor),
  multi-seleção de competências, categoria personalizada, toggle de público,
  emoji e "Escrever com IA" — copy oficial do documento, ao pé da letra.
- `SharedFeedbackCard`: "para Ana, Bruno e mais 2", chips de competência,
  reações e comentários.
- `admin/RecognitionCategoriesSection`: CRUD do catálogo.

## Testes

- Shared: guards e limites.
- API: grupal cria N destinatários e paga XP uma vez; teto semanal barra o 4º;
  privado some do mural e do perfil de terceiro (mas não do de quem recebeu);
  busca e filtro; comentário herda a visibilidade do feedback; CRUD do catálogo
  com auditoria.
- Web: abas trocam de conteúdo; envio grupal manda `targetIds`; busca dispara
  query no servidor; card mostra "e mais N".

## O que a implementação acrescentou ao desenho

- **Backfill dentro da migration.** Cada feedback que já existe ganha a linha de
  `FeedbackRecipient` do destinatário que ele já tinha. Sem isso, "Recebidos"
  precisaria de um `OR targetId = :eu` que alguém teria de lembrar em toda
  consulta nova — e esqueceria.
- **`FeedbackComment` entrou no `test/setup.ts`** (junto de recipients,
  competências e catálogo). Tabela nova fora da limpeza vaza estado entre
  testes; foi assim que a fila do catálogo apareceu com três itens "do nada".
- **`lib/feedback-error.ts`** — a classe de erro saiu do service, pelo mesmo
  motivo de `corporate-mural-error.ts`: o prompt da IA precisa lançá-la.
- **Duas portas para `sharedAt`.** O autor decide no envio; quem recebeu
  continua podendo publicar depois. A segunda porta é o que salva os feedbacks
  antigos, recebidos em privado antes de o toggle existir.
- **Rename do bloco da Home.** "Feedbacks entre colegas" virou "Mural de
  Feedbacks" também na prévia da Home — a página e o bloco mostram a mesma
  coisa, e dois nomes para o mesmo lugar é o que o item 3.2 pede para acabar.
- **A aba Enviar some para ADMIN/SUBADMIN**, porque a API já recusa feedback de
  administrador com 403. Mostrar o formulário para eles seria oferecer um botão
  que só produz erro.

## Fora de escopo

Reação em comentário, edição de comentário, notificação por e-mail/Teams do
feedback, e a migração do enum `FeedbackCategory` para o catálogo novo.
