# Faixa de câmeras muda de topo horizontal para lateral direita vertical

## Problema

A faixa compacta de câmeras (`MediaTiles`, modo não expandido) hoje é ancorada
no topo da tela, centralizada horizontalmente
(`apps/web/src/pages/OfficePage.tsx:253-256`, `absolute top-3 left-1/2 ...
w-full max-w-2xl -translate-x-1/2`), com os tiles em fileira horizontal e
scroll lateral (`MediaTiles.tsx`, `flex flex-1 gap-md overflow-x-auto`). O
usuário quer essa faixa na lateral direita da tela, em coluna vertical.

## Comportamento desejado

- A faixa passa a ficar ancorada no **canto superior direito** da tela
  (mesmo lado onde hoje ficam os avisos, mas sem competir com eles — ver
  abaixo), crescendo verticalmente pra baixo conforme mais gente aparece.
- Os tiles (câmera, tela compartilhada ou avatar) ficam organizados num
  **grid que reflui em colunas** (`grid-cols-[repeat(auto-fit,minmax(160px,1fr))]`,
  mesmo breakpoint de 160px usado como largura mínima de tile hoje na grade
  expandida) em vez de fileira horizontal — ver "Redimensionamento" abaixo
  para como a largura da coluna (e por consequência o número de tiles por
  linha) é controlada.
- O botão de expandir (ícone `fullscreen`, abre a grade em tela cheia) fica
  **fixo no topo da coluna**, sempre visível, fora da área de rolagem.
- A lista de tiles abaixo do botão tem uma **altura máxima (`max-h-[70vh]`)
  com scroll vertical** — se muita gente entrar na sala, a coluna rola em
  vez de crescer indefinidamente e sobrepor outros controles da tela (ex.:
  zoom, no canto inferior direito).
- A grade expandida em tela cheia (overlay, aberta pelo botão de expandir)
  **não muda** — continua com o mesmo layout (grid uniforme / destaque +
  sidebar) já existente. É um mecanismo **separado** do redimensionamento
  por arraste descrito abaixo.

## Redimensionamento (resize por arraste)

A faixa lateral ganha uma **alça de arraste (drag handle)** na borda
**esquerda**, com cursor `col-resize`. Arrastar pra esquerda alarga a
faixa; pra direita, estreita.

- **Largura mínima:** `160px` (cabe exatamente 1 tile por linha).
- **Largura máxima:** largura da janela menos uma margem pequena (ex.:
  `window.innerWidth - 16`) — arrastar até o fim faz a faixa ocupar
  praticamente a tela toda.
- Conforme a largura muda, o grid de tiles (`auto-fit, minmax(160px,1fr)`)
  reflui automaticamente — mais largura cabe mais tiles por linha; menos
  largura cai pra 1 coluna. Não há necessidade de lógica extra pra
  calcular quantas colunas cabem: é comportamento nativo do CSS Grid.
- **Persistência:** a largura escolhida é salva em `localStorage` (chave
  dedicada, ex. `office-media-strip-width`) e reaplicada na próxima vez que
  a pessoa entrar no escritório. Sem valor salvo, a largura inicial é a
  mínima (`160px`).
- O drag afeta só a largura do container da faixa lateral em
  `OfficePage.tsx` — não abre nem interage com o overlay de tela cheia.

## Efeito colateral: `BroadcastBanner`

Hoje `BroadcastBanner` desce (`top-28` em vez de `top-4`) quando a faixa de
câmeras está visível, pra não sobrepor ela no topo
(`apps/web/src/office/media/BroadcastBanner.tsx`, prop `pushDown`). Como a
faixa deixa de ocupar o topo, essa lógica perde a razão de existir:

- `BroadcastBanner` perde o prop `pushDown` — o aviso de "alguém no
  alto-falante" sempre fica em `top-4`.
- `OfficePage.tsx` remove `topMediaVisible` (só existia pra alimentar esse
  prop) e o próprio prop na chamada de `<BroadcastBanner>`.

## Abordagem

Em `OfficePage.tsx`, o container que hoje envolve `<MediaTiles>` (linhas
253-256) troca de:
```
absolute top-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4
```
para algo equivalente a:
```
absolute top-3 right-3 z-10 flex flex-col gap-sm
```
(sem `w-full max-w-2xl`/`-translate-x-1/2`, que existiam só pra centralizar
horizontalmente).

Em `MediaTiles.tsx`, o bloco da faixa compacta (`{hasVisible && !expanded &&
(...)}`) muda de layout horizontal (`flex items-center gap-sm ...`, lista
interna `flex flex-1 gap-md overflow-x-auto`) para:
- Container externo em coluna (`flex flex-col gap-sm ...`), com largura
  controlada por um `width` (em px) recebido via estado/prop — ver resize
  abaixo.
- Botão de expandir primeiro no DOM (topo da coluna), fora do contêiner de
  scroll.
- Lista de tiles filtrados (mesmo `tiles.filter((t) => showAllPresent ||
  t.kind !== 'avatar')` já existente) dentro de um contêiner com `grid
  grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-md max-h-[70vh]
  overflow-y-auto` (em vez de `flex ... overflow-x-auto` horizontal).

O estado de largura (`width`, em px) e a alça de arraste vivem em
`OfficePage.tsx` (dono do container posicionado), inicializado a partir do
`localStorage` (fallback 160px) e persistido a cada mudança. `MediaTiles`
recebe a largura efetiva via `style={{ width }}` no container que
`OfficePage.tsx` já envolve `<MediaTiles>` — não precisa de novo prop no
componente, só o container pai controla a largura. A alça de arraste (uma
`div` fina de ~4px na borda esquerda do container, `cursor-col-resize`,
listeners de `pointerdown`/`pointermove`/`pointerup` em `window` durante o
arraste) também fica em `OfficePage.tsx`, junto do container.

Nenhuma mudança em `buildTiles`, `hasVisible`, `showAllPresent`,
`AvatarTile`/`VideoTile` ou na grade expandida — a faixa compacta muda de
fileira horizontal fixa pra grid vertical com largura ajustável, mais a
remoção do `pushDown`.

## Fora de escopo

- Grade expandida (tela cheia) — layout inalterado.
- Lógica de visibilidade (`hasVisible`, `showAllPresent`) — inalterada,
  feature anterior.
- Redimensionamento vertical (altura) — só a largura é ajustável; a altura
  continua limitada por `max-h-[70vh]` com scroll.

## Testes

- `MediaTiles.test.tsx`: ajustar/confirmar que os testes existentes que
  inspecionam a faixa compacta (ex.: via `container.querySelector` de uma
  classe específica) continuam funcionando com o novo container; não há
  necessidade de testar classes Tailwind específicas, mas testes que
  dependem da estrutura DOM (quantidade de `figure`, texto, ordem) devem
  continuar passando sem alteração de asserts.
- `BroadcastBanner.test.tsx`: remover/ajustar teste(s) que hoje cobrem o
  prop `pushDown` (`top-28` vs `top-4`), já que o prop deixa de existir.
- `OfficePage.test.tsx`: ajustar qualquer teste que dependa de
  `topMediaVisible` sendo passado pro `BroadcastBanner`; adicionar
  cobertura pro resize — arrastar a alça atualiza a largura do container
  (clamp no mínimo 160px e no máximo `window.innerWidth - 16`), e a
  largura é lida/persistida em `localStorage` (mock de
  `window.localStorage` no teste).
