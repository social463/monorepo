# Resenha — Tempo real (WebSocket) — Design Spec

- **Data:** 2026-06-26
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming)
- **Depende de:** [Resenha](2026-06-26-resenha-design.md) e
  [Resenha — Menções](2026-06-26-resenha-mencoes-design.md) (ambas em `main`)

## Problema

A resenha do time é **pull-based**: cada cliente só vê resenhas novas, comentários
e reações depois de dar refresh na página. Quem mexe (mutation) atualiza o próprio
cache, mas os demais usuários **na mesma rota** não recebem nada. Queremos que uma
resenha postada — bem como comentários e reações — apareça **instantaneamente** para
quem estiver em `/resenha` naquele momento.

## Decisões (do brainstorming)

- **Mecanismo (B):** **WebSocket**, reaproveitando o padrão que já existe no repo
  para o retro (`retro-hub.ts` + `retro-ws.ts` + `useRetroSocket.ts`). O
  `@fastify/websocket` já está registrado em `app.ts`.
- **Sincronização (A):** **eventos magros → invalida o cache**. O servidor empurra
  só o tipo do evento (e `reviewId` quando aplicável); o cliente faz
  `invalidateQueries` da query relevante do React Query. Sem payloads "gordos", sem
  reconstruir DTO por viewer — cada cliente refaz o fetch com **suas próprias flags**
  ("eu reagi?", "eu compartilhei?", menções).
- **Canal único e global:** a resenha não tem "salas" como o retro. Um único conjunto
  de conexões; broadcast para todos.
- **Auth sem membership:** o feed é visível a qualquer usuário autenticado, então a
  `preValidation` só verifica o JWT (via `?token=`). Sem checagem de participante.
- **Conexão atrelada à rota:** o hook conecta no mount de `ResenhaPage` e desconecta
  no unmount → **só quem está na rota recebe updates**.
- **Escopo de eventos:** cobre resenha (criar/excluir), comentários (criar/excluir),
  reações de resenha, reações de comentário e shares — todos pelo mesmo caminho de
  invalidação.

## Arquitetura

Fluxo (espelha o retro): **mutation REST → service → route emite broadcast → hub faz
fan-out → cliente invalida a query**. O broadcast é emitido **na rota**
(`routes/review.ts`), depois do service retornar — o service permanece puro, igual à
convenção de `routes/retro.ts`.

### Backend

1. **`apps/api/src/lib/review-hub.ts`** (novo) — hub em memória, versão enxuta do
   `retro-hub`. Sem salas, sem locks: um único `Set<ReviewConnection>`.
   - Interface `ReviewSocket { send(data: string): void }` e
     `ReviewConnection { socket: ReviewSocket }`.
   - Métodos: `subscribe(conn)`, `unsubscribe(conn)`, `broadcast(event: ReviewEvent)`
     (serializa com `JSON.stringify`, ignora erros de socket morto — limpos no
     `close`).
   - Exporta singleton `reviewHub`.
   - **Limitação conhecida (igual ao retro):** preso a uma instância; Postgres é a
     fonte da verdade, o hub só faz fan-out. Redis/multi-instância fica como futuro.

2. **`apps/api/src/routes/review-ws.ts`** (novo) — rota `GET /reviews/ws` com
   `{ websocket: true }`.
   - `preValidation`: lê `request.query.token`, faz `app.jwt.verify(token)`; em falha
     responde `401`. (Mesmo trecho do `retro-ws.ts`, sem buscar nome nem checar
     membership.)
   - Handler: `reviewHub.subscribe(conn)`; `ws.on('close')` → `reviewHub.unsubscribe`.
   - O cliente **não envia mensagens** — não há `ws.on('message')`.
   - Registrada em `app.ts` (`buildApp`), junto das demais rotas.

