# Compartilhar áudio do YouTube na sala de reunião — design

**Data:** 2026-08-06
**Branch:** `Compartilhar-Audio`

## Problema

Dentro de uma sala de reunião do escritório virtual, só há duas formas de fazer
som chegar aos outros: o microfone e o áudio de aba que viaja junto do
compartilhamento de tela (ver `2026-07-17-screen-share-audio-design.md`). Quem
quer apenas tocar uma música ou o áudio de um vídeo do YouTube para a sala
precisa compartilhar a tela — ocupa a grade de vídeo de todo mundo, atrapalha
quem está apresentando e gasta banda de vídeo à toa.

O pedido, inspirado no WorkAdventure: colar um link do YouTube e a sala inteira
passar a ouvir **só o áudio**. Cada pessoa regula o volume do seu lado, e quem
iniciou pode parar a qualquer momento.

## Decisão central: sincronizar estado, não mídia

O hub distribui **o que** tocar e **em que ponto**; cada cliente na sala roda o
próprio player do YouTube. Nenhum byte de mídia passa pela API ou pelo LiveKit.

As alternativas foram descartadas por motivo técnico, não por gosto:

- **Publicar o áudio como track no LiveKit** é impossível com YouTube: o player
  vive num iframe cross-origin, fora do alcance do Web Audio. O único caminho
  seria `getDisplayMedia` de aba — exatamente o compartilhamento de tela que a
  feature existe para evitar.
- **Extrair o áudio no servidor** (yt-dlp + ffmpeg + LiveKit Ingress) daria
  sincronia exata, ao custo de um serviço novo, banda de saída por sala,
  manutenção constante do extrator e rebroadcast batendo no ToS do YouTube.
  Fora de proporção para o pedido.

O preço da escolha é uma deriva de até ~1s entre os ouvintes, aceita no design.

## Escopo

**Dentro:** iniciar, pausar, retomar e parar áudio de YouTube dentro de sala de
reunião; uma faixa por sala; volume e mudo locais por ouvinte; mini player
recolhível; sincronia por posição para quem entra depois.

**Fora:** seek e fila; Spotify e link direto de áudio; tocar no espaço aberto ou
no alto-falante do escritório; ducking automático quando alguém fala;
persistência da faixa no banco e histórico do que já tocou.

## Decisões

| Assunto | Decisão |
|---|---|
| Fonte | Só YouTube — vídeo sozinho ou playlist |
| Concorrência | Uma faixa por sala; segundo pedido é recusado com `busy` |
| Onde vale | Só sala de reunião (`currentZone.type === 'meeting-room'`) |
| Controles de quem transmite | Iniciar, pausar, retomar e parar — tudo vale para a sala |
| Controles de quem ouve | Slider `0-100%` e mudo, locais, em `localStorage` |
| Player | Mini player recolhível de ~200×113 no canto |
| Convidado | Ouve, não inicia |
| Botão | Item no menu "Mais" da `MediaBar` |

O player fica **visível**: o ToS do embed do YouTube proíbe esconder o player, e
a miniatura ainda serve para mostrar o que está tocando. Recolhida, vira uma
barrinha com título, quem iniciou e volume.

Quem iniciou é dono da faixa: só ele pausa, retoma e para. O áudio também para
sozinho quando ele sai da sala, cai a conexão, ou a sala esvazia — mesma linha
do cadeado da sala, que não sobrevive à sala vazia (`unlockIfRoomEmpty`).

**O ouvinte não controla a reprodução, e isso é imposto, não combinado.** O
embed do YouTube deixa qualquer um pausar clicando no vídeo, com a barra de
espaço ou com a tecla de mídia do teclado — e essa pausa seria local, deixando
a pessoa fora de sincronia com a sala para sempre (não há seek contínuo). Duas
travas resolvem: o container do iframe é `pointer-events-none`, e o
`onStateChange` desfaz qualquer `PAUSED` que o servidor não tenha mandado,
voltando a tocar **no ponto em que a sala está**, não naquele em que parou.

Pausa de verdade é da sala e só do dono: `set-room-audio-paused` congela
`positionSeconds` no hub, então quem chega durante a pausa nasce parado no
mesmo ponto que todo mundo, e retomar continua de onde parou — o tempo pausado
não vira atraso.

## Contrato (`@legends/shared`)

`src/office-audio-share.ts`:

- `parseYouTubeVideoId(raw)` — aceita `watch?v=`, `youtu.be/`, `/shorts/`,
  `/live/`, `/embed/`, `/v/`, `music.youtube.com` e `youtube-nocookie.com`;
  devolve o id só quando casa `^[\w-]{11}$`, senão `null`.
- `ROOM_AUDIO_START_COOLDOWN_MS = 3000`
- `OfficeRoomAudioTrack { videoId; startedByUserId; startedByName; positionSeconds }`

As regras de host/path já existiam em `toVideoEmbedUrl` (`learning.ts`), que
passa a chamar o mesmo helper — uma fonte só para "que link é esse".

Mensagens novas em `src/office.ts`:

```ts
// cliente → servidor (sala derivada da posição, como room-chat-message)
| { type: "start-room-audio"; videoId: string; playlistId?: string | null }
| { type: "stop-room-audio" }
| { type: "set-room-audio-paused"; paused: boolean }
| { type: "set-room-audio-item"; playlistIndex: number; videoId: string }

// servidor → cliente
| { type: "room-audio-changed"; roomId: string; track: OfficeRoomAudioTrack | null }
| { type: "room-audio-denied"; reason: "busy" | "not-in-room" | "guest" | "cooldown" | "invalid" }

// welcome
roomAudio?: Array<OfficeRoomAudioTrack & { roomId: string }>
```

