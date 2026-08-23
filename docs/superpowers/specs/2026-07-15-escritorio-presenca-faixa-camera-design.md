# Faixa de câmeras aparece com presença em sala (não só com mídia ativa)

## Problema

Hoje, ao entrar numa sala de reunião (zona `meeting-room`/`private-zone`), a
faixa de câmeras (`MediaTiles`, modo compacto) só aparece quando alguém —
local ou remoto — já ligou câmera ou compartilhou tela
(`apps/web/src/office/media/MediaTiles.tsx:182`, `hasVisible`). Quem entra
numa sala com todo mundo de câmera fechada não vê feedback nenhum de que
está acompanhado; a faixa só surge no instante em que a primeira pessoa liga
a câmera.

O espaço aberto do escritório (mapa geral, fora de qualquer zona) não entra
no escopo desta mudança — lá o comportamento (mostrar faixa só com mídia
ativa) permanece como está.

## Comportamento desejado

Dentro de uma sala/zona (`inMeetingRoom`, já calculado em
`apps/web/src/pages/OfficePage.tsx:62` via `mapZoneAt`), a faixa compacta
passa a aparecer sempre que há **presença** na sala — você e/ou qualquer
remoto conectado à mesma sala LiveKit — independente de câmera/tela ativas.
Quem não tem câmera ligada aparece como um tile de avatar (foto/iniciais +
nome), reaproveitando o `AvatarTile` que já existe hoje só na grade
expandida. Isso inclui o próprio usuário: se você está na sala sem câmera,
seu próprio tile de avatar aparece na faixa (não só os outros).

Fora de sala (espaço aberto), nada muda: a faixa continua exigindo pelo
menos uma câmera ou tela ativa para aparecer.

## Abordagem

`MediaTiles` ganha um novo prop `showAllPresent: boolean`, que
`OfficePage.tsx` passa como `inMeetingRoom`. Internamente:

- A faixa compacta deixa de montar `VideoTile`s "na mão" a partir de
  `remotes`/`local` e passa a iterar sobre `tiles` (resultado de
  `buildTiles`, já usado pela grade expandida), renderizando `VideoTile` para
  tiles `camera`/`screen` e `AvatarTile` para tiles `avatar`. Isso elimina a
  duplicação de lógica entre faixa compacta e grade expandida.
- `hasVisible` (o gate que decide se a faixa aparece) passa a ser:
  - `showAllPresent` true → `tiles.length > 0` (há qualquer presença: local
    ou ao menos um remoto conectado à sala).
  - `showAllPresent` false (espaço aberto) → comportamento atual, isto é, ao
    menos um tile de `camera`/`screen` (equivalente a
    `tiles.some(t => t.kind !== 'avatar')`).
- O efeito que auto-recolhe a grade expandida quando ninguém mais tem
  mídia visível (`MediaTiles.tsx:186-188`) continua usando o mesmo
  `hasVisible`, sem mudança de comportamento adicional.

Em `OfficePage.tsx`, `topMediaVisible` (usado só para empurrar o
`BroadcastBanner` para baixo quando a faixa está visível) espelha a mesma
regra: `inMeetingRoom ? (local !== null || media.remotes.length > 0) :
(condição atual de câmera/tela)`.

## Fora de escopo

- Espaço aberto (fora de zona) — comportamento inalterado.
- Qualquer mudança em como salas LiveKit são atribuídas/conectadas
  (`useOfficeMedia.ts`) — a lista de `remotes` já reflete quem está
  conectado à sala corrente; não é necessário alterar a camada de conexão.
- Mudança visual do `AvatarTile` em si (tamanho/estilo) — reaproveitado como
  já existe.

## Testes

- `MediaTiles.test.tsx` (se existir; senão criar): faixa compacta aparece
  com `showAllPresent=true` e apenas presença sem mídia (local ou remoto sem
  `cameraTrack`/`screenTrack`); faixa some quando não há ninguém
  (`tiles.length === 0`); comportamento de espaço aberto
  (`showAllPresent=false`) permanece inalterado (faixa não aparece sem
  câmera/tela ativa).
- Conferir que clique em tile de avatar na faixa compacta não quebra (não
  precisa ação especial — hoje só tiles de `screen` têm `onClick` na faixa
  compacta).
