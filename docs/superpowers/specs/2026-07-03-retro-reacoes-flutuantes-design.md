# Reações flutuantes no board de retrospectiva (estilo Google Meet) — design

**Data:** 2026-07-03
**Status:** aprovado (brainstorming)

## Problema / objetivo

No board de retrospectiva, dar aos participantes uma forma leve e ao vivo de
"reagir" durante a sessão — estilo Google Meet: clica num emoji e ele **sobe na
tela e some**. Efêmero (não é voto nem reação por card), transmitido a todos os
presentes na sala em tempo real.

Restrições do usuário:
- 7 opções de reação (o pedido inicial era 5; ampliado para 7 na conversa).
- A reação **sobe apenas uma fração da tela** (~35% da altura do board), não a
  tela inteira, para não prejudicar a visibilidade do conteúdo.
- Mostra **quem reagiu** (emoji + mini-avatar + primeiro nome), estilo Meet.

## Decisões de UX (aprovadas)

- **Espaço de tela**, não coordenada de mundo: a reação nasce na base do viewport
  do board e sobe verticalmente. Não é ancorada a nenhum card.
- **7 emojis:** `👍 ❤️ 😂 😮 😢 👏 🎉`.
- **Identidade visível:** emoji + mini-avatar + primeiro nome de quem reagiu.
- **Barra de gatilho:** pílula flutuante ancorada **embaixo ao centro** do board.
- **Modo anônimo:** reação é uma "vibe" efêmera, não ligada à autoria de card →
  **mantém nome/avatar mesmo com o modo anônimo do board ligado**.

## Arquitetura

Espelha o padrão dos **cursores ao vivo** (`cursor` / `cursor.moved`): canal
efêmero pelo WebSocket existente da sala, relay em memória pelo `RetroHub`, sem
persistência em banco. Nenhuma tabela nova, nenhuma migration.

Herda a limitação atual do hub (estado em memória, instância única; Redis é passo
futuro documentado em `retro-hub.ts`).

### 1. Contrato compartilhado — `packages/shared/src/retro.ts`

- Nova constante e tipo:
  ```ts
  export const RETRO_FLOAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🎉'] as const
  export type RetroFloatReaction = (typeof RETRO_FLOAT_REACTIONS)[number]
  ```
- Cliente→servidor: adicionar a `RetroClientMessage`:
  ```ts
  | { type: 'reaction.float'; emoji: string }
  ```
  (nome `reaction.float`, não `reaction`, para não confundir com o `reaction.changed`
  das reações persistidas por card.)
- Servidor→clientes: adicionar ao grupo **efêmero** de `RetroEvent`:
  ```ts
  | { type: 'reaction.floated'; userId: string; name: string; emoji: string }
  ```

### 2. Servidor — `apps/api/src/routes/retro-ws.ts`

- Novo `case 'reaction.float'` no switch de mensagens do socket:
  - Valida `RETRO_FLOAT_REACTIONS.includes(msg.emoji)`. Se inválido, **ignora
    silenciosamente** (sem erro, como o resto do canal efêmero).
  - `retroHub.broadcast(roomId, () => ({ type: 'reaction.floated', userId, name, emoji: msg.emoji }))`
    — para **todos, inclusive quem enviou** (diferente do `cursor`, que retorna
    `null` para o próprio autor). Assim há um único caminho de renderização e o
    autor também vê a própria reação.

### 3. Cliente — hook `apps/web/src/lib/useRetroSocket.ts`

- `sendReaction(emoji: string)` com **throttle leve** (`FLOAT_REACTION_THROTTLE_MS`,
  ex.: 400ms) para evitar spam por clique repetido.
- Ao receber `reaction.floated`: cria um item transiente
  `{ id, userId, name, emoji, xPercent, createdAt }`:
  - `id` gerado localmente (contador incremental ou `crypto.randomUUID()`).
  - `xPercent` aleatório local (ex.: 8–88%) — a posição horizontal **não** é
    transmitida; cada cliente sorteia a sua.
  - Empilha num array de estado e **remove após `FLOAT_REACTION_TTL_MS`**
    (~2500ms) via `setTimeout`, coerente com a duração da animação.
- Expõe `floatingReactions` no retorno do hook (como já faz com `cursors`).

### 4. Renderização — novo `apps/web/src/pages/retro/FloatingReactions.tsx`

- Renderizado como **irmão** da camada "mundo" dentro do container do viewport
  (ao lado de `<LiveCursors>` em `RetroRoomPage.tsx`), com `z-50` e
  `pointer-events-none`, `absolute inset-0 overflow-hidden`.
- Props: `reactions: FloatingReaction[]` e `participants: RetroParticipantDTO[]`
  (para resolver o avatar pelo `userId`).
- Cada reação: posicionada `absolute` na base, `left: ${xPercent}%`, animada por
  keyframe CSS que sobe `FLOAT_RISE_RATIO` (~0.35) da altura do container e faz
  fade-out ao longo de `FLOAT_REACTION_TTL_MS`.
- Conteúdo: emoji grande + mini-avatar (`<Avatar>` resolvido do participante) +
  primeiro nome. Se o `userId` não estiver no roster (borda), cai para iniciais/nome.
- A animação de "subir" é definida via keyframes (Tailwind `@keyframes`/arbitrary
  ou estilo inline com `@keyframes` no CSS global do web) — reaproveitar a
  abordagem de animação já existente no projeto se houver; senão, keyframe local.

### 5. Gatilho — novo `apps/web/src/pages/retro/ReactionBar.tsx`

- Pílula flutuante ancorada embaixo ao centro do board
  (`absolute bottom-4 left-1/2 -translate-x-1/2`, `z-40`), botões com os 7 emojis.
- Cada botão chama `onReact(emoji)` → `socket.sendReaction(emoji)`.
- `aria-label` em português por botão (ex.: "Reagir com coração").
- Visível quando a sala está aberta/ativa (mesma condição de interatividade do
  board; não aparece em sala concluída/somente-leitura).

## Fora de escopo (YAGNI)

- Persistir reações ou contabilizar histórico.
- Sincronizar a posição horizontal exata entre clientes.
- Reações por card (isso já existe e é outra feature — `RetroReactionSummary`).
- Redis / multi-instância (limitação herdada do hub atual).
- Customização do conjunto de emojis por usuário.

## Testes

- **shared:** `RETRO_FLOAT_REACTIONS` existe com os 7 emojis; tipos compilam.
- **api (`apps/api/src/routes/retro-ws.ts`):** ao receber `{type:'reaction',emoji}`
  com emoji válido, o hub transmite `reaction.floated` para **todos os presentes,
  incluindo o autor**; emoji fora do conjunto é ignorado (nenhum broadcast). Seguir
  o estilo dos testes de WS/relay existentes; se não houver harness de WS,
  testar a função de validação/relay isoladamente.
- **web:**
  - `FloatingReactions` renderiza um item por reação, com emoji e primeiro nome,
    resolvendo o avatar do roster.
  - `ReactionBar` renderiza 7 botões e chama `onReact` com o emoji certo ao clicar.
  - Redutor do `useRetroSocket`: `reaction.floated` adiciona ao array; item é
    removido após o TTL (usar timers falsos do Vitest).

## Impacto

- `packages/shared` (contrato), `apps/api` (só relay no WS, sem migration/DB),
  `apps/web` (hook + 2 componentes novos + montagem no `RetroRoomPage`).
- Sem mudança de banco, sem novo endpoint REST.
```
