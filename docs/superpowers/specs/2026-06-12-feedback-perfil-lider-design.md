# Área de feedback (SCI) no perfil do líder

Data: 2026-06-12

## Contexto

Hoje, no perfil (`ProfilePage`), o corpo de reconhecimento — galeria de selos,
histórico de reconhecimento (votos) e categorias reconhecidas — fica totalmente
oculto para usuários com role `LEAD`, porque lideranças não recebem votos
(ver `apps/web/src/pages/ProfilePage.tsx`, bloco `{!isLead && …}`).

Consequência: os selos atribuídos manualmente a um líder nunca aparecem no perfil
dele, e não há nenhum espaço de reconhecimento para lideranças.

## Objetivo

O perfil do LEAD passa a usar o **mesmo layout do dev**, com duas adaptações:

1. A **galeria de selos** aparece normalmente (selos conquistados, em geral manuais).
2. A coluna que no dev é "Histórico de reconhecimento" (baseada em votos) vira,
   no líder, uma **Área de feedbacks** no formato SCI (Situação · Comportamento ·
   Impacto): feedbacks guiados, públicos, identificados, que podem ser deixados a
   qualquer momento, independente de período de votação.

## Regras de negócio

- **Quem escreve:** qualquer usuário autenticado, exceto ADMIN. Não pode dar
  feedback a si mesmo (autor ≠ alvo).
- **Quem vê:** público — qualquer pessoa que abre o perfil do alvo.
- **Autoria:** identificada (nome + avatar do autor).
- **Formato:** três campos guiados — situação, comportamento, impacto — todos
  obrigatórios, cada um com mínimo de caracteres (espelha
  `MIN_JUSTIFICATION_LENGTH = 10`).
- **Frequência:** vários feedbacks por autor, sem limite, independente de período.
- **Editar/excluir:** o autor edita e exclui os próprios feedbacks; ADMIN pode
  excluir qualquer feedback (moderação). ADMIN não cria feedback.
- **Alvo:** o backend aceita feedback para qualquer usuário (exceto self/autor-admin).
  A UI exibe a área de feedback apenas em perfis LEAD nesta entrega; os perfis de
  DEV ganharão a área depois.

## Arquitetura

### Backend

**Prisma — novo model `Feedback`** (`apps/api/prisma/schema.prisma`):

```prisma
model Feedback {
  id         String   @id @default(cuid())
  authorId   String
  targetId   String
  situation  String
  behavior   String
  impact     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  author User @relation("FeedbacksGiven", fields: [authorId], references: [id])
  target User @relation("FeedbacksReceived", fields: [targetId], references: [id])

  @@index([targetId])
  @@index([authorId])
}
```

Adicionar em `User`:
```prisma
feedbacksGiven    Feedback[] @relation("FeedbacksGiven")
feedbacksReceived Feedback[] @relation("FeedbacksReceived")
```

+ migration correspondente.

Os campos `authorId`/`createdAt` deixam o gancho pronto para um futuro selo
automático por quantidade de feedback dado (fora de escopo).

**Service** (`apps/api/src/services/feedback-service.ts`): funções para listar
(por alvo, ordenado por `createdAt` desc, incluindo `author`), criar, atualizar e
excluir, com as regras de autorização acima.

**Rotas** (`apps/api/src/routes/feedback.ts`), todas com `app.authenticate`:

- `GET /users/:id/feedbacks` → `{ feedbacks: FeedbackDTO[] }`. Qualquer logado.
- `POST /users/:id/feedbacks` → cria. Guardas: autor ≠ ADMIN (403), autor ≠ alvo
  (400/403), alvo existe (404). Body validado: situação/comportamento/impacto não
  vazios e ≥ `MIN_FEEDBACK_FIELD_LENGTH`.
- `PATCH /feedbacks/:id` → edita. Só o autor (403 caso contrário). Mesma validação.
- `DELETE /feedbacks/:id` → exclui. Autor **ou** ADMIN (403 caso contrário).

Registrar `feedbackRoutes` junto das demais rotas (onde `profileRoutes` é registrada).

