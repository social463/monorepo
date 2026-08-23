# Design — Board de Retrospectiva de Sprint (tempo real)

- **Data:** 2026-06-18
- **Status:** aprovado (aguardando revisão final do spec)
- **Autor:** brainstorming Lucca + Claude

## Objetivo

Um board interativo de retrospectiva de sprint dentro da plataforma Legends,
inspirado no [ludi.co](https://ludi.co), com **colaboração simultânea em tempo
real** entre os envolvidos. Um **LEAD** abre uma sala, convida participantes, e o
time preenche cinco colunas: **O que foi bom**, **O que foi ruim**, **O que
precisamos começar**, **O que precisamos parar** e **Ações**.

Qualquer LEAD tem acesso livre (somente leitura) a qualquer sala — aberta ou
concluída — para consultar o que foi escrito.

Este é o **primeiro corte (v1)**; a feature evolui aos poucos.

## Decisões de produto

- **Tempo real de verdade** via WebSocket (não polling).
- **Anonimato configurável por sala**: o LEAD escolhe na criação se a sala é
  anônima (autor nunca exibido) ou identificada.
- **Votos por participante (dot voting) definidos pelo LEAD** na criação da sala.
- **Sala "solta" com título livre** (ex.: "Retro Sprint 23 — Squad Pagamentos").
  **Não** há entidade Squad; os participantes convidados *são* o squad daquela
  sala. **Independente** do período mensal de votação (cadência de sprint ≠ mês).
- **ADMIN fica totalmente fora** da feature (coerente com voto/feedback).

## Papéis e acesso

| Papel | Quem | Pode |
|---|---|---|
| **Facilitador** | LEAD criador da sala | Controla fases, gerencia convites, **e participa** (escreve/vota/reage) |
| **Participante** | Usuário convidado (DEV ou LEAD) | Escreve/edita/exclui o próprio card, vota, reage (conforme a fase) |
| **Observador** | Qualquer LEAD não-criador e não-convidado | Lê tudo (sala aberta ou concluída); não escreve/vota/reage |
| **Sem acesso** | DEV não convidado | — |
| **Fora** | ADMIN | Não cria, não participa, não observa |

## Fases da sala

`COLLECTING` → `REVEALED` → `CONCLUDED` (transições só pelo facilitador, irreversíveis).

| Ação | COLLECTING | REVEALED | CONCLUDED |
|---|:---:|:---:|:---:|
| Criar / editar / excluir o próprio card | ✅ | ✅ | ❌ |
| Ver cards dos outros | ❌ (só os próprios) | ✅ | ✅ |
| Votar (dot) / reagir com emoji | ❌ | ✅ | ❌ |
| Consultar (somente leitura) | ✅ (observador) | ✅ | ✅ |
| Avançar de fase | facilitador | facilitador | — (final) |

- Em **COLLECTING**: ninguém vê card alheio (nem facilitador, nem observador).
  Cada participante vê **só os próprios** cards; todos veem um **contador** de
  cards por coluna (para o facilitador saber quando revelar).
- A revelação é **irreversível** (não volta para COLLECTING).
- Escrita liberada em COLLECTING **e** REVEALED (a coluna "Ações" costuma ser
  preenchida na discussão ao vivo). Voto e reação **só** em REVEALED.

## Modelo de dados (Prisma)

Schema único em `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate`.

### Enums

```prisma
enum RetroRoomStatus {
  COLLECTING
  REVEALED
  CONCLUDED
}

enum RetroColumn {
  WENT_WELL   // O que foi bom
  WENT_BAD    // O que foi ruim
  START       // O que precisamos começar
  STOP        // O que precisamos parar
  ACTIONS     // Ações
}
```

### Models

```prisma
model RetroRoom {
  id                  String          @id @default(cuid())
  title               String
  createdById         String
  anonymous           Boolean         @default(false)
  votesPerParticipant Int
  status              RetroRoomStatus @default(COLLECTING)
  createdAt           DateTime        @default(now())
  revealedAt          DateTime?
  concludedAt         DateTime?

  creator      User               @relation("RetroRoomsCreated", fields: [createdById], references: [id])
  participants RetroParticipant[]
  cards        RetroCard[]
}

model RetroParticipant {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  invitedAt DateTime @default(now())

  room RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id])

  @@unique([roomId, userId])
}

model RetroCard {
  id        String      @id @default(cuid())
  roomId    String
  authorId  String
  column    RetroColumn
  text      String
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  room      RetroRoom       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  author    User            @relation(fields: [authorId], references: [id])
  votes     RetroVote[]
  reactions RetroReaction[]
}

model RetroVote {
  id        String   @id @default(cuid())
  cardId    String
  userId    String
  createdAt DateTime @default(now())

  card RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id])
  // SEM unique(card,user): permite empilhar dots; o limite votesPerParticipant
  // é validado contando os votos do usuário na sala.
}

model RetroReaction {
  id     String @id @default(cuid())
  cardId String
  userId String
  emoji  String

  card RetroCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id])

  @@unique([cardId, userId, emoji]) // um de cada emoji por pessoa por card
}
```

Relações inversas a adicionar no model `User`: `retroRoomsCreated`,
`retroParticipations`, `retroCards`, `retroVotes`, `retroReactions`.

**Anonimato é só de exibição:** `authorId` é **sempre** persistido (necessário
para editar/excluir o próprio card e validar orçamento de voto). O DTO **omite o
autor** quando `anonymous = true`.

Notificação reaproveita o model `Notification` com novo tipo **`RETRO_INVITED`**
(adicionar ao enum de tipos de notificação).

## API e tempo real (`apps/api`)

**Princípio:** mutações via **REST** (reusa Zod `safeParse` → `400 {message, issues}`,
service com classe de erro tipada `RetroError` com `status`, serialize em
`lib/serialize.ts`). O handler REST persiste e, ao final, **publica um evento no hub
da sala**. O **WebSocket é push-only** (servidor → clientes) + presença. A lógica de
negócio fica nos services; não há protocolo de comando paralelo no socket.

Camadas: `src/routes/retro.ts` → `src/services/retro-service.ts` → Prisma.
Registrado em `buildApp` (`src/app.ts`). Erros de domínio: classe `RetroError`
(`instanceof` na route → `reply.code(err.status)`).

### Rotas REST (todas com `onRequest: [app.authenticate]`)

| Método | Rota | Quem | Ação |
|---|---|---|---|
| POST | `/retro/rooms` | LEAD | Criar sala (title, anonymous, votesPerParticipant, participantIds) |
| GET | `/retro/rooms` | LEAD/DEV | Listar: criador/convidado vê as suas; LEAD vê todas para consultar |
| GET | `/retro/rooms/:id` | conforme papel | Detalhe respeitando visibilidade da fase |
| PATCH | `/retro/rooms/:id/participants` | facilitador | Gerenciar convites → dispara `RETRO_INVITED` (best-effort) |
| POST | `/retro/rooms/:id/phase` | facilitador | `reveal` / `conclude` |
| POST | `/retro/rooms/:id/cards` | participante | Criar card (COLLECTING/REVEALED) |
| PATCH | `/retro/rooms/:id/cards/:cardId` | autor | Editar o próprio card |
| DELETE | `/retro/rooms/:id/cards/:cardId` | autor | Excluir o próprio card |
| POST | `/retro/rooms/:id/cards/:cardId/votes` | participante | Adiciona dot (REVEALED, valida orçamento) |
| DELETE | `/retro/rooms/:id/cards/:cardId/votes` | participante | Remove dot |
| POST | `/retro/rooms/:id/cards/:cardId/reactions` | participante | Toggle emoji (REVEALED) |

### WebSocket — `GET /retro/rooms/:id/ws`

Via **`@fastify/websocket`** (nova dependência).

- **Auth no upgrade:** access token vive em memória no front e o browser não permite
  header `Authorization` no WebSocket → passamos `?token=<jwt>` na URL e validamos no
  upgrade (sobre `wss://` em produção). Decisão consciente (ver Riscos).
- **Autorização:** valida que o usuário é participante/facilitador/observador(LEAD);
  recusa o upgrade caso contrário.
- **Eventos enviados (push):** `card.created`, `card.updated`, `card.deleted`,
  `vote.changed`, `reaction.changed`, `phase.changed`, `presence.changed`.
- **Visibilidade no socket:** em COLLECTING, `card.created` de outra pessoa **não** é
  enviado aos demais — apenas o contador por coluna é atualizado.

### Hub em memória — `src/lib/retro-hub.ts`

`Map<roomId, Set<{ socket, userId }>>` com `subscribe`, `unsubscribe`,
`broadcast(roomId, evento)`, `presence(roomId)`. **Postgres é a fonte da verdade**;
o hub só faz fan-out. Limitação consciente: estado em memória não escala
horizontalmente sem Redis (deploy é instância única hoje).

## Contrato compartilhado (`packages/shared`)

`packages/shared/src/retro.ts` (+ barril em `index.ts`). Alterar o contrato aqui
**primeiro**, depois ajustar os dois lados.

- Enums/constantes: `RETRO_COLUMNS`, `RETRO_ROOM_STATUS`, `RETRO_REACTION_EMOJIS`,
  `MAX_CARD_LENGTH`, `RETRO_INVITED` (tipo de notificação).
- DTOs: `RetroRoomDTO`, `RetroCardDTO` (com resumo de votos/reações e `author?`
  omitido quando anônimo), `RetroParticipantDTO`.
- `RetroEvent`: union discriminada dos eventos do socket.

## Frontend (`apps/web`)

- **Navegação:** novo item **"Retrospectivas"** visível para DEV e LEAD; oculto para
  ADMIN (gate tipo `DevOnly`).
- **`src/pages/RetrosPage.tsx`** — lista. LEAD: botão "Nova sala" + as salas dele +
  todas as salas para consultar (separadas por status). DEV: só as salas em que foi
  convidado.
- **`src/pages/RetroRoomPage.tsx`** — o board: 5 colunas, cards, controles de fase
  (só facilitador), indicador de orçamento de votos restantes, reações. Carga inicial
  via **React Query**; atualizações ao vivo via hook `useRetroSocket`.
- **`src/lib/useRetroSocket.ts`** — abre a conexão (`?token=`), aplica os eventos no
  cache do React Query, mantém presença, e faz **reconexão com backoff + refetch ao
  reconectar** (cobre token expirado/refresh). Mutações continuam por `apiFetch`
  (REST) com update otimista; o broadcast confirma.
- **Modal de criação de sala:** título, toggle anônimo, votos por participante,
  seleção de participantes (lista de usuários não-admin).

## Testes

Vitest, arquivos `*.test.ts(x)` ao lado do código. API contra Postgres real
(`pnpm db:up`).

- **Service:** permissões (criar/participar/observar; ADMIN fora), gating por fase
  (votar só em REVEALED, escrever em COLLECTING/REVEALED, CONCLUDED read-only),
  orçamento de votos (limite + empilhar dots), visibilidade em COLLECTING (só os
  próprios cards + contador), toggle de reação, transições de fase irreversíveis.
- **Rotas:** status codes, Zod 400, 401/403 por papel.
- **Hub:** `broadcast`/`subscribe`/`presence` isolados; um teste de integração sobe o
  app numa porta efêmera e conecta um cliente WS real (o `inject` do Fastify não faz
  upgrade de WebSocket — documentado).
- **Web:** board renderiza por fase, orçamento de votos, e `useRetroSocket` aplicando
  eventos com socket mockado.

## Riscos e decisões conscientes

- **Token JWT na URL do WebSocket** — mitigado por `wss://` em produção.
- **Presença em memória** → preso a instância única (alinhado ao deploy atual; migrar
  broadcast para Redis quando escalar, sem mudar o modelo de dados).
- **Notificação de convite best-effort** — falha logada, não derruba a operação
  (mesmo padrão de selos/feedback).

## Fora do escopo do v1 (evoluções futuras)

- Agrupar/clusterizar cards (arrastar um sobre o outro).
- Timer de sessão.
- Exportar a retrospectiva.
- Redis pub/sub para multi-instância.
- Indicador "fulano está digitando".
