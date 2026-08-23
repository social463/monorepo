# Grade da sala: auto-abrir com tela compartilhada, chat aberto por padrão, grid sem scroll

## Problema

A feature da grade estilo Meet (destaque do mês do escritório, painel lateral
chat/pessoas) já está implementada e revisada. Três ajustes de comportamento
foram pedidos depois do review:

1. A grade hoje só abre por ação manual (botão "Abrir grade de câmeras" ou
   clique no botão "grid_view" da MediaBar). Quando alguém está
   compartilhando tela, a grade deveria abrir sozinha, com a tela em
   destaque — tanto ao entrar na sala já com alguém compartilhando, quanto
   quando alguém começa a compartilhar enquanto você já está na sala.
2. O painel lateral nasce sem nada aberto (`roomPanel: null`). Deveria nascer
   sempre no chat.
3. A área de câmeras (destaque + miniaturas, ou grid uniforme) tem hoje
   `overflow-y-auto` — se muita gente estiver com câmera/tela ativa, ela
   ganha scroll. O pedido é que ela NUNCA tenha scroll: com 1 pessoa, a
   imagem ocupa o espaço todo; com 2, o espaço é dividido em 2 partes iguais;
   com 3, em 3; e assim por diante — sempre dividindo, nunca crescendo a
   ponto de precisar rolar.

## Decisões (confirmadas com o usuário)

- **Chat por padrão**: vale para QUALQUER abertura da grade (manual ou
  automática) — `roomPanel` sempre nasce `'chat'`, nunca `null` ou
  `'people'`, quando a grade abre. Fechar a grade continua zerando pra
  `null`.
- **Escopo do "sem scroll"**: os DOIS modos mudam — o modo de destaque (tela
  grande + miniaturas na lateral) e o modo de grid uniforme (sem destaque).
  Nenhum dos dois deve ter overflow/scroll no conteúdo de câmeras.
- **Reabertura após fechar manualmente**: sim, mesmo que a pessoa tenha
  fechado a grade manualmente, um NOVO compartilhamento de tela (começando
  agora, borda de transição — não um que já estava ativo) reabre a grade de
  novo. Só não reabre sozinha à toa enquanto o MESMO compartilhamento
  continua ativo sem mudança.

## Comportamento desejado

### 1. Auto-abrir a grade quando há tela compartilhada

- Entrando numa sala de reunião (`inMeetingRoom` vira `true`) com alguém já
  compartilhando tela (`media.remotes.some(r => r.screenTrack)` já
  verdadeiro nesse instante): a grade abre sozinha (`camerasExpanded` vira
  `true`).
- Já dentro da sala, alguém começa a compartilhar tela (a condição acima
  passa de falso pra verdadeiro): a grade abre sozinha do mesmo jeito, MESMO
  que tivesse sido fechada manualmente antes.
- Se tiver mais de uma tela compartilhada ao mesmo tempo, não importa qual —
  a lógica de destaque já existente (`resolveFeatured`, que já prioriza
  `kind === 'screen'` quando não há pin) escolhe uma; nenhuma mudança
  necessária aí.
- Entrando numa sala sem ninguém compartilhando: a grade continua fechada,
  como hoje (comportamento inalterado nesse caso).
- A pessoa continua podendo fechar a grade manualmente a qualquer momento;
  isso só é "desfeito" automaticamente por uma nova borda de início de
  compartilhamento (não por continuar aberto/fechado do estado atual).

### 2. Painel lateral nasce em "chat"

- Toda vez que `camerasExpanded` vira `true` (manual ou automático),
  `roomPanel` vira `'chat'` (nunca fica `null`).
- Toda vez que `camerasExpanded` vira `false`, `roomPanel` volta a `null`
  (comportamento já existente, mantido).
- A pessoa continua podendo trocar pra "people" ou fechar o painel
  manualmente depois — isso só define o estado inicial de cada abertura.

### 3. Área de câmeras nunca tem scroll — divide o espaço em N partes iguais

