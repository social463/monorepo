# Excluir squad, e a planilha movendo squad de setor

**Spec:** `docs/superpowers/specs/2026-09-08-excluir-squad-e-mover-squad-na-importacao-design.md`

## O que já existia

`Squad` com `active`, `sectorId` e `@@unique([companyId, name])` /
`([companyId, slug])`. `PATCH /admin/squads/:id` já movia squad de setor pela
tela, mas só para setor que já existisse. `SquadMember` cascateia na exclusão da
squad; `RetroRoomSquad` não.

A importação (`user-import-service.ts`) já criava setor e squad, e já movia
pessoa de setor. Squad existente citada com outro setor era erro seco, e squad
desativada também — os dois sem saída, porque não havia `DELETE` de squad.

## O que entra

### 1. Contrato ✅

`packages/shared/src/user-import.ts`:

- `UserImportPlanDTO.squadsToMove: { name, fromSectorName, toSectorName }[]`;
- `UserImportResultDTO.squadsMoved: string[]`.

### 2. Excluir squad ✅

`deleteSquad(id, actorId, companyId)` em `services/squad-service.ts`: 404 fora da
empresa, **409** quando há `RetroRoomSquad` (com `P2003` como rede de segurança
para relação nova sem cascade), `AdminAuditLog` com `action: 'DELETE'`.

`DELETE /admin/squads/:id` em `routes/admin.ts`, `adminOrSubadmin`, com o mesmo
recorte do `PATCH` vizinho: SUBADMIN só na squad do próprio setor, 404 nas
demais.

### 3. A planilha move a squad ✅

`user-import-service.ts`, seção 6 reescrita:

- `squadClaims` acumula as linhas de cada squad **antes** de decidir o setor. Duas
  linhas discordando é erro nas duas — agora também para squad que já existe, que
  antes nem chegava nessa checagem;
- seção **6.1** planeja o movimento (`SquadRef.moveFromSectorKey`) só depois de
  todas as linhas concordarem;
- a conferência de quem fica para trás lê **todo integrante ativo no banco** mais
  o **líder** da squad — não só quem está na planilha. Quem a planilha desliga
  não conta. Sobrando alguém, o movimento é bloqueado (`moveBlocked`, fora do
  plano da pré-visualização) e as linhas viram erro nomeando as pessoas;
- o `stuck` da seção 7 deixa de disparar para a squad que vai junto;
- o commit atualiza o `sectorId` da squad dentro da mesma transação, com auditoria
  `UPDATE`, e reporta em `squadsMoved`.

Squad **desativada** continua sendo erro, de propósito.

### 4. Front ✅

- `SquadsSection.tsx`: botão **Excluir** ao lado de Desativar/Ativar, com
  `window.confirm` (padrão do `/admin`) contando os integrantes que saem;
- `UserImportDialog.tsx`: "Além das pessoas" ganha a linha das squads que mudam
  de setor, e o resultado do commit lista `squadsMoved`.

## Testes ✅

- `squad-service.test.ts`: exclui e libera o nome, exclui squad desativada, 409
  com retro, auditoria, 404 entre empresas;
- `routes/admin.test.ts`: exclusão pelo ADMIN e recorte do SUBADMIN;
- `user-import-service.test.ts`: move a squad (inclusive para setor que a própria
  planilha cria), recusa por integrante e por líder deixados para trás, ignora
  quem a planilha desliga, recusa a mesma squad em dois setores, mantém o erro de
  squad desativada;
- `SquadsSection.test.tsx` e `UserImportDialog.test.tsx` do lado do front.
