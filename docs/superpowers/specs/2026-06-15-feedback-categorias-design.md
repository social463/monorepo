# Categorias de Feedback — Design

Data: 2026-06-15

## Objetivo

Adicionar categorias ao feedback e controlar a visibilidade conforme a categoria.

Categorias: **Positivo**, **Orientação**, **Elogio**, **Melhoria**.

Regra de visibilidade:
- **Positivo** e **Elogio** → visíveis para todos os usuários autenticados.
- **Orientação** e **Melhoria** → visíveis somente para o **autor** do feedback, o **alvo** (destinatário) e **ADMIN**.

## Decisões

- ADMIN enxerga todos os feedbacks privados de qualquer par autor/alvo.
- Feedbacks já existentes (sem categoria) viram **POSITIVO** na migração (continuam públicos).
- Categoria é **obrigatória** na criação, **sem** valor pré-selecionado no formulário.
- Sem filtro por categoria na listagem nesta versão (YAGNI).

## 1. Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`

Novo enum:

```prisma
enum FeedbackCategory {
  POSITIVO
  ORIENTACAO
  ELOGIO
  MELHORIA
}
```

Alteração no model `Feedback` (linhas 163-176):

```prisma
model Feedback {
  id         String           @id @default(cuid())
  authorId   String
  targetId   String
  message    String
  category   FeedbackCategory
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  author User @relation("FeedbacksGiven", fields: [authorId], references: [id])
  target User @relation("FeedbacksReceived", fields: [targetId], references: [id])

  @@index([targetId])
  @@index([authorId])
  @@index([targetId, category])
}
```

### Migração

A coluna `category` é obrigatória (NOT NULL) e já existem linhas na tabela. A migração:

1. Adiciona a coluna com `DEFAULT 'POSITIVO'` para preencher as linhas existentes.
2. Remove o default na sequência (a aplicação sempre fornece categoria explícita via validação Zod).

O índice `@@index([targetId, category])` apoia a query de visibilidade.

## 2. Regra de visibilidade (backend)

A filtragem acontece na **query do banco**, não no frontend. Assim feedbacks privados nunca trafegam para quem não pode vê-los e a paginação (offset/limit + hasMore) permanece correta.

### Constante compartilhada

Em `packages/shared` definir o conjunto de categorias públicas, reutilizado no backend:

```ts
export const PUBLIC_FEEDBACK_CATEGORIES = ['POSITIVO', 'ELOGIO'] as const
```

### Serviço

Arquivo: `apps/api/src/services/feedback-service.ts`

`listFeedbacksForUser` passa a receber o viewer (`{ id, role }`):

```ts
export function listFeedbacksForUser(
  targetId: string,
  viewer: { id: string; role: string },
  pagination: { offset?: number; limit?: number } = {},
): Promise<FeedbackWithAuthor[]> {
  const canSeeAll = viewer.id === targetId || viewer.role === 'ADMIN'
  return prisma.feedback.findMany({
    where: {
      targetId,
      ...(canSeeAll
        ? {}
        : {
            OR: [
              { category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] } },
              { authorId: viewer.id }, // autor vê o próprio privado mesmo não sendo o alvo
            ],
          }),
    },
    include: feedbackInclude,
    orderBy: { createdAt: 'desc' },
    skip: pagination.offset ?? 0,
    take: (pagination.limit ?? 10) + 1,
  })
}
```

Resumo:
- **Positivo / Elogio** → todos veem.
- **Orientação / Melhoria** → somente autor, alvo e ADMIN.

### Criação

`createFeedback` passa a exigir `category: FeedbackCategory`. A validação acontece via Zod `enum` na rota (`feedbackBodySchema`) e o serviço persiste o valor.

### Rota

Arquivo: `apps/api/src/routes/feedback.ts`

`GET /users/:id/feedbacks` passa `request.user` (sub → id, role) para `listFeedbacksForUser`.

## 3. DTO / shared

Arquivo: `packages/shared/src/feedback.ts`

```ts
export type FeedbackCategory = 'POSITIVO' | 'ORIENTACAO' | 'ELOGIO' | 'MELHORIA'

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  POSITIVO: 'Positivo',
  ORIENTACAO: 'Orientação',
  ELOGIO: 'Elogio',
  MELHORIA: 'Melhoria',
}

export const PUBLIC_FEEDBACK_CATEGORIES = ['POSITIVO', 'ELOGIO'] as const

export interface FeedbackDTO {
  id: string
  author: PublicUser
  message: string
  category: FeedbackCategory
  createdAt: string
  updatedAt: string
}

export interface CreateFeedbackRequest {
  message: string
  category: FeedbackCategory
}

// Edição continua alterando apenas a mensagem (categoria fora de escopo no PATCH).
export interface UpdateFeedbackRequest {
  message: string
}
```

Serialização (`apps/api/src/lib/serialize.ts`, `toFeedbackDTO`) inclui `category`.

## 4. Frontend

Arquivo: `apps/web/src/pages/profile/FeedbackSection.tsx`

- **Formulário de criação:** seletor de categoria com as 4 opções, **nenhuma** pré-selecionada. O botão de envio só habilita quando há categoria escolhida **e** a mensagem é válida (`>= MIN_FEEDBACK_FIELD_LENGTH`). O corpo enviado passa a ser `{ message, category }`.
- **Listagem:** cada feedback exibe um **badge** com o label da categoria (cor distinta por tipo). Categorias privadas (Orientação/Melhoria) recebem um indicador visual de restrito (ícone de cadeado) para sinalizar que nem todos veem.
- A query de listagem no front **não muda** — o backend já devolve apenas o que o viewer pode ver.

### Cores dos badges (proposta)

- Positivo → verde
- Elogio → âmbar/amarelo
- Orientação → azul (+ cadeado)
- Melhoria → roxo (+ cadeado)

(Ajustar aos tokens existentes do design system Tailwind do projeto.)

## 5. Testes

### Backend (`apps/api/src/routes/feedback.test.ts`)

- Criar feedback exige `category` válida → 201 com a categoria persistida.
- `category` ausente ou inválida → 400.
- Feedback privado (Orientação/Melhoria) **não** aparece para um terceiro autenticado.
- Feedback privado **aparece** para o autor, para o alvo e para ADMIN.
- Feedback público (Positivo/Elogio) aparece para qualquer um.
- Paginação/`hasMore` continua correta com o filtro de visibilidade aplicado.

### Frontend (`apps/web/src/pages/profile/FeedbackSection.test.tsx`)

- Seletor de categoria renderiza as 4 opções sem seleção inicial.
- Envio bloqueado enquanto não houver categoria escolhida.
- Envio inclui `category` no corpo.
- Badge da categoria aparece em cada feedback listado.

## Fora de escopo

- Filtro/aba por categoria na listagem.
- Permitir alterar categoria na edição (PATCH) — manter como está; reavaliar depois se necessário. (Decisão: o PATCH continua editando apenas a mensagem por ora.)
