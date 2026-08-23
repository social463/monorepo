# Seleção de dispositivos de áudio e câmera no escritório

**Data:** 2026-07-20
**Status:** aprovado para plano

## Contexto

O escritório virtual publica áudio (microfone) e vídeo (câmera) via LiveKit sem nunca
especificar `deviceId` — o navegador sempre usa o dispositivo padrão do sistema
operacional (`createLocalAudioTrack()` em `apps/web/src/office/media/useOfficeMedia.ts:328`,
`room.localParticipant.setCameraEnabled(next)` em `useOfficeMedia.ts:474`). Da mesma forma,
a reprodução de áudio remoto nunca escolhe um dispositivo de saída — os elementos `<audio>`
tocam sempre no destino padrão do navegador. Não existe hoje nenhum código de enumeração de
dispositivos (`navigator.mediaDevices.enumerateDevices`) no repositório.

Usuários com mais de um microfone, câmera ou saída de áudio conectados (ex.: fone USB +
alto-falantes da máquina) não têm como escolher qual usar dentro do Legends — precisam trocar
o dispositivo padrão no sistema operacional inteiro.

## Objetivo

Permitir que o usuário escolha, dentro do escritório virtual:
1. Qual **microfone** (entrada de áudio) usar.
2. Qual **câmera** (entrada de vídeo) usar.
3. Qual **saída de áudio** (alto-falante/fone) usar — vale tanto para o áudio de salas/zonas
   (`RemoteAudio.tsx`) quanto para o áudio espacial do espaço aberto (`SpatialRemoteAudio.tsx`
   → `spatialAudio.ts`). A saída escolhida é a mesma em qualquer lugar do escritório.

A escolha é persistida (localStorage) e reaplicada automaticamente nas próximas visitas,
mesmo padrão já usado para a preferência de mic mutado/desmutado
(`MIC_PREFERENCE_STORAGE_KEY`, `useOfficeMedia.ts:30-38`).

## Não-objetivos

- Configurações de cancelamento de ruído/eco/ganho de microfone.
- Qualquer UI de permissão além da que o navegador já solicita sozinho ao pedir
  `getUserMedia`.
- Detecção/aviso de dispositivo desconectado enquanto em uso (fora de escopo; o navegador já
  lida com isso soltando a track — sem tratamento especial adicional).

## Arquitetura

### `useMediaDevices` (novo hook)

`apps/web/src/office/media/useMediaDevices.ts`. Chama
`navigator.mediaDevices.enumerateDevices()` no mount e a cada evento `devicechange` do
navegador (plugar/desplugar fone, webcam etc.), separando o resultado em três listas
(`audioInputs`, `audioOutputs`, `videoInputs`) por `device.kind`. Rótulos de dispositivo só
vêm preenchidos pelo navegador depois que alguma permissão de mic/câmera já foi concedida
nesta sessão — quando `label` vem vazio, usa um rótulo de fallback (`Microfone 1`,
`Câmera 2`, ...) numerado pela ordem da lista. Expõe também se `setSinkId` existe em
`HTMLMediaElement.prototype` (`supportsAudioOutputSelection: boolean`), usado pela UI pra
esconder o seletor de saída em navegadores sem suporte (hoje, só Chromium tem `setSinkId`).

### `devicePreferences` (novo módulo)

`apps/web/src/office/media/devicePreferences.ts`, mesmo formato de
`readMicPreference`/`writeMicPreference` já existente: três chaves de localStorage
(`office:preferred-audio-input`, `office:preferred-audio-output`,
`office:preferred-video-input`), cada uma guardando o `deviceId` escolhido (ou ausente =
"padrão do sistema").

### `useOfficeMedia.ts`

- Ao criar a track de microfone (`createLocalAudioTrack`) e ao ligar a câmera
  (`setCameraEnabled`), passa o `deviceId` preferido lido do localStorage, se houver.
- Troca de dispositivo **ao vivo** (sem cair a chamada) usa
  `room.switchActiveDevice(kind, deviceId)` — API do próprio `Room` do LiveKit
  (`livekit-client` 2.x, `Room.switchActiveDevice(kind: MediaDeviceKind, deviceId: string,
  exact?: boolean): Promise<boolean>`), que já existe e cobre tanto `'audioinput'` quanto
  `'videoinput'` sem precisar recriar/republicar a track manualmente.
- Novas ações expostas em `OfficeMediaState`: `setAudioInputDevice(deviceId: string | null)`,
  `setVideoInputDevice(deviceId: string | null)` (`null` = voltar ao padrão do sistema, limpa
  a preferência salva). Cada uma persiste a escolha e chama `switchActiveDevice`.
- Saída de áudio (`setAudioOutputDevice`) não passa por `useOfficeMedia` (não é uma
  característica da publicação, é da reprodução) — ver `OfficeSessionContext` abaixo.

### Saída de áudio — `OfficeSessionContext` + `RemoteAudio` + `SpatialRemoteAudio`

O `deviceId` de saída escolhido vira um estado leve no próprio `OfficeSessionContext`
(inicializado a partir do localStorage, com um setter que persiste e atualiza o estado — sem
envolver LiveKit, é só reprodução local). `OfficeSessionContext` já é quem renderiza
`<RemoteAudio>`/`<SpatialRemoteAudio>` para cada `media.remotes` — passa o `deviceId`
escolhido como prop pra baixo em ambos.

- **`RemoteAudio.tsx`** ganha um `useEffect` que chama `audioEl.setSinkId(deviceId)` sempre
  que o id muda (só quando a API existe — feature-detect com `'setSinkId' in
  HTMLMediaElement.prototype`, extraído para um helper pequeno reaproveitado nos dois
  lugares, ex. `applyAudioSink(el, deviceId)` em `devicePreferences.ts` ou um novo
  `audioSink.ts`).