**Shared** (`packages/shared/src/feedback.ts`, exportado por `index.ts`):

```ts
export const MIN_FEEDBACK_FIELD_LENGTH = 10

export interface FeedbackDTO {
  id: string
  author: PublicUser        // reusa o componente Avatar
  situation: string
  behavior: string
  impact: string
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  situation: string
  behavior: string
  impact: string
}

export type UpdateFeedbackRequest = CreateFeedbackRequest
```

**Serialização** (`apps/api/src/lib/serialize.ts`): `toFeedbackDTO` (author via
`toPublicUser`).

### Frontend

**`ProfilePage`** (`apps/web/src/pages/ProfilePage.tsx`):

- **Hero:** identidade segue largura total (`col-span-12`) para LEAD — sem card
  lateral de resumo. Sem mudança no hero do LEAD.
- **Bento (LEAD):** novo bloco em `grid grid-cols-12` exibido **apenas para LEAD**:
  - **Galeria de selos** (`lg:col-span-5`) — selos conquistados, reusando a
    apresentação atual da galeria (emblema + nome, descrição no `title`).
  - **Área de feedbacks** (`lg:col-span-7`) — componente `FeedbackSection`.
- O bento atual baseado em votos (`{!isLead && …}`) permanece inalterado para
  DEV/ADMIN. Não há barra "Categorias reconhecidas" no LEAD (é vote-based).

**Novo componente isolado `FeedbackSection`**
(`apps/web/src/pages/profile/FeedbackSection.tsx` ou `components/`), recebendo
`targetId` e o usuário autenticado. Responsabilidades:

- Query `["feedbacks", targetId]` via `GET /users/:id/feedbacks`.
- Formulário SCI guiado (3 campos rotulados: Situação / Comportamento / Impacto)
  para criar feedback — exibido para quem pode escrever (logado, não-ADMIN,
  não é o próprio perfil). Validação de campo obrigatório + mínimo de caracteres.
- Lista de feedbacks: autor (avatar + nome), data, e os três campos SCI.
- Controles: editar/excluir nos feedbacks do próprio autor; excluir nos demais se
  o usuário for ADMIN.
- Mutations create/edit/delete invalidando a query, seguindo o padrão de
  `MemberBadgesPanel` em `apps/web/src/pages/admin/BadgesSection.tsx`.

A contagem de feedbacks, se exibida, deriva do tamanho da lista (sem alterar
`ProfileDTO`).

## Tratamento de erros

- API retorna 400 (validação), 403 (autorização: ADMIN escrevendo, não-autor
  editando, não-autor/não-admin excluindo, self-feedback), 404 (alvo/feedback
  inexistente). Mensagens em pt-BR, no padrão das rotas existentes.
- No front, erros de mutation exibidos inline (padrão `ApiError` + `Icon name="error"`),
  como em `MemberBadgesPanel`.

## Testes

- **API `feedback.test.ts`:** criar com SCI válido; rejeitar campos vazios/curtos;
  bloquear autor ADMIN; bloquear self-feedback; 404 alvo inexistente; listar
  ordenado desc com autor; editar só pelo autor (403 para outro); excluir pelo
  autor e por ADMIN (403 para terceiro não-admin).
- **Web:** atualizar o teste do perfil LEAD em `ProfilePage.test.tsx` — galeria de
  selos e área de feedback agora **presentes** para LEAD (hoje o teste afirma a
  ausência de "Galeria de selos"); incluir um selo manual e afirmar que aparece.
  Novo teste de `FeedbackSection`: validação do formulário, render da lista com
  autor/SCI, e visibilidade dos controles de editar/excluir (próprio vs. ADMIN vs.
  terceiro).

## Fora de escopo (futuro)

- Selo automático por quantidade de feedback dado (novo `BadgeKind FEEDBACK`):
  apenas o gancho de dados (autor/data) fica pronto; lógica e concessão em spec
  separada.
- Área de feedback no perfil dos DEVs (o backend já aceita; falta surfacear na UI).