`room-audio-changed` vai em broadcast global, como `room-lock-changed`: o
cliente filtra pelo `roomId` da sala em que está, e quem **anda** para dentro de
uma sala que já está tocando pega o estado sem precisar de evento novo.

## Sincronia sem confiar no relógio do cliente

O servidor manda `positionSeconds` calculado no instante do envio, nunca um
epoch. O cliente converte isso em `originMs` — o instante **local** do segundo
zero do vídeo — e daí em diante calcula a posição por subtração, na hora em que
for usar. Só diferenças locais entram na conta, então relógio de máquina
desajustado não desalinha ninguém. Sobra a latência de rede, de dezenas de
milissegundos.

Guardar a origem em vez de um número congelado é o que faz a posição continuar
certa quando o iframe demora a carregar (o `seekTo` acontece no `onReady`, que
pode ser segundos depois) e o que permite ao watchdog devolver o ouvinte ao
ponto da sala. Enquanto pausada, `originMs` não avança.

A identidade da faixa (`key`) nasce ao aplicar a mensagem, não no render:
pausar e retomar são a **mesma** faixa e não podem recriar o player, senão o
vídeo recarregaria do zero a cada pausa. Numa playlist, virar de música também
continua sendo a mesma sessão — quem define a identidade ali é a playlist, não
o vídeo do momento. Já a mesma música em outra sala, ou reiniciada por outra
pessoa, é faixa nova, e aí o player nasce de novo no ponto daquela sala.

## Playlist

Cada cliente carrega a playlist inteira no próprio player (`listType:
'playlist'`), mas **quem avança é só quem iniciou**: quando o player dele vira
de música, ele manda `set-room-audio-item` e o hub leva a sala junto, zerando a
posição. Deixar cada player seguir sozinho colocaria as pessoas em músicas
diferentes já na segunda faixa — nada garante que dois players cruzem a virada
no mesmo instante, e o erro acumula.

O ouvinte segue por `playVideoAt(index)`, sem recriar o player. O fim de um item
no meio da lista não encerra nada; só o fim do **último** vira `stop`.

Nem toda lista serve: o embed do YouTube não abre as "Mixes"/rádio (`RD…`, o que
o botão *Tocar mix* gera), e `WL`/`LL` são privadas de quem copiou o link.
Nesses casos `parseYouTubePlaylistId` devolve `null` e a sala ouve **só o
vídeo** — melhor que um player que não carrega.

O fim do vídeo não é problema do servidor: o player de quem iniciou dispara
`ENDED` e o cliente manda `stop-room-audio`. Sem timer no hub.

## Erros e bordas

- Link inválido é barrado no cliente e no hub — nada que chega pelo socket é
  confiável.
- Vídeo com embed bloqueado pelo dono (erros 101/150) não toca para ninguém; a
  mensagem aparece para quem tentou.
- Autoplay bloqueado pelo navegador: se o player não entra em `PLAYING`, a
  faixa mostra "Clique para ouvir" — mesmo tratamento da música ambiente da
  retrospectiva (`RetroTimerPanel`).
- Anti-spam de 3s por pessoa entre inícios, no molde do `KNOCK_COOLDOWN_MS`.

## Limitações conhecidas

- A escolha de dispositivo de saída (`audioOutputDeviceId`, ver
  `2026-07-20-selecao-dispositivos-audio-design.md`) **não** alcança o player:
  não há `setSinkId` para iframe de terceiro. O áudio do YouTube sai no
  dispositivo padrão do sistema.
- Aba em segundo plano sofre throttling do navegador e a deriva pode passar de
  1s. Não há correção contínua, porque não há seek no escopo.
- A CSP do nginx (`frame-src`) precisa liberar `youtube.com` e
  `youtube-nocookie.com`; sem isso o iframe é bloqueado em produção.

## Pontos de implementação

- `apps/api/src/lib/office-hub.ts` — `roomAudio` por sala e cooldown por
  usuário, no mesmo desenho de `lockedRooms`/`raisedHandsByRoom`; limpeza no
  movimento, na saída, na sala vazia e na troca de publicação.
- `apps/api/src/routes/office-ws.ts` — dois ramos de dispatch, sem regra.
- `apps/web/src/office/media/useRoomAudio.ts` — estado por sala vindo do
  servidor, mesmo esqueleto de `useRoomLock`.
- `apps/web/src/office/media/RoomAudioPlayer.tsx` e `youtube-iframe-loader.ts` —
  player sob demanda, no molde do `livekit-loader`.
- `apps/web/src/office/media/roomAudioVolumePreference.ts` — `localStorage`,
  best-effort, formato de `remoteUserVolumePreferences`.
- `apps/web/src/office/session/OfficeSessionContext.tsx` — o player vive no
  provider, junto dos `RemoteAudio`: continua tocando no PiP e nunca duplica.
- `apps/web/src/office/media/MediaBarMoreMenu.tsx` — item "Compartilhar áudio".

## Testes

- Parser de link no `shared` (cada forma de URL, id de 11 chars, lixo → `null`).
- Hub: propagação do início; `busy`; fora de sala; convidado; cooldown; parar só
  de quem iniciou; dono sai andando, cai, ou sala esvazia; `welcome` com
  `positionSeconds` avançado; troca de publicação limpa.
- Rota WS: despacho dos dois tipos e mensagem malformada que não derruba a
  conexão.
- Front: filtro por sala e deriva local no hook; `seekTo`/volume/mudo/`ENDED`/
  erro/autoplay no player; clamp e persistência da preferência; item do menu
  visível só dentro de sala e ausente para convidado.