- **Grid uniforme** (sem destaque): ao invés de
  `grid-cols-[repeat(auto-fit,minmax(240px,1fr))]` (que deixa a grade
  crescer e precisar de scroll quando não cabe mais), o número de
  colunas/linhas é calculado a partir da quantidade de tiles (`N`):
  `cols = Math.ceil(Math.sqrt(N))`, `rows = Math.ceil(N / cols)` (mínimo 1
  em ambos). O container vira `grid h-full w-full` com
  `gridTemplateColumns`/`gridTemplateRows` inline (`repeat(cols, minmax(0,
  1fr))` / `repeat(rows, minmax(0, 1fr))`), sem `auto-fit`/`minmax(240px,
  ...)` fixo. Cada tile ocupa sua célula inteira (`flex h-full flex-col`
  no tile, vídeo com `min-h-0 flex-1 object-contain`).
- **Destaque** (tela grande + miniaturas): a coluna de miniaturas
  (`w-56 shrink-0`) perde o `overflow-y-auto` e cada miniatura vira
  `flex min-h-0 flex-1 flex-col` — com isso, o flexbox divide a altura da
  coluna igualmente entre as miniaturas presentes, sem crescer além da
  altura disponível.
- A área central (`min-w-0 flex-1 ... p-lg`, que envolve os dois modos)
  troca `overflow-y-auto` por `overflow-hidden` — o conteúdo agora sempre
  cabe exatamente, então overflow nunca deveria acontecer; `overflow-hidden`
  garante que, se acontecer por algum caso extremo não previsto, não vira
  scrollbar visível quebrando o layout.
- O painel lateral (chat/pessoas) NÃO muda — continua com `overflow-y-auto`
  normalmente (mensagens de chat e lista de pessoas podem crescer e rolar
  normalmente; a regra de "sem scroll" é só da área de câmeras).

## Abordagem técnica

### `OfficePage.tsx`

- Novo valor derivado: `anyScreenShared = media.remotes.some((r) =>
  r.screenTrack)`.
- Novo par de refs (`prevInMeetingRoomRef`, `prevAnyScreenSharedRef`) e um
  `useEffect` que compara o valor atual com o anterior a cada render,
  identifica as bordas de transição (`enteredRoom`, `screenShareStarted`) e
  chama `setCamerasExpanded(true)` quando `inMeetingRoom && anyScreenShared
  && (enteredRoom || screenShareStarted)`. Os refs são atualizados no fim do
  efeito.
- O `useEffect` existente que zera `roomPanel` quando `camerasExpanded` fica
  `false` passa a também setar `'chat'` quando fica `true`:
  `setRoomPanel(camerasExpanded ? 'chat' : null)`.

### `MediaTiles.tsx`

- Grid uniforme: computa `cols`/`rows` a partir de `tiles.length` e troca o
  container e os tiles pelas classes/estilo descritos acima.
- Destaque: remove `overflow-y-auto` da coluna de miniaturas e troca a
  classe de cada miniatura de `w-full` pra `flex min-h-0 flex-1 flex-col`
  (com o vídeo/avatar preenchendo `h-full`, reaproveitando o padrão já usado
  no tile de destaque principal).
- Wrapper da área central: `overflow-y-auto` → `overflow-hidden`.
- Nenhuma mudança na lógica de `resolveFeatured`/`buildTiles`/pin — só nos
  containers e classes de tamanho.

## Fora de escopo

- Mudar a lógica de qual tile fica em destaque (`resolveFeatured` já
  prioriza tela compartilhada — comportamento reaproveitado, não alterado).
- Mudar o comportamento do painel lateral em si (chat/pessoas) além do
  estado inicial.
- Qualquer scroll dentro do chat ou da lista de pessoas — continuam
  rolando normalmente.
- Layout responsivo por tamanho de tela/breakpoint além do que já existe.

## Testes

- `OfficePage.test.tsx`: entrar numa sala com tela já compartilhada abre a
  grade sozinha; entrar numa sala sem compartilhamento não abre; começar a
  compartilhar tela já dentro da sala abre a grade mesmo se estava fechada
  manualmente; fechar a grade manualmente enquanto o MESMO
  compartilhamento continua ativo não a reabre sozinha; abrir a grade
  (qualquer forma) sempre nasce com `roomPanel` em `'chat'`.
- `MediaTiles.test.tsx`: grid uniforme com N tiles usa
  `gridTemplateColumns`/`gridTemplateRows` computados a partir de N (alguns
  valores de N verificados: 1, 2, 3, 4); modo de destaque com várias
  miniaturas não tem mais `overflow-y-auto` na coluna lateral; nenhum teste
  existente de destaque/grid/auto-recolhimento/Escape/portal quebra.