3. **Emissões em `apps/api/src/routes/review.ts`** — após cada mutation bem-sucedida,
   `reviewHub.broadcast(...)`:

   | Endpoint | Evento emitido |
   |---|---|
   | `POST /reviews` | `{ type: 'feed:changed' }` |
   | `DELETE /reviews/:id` | `{ type: 'feed:changed' }` |
   | `POST /reviews/:id/reactions/toggle` | `{ type: 'review:changed', reviewId }` |
   | `POST /reviews/:id/share` | `{ type: 'review:changed', reviewId }` |
   | `DELETE /reviews/:id/share` | `{ type: 'review:changed', reviewId }` |
   | `POST /reviews/:id/comments` | `{ type: 'comments:changed', reviewId }` |
   | `DELETE /reviews/comments/:commentId` | `{ type: 'comments:changed', reviewId }` |
   | `POST /reviews/comments/:commentId/reactions/toggle` | `{ type: 'comments:changed', reviewId }` |

   Obs.: as rotas de comentário por `commentId` (delete, toggle reaction) precisam do
   `reviewId` para o evento. O service já carrega o comentário/review; expor o
   `reviewId` no retorno (ou buscá-lo) para a rota poder emitir.

### Contrato compartilhado

4. **`packages/shared/src/review-events.ts`** (novo, exportado no barril `index.ts`) —
   tipo `ReviewEvent` como union discriminada:

   ```ts
   export type ReviewEvent =
     | { type: 'feed:changed' }
     | { type: 'review:changed'; reviewId: string }
     | { type: 'comments:changed'; reviewId: string }
   ```

   Mesma convenção do `RetroEvent`. É a fonte única do contrato api⇄web.

### Frontend

5. **`apps/web/src/lib/useReviewSocket.ts`** (novo) — hook que **copia a mecânica de
   conexão** do `useRetroSocket`: token em memória + `refreshAccessToken` single-flight,
   backoff exponencial no `onclose` (cap ~15s), escolha `wss`/`ws` pelo protocolo,
   cleanup no unmount (`closedByUs`). URL:
   `${scheme}://${host}/api/reviews/ws?token=${token}`.
   - No `onmessage`, parseia `ReviewEvent` e mapeia para invalidação:
     - `feed:changed` → `invalidateQueries(['reviews','feed'])`
     - `review:changed` → `invalidateQueries(['reviews','feed'])`
     - `comments:changed` → `invalidateQueries(['reviews','comments', reviewId])`
       **e** `invalidateQueries(['reviews','feed'])` (atualiza o `commentCount`)
   - Não expõe `send` (fluxo só servidor→cliente).

6. **`apps/web/src/pages/resenha/ResenhaPage.tsx`** — chama `useReviewSocket()` uma vez.

## Comportamento que se resolve sozinho

- **Echo para o próprio autor:** quem fez a ação recebe o próprio evento e invalida de
  novo — inofensivo e idempotente. As mutations já invalidam no `onSettled`; o
  optimistic update das reações (`use-reviews.ts`) continua intacto (o invalidate só
  reconcilia depois).
- **Flags por viewer:** como invalidamos (não aplicamos DTO empurrado), cada cliente
  refaz o fetch com suas próprias flags pessoais — zero risco de dessincronizar.

## Testes

- **`apps/api/src/lib/review-hub.test.ts`** — subscribe/broadcast/unsubscribe com socket
  fake (espelha `retro-hub.test.ts`); broadcast não quebra com socket que lança no `send`.
- **Teste de rota** (`apps/api/src/routes/review.test.ts` ou arquivo dedicado) — uma
  mutation dispara o broadcast esperado para uma conexão inscrita (inscreve um socket
  fake no `reviewHub`, executa a mutation, verifica o evento recebido).
- **`apps/web/src/lib/useReviewSocket.test.tsx`** — espelha `useRetroSocket.test.tsx`:
  ao receber cada tipo de evento, invalida a(s) query(s) correta(s).

## Fora de escopo (YAGNI)

- Redis / broadcast multi-instância (mesma dívida do retro).
- Debounce/coalescing de rajadas de eventos no cliente.
- Payloads "gordos" (empurrar DTO completo e aplicar direto no cache).
- Presença ("quem está vendo a resenha") e indicadores de digitação.
