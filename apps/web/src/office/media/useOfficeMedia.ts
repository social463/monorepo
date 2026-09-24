import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LocalAudioTrack,
  LocalVideoTrack,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
} from 'livekit-client'
import {
  TILE_SIZE,
  tileOfPixel,
  officeOpenRoom,
  officeRoomForTile,
  isInSilenceZone,
  isWithinProximityTiles,
  isOfficeAudioIsolated,
  type MapDocumentV1,
  type OfficeOccupant,
  type OfficeMediaTokenResponse,
  type AvatarStyleKey,
  type CharacterOptions,
} from '@legends/shared'
import { getLiveKit, loadLiveKit } from './livekit-loader'
import { readDevicePreference, writeDevicePreference } from './devicePreferences'
import { apiFetch } from '../../lib/api'
import type { OfficeBridge } from '../OfficeBridge'

/** Estabilidade exigida antes de trocar de sala — parado na porta não flapa. */
const ROOM_STABILITY_MS = 500
const MAX_RETRY_MS = 15000

/** Última escolha de mic (mutado/desmutado) do usuário, por dispositivo — sobrevive a troca de sala/zona e a reconexão. */
const MIC_PREFERENCE_STORAGE_KEY = 'office:mic-enabled'

function readMicPreference(): boolean {
  return localStorage.getItem(MIC_PREFERENCE_STORAGE_KEY) === '1'
}

function writeMicPreference(enabled: boolean): void {
  localStorage.setItem(MIC_PREFERENCE_STORAGE_KEY, enabled ? '1' : '0')
}

export type OfficeMediaStatus = 'off' | 'connecting' | 'connected' | 'error'

export interface RemoteMedia {
  userId: string
  name: string
  audioTrack: RemoteAudioTrack | null
  cameraTrack: RemoteVideoTrack | null
  screenTrack: RemoteVideoTrack | null
  screenAudioTrack: RemoteAudioTrack | null
  photoUrl?: string | null
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
  avatarOptions?: CharacterOptions | null
  /** Mic publicado e não mutado — independente de estar falando agora ou de assinatura por proximidade. */
  micOpen: boolean
  /** Ativo no LiveKit `ActiveSpeakersChanged` agora mesmo. */
  speaking: boolean
}

/**
 * Compara o que a UI consome de `remotes` (refs de track e flags), campo a
 * campo. Existe por causa de um ciclo real: `syncRemotes` roda num efeito que
 * depende de `occupants`, e a identidade de `occupants` muda a cada render (vem
 * do WS em runtime, de props recriadas em teste). Setar um array novo mesmo
 * quando nada mudou re-renderiza → o efeito roda de novo → seta de novo:
 * render→setState→render sem fim, que não aparece como loop nem como timeout
 * (é microtask/timer), só como heap cheio. Com a comparação, o ciclo morre no
 * primeiro no-op.
 */
function sameRemotes(a: readonly RemoteMedia[], b: readonly RemoteMedia[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (
      x.userId !== y.userId ||
      x.name !== y.name ||
      x.audioTrack !== y.audioTrack ||
      x.cameraTrack !== y.cameraTrack ||
      x.screenTrack !== y.screenTrack ||
      x.screenAudioTrack !== y.screenAudioTrack ||
      x.micOpen !== y.micOpen ||
      x.photoUrl !== y.photoUrl ||
      x.avatarStyle !== y.avatarStyle ||
      x.avatarSeed !== y.avatarSeed ||
      x.avatarOptions !== y.avatarOptions
    ) {
      return false
    }
  }
  return true
}

/** Mesma motivação de `sameRemotes`: `new Set(...)` sempre tem identidade nova. */
function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

