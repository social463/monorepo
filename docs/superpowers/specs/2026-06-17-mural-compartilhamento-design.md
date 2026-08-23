# Mural do time — compartilhar feedback e exibir selos

Data: 2026-06-17

## Objetivo

Permitir que uma pessoa **compartilhe** um feedback que recebeu e exibir, num
**banner com carrossel** no topo da página Time (`/time`), um **mural global do
time** com os feedbacks compartilhados e os selos conquistados recentemente.
Reforça a cultura de reconhecimento dando visibilidade coletiva às conquistas.

## Decisões (definidas no brainstorming)

- **Onde aparece:** topo de `/time` (acima do header "Time"). É a tela comum a
  todos os papéis, inclusive ADMIN. Não há página "home" dedicada hoje (`/`
  redireciona para o perfil do DEV/LEAD ou para `/admin`).
- **O que pode ser compartilhado:** apenas feedbacks de categoria pública
  (`POSITIVO`, `ELOGIO`). `ORIENTACAO` e `MELHORIA` continuam privados e nunca
  vão ao mural — a regra de privacidade atual fica intacta.
- **Quem compartilha:** somente o **alvo** (`targetId`) do feedback. Reversível
  (pode descompartilhar).
- **Selos:** entram no mural **automaticamente** ao serem conquistados; não há
  ação de compartilhar selo.
- **Escopo:** **mural global** — todos veem os mesmos itens do time inteiro.
- **Janela:** **últimos 30 dias**, ordenado do mais recente primeiro. Se vazio,
  o banner não é renderizado.

## Abordagem escolhida

Campo `sharedAt DateTime?` no modelo `Feedback`:

- `null` = não compartilhado; preenchido = compartilhado.
- Serve como marca **e** como critério de ordenação (quem compartilha agora
  sobe no mural).
- Reversível (volta a `null` ao descompartilhar).

Alternativas descartadas:

- **Tabela `SharedItem` polimórfica:** estrutura nova sem ganho — selos já
  entram automático e feedback é o único tipo opt-in (YAGNI).
- **Booleano `shared`:** perde a ordenação pelo momento do compartilhamento e
  exigiria outro campo de timestamp de qualquer forma.

## Modelo de dados

`Feedback` ganha:

```prisma
sharedAt DateTime?
@@index([sharedAt])
```

`UserBadge` não muda (já possui `awardedAt`).

Migration Prisma nova adicionando a coluna e o índice.

## API

### Toggle de compartilhamento

- `POST /feedbacks/:id/share` — define `sharedAt = now()`.
- `DELETE /feedbacks/:id/share` — define `sharedAt = null`.

Validações (senão `403`, sem vazar existência de feedback privado → `404`
quando aplicável, espelhando `canViewFeedback`):

- requisitante deve ser o `targetId` do feedback;
- categoria do feedback deve ser pública (`POSITIVO`/`ELOGIO`).

Retorna o `FeedbackDTO` atualizado.

### Mural

- `GET /mural` — autenticado, global. Devolve itens dos **últimos 30 dias**
  mesclados e ordenados por timestamp desc:
  - **feedbacks** com `sharedAt != null` **e** categoria pública **e**
    `sharedAt >= now - 30d`;
  - **selos** (`UserBadge`) com `awardedAt >= now - 30d`.
- Resposta: `{ items: MuralItemDTO[] }`. Lista vazia ⇒ `{ items: [] }` (front
  esconde o banner).

### Tipos compartilhados (`packages/shared`)

- `FeedbackDTO` ganha `sharedAt: string | null`.
- Novos tipos:

```ts
type MuralFeedbackItem = {
  type: 'feedback'
  id: string
  timestamp: string        // sharedAt
  target: PublicUser
  author: PublicUser
  message: string
  category: FeedbackCategory
  reactions: ReactionSummary[]
}

type MuralBadgeItem = {
  type: 'badge'
  id: string               // userBadge id
  timestamp: string        // awardedAt
  user: PublicUser
  badge: { slug: string; name: string; description: string; iconKey: string }
}

type MuralItemDTO = MuralFeedbackItem | MuralBadgeItem
```

## Frontend

### Botão "Compartilhar" no card de feedback

Em `apps/web/src/pages/profile/FeedbackSection.tsx`:

- Visível **apenas para o alvo** do feedback e **apenas** em categoria pública.
- Toggle "Compartilhar" ↔ "Compartilhado" (com ícone, estado derivado de
  `sharedAt`).
- Mutation chama `POST`/`DELETE /feedbacks/:id/share`; ao concluir, invalida as
  queries de feedback do perfil e a query `["mural"]`.

### `MuralBanner`

Novo componente, renderizado no topo de `apps/web/src/pages/TeamPage.tsx`,
acima do header "Time":

- Carrossel horizontal de cards.
- Auto-avanço suave + navegação por setas/swipe. Respeita
  `prefers-reduced-motion` (sem auto-avanço quando reduzido).
- **Card de feedback:** avatar + nome do alvo, trecho da mensagem, autor
  ("por Fulano"), chip da categoria.
- **Card de selo:** emblema (reusa `BadgeEmblem`), nome do selo, "conquistado
  por Fulano".
- Loading: skeleton. Erro ou lista vazia: não renderiza nada (some sem ruído).
- Usa react-query com `queryKey: ["mural"]`.

## Testes

### API

- Serviço de share:
  - apenas o alvo compartilha (autor/terceiro/admin → erro);
  - apenas categoria pública pode ser compartilhada;
  - toggle define e limpa `sharedAt`.
- `GET /mural`:
  - inclui feedback compartilhado público dentro de 30d;
  - exclui feedback não compartilhado, privado, ou fora da janela;
  - inclui selo conquistado dentro de 30d;
  - mescla e ordena por timestamp desc.

### Web

- Botão share aparece só para o alvo em categoria pública; some nos demais
  casos.
- `MuralBanner` renderiza card de feedback e card de selo; não renderiza quando
  a lista vem vazia.

## Fora de escopo

- Mural personalizado por squad/seguidores.
- Compartilhamento de selo opt-in.
- Notificações de novo item no mural.
