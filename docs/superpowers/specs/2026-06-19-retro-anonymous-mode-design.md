# Design — Modo anônimo (ocultar conteúdo) controlável no board

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board`
- **Escopo:** full-stack (shared + api + web). **Sem migration** (coluna `anonymous` já existe).
- **Base:** evolui o board de retrospectiva já implementado nesta branch.

## Objetivo

Permitir que o **facilitador** ative/desative o **modo anônimo** de dentro do board, em
tempo real. Quando ON, os demais participantes **não veem o conteúdo (texto)** dos cards
das outras pessoas — apenas um placeholder de barras representando que há algo escrito.
O **autor continua visível** e cada um sempre vê/edita o próprio card normalmente. Ao
desligar, o conteúdo real é revelado para todos.

## Redefinição consciente do `anonymous`

Hoje o flag `anonymous` da sala (escolhido na criação) **esconde o autor** (em
`toRetroCardDTO`, `author: anonymous ? null : {...}`) e o texto fica visível. Esta feature
**redefine** o significado:

- `anonymous = true` passa a **mascarar o conteúdo (texto)** dos cards de outros viewers;
- o **autor passa a ser sempre visível** (deixa de ser anulado).

O checkbock "sala anônima" da criação continua existindo e define o **estado inicial** do
modo; o badge "anônima" na listagem permanece. Não há um segundo conceito — é o mesmo
flag, agora (a) alternável no board e (b) com semântica de ocultar conteúdo.

## Privacidade no servidor

O texto de um card de outra pessoa **não é enviado** ao cliente enquanto o modo está ON —
a mascaração acontece na serialização (por-viewer). Isso já é viável porque tanto o GET
da sala quanto o `broadcastCard` serializam por usuário (`toRetroCardDTO(card, { viewerId,
anonymous })`) e o `retroHub.broadcast(roomId, build(viewerId))` entrega payload por
conexão.

## 1. Contrato (`packages/shared/src/retro.ts`)

- `RetroCardDTO`: adicionar `masked: boolean`.
  - Quando `masked === true`, `text` vem como `''` (não vaza o conteúdo).
  - `author` passa a ser sempre preenchido com o autor real (o tipo segue
    `{ id; name } | null`, mas anonimato **não** mais o anula; pode continuar `null` só se
    o autor for desconhecido, o que não ocorre hoje).
  - `mine` inalterado.
- `RetroEvent`: novo evento autoritativo `{ type: 'anonymous.changed'; anonymous: boolean }`.
- Novo request: `ToggleRetroAnonymousRequest { anonymous: boolean }` (ou inline no client).
- `RetroRoomDTO.anonymous` permanece (reflete o estado atual da sala).

## 2. Backend (`apps/api`)

### serialize.ts — `toRetroCardDTO`
```
const masked = ctx.anonymous && card.authorId !== ctx.viewerId
return {
  ...,
  text: masked ? '' : card.text,
  author: { id: card.author.id, name: card.author.name }, // sempre o autor real
  masked,
  mine: card.authorId === ctx.viewerId,
  ...
}
```
Remove o `author: ctx.anonymous ? null : {...}`. `summarizeRetroReactions`/votos inalterados.

### retro-service.ts — `setAnonymous`
Espelha `advancePhase`:
```
export async function setAnonymous(input: { roomId; userId; anonymous: boolean }) {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda o modo anônimo.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Sala não está aberta.', 409)
  await prisma.retroRoom.update({ where: { id: room.id }, data: { anonymous: input.anonymous } })
  return loadRoom(room.id)
}
```

### routes/retro.ts — `POST /retro/rooms/:id/anonymous`
Zod `{ anonymous: z.boolean() }`; chama `setAnonymous`; broadcast
`retroHub.broadcast(room.id, () => ({ type: 'anonymous.changed', anonymous: room.anonymous }))`;
retorna `{ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') }`. Erros de
domínio via `instanceof RetroError`.

> `broadcastCard` (create/update) já usa `meta.anonymous` fresco do request, então cards
> criados/editados durante o modo já saem mascarados para os outros automaticamente.

## 3. Tempo real / web

### retro-api.ts
```
export function toggleRetroAnonymous(id: string, anonymous: boolean) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/anonymous`, { method: 'POST', body: JSON.stringify({ anonymous }) })
}
```

### useRetroSocket.ts
- `applyEvent`: tratar `anonymous.changed` atualizando `room.anonymous` no cache.
- No handler `onmessage`, ao receber `anonymous.changed`, **invalidar a query**
  `['retro-room', roomId]` (`qc.invalidateQueries`) para refazer o GET e obter os cards
  com `masked`/texto corretos do servidor (vale para ligar e desligar). É o ponto que
  garante revelação/ocultação consistentes e a privacidade (texto real só chega do
  servidor quando o modo está OFF).

### RetroRoomPage.tsx
- `toggleAnonM` (mutation) chamando `toggleRetroAnonymous(id, !room.anonymous)`; `onSuccess`
  atualiza o cache do room (o refetch via evento cobre os cards).
- Top bar: quando `isFacilitator && room.status === 'OPEN'`, botão de toggle
  ("Modo anônimo: ativar" / "...: desativar" conforme `room.anonymous`).
- Para **todos**: quando `room.anonymous`, mostrar um chip discreto "Anônimo" na top bar.

### PostIt.tsx
- Quando `card.masked`, renderizar **barras cinza** (skeleton de 2–3 linhas) no lugar do
  `<p>`/textarea. Autor (avatar) e selos de voto/reação seguem visíveis.
- Cards `mine` nunca são `masked` (servidor garante) → sempre legível/editável.

## 4. Testes

- **API** (`retro.test.ts` / `retro-service` test, Postgres real):
  - `POST /anonymous` só facilitador (403 para participante); 409 se não-OPEN.
  - Após ligar, o GET/serialize de um card de OUTRO autor vem `masked: true, text: ''`;
    o card do próprio viewer vem `masked: false` com texto; `author` sempre presente.
  - Broadcast `anonymous.changed` emitido (se houver helper de captura de ws; senão,
    cobrir o serialize/serviço).
- **Web**:
  - `PostIt.test.tsx`: `masked` esconde o texto (mostra barras) e mantém autor; `mine`/não
    mascarado mostra texto.
  - `RetroRoomPage.test.tsx`: facilitador vê o botão de modo anônimo e clicar chama
    `toggleRetroAnonymous`; chip "Anônimo" aparece quando `room.anonymous`.
  - Ajustar mocks/fixtures que dependem do shape de `RetroCardDTO` (adicionar `masked`).

## 5. Riscos e decisões conscientes

- **Redefinição do `anonymous`**: a mudança altera o comportamento de salas criadas como
  anônimas (antes ocultava autor; agora oculta conteúdo e mostra autor). Decisão aceita.
- **Refetch no toggle**: revela/oculta via re-serialização do servidor; cards com texto
  já lido antes de ligar continuam tendo sido vistos (inerente — o modo protege o que é
  escrito enquanto está ON). O refetch garante que a UI passe a mascarar/revelar.
- **Sem indicador "escrevendo…" ao vivo** e **sem streaming de digitação** — fora de
  escopo; o placeholder é estático.
- **Voto/reação em card mascarado**: continuam funcionando (não alterados); ler-sem-ver é
  aceitável para o v1.
- **Sem migration**: coluna `anonymous` já existe no schema.
