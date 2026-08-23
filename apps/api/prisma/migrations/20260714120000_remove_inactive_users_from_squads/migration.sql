-- Remove vínculos operacionais de squads para usuários desativados ou desligados.
DELETE FROM "SquadMember"
WHERE "userId" IN (
  SELECT "id"
  FROM "User"
  WHERE "active" = false OR "leftAt" IS NOT NULL
);

UPDATE "Squad"
SET "leaderId" = NULL
WHERE "leaderId" IN (
  SELECT "id"
  FROM "User"
  WHERE "active" = false OR "leftAt" IS NOT NULL
);
