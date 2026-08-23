# Design — Toolbar lateral de ferramentas do board de retro

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board`
- **Escopo:** **frontend apenas**. Sem API/DB/migration. Sem novos tipos no `@legends/shared`.
- **Referência visual:** prints de ferramenta de retro (Metro Retro-like) enviados pelo usuário — toolbar vertical à esquerda, flyout de stickies, flyout de emojis.

## Objetivo

Substituir a paleta de cores fixa no rodapé do board por uma **toolbar vertical à
esquerda** no estilo do print, com um modelo de **ferramenta selecionada** (cursor /
post-it / reagir). É o item **E** explicitamente adiado no design anterior
(`2026-06-19-retro-board-print-ui-design.md`), agora destravado — porém só com as três
ferramentas combinadas, "por enquanto".

**Fora deste round** (cada um vira seu próprio ciclo, pois exigem backend/contrato):
- Conectores, caneta, formas, carimbos genéricos, frames, votação com corações.
- "Big Stickies" (segundo tamanho de post-it), formatação de texto do sticky, pin do flyout.
- Emoji picker completo: busca, categorias, tons de pele e emojis fora das 6 reações
  atuais — o tipo de reação é **fechado** em `RETRO_REACTION_EMOJIS` no `@legends/shared`
  e na API/DB; ampliar exige mudança de contrato/schema.

## Estado atual (o que existe e será alterado)

- `apps/web/src/pages/RetroRoomPage.tsx`: board full-screen; sem estado de "ferramenta
  ativa". A paleta de cores (`ColorPalette`) fica fixa no rodapé centralizado e, ao
  clicar uma cor, chama `createAtCenter(color)` (cria post-it no centro da viewport).
  `onCanvasPointerDown` inicia pan; `onCardPointerDown` inicia arrasto do card. As
  reações são aplicadas via `reactM` a partir dos botões inline do `PostIt`.
- `apps/web/src/pages/retro/ColorPalette.tsx`: exporta `CARD_COLOR_CLASS`
  (`Record<RetroCardColor,string>`) **e** o componente `ColorPalette`. O `CARD_COLOR_CLASS`
  é reaproveitado pelo `PostIt`.
- `apps/web/src/pages/retro/PostIt.tsx`: card com texto/editar/excluir e cluster inline
  de voto (`− contador +`) + 6 botões de reação (`RETRO_REACTION_EMOJIS`). Esse
  comportamento inline **permanece** (voto e reações continuam visíveis no card).
- `packages/shared/src/retro.ts`: `RETRO_CARD_COLORS` (6 cores), `RETRO_REACTION_EMOJIS`
  (6 emojis) — **inalterados** neste round.

## 1. Toolbar vertical à esquerda

Coluna fixa (screen space) encostada na borda esquerda do canvas, centralizada
verticalmente. Cartão arredondado com sombra e borda sutil, ícones empilhados — segue o
mesmo vocabulário visual de `ZoomControls` (rounded, `bg-surface-container`, `shadow-lg`,
`border-outline-variant/40`).

- 3 botões de ferramenta: **Cursor**, **Post-it**, **Reagir**.
- O botão da ferramenta ativa fica destacado (fundo realçado, ex.
  `bg-surface-container-highest` + texto `text-primary`).
- Ícones: **SVG inline** simples (seta, sticky, carinha), sem nova dependência. Se
  `lucide-react` já estiver no projeto, pode-se usar; decisão na implementação, mas o
  default é SVG inline para não introduzir dependência.
- Só aparece quando `canWrite` (mesma condição da paleta atual). No modo leitura/sala
  concluída, não renderiza.
- **Remove** a `ColorPalette` do rodapé. A escolha de cor passa a viver no flyout do
  Post-it.

## 2. Ferramenta Cursor (padrão)

- Estado inicial. Mantém **exatamente** o comportamento atual: arrastar cards
  (`onCardPointerDown`), pan do canvas (`onCanvasPointerDown`), zoom por roda/controles.
- Cards mantêm **voto + reações inline visíveis** (nenhuma mudança no `PostIt`).

## 3. Ferramenta Post-it → flyout de cores

- Ao selecionar a ferramenta Post-it, abre um **flyout à direita da toolbar** (estilo do
  print "Stickies"), com título **"Post-its"** e as **6 cores** (`RETRO_CARD_COLORS`)
  como swatches quadrados estilo sticky (reusa `CARD_COLOR_CLASS`).
- Clicar uma cor chama o atual `createAtCenter(color)` → cria o post-it no centro da
  viewport. O flyout **permanece aberto** para adicionar vários; fecha ao trocar de
  ferramenta, clicar fora, ou selecionar Cursor.
- Enquanto a ferramenta Post-it está ativa, pan/arrasto seguem funcionando normalmente
  (a criação é só via swatch). Não há "clique-para-posicionar" neste round.

## 4. Ferramenta Reagir → flyout de reações (carimbo)

- Ao selecionar a ferramenta Reagir, abre um **flyout à direita da toolbar** (estilo do
  print de emojis, porém enxuto) com as **6 reações** (`RETRO_REACTION_EMOJIS`) + um
  botão **"Eraser"**.
- Selecionar um emoji define o **carimbo ativo**. Com um emoji ativo, **clicar num card**
  aplica aquela reação via `reactM` (toggle existente). Com o **Eraser** ativo, clicar
  num card remove a reação daquele usuário (o toggle atual já alterna add/remove; o
  eraser força a remoção quando presente).
- Clicar em card no modo Reagir **não** inicia arrasto/edição — só aplica/remove a reação.
- Os botões inline de voto/reação do card continuam visíveis e utilizáveis em qualquer
  modo (a ferramenta Reagir é um atalho de carimbo, não substitui o inline).

## 5. Estado e fiação

- Novo estado em `RetroRoomPage`: `tool: 'cursor' | 'postit' | 'react'` (default
  `'cursor'`), `activeReaction: RetroReactionEmoji | 'eraser' | null` (carimbo ativo).
- O flyout exibido segue a ferramenta selecionada (post-it → cores; reagir → reações).
- `onCardPointerDown`: se `tool === 'react'` e há carimbo ativo, aplica reação e **não**
  arrasta; caso contrário, arrasta (modo cursor) — no modo `postit` o arrasto segue
  permitido.
- `onCanvasPointerDown`: pan segue ativo (não muda).

## Componentes e arquivos (frontend)

- `apps/web/src/pages/retro/BoardToolbar.tsx` — **novo**. Coluna de ferramentas; props
  `tool`, `onSelectTool(tool)`. Renderiza os 3 botões com destaque do ativo.
- `apps/web/src/pages/retro/StickyFlyout.tsx` — **novo**. Flyout de cores; props
  `onPick(color)`, `disabled`. Reusa `CARD_COLOR_CLASS` e `RETRO_CARD_COLORS`.
- `apps/web/src/pages/retro/ReactionFlyout.tsx` — **novo**. Flyout de reações + eraser;
  props `active: RetroReactionEmoji | 'eraser' | null`, `onSelect(value)`. Reusa
  `RETRO_REACTION_EMOJIS`.
- `apps/web/src/pages/RetroRoomPage.tsx` — estado `tool`/`activeReaction`; render da
  toolbar + flyout (substituindo a `ColorPalette` do rodapé); fiação do clique-carimbo
  em `onCardPointerDown`.
- `apps/web/src/pages/retro/ColorPalette.tsx` — **mantém** o `CARD_COLOR_CLASS`
  (reaproveitado por `PostIt` e `StickyFlyout`). O componente `ColorPalette` em si deixa
  de ser usado; pode ser removido se nenhum import restar (o `CARD_COLOR_CLASS` pode
  migrar para um módulo neutro, ex. `card-colors.ts`, se preferível — decisão de
  implementação, sem mudança de comportamento).

## Testes

Vitest + jsdom + Testing Library. Sem testes de API (round é frontend).

- **`BoardToolbar.test.tsx`**: renderiza os 3 botões (Cursor/Post-it/Reagir); destaca o
  ativo; clicar dispara `onSelectTool` com a ferramenta certa.
- **`StickyFlyout.test.tsx`**: renderiza 6 swatches; clicar dispara `onPick(color)`.
- **`ReactionFlyout.test.tsx`**: renderiza as 6 reações + eraser; clicar dispara
  `onSelect` com o valor certo; destaca o ativo.
- **`RetroRoomPage.test.tsx`**: ferramenta inicial é cursor; selecionar Post-it mostra o
  flyout de cores e clicar uma cor cria card (mock de `createRetroCard`); selecionar
  Reagir mostra o flyout de reações; com carimbo ativo, clicar num card chama
  `toggleRetroReaction`; a `ColorPalette` do rodapé não está mais presente. Mantém os
  mocks atuais de `retro-api`/`useRetroSocket`/`AuthContext`.

## Riscos e decisões conscientes

- **Conflito clique vs. arrasto no modo Reagir**: `onCardPointerDown` precisa diferenciar
  "carimbar" de "arrastar". Decisão: no modo `react` com carimbo ativo, o pointerdown no
  card aplica a reação e não arrasta. No modo `cursor`/`postit`, arrasta como hoje.
- **Reações fechadas em 6**: o flyout do Reagir é fiel ao print só na forma; o conteúdo
  fica restrito às 6 reações suportadas pelo backend. Picker completo = round futuro com
  mudança de contrato.
- **Eraser**: o `toggleRetroReaction` atual já alterna; o eraser é tratado como
  "intenção de remover" no clique. Se o usuário não tem aquela reação, o clique é no-op
  visual (sem erro).
- **`CARD_COLOR_CLASS` mora em `ColorPalette.tsx`**: ao remover o componente, garantir
  que o `export` do mapa permaneça acessível (mover para módulo neutro se o arquivo for
  apagado), pois `PostIt` depende dele.
