# Tasks 22046 e 21922 — Implementation Plan

**Goal:** restringir o cadeado de salas com mesa reivindicada ao dono da mesa e
melhorar a leitura visual da layer de mesas, deixando uma mesa disponível no
mapa default para teste local.

## Passos

- [x] Adicionar helper compartilhado para encontrar a mesa reivindicada contida
  em uma sala de reunião.
- [x] Usar o helper no `OfficeHub` para ignorar tentativas de trancar/destrancar
  feitas por quem não é dono da mesa da sala.
- [x] Usar a mesma regra no `useRoomLock` para habilitar/desabilitar o botão de
  cadeado no cliente.
- [x] Melhorar o desenho Phaser de `desk` para parecer uma mesa padrão, sem
  mudar hitbox, eventos ou contrato.
- [x] Criar migration nova para acrescentar uma mesa reivindicável ao mapa
  legado/default e materializá-la na publicação ativa local.
- [x] Cobrir com testes focados de shared, hub, hook e render helper.

## Verificação

- `pnpm --filter @legends/shared test -- office-map-runtime.test.ts`
- `pnpm --filter @legends/api exec vitest run src/lib/office-hub.test.ts`
- `pnpm --filter @legends/web exec vitest run src/office/media/useRoomLock.test.ts`
- `pnpm --filter @legends/web exec vitest run src/office/scenes/OfficeScene.test.ts`
