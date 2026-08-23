# Design — Gerir participantes de uma sala aberta (add/remove no board)

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board`
- **Escopo:** full-stack (shared + api + web). **Sem migration** (modelo `RetroParticipant` já existe).
- **Base:** evolui o board de retrospectiva desta branch.

## Objetivo

Permitir que o **facilitador** adicione e **remova** participantes de uma sala **aberta**,
de dentro do board, via um painel lateral. As mudanças refletem **ao vivo** para quem já
está na sala. Remover alguém apenas tira o acesso — os cards/votos/reações dele
**permanecem** no board.

## Estado atual (o que muda)

- `apps/api/src/services/retro-service.ts` → `setParticipants` hoje é **só-adiciona**:
  monta `desired = {creator, ...participantIds}`, valida com `assertInvitable`, e só faz
  `createMany` dos que faltam — **nunca remove**. Retorna `{ room, addedUserIds }`.
- `apps/api/src/routes/retro.ts` → `PATCH /retro/rooms/:id/participants`: facilitador
  (`createdById`), rejeita sala `CONCLUDED` (no service), notifica convidados novos
  (`notifyRetroInvited`), retorna o room DTO. **Não** faz broadcast.
- Único consumidor do endpoint é esse PATCH; a criação de sala usa `createRoom`
  (`createRetroRoom`), não `setParticipants`. Logo, mudar a semântica de `setParticipants`
  é seguro.
- `RetroParticipant` (schema): `@@unique([roomId, userId])`, `onDelete: Cascade` só na
  relação com `RetroRoom`. `RetroCard.authorId`/`RetroVote.userId`/`RetroReaction.userId`
  referenciam **User**, não `RetroParticipant` — remover um participante **não** apaga
  cards/votos/reações.
- Web: gestão de participantes só existe no **modal de criação** (`RetrosPage`). No board
  não há UI; a top bar mostra só "N online" (presença efêmera). `listInvitableUsers()`
  (`GET /users`: ativos, não-admin, exceto o próprio) já existe.

## 1. Contrato (`packages/shared/src/retro.ts`)

- `RetroEvent` ganha `{ type: 'participants.changed' }` (autoritativo, sem payload — o
  cliente refaz o GET). `UpdateParticipantsRequest`/`RetroParticipantDTO` inalterados.

## 2. Backend (`apps/api`)

### retro-service.ts — `setParticipants` vira "set"
A lista recebida passa a ser a **lista final** (substitui), sempre preservando o criador:
```
const desired = new Set([room.createdById, ...input.participantIds])
await assertInvitable([...desired].filter((id) => id !== room.createdById))
const current = new Set(room.participants.map((p) => p.userId))
const toAdd = [...desired].filter((id) => !current.has(id))
const toRemove = [...current].filter((id) => !desired.has(id) && id !== room.createdById)
await prisma.$transaction([
  ...(toAdd.length ? [prisma.retroParticipant.createMany({ data: toAdd.map((userId) => ({ roomId: room.id, userId })) })] : []),
  ...(toRemove.length ? [prisma.retroParticipant.deleteMany({ where: { roomId: room.id, userId: { in: toRemove } } })] : []),
])
return { room: await loadRoom(room.id), addedUserIds: toAdd }
```
- Guards inalterados: facilitador-only (403), `CONCLUDED` (409).
- Cards/votos/reações dos removidos **não** são tocados (permanecem).
- Retorno mantém `{ room, addedUserIds }` (notificações só pros novos).

### routes/retro.ts — broadcast no PATCH
Após `setParticipants` (e a notificação dos novos), adicionar:
```
retroHub.broadcast(room.id, () => ({ type: 'participants.changed' }))
```
Resto do handler inalterado (retorna `{ room: toRetroRoomDTO(...) }`).

## 3. Tempo real / web

### useRetroSocket.ts
- No `ws.onmessage`, ao receber `participants.changed`, **invalidar** a query
  `['retro-room', roomId]` (refetch). `applyEvent` não precisa de case (default no-op);
  o refetch traz o roster atualizado. Quem foi removido, ao refazer o GET, perde acesso
  (DEV → 403 → a página já mostra "Sala indisponível."; LEAD vira OBSERVER).

### retro-api.ts
- `setRetroParticipants(id, participantIds)` já existe; `listInvitableUsers()` já existe.

## 4. UI — painel lateral (`ParticipantsPanel`)

### Novo componente `apps/web/src/pages/retro/ParticipantsPanel.tsx`
Drawer à direita sobre o canvas. Props:
`{ participants: RetroParticipantDTO[]; invitable: PublicUser[]; busy?: boolean; onAdd(userId): void; onRemove(userId): void; onClose(): void }`.
- **Na sala**: lista `participants`. Linha do **criador** (`isCreator`) tem tag "criador" e
  **sem** botão de remover; demais têm **×** (`aria-label="Remover {nome}"`) → `onRemove`.
- **Adicionar**: lista `invitable` (já filtrada para excluir quem está na sala), cada um
  com **+** (`aria-label="Adicionar {nome}"`) → `onAdd`.
- Cabeçalho "Participantes" + botão fechar (`aria-label="Fechar"`).

### RetroRoomPage.tsx
- Estado `participantsOpen: boolean`.
- Botão **"Participantes (N)"** na top bar quando `isFacilitator && room.status === 'OPEN'`
  → abre o drawer. `N = room.participants.length`.
- Query `invitableQuery = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers, enabled: participantsOpen })`.
- `participantsM = useMutation({ mutationFn: (ids: string[]) => setRetroParticipants(id, ids), onSuccess: ({ room: r }) => patch((c) => ({ room: { ...c.room, participants: r.participants, participantCount: r.participantCount } })) })`.
- `onAdd(userId)`: ids atuais (`room.participants.map(p => p.user.id)`) **+ userId** → `participantsM.mutate(ids)`.
- `onRemove(userId)`: ids atuais **− userId** → `participantsM.mutate(ids)`.
- `invitable` passado ao painel = `invitableQuery.data?.users` filtrado para remover quem já
  é participante (`!participants.some(p => p.user.id === u.id)`).

## 5. Testes

- **API** (Postgres real):
  - `setParticipants` (service): agora **remove** quem sai da lista mantendo o criador;
    **atualizar** o teste existente que assumia add-only (enviar `[d2]` partindo de `[d1]`
    resulta em `[lead, d2]`, d1 removido); novo caso garantindo que os **cards** de d1
    permanecem após a remoção.
  - Rota PATCH: emite `participants.changed` (se houver helper de ws; senão, cobrir via
    service/serialize). Mantém o teste de notificação dos novos.
- **Web**:
  - `ParticipantsPanel.test.tsx`: renderiza participantes (criador sem ×), botões ×/+
    disparam `onRemove`/`onAdd` com o id certo; lista de adicionar exclui quem já está.
  - `RetroRoomPage.test.tsx`: facilitador vê "Participantes (N)"; abrir mostra o painel;
    clicar + chama `setRetroParticipants` com a lista incluindo o novo id; clicar × chama
    com a lista sem o id. Ajustar o mock de `retro-api` (`setRetroParticipants`,
    `listInvitableUsers`).

## 6. Riscos e decisões conscientes

- **Set-semantics**: muda o comportamento de `setParticipants` (de add-only para
  substituir). Seguro porque o único consumidor é o PATCH (a criação usa `createRoom`).
  O teste de serviço existente é atualizado para a nova semântica.
- **Remoção preserva conteúdo**: cards/votos/reações do removido permanecem (sem cascade);
  o autor segue exibido. Decisão aceita.
- **Acesso do removido**: não é desconectado ao vivo; perde acesso no próximo
  GET/refetch (disparado pelo `participants.changed`). Suficiente para o v1.
- **Criador protegido**: nunca removido (forçado em `desired`); sem × na UI.
- **Sem migration**: usa o modelo `RetroParticipant` existente.
