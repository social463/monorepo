-- DropForeignKey
ALTER TABLE "KnowledgeEntry" DROP CONSTRAINT "KnowledgeEntry_sectorId_fkey";

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