export interface OfficeMediaState {
  status: OfficeMediaStatus
  roomName: string | null
  /** Sala LiveKit do espaço aberto do mapa atual — usada para saber se está
   * no espaço aberto (`roomName === openRoom`) sem recalcular a partir de
   * `mapId`. `null` sem mapa ativo. */
  openRoom: string | null
  micEnabled: boolean
  micError: boolean
  cameraEnabled: boolean
  cameraError: boolean
  screenShareEnabled: boolean
  screenShareError: boolean
  remotes: RemoteMedia[]
  localCameraTrack: LocalVideoTrack | null
  localScreenTrack: LocalVideoTrack | null
  /** Ordem de início do compartilhamento de tela: chave 'local' para o próprio
   * usuário, userId para remotos; menor valor = começou a compartilhar
   * primeiro. Usado como critério de destaque quando há múltiplas telas
   * ativas ao mesmo tempo (MediaTiles, grid da área aberta, PiP). */
  screenShareOrder: ReadonlyMap<string, number>
  /** Você mesmo está no LiveKit `ActiveSpeakersChanged` agora. */
  localSpeaking: boolean
  toggleMic(): Promise<void>
  toggleCamera(): Promise<void>
  toggleScreenShare(): Promise<void>
  applyMicEnabled(enabled: boolean): Promise<void>
  /** `null` = usando o padrão do sistema. */
  audioInputDeviceId: string | null
  videoInputDeviceId: string | null
  setAudioInputDevice(deviceId: string | null): Promise<void>
  setVideoInputDevice(deviceId: string | null): Promise<void>
}

/**
 * Dono do objeto `Room` do LiveKit. A sala segue a posição CONFIRMADA pelo
 * servidor (occupants vem do WS do escritório): zona → sala da zona; espaço
 * aberto → `office-open` com assinatura manual por proximidade. O servidor
 * continua autoritativo — aqui não se inventa posição nem se conecta a sala
 * que a API não autorizou.
 */
