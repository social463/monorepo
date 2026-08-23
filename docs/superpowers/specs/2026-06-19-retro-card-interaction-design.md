# Design — Card limpo + modelo de ferramentas do board (Cursor/Post-it/Reagir/Votar)

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board`
- **Escopo:** **frontend apenas**. Sem API/DB/migration. Sem novos tipos no `@legends/shared`.
- **Referência visual:** print de card "limpo" (sticky azul com avatar discreto no topo, sem botões).
- **Base:** evolui o round da toolbar (`2026-06-19-retro-board-toolbar-design.md`), que introduziu Cursor/Post-it/Reagir e os flyouts.

## Objetivo

Tornar o post-it **limpo** (sem controles inline) e mover toda a interação para um modelo
de **ferramenta selecionada**. A toolbar passa de 3 para **4 ferramentas**: Cursor,
Post-it, Reagir e **Votar**. Criar, escrever, excluir, reagir e votar passam a ser ações
das ferramentas / do teclado, não de botões no card.

**Fora deste round:** picker de emoji completo (segue restrito às 6 reações), tamanhos de
post-it, conectores/caneta/formas/frames, e qualquer mudança de contrato/backend.

## Estado atual (o que muda)

- `apps/web/src/pages/retro/PostIt.tsx`: hoje o card mostra texto + autor ("Você"/nome) +
  cluster de voto (`− contador +`) + 6 botões de reação + links `editar`/`excluir`. Edição
  é estado **interno** do componente (`editing`/`draft`). **Será reescrito**: card limpo,
  estados `selected`/`editing` vindos da página, selos read-only condicionais.
- `apps/web/src/pages/RetroRoomPage.tsx`: estado `tool: 'cursor'|'postit'|'react'` +
  `activeReaction`; `createAtCenter` cria post-it no centro; `onCardPointerDown` arrasta
  (ou carimba no modo react). **Será estendido** com o 4º modo, seleção/edição/exclusão,
  e placement por clique.
- `apps/web/src/pages/retro/StickyFlyout.tsx`: `onPick(color)` hoje cria direto (via
  `createAtCenter`). **Passa a armar** uma cor (fecha o flyout; a criação vira clique no
  board).
- `apps/web/src/pages/retro/BoardToolbar.tsx`: 3 ferramentas. **Ganha a 4ª (Votar)**.
- Mutations já existentes e reaproveitadas: `createM` (`createRetroCard`), `editM`
  (`updateRetroCard`), `deleteM` (`deleteRetroCard`), `voteM` (`addRetroVote`/
  `removeRetroVote`, retorna `{voteCount, myRemainingVotes}`), `reactM`
  (`toggleRetroReaction`). DTO do card: `text`, `x`, `y`, `color`, `author`, `mine`,
  `voteCount`, `myVotes`, `reactions[{emoji,count,reactedByMe}]`.

## 1. PostIt limpo (reescrita)

Card sem nenhum controle inline. Renderiza:
- **Texto** (ou `<textarea>` com caret quando `editing`).
- **Autor discreto**: avatar/inicial pequeno no canto superior (como no print); sem o
  texto "Você"/nome ocupando o rodapé.
- **Selos read-only condicionais** — só aparecem quando há valor, somem ao zerar:
  - Votos: um selo com o total (`★ {voteCount}`) quando `voteCount > 0`.
  - Reações: um chip por emoji presente (`{emoji} {count}`) para cada reação com `count > 0`.
  - São **somente leitura** (não clicáveis); a interação acontece pelas ferramentas.
- **Estado visual**: `selected` → anel/borda de seleção; `editing` → textarea focado.
  Card "em repouso" não tem caret nem borda.

O componente é **controlado**: recebe `selected`, `editing` e callbacks
(`onCommitText(text)`), além do `onPointerDown` para a página orquestrar
seleção/edição/arrasto/carimbo. Não guarda mais o modo de edição internamente (só o
`draft` local do textarea enquanto edita).

## 2. Estado e orquestração na RetroRoomPage

Novos/alterados:
- `tool: 'cursor' | 'postit' | 'react' | 'vote'` (default `'cursor'`).
- `selectedCardId: string | null`, `editingCardId: string | null`.
- `pendingColor: RetroCardColor | null` (cor armada do Post-it).
- `activeReaction: ReactionStamp | null` (existente; carimbo do Reagir).
- `voteMode: 'add' | 'remove'` (carimbo do Votar; default `'add'`).

Trocar de ferramenta limpa estados incompatíveis (sair de `postit` zera `pendingColor`;
sair de `react`/`vote` zera o carimbo respectivo; trocar de ferramenta também sai da
edição).

## 3. Cursor — selecionar / editar / arrastar / excluir

- **Clique vs. arrasto** distinguidos por um **limiar de movimento (~4px)**: pointerdown
  no card inicia um arrasto tentativo; se o ponteiro mexer além do limiar antes do
  pointerup, é arrasto (move via `socket`/`updateRetroCardPosition`, como hoje); se soltar
  sem mexer, é **clique**.
- **Clique** num card:
  - não selecionado → **seleciona** (`selectedCardId = card.id`), sem editar.
  - já selecionado (ou duplo-clique) → **edita** (`editingCardId = card.id`, textarea
    focado).
- **Clique no vazio** (canvas/world background) → desseleciona e sai da edição.
- **Del/Backspace**: se há `selectedCardId` e **não** está editando → `deleteM`. Durante a
  edição, a tecla edita o texto normalmente (não exclui o card).
- **Esc**: sai da edição (volta a "selecionado").
- Commit do texto: ao sair da edição (blur/Esc/clicar fora), se mudou e não-vazio →
  `editM`; senão restaura.

## 4. Post-it — armar cor e posicionar por clique

- Selecionar a ferramenta Post-it abre o `StickyFlyout`.
- Clicar numa cor: **fecha o flyout** e arma `pendingColor` (não cria ainda).
- Com `pendingColor` armado, o **próximo clique no board** cria o card naquele ponto:
  converte as coordenadas de tela do clique para mundo (`vp.toWorld`) e chama `createM`
  com `x/y` centralizados no clique (subtraindo metade de `POSTIT_WIDTH/HEIGHT`, como o
  `createAtCenter` faz hoje).
- Após criar: volta para a ferramenta **Cursor** e deixa o card novo **selecionado** (sem
  entrar em edição — regra uniforme do 2º clique). Para criar vários, reabre o Post-it.
- O cursor do canvas indica o modo armado (ex.: `crosshair`).

## 5. Reagir (inalterado funcionalmente)

Mantém o `ReactionFlyout` (6 emojis + borracha) e o carimbo por clique no card já
implementados. Única diferença visível: a reação aplicada agora aparece como **selo
read-only** no card (seção 1), não mais como botão. O clique-carimbo segue indo por
`reactM`.

## 6. Votar (nova ferramenta)

- Novo `VoteFlyout`: dois modos de carimbo — **Votar (+)** e **Borracha (−)** — e um
  rótulo "Votos restantes: {myRemainingVotes}". Carimbo padrão `'add'`.
- Com a ferramenta Votar ativa, clicar num card:
  - modo `add` → `voteM('add')` se `myRemainingVotes > 0` (senão no-op visual);
  - modo `remove` → `voteM('remove')` (já protegido por `myVotes === 0` no service/UI).
- Reaproveita `addRetroVote`/`removeRetroVote` (a página já tem `voteM`).

## 7. BoardToolbar — 4ª ferramenta

Acrescenta o botão **Votar** (ícone SVG inline, ex.: seta/joinha ou "+1"), com
`aria-label="Votar"` e `aria-pressed`. `RetroTool` passa a incluir `'vote'`.

## Componentes e arquivos (frontend)

- `apps/web/src/pages/retro/PostIt.tsx` — **reescrito**: card limpo, selos read-only,
  estados `selected`/`editing` controlados, props/callbacks ajustados.
- `apps/web/src/pages/RetroRoomPage.tsx` — estado dos 4 modos, seleção/edição/exclusão
  (Del/Esc), placement por clique, fiação dos flyouts.
- `apps/web/src/pages/retro/BoardToolbar.tsx` — 4º botão (Votar); `RetroTool += 'vote'`.
- `apps/web/src/pages/retro/StickyFlyout.tsx` — `onPick` arma a cor (semântica de
  "escolher", a criação migra para a página).
- `apps/web/src/pages/retro/VoteFlyout.tsx` — **novo**: votar/borracha + votos restantes.
- `ReactionFlyout.tsx` — inalterado.

## Testes

Vitest + jsdom + Testing Library. Sem testes de API (round é frontend).

- **PostIt.test.tsx**: card limpo (sem botões de voto/reação/editar/excluir); selo de voto
  aparece só com `voteCount > 0`; chip de reação só quando `count > 0`; `editing` mostra
  textarea e `onCommitText` dispara no commit; `selected` aplica a borda.
- **VoteFlyout.test.tsx**: mostra +voto, borracha e "Votos restantes: N"; `onSelect`
  dispara `'add'`/`'remove'`; marca o ativo.
- **BoardToolbar.test.tsx**: agora 4 botões; Votar dispara `onSelectTool('vote')`.
- **RetroRoomPage.test.tsx**:
  - Post-it: selecionar a ferramenta + clicar a cor **arma** (não cria); clicar no board
    cria via `createRetroCard` e o card novo fica selecionado.
  - Cursor: 1º clique seleciona; 2º clique edita; Del exclui o selecionado (chama
    `deleteRetroCard`) e **não** exclui durante a edição.
  - Vote: ferramenta Votar + clicar num card chama `addRetroVote`; borracha → `removeRetroVote`.
  - Mantém o teste de carimbo de reação.
- Mocks atuais de `retro-api`/`useRetroSocket`/`AuthContext` preservados.

## Riscos e decisões conscientes

- **Clique vs. arrasto** (limiar de 4px): o `socket.grab` não deve "travar" o card num
  clique simples — só inicia o lock quando vira arrasto de fato (mover além do limiar).
- **Del global**: o handler de teclado precisa ignorar quando o foco está num
  `input`/`textarea` (edição), para não excluir o card ao apagar texto.
- **Placement em clique de card vs. vazio**: com `pendingColor` armado, o clique cria no
  ponto do clique mesmo que caia sobre um card existente (cria por cima); o destino é o
  ponto do ponteiro convertido para mundo.
- **Selos read-only**: votar/reagir continuam visíveis ao vivo (aparecem assim que há
  valor), evitando que a ferramenta fique "invisível"; somem ao zerar.
- **Sem backend**: votos/reações/edição/exclusão usam as rotas e mutations já existentes;
  nada de contrato muda.
