---
name: verify
description: Como subir e dirigir o Legends (web+api) para verificar mudanças de runtime, incluindo o escritório virtual (Phaser/WebSocket)
---

# Verificar o Legends rodando

## Subir o app

- **Node 20 obrigatório** (`source ~/.nvm/nvm.sh && nvm use 20`) — shell padrão usa 18 e o proxy do Vite quebra (ECONNREFUSED ::1).
- Worktree novo: `pnpm install`, copiar `apps/api/.env` do checkout principal, `pnpm db:generate`. Postgres: container `legends-db` costuma já estar de pé (senão `pnpm db:up`).
- O dev do checkout principal ocupa 5173 (web) e 3333 (api). Mudanças só de frontend: reusar a API de 3333 e subir apenas o Vite do worktree em outra porta:
  `pnpm --filter @legends/web exec vite --port 5174 --strictPort` (launch.json com `bash -lc` + nvm).
- Login: usuários do seed, senha `emr2026@` (ver `apps/api/prisma/seed.ts`); cookie de refresh de localhost vale entre portas — sessão do 5173 já loga o 5174.

## Dirigir o escritório (Phaser) no Browser pane

- **rAF congela quando o pane está oculto** → o loop do Phaser para: teclas são comidas, tweens não progridem e `setTimeout` é agrupado em ticks de ~1s. Não confie em `computer key` nem em screenshots para "acordar" o jogo.
- As teclas sintéticas do pane vêm **sem `keyCode`** e o Phaser mapeia por keyCode: despachar via JS `KeyboardEvent` com `Object.defineProperty(ev, 'keyCode', ...)` (39/37/38/40).
- Handle do jogo: o canvas é do Phaser (sem fiber). Partir da div `[aria-label="Mapa do escritório"]`, andar pela fiber React (`__reactFiber$...` → `fiber.memoizedState` → hooks → `.current` com `sys/game/characters`) → `scene` e `scene.game`.
- **Bombear frames manualmente**: `game.loop.step(t)` com timestamps crescentes roda `update()` e tweens sem rAF. Padrão à prova de rede: fazer clique/tecla + pumps + leitura de estado **numa única chamada síncrona de JS** — nenhum eco de WebSocket consegue rodar no meio (single-thread), então qualquer movimento observado é predição local.
- Estado observável: `scene.characters` (posições dos containers), `scene.predictor` (base/pending), patch em `WebSocket.prototype.send` para logar/atrasar envios (`window.__sendDelay`).
- Segundo usuário/verdade do servidor: script Node com `createRequire(apps/api/package.json)` → `require('ws')`, login via `POST /auth/login`, WS `ws://localhost:3333/office/ws?token=...` — o `welcome` traz as posições server-side de todos.

## Gotchas

- WS de mensagens continua entregando com a aba oculta (só timers/rAF congelam).
- Follow (Seguir) com RTT efetivo ≥500ms dispara retries do `FollowController` e duplica passos — artefato conhecido, não regressão.
- Testes de `ProfilePage.test.tsx` (2) falham pré-existentes na base `feat/destaque-do-mes` (texto duplicado "Conector do Time"/"Mentor").
