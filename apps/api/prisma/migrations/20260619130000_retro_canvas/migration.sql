-- RetroCard: posição + cor; remove categoria
ALTER TABLE "RetroCard" ADD COLUMN "x" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RetroCard" ADD COLUMN "y" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RetroCard" ADD COLUMN "color" TEXT NOT NULL DEFAULT 'yellow';
ALTER TABLE "RetroCard" ALTER COLUMN "x" DROP DEFAULT;
ALTER TABLE "RetroCard" ALTER COLUMN "y" DROP DEFAULT;
ALTER TABLE "RetroCard" ALTER COLUMN "color" DROP DEFAULT;
ALTER TABLE "RetroCard" DROP COLUMN "column";
DROP TYPE "RetroColumn";

-- RetroRoom: status OPEN|CONCLUDED (converte COLLECTING/REVEALED -> OPEN), remove revealedAt
ALTER TABLE "RetroRoom" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "RetroRoomStatus_new" AS ENUM ('OPEN', 'CONCLUDED');
ALTER TABLE "RetroRoom" ALTER COLUMN "status" TYPE "RetroRoomStatus_new"
  USING (CASE WHEN "status"::text = 'CONCLUDED' THEN 'CONCLUDED' ELSE 'OPEN' END::"RetroRoomStatus_new");
DROP TYPE "RetroRoomStatus";
ALTER TYPE "RetroRoomStatus_new" RENAME TO "RetroRoomStatus";
ALTER TABLE "RetroRoom" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "RetroRoom" DROP COLUMN "revealedAt";