export function useOfficeMedia(
  occupants: OfficeOccupant[],
  youId: string | null,
  connected: boolean,
  document: MapDocumentV1 | null = null,
  mapId: string | null = null,
  bridge?: OfficeBridge,
  guestToken: string | null = null,
): OfficeMediaState {
  const [status, setStatus] = useState<OfficeMediaStatus>('off')
  const [roomName, setRoomName] = useState<string | null>(null)
  // Sempre começa mutado na UI (ver `isSpawnConnectRef`/`isSpawnConnect` em
  // `connectTo`) — não lê a preferência salva aqui, senão o ícone pisca
  // "ligado" por um instante antes do `connectTo` publicar já mutado.
  const [micEnabled, setMicEnabled] = useState(false)
  const [audioInputDeviceId, setAudioInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('audioInput'),
  )
  const [videoInputDeviceId, setVideoInputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('videoInput'),
  )
  const [micError, setMicError] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
  const [screenShareError, setScreenShareError] = useState(false)
  const [remotes, setRemotes] = useState<RemoteMedia[]>([])
  const [localCameraTrack, setLocalCameraTrack] = useState<LocalVideoTrack | null>(null)
  const [localScreenTrack, setLocalScreenTrack] = useState<LocalVideoTrack | null>(null)
  const [stableRoom, setStableRoom] = useState<string | null>(null)
  const [speakingIds, setSpeakingIds] = useState<ReadonlySet<string>>(new Set())
  const screenShareOrderRef = useRef<Map<string, number>>(new Map())
  const screenShareCounterRef = useRef(0)
  const prevSpeakingRef = useRef<ReadonlySet<string>>(new Set())

  const roomRef = useRef<Room | null>(null)
  const targetRoomRef = useRef<string | null>(null)
  const micTrackRef = useRef<LocalAudioTrack | null>(null)
  const retryRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  })
  // Contador de geração: cada chamada de `connectTo` (efeito ou retry) incrementa
  // e captura o próprio número. Se, depois de um `await`, o contador global já
  // avançou (uma geração mais nova assumiu), esta continuação está superada —
  // ela aborta em vez de sobrescrever roomRef/estado ou agendar retry. Isso
  // também cobre unmount e transição para "sem sala" (ver os dois `useEffect`
  // abaixo, que incrementam a geração antes de desconectar).
  const generationRef = useRef(0)
  /**
   * True enquanto NÃO há sessão de mídia de pé — ou seja, na conexão que
   * acontece no SPAWN: entrar no escritório, recarregar a página, voltar
   * depois de sair, reconectar depois de cair o WS. Força o mic mutado nessa
   * entrada: várias pessoas chegam juntas no spawn e um mic ligado sozinho
   * vaza áudio. Volta a `true` no teardown ("sem sala", ver o efeito de
   * `stableRoom` abaixo) — então TODO spawn nasce mutado, independente da
   * sessão, mesmo com preferência "desmutado" salva. Trocas de sala/zona
   * andando pelo mapa não passam por aqui (a sala desejada nunca fica nula
   * dentro do escritório) e continuam respeitando a preferência salva.
   */
  const isSpawnConnectRef = useRef(true)
  const occupantsRef = useRef(occupants)
  occupantsRef.current = occupants
  const youIdRef = useRef(youId)
  youIdRef.current = youId
  const audioInputDeviceIdRef = useRef(audioInputDeviceId)
  audioInputDeviceIdRef.current = audioInputDeviceId
  // A régua de pixel→tile do mapa ATIVO. Em ref, e não nas deps de
  // `applyProximity`, porque a assinatura não pode ser refeita a cada
  // publicação de decoração. `TILE_SIZE` só cobre o intervalo em que ainda não
  // há mapa — e sem mapa também não há sala, então ninguém está assinado.
  const tileSizeRef = useRef(TILE_SIZE)
  tileSizeRef.current = document?.map.tileWidth ?? TILE_SIZE
  const videoInputDeviceIdRef = useRef(videoInputDeviceId)
  videoInputDeviceIdRef.current = videoInputDeviceId

  const you = occupants.find((o) => o.userId === youId) ?? null
  // Sala de silêncio: nenhuma sala de voz. Em vez de silenciar o alto-falante,
  // não entra — assim também não publica o mic, e o silêncio vale nos dois
  // sentidos. "Sem sala" já é um estado suportado (desconecta e vai pra `off`).
  // A sala de ÁUDIO sai do TILE, e o occupant fala PIXEL desde o movimento
  // livre. `TilePosition` não protege: ela é estrutural, e um `{x, y}` em pixel
  // entra sem erro — o sintoma é todo mundo cair na sala aberta e as conversas
  // de sala deixarem de isolar.
  const youTile = you && document ? tileOfPixel(you, document.map.tileWidth) : null
  const desiredRoom =
    connected && youTile && document && mapId && !isInSilenceZone(document, youTile)
      ? officeRoomForTile(mapId, document, youTile.x, youTile.y)
      : null
  const openRoom = mapId ? officeOpenRoom(mapId) : null

  // Só aplica a troca depois de ROOM_STABILITY_MS com a mesma sala desejada.
  useEffect(() => {
    if (desiredRoom === stableRoom) return
    const timer = setTimeout(() => setStableRoom(desiredRoom), ROOM_STABILITY_MS)
    return () => clearTimeout(timer)
  }, [desiredRoom, stableRoom])

  /**
   * Reconstrói `remotes` a partir do que está assinado agora. Sempre via
   * `commitRemotes`/`commitSpeaking` (nunca `setRemotes`/`setSpeakingIds`
   * direto): rodar sem mudança nenhuma tem que ser um no-op de verdade, ver
   * `sameRemotes`.
   */
  const commitRemotes = useCallback((next: RemoteMedia[]) => {
    setRemotes((prev) => (sameRemotes(prev, next) ? prev : next))
  }, [])
  const commitSpeaking = useCallback((next: ReadonlySet<string>) => {
    setSpeakingIds((prev) => (sameIds(prev, next) ? prev : next))
  }, [])

  const syncRemotes = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      commitRemotes([])
      return
    }
    const lk = getLiveKit()
    if (!lk) {
      commitRemotes([])
      return
    }
    const next: RemoteMedia[] = []
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      const media: RemoteMedia = {
        userId: participant.identity,
        name: participant.name ?? participant.identity,
        audioTrack: null,
        cameraTrack: null,
        screenTrack: null,
        screenAudioTrack: null,
        photoUrl: occupant?.photoUrl ?? null,
        avatarStyle: occupant?.avatarStyle ?? null,
        avatarSeed: occupant?.avatarSeed ?? null,
        avatarOptions: occupant?.avatarOptions ?? null,
        micOpen: false,
        speaking: false,
      }
      for (const pub of participant.trackPublications.values()) {
        // Estado do mic (aberto/mudo) é visível via sinalização mesmo sem
        // assinar a track — não depende do `continue` de assinatura abaixo,
        // senão o badge de "mic aberto" ficaria preso em "mudo" enquanto a
        // proximidade não assina o áudio.
        if (pub.source === lk.Track.Source.Microphone) media.micOpen = !pub.isMuted
        // `setCameraEnabled(false)`/`setMicrophoneEnabled(false)` (LiveKit),
        // depois da primeira publicação, MUTAM a track em vez de despublicá-la
        // — a publicação continua "subscribed" com um track "live", só sem
        // dados fluindo. Sem checar `isMuted` aqui, "desligar a câmera" nunca
        // reflete pros remotos: o balão de vídeo fica preso com um quadro
        // preto (a track mutada) em vez de sumir.
        if (!pub.isSubscribed || !pub.track || pub.isMuted) continue
        if (pub.source === lk.Track.Source.Microphone) media.audioTrack = pub.track as RemoteAudioTrack
        else if (pub.source === lk.Track.Source.Camera) media.cameraTrack = pub.track as RemoteVideoTrack
        else if (pub.source === lk.Track.Source.ScreenShare)
          media.screenTrack = pub.track as RemoteVideoTrack
        else if (pub.source === lk.Track.Source.ScreenShareAudio)
          media.screenAudioTrack = pub.track as RemoteAudioTrack
      }
      next.push(media)
    }
    commitRemotes(next)
  }, [commitRemotes])

  /**
   * No espaço aberto, assinatura segue a distância; nas zonas é autoSubscribe.
   * Ausente/Volto logo bloqueia o chat de proximidade nos dois sentidos: se EU
   * estou ausente não assino ninguém (não ouço), e ninguém assina alguém que
   * está ausente (não é ouvido) — cada cliente roda este mesmo cálculo pro seu
   * lado, então checar os dois status aqui já cobre a simetria sem round-trip.
   */
  const applyProximity = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const me = occupantsRef.current.find((o) => o.userId === youIdRef.current)
    if (!me) return
    const iAmIsolated = isOfficeAudioIsolated(me.status)
    const byProximity = targetRoomRef.current === openRoom
    const meOnline = (me.status ?? 'online') === 'online'
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      let subscribed: boolean
      if (iAmIsolated || isOfficeAudioIsolated(occupant?.status)) {
        // Ocupado é surdo e mudo, em qualquer sala. O mudo vem do mic parado
        // (ver o efeito de isolamento); o surdo é isto.
        subscribed = false
      } else if (byProximity) {
        const meuTile = tileOfPixel(me, tileSizeRef.current)
        const deleTile = occupant ? tileOfPixel(occupant, tileSizeRef.current) : null
        subscribed =
          meOnline &&
          !!occupant &&
          !!deleTile &&
          (occupant.status ?? 'online') === 'online' &&
          isWithinProximityTiles(meuTile.x, meuTile.y, deleTile.x, deleTile.y)
      } else {
        // Zona: o `autoSubscribe` já assinaria tudo, e reafirmar é no-op pelo
        // teste de igualdade abaixo. Mas é preciso reafirmar: quando alguém
        // sai de "Ocupado", as publicações que cortamos à mão não voltam
        // sozinhas — `autoSubscribe` só vale para tracks NOVAS, e sem isto a
        // pessoa ficaria surda até alguém republicar.
        subscribed = true
      }
      for (const pub of participant.trackPublications.values()) {
        if (pub.isSubscribed !== subscribed) pub.setSubscribed(subscribed)
      }
    }
  }, [openRoom])

  const connectTo = useCallback(
    async (target: string) => {
      // Captura a própria geração; qualquer chamada futura a connectTo (efeito
      // ou retry) incrementa generationRef e torna esta invocação obsoleta.
      const gen = ++generationRef.current
      void roomRef.current?.disconnect()
      roomRef.current = null
      micTrackRef.current = null
      targetRoomRef.current = target
      commitRemotes([])
      commitSpeaking(new Set())
      setLocalCameraTrack(null)
      setLocalScreenTrack(null)
      screenShareOrderRef.current = new Map()
      screenShareCounterRef.current = 0
      setStatus('connecting')
      // Sala criada por ESTA invocação — se formos superados, é ela (e só ela)
      // que precisa ser desconectada; nada mais ficou de pé por causa dela.
      let room: Room | null = null
      try {
        const { Room: LiveKitRoom, RoomEvent, Track, createLocalAudioTrack } = await loadLiveKit()
        if (generationRef.current !== gen) return
        const { token, url } = await apiFetch<OfficeMediaTokenResponse>('/office/media-token', {
          method: 'POST',
          headers: guestToken ? { Authorization: `Bearer ${guestToken}` } : undefined,
          body: JSON.stringify({ room: target }),
        })
        if (generationRef.current !== gen) return // superada enquanto buscava o token — nada foi criado ainda

        room = new LiveKitRoom()
        room
          .on(RoomEvent.ParticipantConnected, () => {
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.ParticipantDisconnected, syncRemotes)
          .on(RoomEvent.TrackPublished, (pub?: RemoteTrackPublication, participant?: RemoteParticipant) => {
            if (pub?.source === Track.Source.ScreenShare && participant && !screenShareOrderRef.current.has(participant.identity)) {
              screenShareOrderRef.current.set(participant.identity, screenShareCounterRef.current++)
            }
            applyProximity()
            syncRemotes()
          })
          .on(RoomEvent.TrackUnpublished, (pub?: RemoteTrackPublication, participant?: RemoteParticipant) => {
            if (pub?.source === Track.Source.ScreenShare && participant) {
              screenShareOrderRef.current.delete(participant.identity)
            }
            syncRemotes()
          })
          .on(RoomEvent.TrackSubscribed, syncRemotes)
          .on(RoomEvent.TrackUnsubscribed, syncRemotes)
          // Mute/unmute (câmera/mic desligados via setCameraEnabled/
          // setMicrophoneEnabled depois da primeira publicação) não emitem
          // TrackUnpublished — só isso, e syncRemotes já ignora tracks
          // mutadas (ver comentário no loop acima).
          .on(RoomEvent.TrackMuted, syncRemotes)
          .on(RoomEvent.TrackUnmuted, syncRemotes)
          // Nativo do LiveKit — dispara pra local e remotos, sem precisar de
          // AnalyserNode próprio. Booleano só (sem nível de volume): quem
          // está falando agora, ponto.
          .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            commitSpeaking(new Set(speakers.map((p) => p.identity)))
          })
          // O LiveKit reconecta sozinho no nível de rede (ICE/WebRTC) sem
          // que esta invocação de `connectTo` seja refeita — nenhum dos
          // handlers acima dispara sozinho para o que mudou DURANTE a queda
          // (participante que entrou, track que foi publicada). Sem isto,
          // `remotes` fica preso no estado de antes da queda até algum
          // evento de track não relacionado acontecer por acaso: alguém
          // ouve os outros mas não os vê no grid até dar refresh.
          .on(RoomEvent.Reconnected, () => {
            applyProximity()
            syncRemotes()
          })
          // A recuperação automática do LiveKit pode desistir de vez (rede
          // caiu por tempo demais) — sem isto, o hook ficava com
          // `status: 'connected'` para sempre, sem tentar de novo, e só um
          // refresh manual resolvia. `roomRef.current === room` distingue
          // isto de uma desconexão NOSSA (troca de sala, teardown): nesses
          // casos `connectTo`/o efeito de "sem sala" já trocaram
          // `roomRef.current` antes deste evento tardio chegar.
          .on(RoomEvent.Disconnected, () => {
            if (roomRef.current !== room) return
            roomRef.current = null
            void connectTo(target)
          })
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(true)
              setScreenShareError(false)
              setLocalScreenTrack((pub.track as LocalVideoTrack | undefined) ?? null)
              if (!screenShareOrderRef.current.has('local')) {
                screenShareOrderRef.current.set('local', screenShareCounterRef.current++)
              }
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack((pub.track as LocalVideoTrack | undefined) ?? null)
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.source === Track.Source.ScreenShare) {
              setScreenShareEnabled(false)
              setLocalScreenTrack(null)
              screenShareOrderRef.current.delete('local')
            }
            if (pub.source === Track.Source.Camera) {
              setLocalCameraTrack(null)
            }
          })
        await room.connect(url, token, { autoSubscribe: target !== openRoom })
        if (generationRef.current !== gen) {
          void room.disconnect()
          return
        }

        roomRef.current = room
        retryRef.current.attempts = 0
        setRoomName(target)
        setStatus('connected')
        // Câmera SEMPRE desligada ao (re)conectar — inclusive no spawn. Não
        // existe preferência persistida de câmera de propósito: ninguém entra
        // no escritório com o próprio vídeo já no ar. Como cada `connectTo`
        // cria uma `Room` nova, nada de vídeo vem publicado; aqui só se alinha
        // o estado da UI (o track local já foi zerado no topo da função).
        setCameraEnabled(false)
        setCameraError(false)
        setScreenShareEnabled(false)
        setScreenShareError(false)

        // Mic publicado respeitando a ÚLTIMA preferência do usuário (localStorage):
        // trocar de sala/zona não deve resetar quem estava desmutado, nem
        // desmutar sozinho quem estava mutado. EXCETO no spawn (entrar no
        // escritório, reload, reconexão) — aí sempre começa mutado, ver
        // `isSpawnConnectRef`.
        const isSpawnConnect = isSpawnConnectRef.current
        const preferMicEnabled = isSpawnConnect ? false : readMicPreference()
        try {
          const track = await createLocalAudioTrack({
            deviceId: audioInputDeviceIdRef.current ?? undefined,
          })
          if (generationRef.current !== gen) {
            void room.disconnect()
            return
          }
          // Mutar sem parar a MediaStreamTrack mantém o microfone capturando:
          // no macOS o indicador do sistema fica aceso e as pessoas acham que
          // continuam sendo ouvidas. Com isto o LiveKit para a track no mute e
          // reaquire no unmute (respeitando o deviceId das constraints).
          //
          // Marcado aqui, e não via `stopMicTrackOnMute` nas opções de
          // publicação, porque o `mute()` abaixo acontece ANTES de publicar —
          // e é justamente o caso do spawn, que entra sempre mutado.
          track.stopOnMute = true
          if (!preferMicEnabled) await track.mute()
          await room.localParticipant.publishTrack(track)
          if (generationRef.current !== gen) {
            void room.disconnect()
            return
          }
          micTrackRef.current = track
          setMicEnabled(preferMicEnabled)
          setMicError(false)
          isSpawnConnectRef.current = false
        } catch {
          if (generationRef.current === gen) {
            setMicEnabled(false)
            setMicError(true)
          }
        }

        if (generationRef.current !== gen) return
        applyProximity()
        syncRemotes()
      } catch {
        if (generationRef.current !== gen) {
          // Geração superada: quem assumiu já cuidou do próprio estado/retry;
          // só resta desconectar a sala que esta invocação tiver criado.
          if (room) void room.disconnect()
          return
        }
        setStatus('error')
        const attempts = (retryRef.current.attempts += 1)
        retryRef.current.timer = setTimeout(() => {
          if (generationRef.current !== gen) return // geração antiga: retry morto, ninguém reconecta
          void connectTo(target)
        }, Math.min(1000 * 2 ** attempts, MAX_RETRY_MS))
      }
    },
    [applyProximity, commitRemotes, commitSpeaking, guestToken, openRoom, syncRemotes],
  )

  // Conecta/desconecta quando a sala estável muda.
  useEffect(() => {
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer)
      retryRef.current.timer = null
    }
    retryRef.current.attempts = 0
    if (!stableRoom) {
      // Sem sala desejada: ninguém vai chamar connectTo para invalidar uma
      // conexão em voo — precisamos incrementar a geração nós mesmos, senão
      // uma continuação pendente reconecta depois do "off".
      generationRef.current += 1
      void roomRef.current?.disconnect()
      roomRef.current = null
      targetRoomRef.current = null
      setStatus('off')
      setRoomName(null)
      commitRemotes([])
      commitSpeaking(new Set())
      // Este hook vive num provider que NUNCA desmonta (o escritório sobrevive
      // à navegação) — "sair" de verdade só zera os inputs, não desmonta. Sem
      // isso, mic/câmera ficam marcados como ligados da sessão morta e
      // `localCameraTrack` pode renderizar um balão com track morto ao voltar.
      setMicEnabled(false)
      setMicError(false)
      setCameraEnabled(false)
      setCameraError(false)
      setScreenShareEnabled(false)
      setScreenShareError(false)
      setLocalCameraTrack(null)
      setLocalScreenTrack(null)
      screenShareOrderRef.current = new Map()
      // A sessão de mídia morreu: a PRÓXIMA conexão é um spawn de novo (voltar
      // ao escritório, WS reconectando) e tem que nascer mutada como qualquer
      // outro spawn — sem isto, o gate valia só uma vez por page load e quem
      // saiu desmutado voltava com o mic aberto.
      isSpawnConnectRef.current = true
      return
    }
    void connectTo(stableRoom)
  }, [stableRoom, connectTo, commitRemotes, commitSpeaking])

  // Proximidade re-avaliada a cada atualização de posições. `applyProximity`
  // só mexe na flag de assinatura do SDK (`pub.isSubscribed`) — sem o
  // `syncRemotes()` em seguida (mesmo par usado nos outros gatilhos de
  // proximidade acima), o áudio/vídeo continuava tocando com base no
  // `remotes` antigo até algum evento não relacionado do LiveKit disparar um
  // resync por conta própria (podendo nunca acontecer enquanto a pessoa só
  // anda, sem ninguém publicar/mutar nada).
  useEffect(() => {
    applyProximity()
    syncRemotes()
  }, [occupants, applyProximity, syncRemotes])

  // Repassa só as TRANSIÇÕES de fala para a cena do Phaser (badge/ondas) —
  // nunca para o servidor (ver `OfficeBridge.emitSpeakingChanged`).
  useEffect(() => {
    if (!bridge) return
    const prev = prevSpeakingRef.current
    for (const userId of speakingIds) {
      if (!prev.has(userId)) bridge.emitSpeakingChanged({ userId, speaking: true })
    }
    for (const userId of prev) {
      if (!speakingIds.has(userId)) bridge.emitSpeakingChanged({ userId, speaking: false })
    }
    prevSpeakingRef.current = speakingIds
  }, [bridge, speakingIds])

  // Unmount: derruba tudo. Incrementa a geração ANTES de desconectar, para que
  // um connectTo ainda em voo (await pendente) se veja superado ao continuar:
  // ele desconecta a própria Room e não agenda retry nenhum.
  useEffect(
    () => () => {
      generationRef.current += 1
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer)
      void roomRef.current?.disconnect()
      roomRef.current = null
    },
    [],
  )

  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const track = micTrackRef.current
    if (!track) {
      // Permissão negada antes — tentar de novo é o "tentar novamente" da barra.
      try {
        const { createLocalAudioTrack } = await loadLiveKit()
        const fresh = await createLocalAudioTrack({
          deviceId: audioInputDeviceIdRef.current ?? undefined,
        })
        fresh.stopOnMute = true
        await room.localParticipant.publishTrack(fresh)
        micTrackRef.current = fresh
        setMicError(false)
        setMicEnabled(true)
        writeMicPreference(true)
      } catch {
        setMicError(true)
      }
      return
    }
    if (track.isMuted) {
      // Com `stopOnMute`, desmutar reabre o dispositivo — leva alguns
      // instantes e pode falhar (mic ocupado por outro app, permissão
      // revogada). Sem tratamento, a promise rejeitava sozinha e o botão
      // ficava dizendo que o mic estava aberto.
      try {
        await track.unmute()
      } catch {
        setMicEnabled(false)
        setMicError(true)
        return
      }
      setMicEnabled(true)
      setMicError(false)
      writeMicPreference(true)
    } else {
      await track.mute()
      setMicEnabled(false)
      writeMicPreference(false)
    }
  }, [])

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(
        next,
        next && videoInputDeviceIdRef.current ? { deviceId: videoInputDeviceIdRef.current } : undefined,
      )
      setCameraEnabled(next)
      setCameraError(false)
    } catch {
      setCameraEnabled(false)
      setCameraError(true)
    }
  }, [cameraEnabled])

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !screenShareEnabled
    try {
      // `audio: true` pede o áudio junto: no Chrome/Edge habilita a caixinha
      // "compartilhar áudio da guia" ao escolher uma aba; `systemAudio:'include'`
      // oferece o áudio do sistema ao escolher tela inteira. Janela não tem
      // áudio (limite do getDisplayMedia) — nesse caso publica só o vídeo.
      await room.localParticipant.setScreenShareEnabled(next, {
        audio: true,
        systemAudio: 'include',
      })
      setScreenShareEnabled(next)
      setScreenShareError(false)
    } catch {
      setScreenShareEnabled(false)
      setScreenShareError(true)
    }
  }, [screenShareEnabled])

  /**
   * Força o estado do mic local — usado pelo alto-falante ("voz sai SÓ pelo
   * alto-falante" ⇒ silencia aqui ao ligar, restaura ao desligar). Sem track
   * (permissão negada), é no-op: não há o que silenciar.
   */
  const applyMicEnabled = useCallback(async (enabled: boolean) => {
    const track = micTrackRef.current
    if (!track) return
    if (enabled && track.isMuted) {
      // Mesma reaquisição de dispositivo do `toggleMic` — ver o porquê lá.
      try {
        await track.unmute()
      } catch {
        setMicEnabled(false)
        setMicError(true)
        return
      }
      setMicEnabled(true)
      setMicError(false)
    } else if (!enabled && !track.isMuted) {
      await track.mute()
      setMicEnabled(false)
    }
  }, [])

  /**
   * "Ocupado" é o lado MUDO do isolamento (o surdo está em `applyProximity`):
   * o mic é parado enquanto durar e volta à preferência do usuário ao sair.
   *
   * Guardado por `isolatedRef` para agir só na TRANSIÇÃO: `occupants` é um
   * array novo a cada render, e mexer no mic em toda passagem brigaria com o
   * alto-falante — que mexe no mesmo estado por `applyMicEnabled`.
   */
  const isolatedRef = useRef(false)
  useEffect(() => {
    const me = occupants.find((o) => o.userId === youId)
    const isolated = isOfficeAudioIsolated(me?.status)
    if (isolated === isolatedRef.current) return
    isolatedRef.current = isolated
    void applyMicEnabled(isolated ? false : readMicPreference())
  }, [occupants, youId, applyMicEnabled])

  /**
   * Troca o microfone em uso. Persiste sempre; só chama `switchActiveDevice`
   * (troca ao vivo, sem cair a chamada) quando já existe uma track de mic
   * publicada — sem isso, é só a preferência para a próxima vez.
   *
   * A preferência é escrita ANTES de tentar a troca ao vivo, e não é revertida
   * se `switchActiveDevice` rejeitar ou resolver `false` (dispositivo sumiu,
   * permissão revogada etc.): ela representa a INTENÇÃO do usuário, não o
   * estado ao vivo — a próxima reconexão (`connectTo`, que lê
   * `audioInputDeviceIdRef`) tenta esse dispositivo de novo do zero. O que
   * importa aqui é só não deixar a promise rejeitar sem tratamento — daí o
   * try/catch, sem UI de erro dedicada (não existe esse padrão em
   * `OfficeMediaState` hoje e criar um é fora do escopo deste ajuste).
   */
  const setAudioInputDevice = useCallback(async (deviceId: string | null) => {
    writeDevicePreference('audioInput', deviceId)
    setAudioInputDeviceIdState(deviceId)
    const room = roomRef.current
    if (!room || !micTrackRef.current) return
    try {
      await room.switchActiveDevice('audioinput', deviceId ?? 'default')
    } catch {
      // Troca ao vivo falhou — preferência já persistida fica de pé (ver
      // comentário acima); só evita promise rejeitada sem tratamento.
    }
  }, [])

  /**
   * Troca a câmera em uso. Persiste sempre; só chama `switchActiveDevice`
   * quando a câmera já está ligada — trocar a preferência não deve ligar a
   * câmera sozinha. Mesma lógica de "persiste e não reverte" do mic acima.
   */
  const setVideoInputDevice = useCallback(
    async (deviceId: string | null) => {
      writeDevicePreference('videoInput', deviceId)
      setVideoInputDeviceIdState(deviceId)
      const room = roomRef.current
      if (!room || !cameraEnabled) return
      try {
        await room.switchActiveDevice('videoinput', deviceId ?? 'default')
      } catch {
        // Troca ao vivo falhou — preferência já persistida fica de pé (ver
        // comentário em setAudioInputDevice); só evita promise rejeitada.
      }
    },
    [cameraEnabled],
  )

  return {
    status,
    roomName,
    openRoom,
    micEnabled,
    micError,
    cameraEnabled,
    cameraError,
    screenShareEnabled,
    screenShareError,
    remotes: remotes.map((r) => ({ ...r, speaking: speakingIds.has(r.userId) })),
    localCameraTrack,
    localScreenTrack,
    screenShareOrder: screenShareOrderRef.current,
    localSpeaking: youId ? speakingIds.has(youId) : false,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    applyMicEnabled,
    audioInputDeviceId,
    videoInputDeviceId,
    setAudioInputDevice,
    setVideoInputDevice,
  }
}
