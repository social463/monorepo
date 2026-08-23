-- Backfill: RetroRoom.companyId a partir do dono real (createdById -> User.companyId)
UPDATE "RetroRoom" r SET "companyId" = u."companyId" FROM "User" u WHERE u.id = r."createdById";

-- Backfill: os demais models herdam transitivamente de RetroRoom (via roomId)
UPDATE "RetroRoomSquad" rrs SET "companyId" = rr."companyId" FROM "RetroRoom" rr WHERE rr.id = rrs."roomId";
UPDATE "RetroParticipant" rp SET "companyId" = rr."companyId" FROM "RetroRoom" rr WHERE rr.id = rp."roomId";
UPDATE "RetroCard" rc SET "companyId" = rr."companyId" FROM "RetroRoom" rr WHERE rr.id = rc."roomId";
UPDATE "RetroEdit" re SET "companyId" = rr."companyId" FROM "RetroRoom" rr WHERE rr.id = re."roomId";

-- Backfill: votos e reações herdam de RetroCard (via cardId), que já foi corrigido acima
UPDATE "RetroVote" rv SET "companyId" = rc."companyId" FROM "RetroCard" rc WHERE rc.id = rv."cardId";
UPDATE "RetroReaction" rr2 SET "companyId" = rc."companyId" FROM "RetroCard" rc WHERE rc.id = rr2."cardId";