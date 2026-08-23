# Toggle de "Reações ao vivo" na toolbar do board de retro — design

**Data:** 2026-07-03
**Status:** aprovado (brainstorming)

## Problema

As reações flutuantes (estilo Meet) hoje têm uma barra de opções (`FloatingReactionBar`,
7 emojis) **sempre visível** embaixo-centro do board. Isso ocupa espaço e pode
atrapalhar na hora de escrever cards. O usuário quer poder **esconder/mostrar** as
opções sob demanda, começando **recolhidas**.

## Decisões (aprovadas)

- Adicionar um botão na **toolbar lateral** (`BoardToolbar`) que **mostra/esconde** a
  `FloatingReactionBar`. Começa **recolhido** (barra escondida).
- Rótulo: **"Reações ao vivo"** — distinto da ferramenta existente **"Reagir"**, que é
  a reação **por card** (persistida). Ícone distinto do smiley da "Reagir".
- O botão é um **toggle**, **separado das ferramentas de modo** (cursor/forma/reagir/
  votar): não altera o modo do ponteiro, só liga/desliga o painel de opções.
- As **reações que sobem na tela** (overlay `FloatingReactions`, reações dos colegas)
  **continuam sempre visíveis** — esconde-se apenas o *seletor* de emojis, não a
  visualização das reações.

## Escopo

### 1. `apps/web/src/pages/retro/BoardToolbar.tsx`

- Assinatura ganha dois props novos:
  ```ts
  liveReactionsOn: boolean
  onToggleLiveReactions: () => void
  ```
- Renderiza as 4 ferramentas de modo como hoje (via `TOOLS`), depois um **separador
  sutil** e um **botão toggle** "Reações ao vivo":
  - `type="button"`, `aria-label="Reações ao vivo"`, `aria-pressed={liveReactionsOn}`.
  - `onClick={onToggleLiveReactions}`.
  - Estilo ativo (quando `liveReactionsOn`) reaproveita o mesmo destaque visual dos
    botões ativos (`bg-surface-container-highest text-primary`).
  - Ícone novo, distinto do `ReactIcon` (smiley) usado pela "Reagir" por card — um
    ícone de coração/sparkle que leia como "reações ao vivo".
- Não altera o tipo `RetroTool` nem o fluxo `tool`/`onSelectTool` (o toggle é
  ortogonal aos modos).

### 2. `apps/web/src/pages/RetroRoomPage.tsx`

- Novo estado local: `const [showLiveReactions, setShowLiveReactions] = useState(false)`
  (**começa recolhido**).
- Passar à `BoardToolbar`: `liveReactionsOn={showLiveReactions}` e
  `onToggleLiveReactions={() => setShowLiveReactions((v) => !v)}`.
- A barra passa a renderizar **só quando ligada**:
  ```tsx
  {canWrite && showLiveReactions && <FloatingReactionBar onReact={socket.sendReaction} />}
  ```
- O overlay `FloatingReactions` (reações que sobem) **permanece inalterado** — sempre
  renderizado, para todos.

## Fora de escopo (YAGNI)

- Não mexer na ferramenta "Reagir" por card (`tool === 'react'`, `ReactionFlyout`).
- Não mudar a posição da `FloatingReactionBar` (segue embaixo-centro; apenas togglada).
- Não persistir o estado do toggle entre recarregamentos (sempre inicia recolhido).
- Não esconder o overlay de reações que sobem.

## Testes

- **`BoardToolbar.test.tsx`** (criar se não existir; senão adicionar casos):
  - Renderiza o botão "Reações ao vivo".
  - Clicar dispara `onToggleLiveReactions`.
  - `aria-pressed` reflete o prop `liveReactionsOn` (false → "false", true → "true").
- **`RetroRoomPage.test.tsx`** (já existe):
  - No estado inicial, a `FloatingReactionBar` **não** está no DOM (nenhum botão
    "Reagir com …").
  - Após clicar no botão "Reações ao vivo" da toolbar, a barra aparece (botões
    "Reagir com …" presentes).

## Impacto

- Somente frontend (`apps/web`): `BoardToolbar.tsx` + `RetroRoomPage.tsx` (+ testes).
- Sem mudança de contrato, API, banco ou do hook de socket.
