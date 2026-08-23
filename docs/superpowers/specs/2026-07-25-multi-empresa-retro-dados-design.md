# Multi-tenancy em Retro — sub-fatia 1: dados + services — Design

## Contexto

Gap mais severo remanescente de um audit de completude da linha de trabalho de multi-tenancy
(PR #10609, já mergeável com `main`). Retro (retrospectivas de time) é o único domínio da lista
original de não-objetivos (`docs/superpowers/specs/2026-07-23-multi-empresa-isolamento-design.md`)
que nunca foi migrado — Feedback, MoodEntry, Notification, Review e todo o Escritório já foram.

Hoje: os 7 models de Retro (`RetroRoom`, `RetroRoomSquad`, `RetroParticipant`, `RetroCard`,
`RetroVote`, `RetroReaction`, `RetroEdit`) não têm `companyId` nem `sectorId`; `retro-service.ts`
usa `prisma` cru em 100% das operações; qualquer usuário com papel de liderança
(`isLeaderRole`) ou qualquer `ADMIN`/`SUBADMIN` vê, edita ou apaga permanentemente salas de
retro de **qualquer** empresa — incluindo conteúdo de card e identidade de participantes.
`listRoomsForUser`/`listRoomsForAdmin` já devolvem todas as salas do banco pra qualquer líder/
admin, sem filtro nenhum.

Esta é a sub-fatia 1 de 3: dados + services. Rotas HTTP (sub-fatia 2) e
`retro-hub.ts`/`retro-ws.ts` (sub-fatia 3, a mais arriscada — hub de presença em tempo real que
hoje transporta conteúdo real de card/voto/reação, singleton global sem particionamento) ficam
fora, com o handoff de compilação quebrada já estabelecido nas fatias anteriores desta linha.

## Escopo

### Schema — `companyId` denormalizado nos 7 models

Mesmo padrão já usado em Review/Escritório: cada model ganha `companyId String
@default("company-emr")` + relação `company Company @relation(...)` + `@@index([companyId])`.
`RetroRoom.companyId` é a fonte da verdade (gravado a partir do `companyId` de quem cria a
sala); os demais 6 models herdam o `companyId` da sala/card ao qual pertencem.

Migration: `RetroRoom.companyId` vem de `creator.companyId` (via `createdById`);
`RetroRoomSquad`/`RetroParticipant`/`RetroCard`/`RetroEdit` vêm transitivamente de
`RetroRoom.companyId` (via `roomId`); `RetroVote`/`RetroReaction` vêm transitivamente de
`RetroCard.companyId` (via `cardId`) — mesmo padrão de backfill real (não só `DEFAULT`) já usado
nas migrations anteriores desta linha.

### Gap adjacente fechado: squads de empresas diferentes na mesma sala

Hoje `createRoom`/`updateRoomAsAdmin` só validam que a squad está `active`, nunca sua empresa —
uma sala pode, em teoria, já misturar squads de empresas diferentes. Esta fatia adiciona a
validação: toda squad anexada a uma sala precisa ter `squad.companyId === room.companyId`
(a empresa de quem criou a sala), rejeitada com erro de domínio caso contrário.

### `apps/api/src/services/retro-service.ts`

Todas as ~20 funções exportadas ganham `companyId` (do chamador) e passam a usar
`scopedPrisma(companyId)` para carregar `RetroRoom`/`RetroCard` — uma sala/card de outra empresa
vira 404 genuíno (mesma convenção de erro já usada no arquivo). Em particular:
- `listRoomsForUser`/`listRoomsForAdmin` — os vazamentos mais graves — passam a filtrar por
  `companyId` além do filtro de papel/participação já existente.
- `createRoom` — grava `companyId` no `RetroRoom` a partir do criador, e valida squads
  conforme o gap adjacente acima.
- `priorConcludedSquadRooms` (carry-over) — permanece correto sem mudança de lógica, já que
  squads e salas agora compartilham `companyId`.

### Fora de escopo desta sub-fatia

- `apps/api/src/routes/retro.ts` e o trecho de retro em `apps/api/src/routes/admin.ts` — sub-fatia
  2, ficam com erro de compilação até lá (handoff já estabelecido nas fatias anteriores).
- `apps/api/src/lib/retro-hub.ts`/`apps/api/src/routes/retro-ws.ts` — sub-fatia 3.

## Testes

Fixture de 2ª empresa real (mesmo padrão de `otherCompany`/`otherSector` já usado em
`feedback.test.ts`/`review.test.ts`/`admin.test.ts` — nenhum teste de Retro hoje usa esse
padrão). Cobertura mínima: `listRoomsForUser`/`listRoomsForAdmin` não retornam sala de outra
empresa; `getRoomForViewer`/`updateRoomAsAdmin`/`hardDeleteRoom`/`createCard`/`addVote`/etc.
tratam sala/card de outra empresa como 404; `createRoom` rejeita squad de outra empresa anexada
à sala.
