# MediaBar — menu "Mais" e realce visual

Data: 2026-07-27
Branch: `feat/office-toolbar-dock`

## Contexto

A `MediaBar` (`apps/web/src/office/media/MediaBar.tsx`), barra flutuante de mídia
do escritório ao vivo, acumulou botões condicionais ao longo de várias features
(reações, levantar a mão, trancar sala, chat da sala, pessoas da sala, saída de
áudio, alto-falante/broadcast) além dos controles principais (mic, câmera, chat,
compartilhar tela, sair). Quando várias condições coincidem (sala de reunião com
controles de host, saída de áudio disponível, broadcast habilitado), a barra fica
com muitos ícones sempre visíveis.

Um mockup de referência (fornecido pelo usuário) propõe agrupar as ações menos
usadas num botão "Mais" (`apps`) que abre um submenu, deixando a barra principal
enxuta. O mockup também usa um verde-neon como cor de destaque — que já é a cor
`primary`/`primary-container` (`#52fba2`/`#25de88`) do tema Material 3 "Technical
Precision" do app (`apps/web/tailwind.config.ts`), a mesma já usada em
`toolButtonCls` na `MediaBar` atual.

## Escopo

1. Reorganizar os botões da `MediaBar` em barra principal + menu "Mais".
2. Fundo e borda do container principal da `MediaBar` migram para os tokens de
   tema `surface`/`primary-container` (ver "Container principal — fundo e
   borda").
3. Realce visual pontual usando a paleta `primary`/`primary-container` já
   existente no app (glow no indicador online, destaque nos botões-chave, hover
   com glow no ícone).

**Fora de escopo:** replicar o novo fundo/borda para os outros ~15 componentes
flutuantes do escritório que hoje compartilham o estilo `bg-[#2f2f2f]/95
border-white/10` (`OfficePipWindow`, `DeviceMenu`, `CameraBackgroundMenu`,
`KnockRequestModal`, etc.). A `MediaBar` fica visualmente diferente desses
painéis por um tempo — é uma decisão consciente do usuário, com a intenção de
replicar o mesmo tratamento para os outros componentes numa etapa seguinte
(spec própria, não coberta aqui). Nenhuma ação nova, nenhuma mudança de regra
de negócio — só reorganização de layout e acabamento visual dos controles
existentes.

## Barra principal (sempre visível)

Da esquerda pra direita, sem mudanças de handler/condição em relação ao código
atual:

1. Avatar/identidade (menu de status + edição de nome/personagem) — inalterado.
2. Microfone + seta de dispositivo — inalterado.
3. Câmera + seta de efeito de fundo — inalterado.
4. *divisor*
5. Chat da sala (ícone `forum`, badge de não lido) — só quando `showRoomControls`.
6. Compartilhar tela — inalterado, ganha destaque visual quando ativo (ver
   "Realce visual").
7. **Mais** (ícone `apps`, novo) — abre o menu descrito abaixo.
8. *divisor*
9. Sair — inalterado.

## Menu "Mais" (novo)

Popover que abre acima do botão "Mais", mesmo padrão visual/comportamental do
`DeviceMenu`/`CameraBackgroundMenu` já existentes (glass panel escuro, fecha em
outside-click e `Escape`). Itens, na ordem, cada um preservando exatamente a
mesma condição de exibição e o mesmo handler do código atual — só muda onde
renderiza:

- Reagir (abre o seletor de emojis, igual hoje)
- Nearby chat (falar/pensar)
- Levantar a mão — `canRaiseHand`
- Participantes / Pessoas da sala — `showRoomControls`
- Trancar/destrancar sala — `canLockRoom`
- Saída de áudio — `devices.supportsAudioOutputSelection`
- Alto-falante/broadcast — `canBroadcast && broadcast.available`

Atalhos numéricos de reação (1-8) continuam funcionando via listener global de
teclado, independente do menu "Mais" estar aberto ou fechado.

Se nenhum item condicional estiver disponível (ex.: fora de sala de reunião, sem
saída de áudio selecionável, sem broadcast), o menu ainda mostra Reagir e Nearby
chat — nunca fica vazio, então o botão "Mais" sempre tem conteúdo útil.

## Componente novo: `MediaBarMoreMenu`

Novo arquivo `apps/web/src/office/media/MediaBarMoreMenu.tsx`, seguindo o padrão
de `DeviceMenu.tsx`/`CameraBackgroundMenu.tsx`: componente de apresentação puro,
recebe via props os estados e handlers necessários (mesmos que já existem hoje
em `MediaBar`) e não guarda lógica de negócio própria. `MediaBar` mantém o estado
`showMoreMenu` (booleano) junto dos outros (`showMicMenu`, `showBackgroundMenu`,
etc.) e o mesmo padrão de outside-click/Escape já usado para `showModeMenu` e
`showIdentityMenu` (via `data-more-menu-root` + `useEffect`).

## Container principal — fundo e borda

O container da barra principal troca:

- `bg-[#2f2f2f]/95 backdrop-blur` → `bg-surface/70 backdrop-blur-xl` (o token
  `surface` já é `#0c141b`, praticamente idêntico ao `rgba(12,20,27,.7)` do
  glass-panel do mockup — não introduz cor nova, só troca um cinza hardcoded
  pelo token de tema equivalente).
- `border-white/10` → `border-primary-container/20`, alinhando a borda com a
  cor de destaque do app em vez de um cinza neutro.
- `rounded-2xl` e `shadow-2xl` **mantidos como estão** — só fundo/borda mudam,
  não o formato do container (decisão explícita: não adotar o `rounded-full`
  do mockup, pra manter a proporção mais próxima dos outros painéis).

O popover do menu "Mais" (`MediaBarMoreMenu`) usa o mesmo `bg-surface/70
backdrop-blur-xl border-primary-container/20`, para consistência com o
container principal que acabou de mudar.

## Realce visual

Usando exclusivamente tokens já existentes no tema (`primary`, `primary-container`)
e o padrão de glow já usado em `apps/web/src/index.css` (`emblem-glow`,
`mic-speaking`):

1. **Indicador "online"**: a bolinha de status sob o avatar (`presenceStatusDotCls`)
   ganha um pulso neon sutil quando `status === 'online'`, reaproveitando a
   mesma técnica de `box-shadow`/`filter: drop-shadow` pulsante já usada em
   `.badge-emblem`/`.mural-highlight` — não reinventa uma técnica de glow nova.
2. **Botões de destaque**: "Compartilhar tela" (quando `screenShareEnabled`) e o
   botão "Mais" ganham o tratamento `border-primary-container/40
   bg-primary-container/10` com leve `box-shadow` de glow, sinalizando ações de
   destaque — mesma paleta que `toolButtonCls` já usa no estado ativo, só mais
   intensa nesses dois casos específicos.
3. **Hover nos ícones**: leve `text-shadow`/`filter: drop-shadow` verde-neon ao
   passar o mouse sobre qualquer botão da barra e do menu "Mais" — portado do
   micro-interaction JS do mockup para uma classe Tailwind/CSS (`group-hover`),
   sem JS adicional.

## Testes

Atualizar `apps/web/src/office/media/MediaBar.test.tsx`:

- Testes que hoje interagem diretamente com Reagir/Nearby chat/Levantar a
  mão/Participantes/Trancar sala/Saída de áudio/Broadcast passam a abrir o menu
  "Mais" primeiro (clicar no botão `aria-label="Mais opções"` antes de buscar o
  item).
- Aria-labels e `title`s dos itens realocados continuam os mesmos — só o
  caminho de interação muda.
- Novo teste: menu "Mais" fecha em outside-click e em `Escape`, seguindo o
  padrão dos testes existentes para `showModeMenu`/`showIdentityMenu`.
- Novo teste: atalho numérico de reação (tecla `1`) funciona com o menu "Mais"
  fechado.

## Riscos / pontos de atenção

- `MediaBar.tsx` já tem ~780 linhas; extrair `MediaBarMoreMenu` reduz esse
  arquivo, mas ele continua sendo o maior componente do diretório `office/media`
  — não há novo problema introduzido, só não resolve o tamanho por completo.
- Usuários acostumados com a posição atual dos botões (ex. "Reagir" sempre
  visível) precisam de um clique a mais para reagir. Aceito como trade-off
  consciente do pedido (reduzir poluição visual).
- A `MediaBar` fica com fundo/borda diferentes dos outros painéis flutuantes do
  escritório até que o mesmo tratamento seja replicado para eles (fora de
  escopo aqui). Inconsistência temporária aceita pelo usuário.
