-- Renomeia DEV -> LEGEND (preserva dados e default existentes) e adiciona novos valores.
ALTER TYPE "UserRole" RENAME VALUE 'DEV' TO 'LEGEND';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'HEAD';

-- Default explícito do papel.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'LEGEND';

-- Liderança da squad.
ALTER TABLE "Squad" ADD COLUMN "leaderId" TEXT;
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Squad_leaderId_idx" ON "Squad"("leaderId");