- **`spatialAudio.ts`** — hoje o grafo liga `panner.connect(ctx.destination)` (destino fixo
  do sistema, sem hook de saída). Passa a ligar `panner.connect(destination)`, onde
  `destination = ctx.createMediaStreamDestination()`, e cria um **segundo** `<audio>`
  escondido (`outputSink`) com `srcObject = destination.stream`, autoplay, **não-mudo**
  (diferente do `<audio>` mudo que já existe hoje só pra manter a track WebRTC bruta viva no
  Chrome — esse continua exatamente como está, sem mexer). É nesse `outputSink` que
  `setSinkId` é chamado. `SpatialAudioGraph` ganha um método `setOutputDevice(deviceId:
  string | null): void`, chamado pelo `createSpatialAudioGraph` na criação e por
  `SpatialRemoteAudio` sempre que a preferência mudar.
- **`SpatialRemoteAudio.tsx`** recebe o `deviceId` como prop, repassa pro
  `createSpatialAudioGraph` na criação do grafo e chama `graph.setOutputDevice(deviceId)` num
  `useEffect` próprio quando o id muda (sem recriar o grafo inteiro — só reaponta o sink).
  Seu fallback pra `RemoteAudio` (quando Web Audio está indisponível) já herda o
  comportamento certo automaticamente, sem código extra.

### UI — `MediaBar.tsx`

- **Microfone**: o botão único de mudo (`MediaBar.tsx:394-407`) vira um botão duplo, no
  mesmo padrão visual do botão de câmera (`MediaBar.tsx:409-432`) — ação principal
  (mutar/desmutar) + seta lateral que abre um novo `AudioInputMenu` (mesmo componente de
  popover de `CameraBackgroundMenu.tsx`: `role="menu"`, fecha em clique fora/Esc,
  `role="menuitemradio"`/`aria-checked`), listando `audioInputs` + item "Padrão do sistema".
- **Câmera**: o popover existente (`CameraBackgroundMenu.tsx`) ganha uma seção nova no topo,
  "Câmera", com a lista de `videoInputs` — mesmo botão/seta que já existe, sem novo elemento
  na barra.
- **Saída de áudio**: botão novo na barra (ícone `volume_up`), só renderizado quando
  `supportsAudioOutputSelection` é `true`, abrindo um `AudioOutputMenu` com o mesmo padrão de
  popover, listando `audioOutputs` + "Padrão do sistema".

## Testes

- `useMediaDevices.test.ts` — mocka `navigator.mediaDevices.enumerateDevices` e o evento
  `devicechange`; cobre separação por `kind`, rótulo de fallback quando `label` vem vazio, e
  `supportsAudioOutputSelection` refletindo a presença de `setSinkId`.
- `devicePreferences.test.ts` — round-trip de leitura/escrita/limpeza das três chaves de
  localStorage.
- `useOfficeMedia.test.ts` (extensão do existente) — `setAudioInputDevice`/
  `setVideoInputDevice` chamam `room.switchActiveDevice` com os argumentos certos e persistem
  a escolha.
- `MediaBar.test.tsx` (extensão) — botão de mic vira duplo e abre o menu; menu de câmera
  ganha a seção nova; botão de saída aparece só quando `supportsAudioOutputSelection` é
  `true` e chama o setter certo ao escolher um item.
- `RemoteAudio.test.tsx` (extensão) — chama `setSinkId` quando a API existe e um `deviceId`
  é passado; não quebra quando a API não existe (feature-detect antes de chamar).
- `spatialAudio.test.ts` (extensão) — `createSpatialAudioGraph` liga o `panner` no
  `MediaStreamAudioDestinationNode` (não mais direto em `ctx.destination`); cria o
  `outputSink` separado do `<audio>` mudo de keep-alive existente; `setOutputDevice` chama
  `setSinkId` só no `outputSink`; `dispose()` limpa os dois elementos de áudio.
- `SpatialRemoteAudio.test.tsx` (extensão) — repassa o `deviceId` recebido pro
  `createSpatialAudioGraph` e chama `setOutputDevice` quando o id muda, sem recriar o grafo.

## Riscos / pontos de atenção

- `Room.switchActiveDevice` é a API pretendida, mas seu comportamento exato (retorno
  `Promise<boolean>`, o que significa `false`) precisa ser confirmado lendo a implementação
  real de `livekit-client` durante o plano — se o retorno indicar falha, a escolha não deve
  ser persistida como se tivesse funcionado.
- Rótulos de dispositivo vazios (sem permissão concedida ainda) — o rótulo de fallback
  numerado é aceitável, mas a ordem da lista pode mudar entre chamadas de
  `enumerateDevices()` em alguns navegadores; não é um problema novo introduzido aqui (mesma
  limitação da Web API), só documentar a expectativa.
- Convém verificar, durante o plano, se `switchActiveDevice('videoinput', ...)` funciona
  mesmo com a câmera desligada (`cameraEnabled: false`) sem ligá-la sozinha — o comportamento
  esperado é só trocar a preferência, sem ligar a câmera.
- O áudio espacial passa a ter **dois** elementos `<audio>` escondidos por track remota (o
  keep-alive mudo existente + o novo `outputSink` audível) em vez de um — custo aceitável
  (poucas pessoas por vez no espaço aberto), mas vale confirmar no plano que `dispose()`
  remove os dois corretamente (sem vazar elemento no DOM ao trocar de sala/sair).
- `MediaStreamAudioDestinationNode` é suportado em todo navegador com Web Audio API (mesmo
  guard de `getAudioContext()` já existente) — não introduz uma nova dependência de suporte
  além da que já existe hoje pro áudio espacial.
