-- Habilita o papel SUBADMIN no setor padrão, espelhando o ADMIN já habilitado
-- para ele na migration de criação do setor (20260722180000_add_sector_core).
-- Sem isso, POST/PATCH /admin/users rejeita a promoção a SUBADMIN com "papel
-- não habilitado", pois SUBADMIN não existia quando o setor padrão foi seedado.
INSERT INTO "SectorRole" ("sectorId", "role")
VALUES ('sector-dev-produto', 'SUBADMIN')
ON CONFLICT ("sectorId", "role") DO NOTHING;
