# Volume local por usuário na sala

## Tarefas

1. Criar preferência local por usuário (`localStorage`, padrão `100%`, clamp
   `0-100`).
2. Aplicar a preferência nos sinks de áudio remoto (`RemoteAudio` e áudio
   espacial).
3. Expor controle de volume no card de personagem e nos tiles remotos da grade.
4. Cobrir persistência, aplicação de áudio e UI com testes focados.

## Verificação

- `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx src/office/media/remoteUserVolumePreferences.test.ts src/office/media/RemoteAudio.test.tsx src/office/media/SpatialRemoteAudio.test.tsx src/office/media/spatialAudio.test.ts src/office/media/MediaTiles.test.tsx src/office/media/RoomPeoplePanel.test.tsx src/office/CharacterCard.test.tsx src/office/session/OfficeSessionContext.test.tsx`
- `pnpm --filter @legends/web exec tsc --noEmit`

