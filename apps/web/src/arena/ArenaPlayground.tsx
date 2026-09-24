import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ARENA_MAX_HITS,
  ARENA_MODES,
  ARENA_MODE_LABELS,
  ARENA_TEAMS,
  ARENA_TEAM_COLORS,
  ARENA_SOCCER_KICKOFF_MS,
  ARENA_RACE_LAPS,
  modeIsRace,
  arenaAssetsFor,
  arenaDocumentFor,
  mapSpawnTiles,
  modeHasShooting,
  type ArenaMode,
  type ArenaOccupant,
  type ArenaServerMessage,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { useArenaSocket } from './useArenaSocket'
import type {
  ArenaDebugInfo,
  ArenaGoalInfo,
  ArenaMatchInfo,
  ArenaMinimapInfo,
  ArenaRaceNoticeInfo,
} from './ArenaScene'
import { ArenaMinimap } from './ArenaMinimap'
import { ArenaLobby } from './ArenaLobby'
import { ArenaMediaBar } from './media/ArenaMediaBar'
import { ArenaRemoteAudio } from './media/ArenaRemoteAudio'
import { useArenaMedia } from './media/useArenaMedia'
import { useArenaChat } from './useArenaChat'
import { CharacterOverlay } from '../office/media/CharacterOverlay'
import { RoomChatPanel } from '../office/media/RoomChatPanel'
import { useCharacterScreenPositions } from '../office/media/useCharacterScreenPositions'

/**
 * Banco de provas do movimento livre da arena — **local**, sem servidor.
 *
 * Responde a única pergunta do marco 1 que nenhum teste responde: *andar
 * ficou gostoso?* Como `stepBody` é a mesma função que o servidor vai rodar,
 * o que se sente aqui é o que a arena em rede entrega para o dono do
 * personagem; a rede acrescenta reconciliação e interpolação, que mudam como
 * se vê os OUTROS, não como se sente o próprio passo.
 *
 * Vem ANTES do netcode de propósito: se o passo não agradar, a constante se
 * ajusta aqui de graça, em vez de depois de hub, socket e cena prontos.
 */
/** O que cada cartão do menu promete. */
const MODO_DESCRICAO: Record<ArenaMode, string> = {
  'mata-mata': 'Cada acerto abate e vale um ponto. Vence quem chegar a 25.',
  bandeira: 'Leve a bandeira do adversário até a sua base — com a sua em casa.',
  futebol:
    'Sem tiro: só bola. Ande por cima dela para conduzir, Espaço (ou clique) chuta, E (ou botão direito) passa — com Shift, chutão. Cinco gols em cinco minutos.',
  corrida:
    'Sem tiro: só pilotagem. W acelera, S freia e engata a ré, A/D esterçam — e o kart só vira andando. Shift é freio de mão para a curva fechada, R desatola. Cinco voltas, classificação individual.',
}

/** Quanto tempo um aviso de corrida fica na tela. */
const AVISO_DE_CORRIDA_MS = 2_600

/** m:ss.mmm — a volta se ganha no décimo, então aqui o milissegundo importa. */
function formatarVolta(ms: number): string {
  const total = Math.max(0, ms)
  const minutos = Math.floor(total / 60_000)
  const segundos = Math.floor((total % 60_000) / 1000)
  const milis = Math.floor(total % 1000)
  return `${minutos}:${String(segundos).padStart(2, '0')}.${String(milis).padStart(3, '0')}`
}

/** mm:ss — o placar precisa de tempo, não de milissegundos. */
function formatarTempo(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function ArenaPlayground() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const { user } = useAuth()
  const [debugVisivel, setDebugVisivel] = useState(false)
  const [match, setMatch] = useState<ArenaMatchInfo | null>(null)
  const [minimapa, setMinimapa] = useState<ArenaMinimapInfo | null>(null)
  /**
   * `menu` → `entrando` → `jogando`.
   *
   * O menu existe por dois motivos. O óbvio: escolher o modo antes de cair em
   * campo. O menos óbvio: trocar de modo é trocar de ARENA, e antes disso a
   * troca acontecia com a pessoa já jogando — no intervalo entre desconectar e
   * o novo `welcome`, quem saísse andando via o personagem andar e ser puxado
   * de volta. Com a fase explícita, esse intervalo é uma tela de carregamento.
   */
  const [fase, setFase] = useState<'menu' | 'entrando' | 'jogando'>('menu')
  const [modo, setModo] = useState<ArenaMode | null>(null)
  /** O aviso de gol, que some sozinho quando a saída de bola sai. */
  const [gol, setGol] = useState<ArenaGoalInfo | null>(null)
  /** O aviso da corrida (largada, volta, chegada), que some sozinho. */
  const [aviso, setAviso] = useState<ArenaRaceNoticeInfo | null>(null)
  const [showCollision, setShowCollision] = useState(false)
  const [zoom, setZoom] = useState(2)
  const [debug, setDebug] = useState<ArenaDebugInfo>({ x: 0, y: 0, fps: 0, pending: 0, players: 1, mode: 'local', stalled: false })
  const sceneRef = useRef<import('./ArenaScene').ArenaScene | null>(null)

  /**
   * O último `welcome`, guardado para sempre — não uma fila que se esvazia.
   *
   * É o análogo do welcome sintético do `OfficeBridge`, e existe pelo mesmo
   * motivo: o socket abre muito antes de o Phaser (~1,4 MB) carregar, e o
   * `welcome` é o único pacote que não se repete. Com uma fila drenada, a
   * PRIMEIRA cena consumia o welcome e a segunda — a que o StrictMode monta de
   * verdade — nascia sem ele: sem `youId`, sem predição, sem os outros. A cena
   * ficava "em local" achando que ninguém tinha entrado.
   */
  const welcomeRef = useRef<ArenaServerMessage | null>(null)
  /**
   * Quem está na arena, em estado React — só para o chat (avatar e nome de
   * quem falou) e para o contador da barra. O que a CENA precisa continua
   * vindo do snapshot, sem passar por aqui: isto muda por evento (entrou,
   * saiu), não vinte vezes por segundo.
   */
  const [jogadores, setJogadores] = useState<ArenaOccupant[]>([])
  const [chatAberto, setChatAberto] = useState(false)

  /** Mesmo motivo do `sendRef` do saguão: o chat é declarado antes do socket. */
  const sendRef = useRef<(text: string) => void>(() => {})
  const chat = useArenaChat({
    send: (text) => sendRef.current(text),
    sender: user ? { userId: user.id, name: user.name } : null,
    connected: fase === 'jogando',
    open: chatAberto,
  })

  const arena = useArenaSocket(fase === 'menu' ? null : modo, (message) => {
    if (message.type === 'welcome') {
      welcomeRef.current = message
      setJogadores(message.players)
    } else if (message.type === 'joined') {
      setJogadores((atuais) => [
        ...atuais.filter((jogador) => jogador.userId !== message.player.userId),
        message.player,
      ])
    } else if (message.type === 'left') {
      setJogadores((atuais) => atuais.filter((jogador) => jogador.userId !== message.userId))
    } else if (message.type === 'chat') {
      chat.receive(message)
    }
    sceneRef.current?.handleServerMessage(message)
  })

  // O cenário é GERADO, não buscado: a mesma função que o servidor chama.
  // Sem documento no fio nem no banco, cliente e servidor não têm como
  // discordar sobre onde estão as paredes.
  //
  // Quem escolhe é o MODO — o futebol tem campo próprio. Mata-mata e bandeira
  // continuam devolvendo o mesmo documento e os mesmos assets (a cache do
  // `arena-scenario` é por cenário), então trocar entre eles não remonta o
  // Phaser, como antes.
  const cenario: ArenaMode = modo ?? 'mata-mata'
  const document = useMemo(() => arenaDocumentFor(cenario), [cenario])
  const assets = useMemo(() => arenaAssetsFor(cenario), [cenario])

  const avatar = useMemo(
    () => ({
      userId: user?.id ?? 'arena',
      avatarStyle: user?.avatarStyle ?? null,
      avatarSeed: user?.avatarSeed ?? null,
      avatarOptions: user?.avatarOptions ?? null,
    }),
    [user],
  )

  // `send` muda de identidade a cada render; a cena guarda o ref, não a função,
  // para não precisar ser remontada a cada um.
  const arenaRef = useRef(arena)
  arenaRef.current = arena
  sendRef.current = (text) => arenaRef.current.send({ type: 'chat', text })

  /**
   * Voz e câmera da arena. Conecta só em `jogando`: o token do LiveKit é
   * autorizado pela presença no hub, e pedi-lo enquanto o `welcome` não chegou
   * volta 409.
   */
  const readPresence = useCallback(() => sceneRef.current?.presence() ?? null, [])
  const media = useArenaMedia({
    arenaId: fase === 'jogando' ? modo : null,
    spatial: true,
    readPresence,
  })

  /**
   * Só quem tem câmera ligada ganha balão. O escritório mostra um badge de
   * nome quando não há vídeo; aqui não — nome flutuando sobre todo mundo
   * entregaria a posição do adversário, que é justamente o que o jogo esconde
   * (ver `REVEAL_MS` na cena).
   */
  const idsComCamera = useMemo(() => {
    const ids = media.remotes.filter((remoto) => remoto.cameraTrack).map((remoto) => remoto.userId)
    if (media.cameraEnabled && user?.id) ids.push(user.id)
    return ids
  }, [media.remotes, media.cameraEnabled, user?.id])
  const posicoesDosBaloes = useCharacterScreenPositions(sceneRef, idsComCamera)

  const entrar = (escolhido: ArenaMode) => {
    welcomeRef.current = null
    sceneRef.current?.resetForNewSession()
    setMatch(null)
    setMinimapa(null)
    setJogadores([])
    setGol(null)
    setAviso(null)
    chat.reset()
    setModo(escolhido)
    setFase('entrando')
  }

  const voltarAoMenu = () => {
    welcomeRef.current = null
    sceneRef.current?.resetForNewSession()
    setMatch(null)
    setMinimapa(null)
    setJogadores([])
    setChatAberto(false)
    setGol(null)
    setAviso(null)
    chat.reset()
    setModo(null)
    setFase('menu')
  }

  /**
   * O nome de quem fez o gol. Sai daqui, e não da cena, porque a cena não sabe
   * o PRÓPRIO nome — e o gol que mais importa mostrar é o seu.
   */
  const autorDoGol = gol?.userId
    ? (jogadores.find((jogador) => jogador.userId === gol.userId)?.name ?? null)
    : null

  // O aviso de gol dura o que dura a saída de bola: quando a bola volta a
  // rolar, o que estava na tela deixou de ser notícia.
  useEffect(() => {
    if (!gol) return
    const timer = setTimeout(() => setGol(null), ARENA_SOCCER_KICKOFF_MS)
    return () => clearTimeout(timer)
  }, [gol])

  /**
   * O nome de um id, quando ele está na arena.
   *
   * Mora aqui, e não na cena, pela mesma razão do autor do gol: a cena conhece o
   * nome dos OUTROS (veio no `joined`), mas não o PRÓPRIO — e numa corrida o
   * nome que mais importa mostrar é o seu.
   */
  const nomeDe = (userId?: string | null) =>
    userId ? (jogadores.find((jogador) => jogador.userId === userId)?.name ?? null) : null

  const autorDoAviso = nomeDe(aviso?.userId)

  // O aviso da corrida é passageiro: a volta seguinte já é outra notícia.
  useEffect(() => {
    if (!aviso) return
    const timer = setTimeout(() => setAviso(null), AVISO_DE_CORRIDA_MS)
    return () => clearTimeout(timer)
  }, [aviso])

  // F3 abre e fecha o diagnóstico. Fora dele, a tela é só o jogo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault()
        setDebugVisivel((visivel) => !visivel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    sceneRef.current?.setShowCollision(showCollision)
  }, [showCollision])

  /**
   * Fechar o chat devolve o teclado à cena. O `onBlurCapture` do painel não
   * cobre isto: quando o painel é DESMONTADO com o cursor dentro dele, o React
   * não dispara blur — e o personagem ficaria surdo ao WASD até o próximo
   * clique no campo de texto.
   */
  useEffect(() => {
    if (!chatAberto) sceneRef.current?.setInputEnabled(true)
  }, [chatAberto])

  useEffect(() => {
    if (!document) return
    let game: import('phaser').Game | null = null
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null

    void (async () => {
      const [{ default: Phaser }, { ArenaScene }] = await Promise.all([
        import('phaser'),
        import('./ArenaScene'),
      ])
      if (cancelled || !hostRef.current) return

      // Nasce num spawn do mapa, no centro do tile: é chão garantido, e evita
      // acordar dentro de uma parede num mapa qualquer.
      const spawnTile = mapSpawnTiles(document)[0] ?? { x: 2, y: 2 }
      const spawn = {
        x: spawnTile.x * document.map.tileWidth + document.map.tileWidth / 2,
        y: spawnTile.y * document.map.tileHeight + document.map.tileHeight / 2,
      }

      const scene = new ArenaScene(document, assets, avatar, spawn, cenario)
      scene.setShowCollision(showCollision)
      scene.setDebugListener(setDebug)
      scene.setZoomListener(setZoom)
      scene.setMatchListener(setMatch)
      // Sai do carregamento só quando há autoridade: posição, time e partida.
      scene.setReadyListener(() => setFase('jogando'))
      scene.setMinimapListener(setMinimapa)
      scene.setGoalListener(setGol)
      scene.setRaceNoticeListener(setAviso)
      scene.setSender((message) => arenaRef.current.send(message))
      sceneRef.current = scene
      // Reproduz o welcome para a cena nova. Ela guarda o que chegar antes do
      // boot do Phaser e aplica no `create()`.
      if (welcomeRef.current) scene.handleServerMessage(welcomeRef.current)

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: hostRef.current.clientWidth || 800,
        height: hostRef.current.clientHeight || 600,
        backgroundColor: '#15151a',
        pixelArt: true,
        scale: { mode: Phaser.Scale.RESIZE },
        scene,
      })

      resizeObserver = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) game?.scale.resize(width, height)
      })
      resizeObserver.observe(hostRef.current)
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      game?.destroy(true)
      sceneRef.current = null
    }
    // A cena é criada uma vez por documento; velocidade e overlay entram pelos
    // setters acima, sem remontar o jogo (remontar zeraria a posição a cada
    // arrasto do controle de velocidade).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // A cena é criada uma vez por documento e sobrevive à troca de modo (o
    // cenário é o mesmo); quem limpa o estado da sessão anterior é
    // `resetForNewSession`.
  }, [document, assets, avatar, cenario])

  return (
    // `h-screen`, e não `h-full`: como o `/escritorio`, esta rota fica FORA do
    // `AppLayout`, então nada acima dela tem altura definida — com `h-full` o
    // contêiner nasce com 0px e o `overflow-hidden` corta a tela inteira.
    <div className="relative h-screen w-full overflow-hidden bg-surface">
      <div ref={hostRef} className="h-full w-full" />

      {/* Balões de webcam por cima do canvas, ancorados no personagem — o
          MESMO componente do escritório (`CharacterOverlay`). */}
      {media.cameraEnabled && user && (
        <CharacterOverlay
          name={user.name}
          cameraTrack={media.localCameraTrack}
          screenTrack={null}
          mirrored
          position={posicoesDosBaloes.get(user.id) ?? null}
        />
      )}
      {media.remotes.map(
        (remoto) =>
          remoto.cameraTrack && (
            <CharacterOverlay
              key={remoto.userId}
              name={remoto.name}
              cameraTrack={remoto.cameraTrack}
              screenTrack={null}
              position={posicoesDosBaloes.get(remoto.userId) ?? null}
            />
          ),
      )}

      {/* Voz espacial: ganho e pan pela distância em campo (ver `ArenaRemoteAudio`). */}
      {media.remotes.map(
        (remoto) =>
          remoto.audioTrack && (
            <ArenaRemoteAudio
              key={remoto.userId}
              track={remoto.audioTrack}
              userId={remoto.userId}
              readPresence={readPresence}
            />
          ),
      )}

      {/*
        Sem painel de controles. A velocidade é do servidor, o zoom tem roda e
        teclado, e a colisão é depuração — deixar tudo isso na tela tapava o
        canto do campo e dava a um jogo a cara de ferramenta.

        Ficam só duas coisas: a saída (sem ela a arena é um beco sem volta) e o
        diagnóstico, escondido atrás do F3. O diagnóstico já pagou o próprio
        custo: foi o contador de inputs pendentes que denunciou a arena muda.
      */}
      {/*
        Placar no topo, centralizado: é a única informação do jogo que precisa
        estar sempre visível. Tudo o mais que estava no painel virou depuração
        atrás do F3.
      */}
      {match && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
          <div className="flex items-center gap-md rounded-full border border-outline-variant/30 bg-surface-container/85 px-lg py-1.5 font-label text-title-sm shadow-sm backdrop-blur">
            {/*
              Na corrida o placar de time não diz nada — ele fica zerado de
              propósito, porque a classificação é individual. O que ocupa o topo
              é o que decide a prova: em que posição você está e em que volta.
            */}
            {modeIsRace(match.mode) ? (
              <>
                <span className="flex items-baseline gap-1">
                  <span className="font-headline text-title-md text-on-surface">
                    {match.suaPosicao ?? '—'}
                  </span>
                  <span className="text-label-sm text-on-surface-variant">
                    / {match.race?.standings.length ?? 1}
                  </span>
                </span>
                <span className="flex items-baseline gap-1 border-l border-outline-variant/40 pl-md">
                  <span className="text-label-sm text-on-surface-variant">volta</span>
                  <span className="font-headline text-title-md text-on-surface">
                    {match.suaVolta ?? 1}
                  </span>
                  <span className="text-label-sm text-on-surface-variant">
                    / {match.race?.laps ?? ARENA_RACE_LAPS}
                  </span>
                </span>
              </>
            ) : (
              ARENA_TEAMS.map((time) => (
              <span key={time} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: `#${ARENA_TEAM_COLORS[time].toString(16).padStart(6, '0')}` }}
                />
                <span className={match.team === time ? 'text-on-surface' : 'text-on-surface-variant'}>
                  {match.scores[time]}
                </span>
              </span>
              ))
            )}
            <span className="font-label text-label-md text-on-surface-variant">
              {/*
                Depois de o primeiro cruzar, o relógio que importa é o da
                bandeirada — não o da partida, que ainda tem minutos e daria a
                impressão errada de que há tempo de sobra.
              */}
              {formatarTempo(match.race?.finishGraceMs ?? match.remainingMs)}
            </span>

            {/*
              A vida precisa estar na tela: sem ela, quem leva tinta e não cai
              não entende se escapou por sorte ou se o tiro não valeu. No
              futebol não há vida nenhuma — e um indicador que nunca muda é
              pior que indicador nenhum.
            */}
            {modeHasShooting(match.mode) && (
              <span className="flex items-center gap-1 border-l border-outline-variant/40 pl-md">
                {Array.from({ length: ARENA_MAX_HITS }, (_, i) => (
                  <span
                    key={i}
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      i < match.vidas ? 'bg-primary' : 'border border-outline-variant/60'
                    }`}
                  />
                ))}
              </span>
            )}
          </div>

          {gol && (
            <span
              className="rounded-full px-lg py-1 font-headline text-title-md text-on-primary shadow-sm"
              style={{
                backgroundColor: `#${ARENA_TEAM_COLORS[gol.team].toString(16).padStart(6, '0')}`,
              }}
            >
              GOL do time {gol.team}
              {autorDoGol && ` · ${autorDoGol}`}
              {gol.contra && ' (contra)'}
            </span>
          )}

          {/*
            O semáforo. Ocupa o lugar do aviso de gol porque é a mesma coisa: o
            que está acontecendo AGORA e que some sozinho.
          */}
          {match.race?.countdownMs !== undefined && (
            <span className="rounded-full bg-primary px-xl py-1 font-headline text-headline-sm text-on-primary shadow-sm">
              {Math.ceil(match.race.countdownMs / 1000)}
            </span>
          )}

          {aviso && match.race?.countdownMs === undefined && (
            <span className="rounded-full bg-surface-container/85 px-lg py-1 font-label text-label-md text-on-surface shadow-sm backdrop-blur">
              {aviso.kind === 'largada' && 'Valendo!'}
              {aviso.kind === 'volta' &&
                `${autorDoAviso ?? 'Você'} · volta ${aviso.lap}${
                  aviso.lapMs ? ` em ${formatarVolta(aviso.lapMs)}` : ''
                }`}
              {aviso.kind === 'chegada' && `${aviso.position}º · ${autorDoAviso ?? 'você'}`}
            </span>
          )}

          {match.phase === 'intervalo' && (
            <span className="rounded-full bg-surface-container/85 px-lg py-1 font-label text-label-md text-on-surface shadow-sm backdrop-blur">
              {modeIsRace(match.mode)
                ? `${nomeDe(match.podium?.[0]) ?? 'Ninguém'} venceu`
                : match.winner
                  ? `Time ${match.winner} venceu`
                  : 'Empate'}{' '}
              · próxima em {formatarTempo(match.remainingMs)}
            </span>
          )}
        </div>
      )}

      {/*
        A classificação ao vivo. Fica na lateral, e não no topo, porque cresce
        com o número de pilotos — e o topo tem de continuar legível de relance.
      */}
      {fase === 'jogando' && match?.race && match.race.standings.length > 1 && (
        <div className="pointer-events-none absolute right-4 top-24 z-10 flex w-44 flex-col gap-0.5 rounded-lg border border-outline-variant/30 bg-surface-container/85 p-sm shadow-sm backdrop-blur">
          {match.race.standings.map((linha) => (
            <div
              key={linha.userId}
              className={`flex items-baseline gap-2 rounded px-1.5 py-0.5 font-label text-label-sm ${
                linha.userId === user?.id ? 'bg-primary/15 text-on-surface' : 'text-on-surface-variant'
              }`}
            >
              <span className="w-4 shrink-0 text-right tabular-nums">{linha.position}</span>
              <span className="flex-1 truncate">{nomeDe(linha.userId) ?? '—'}</span>
              <span className="shrink-0 tabular-nums text-label-sm">
                {linha.finished ? '✓' : `V${linha.lap + 1}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {fase === 'jogando' && minimapa && (
        <ArenaMinimap info={minimapa} desviarDoPainel={chatAberto} />
      )}

      {fase === 'menu' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-lg bg-surface/85 backdrop-blur">
          <div className="flex flex-col items-center gap-1">
            <span className="font-headline text-headline-md text-on-surface">Arena</span>
            <span className="font-label text-label-md text-on-surface-variant">
              Escolha o modo. Cada um tem a sua arena — quem já está jogando o outro não é
              interrompido.
            </span>
          </div>

          {/*
            O menu É o saguão: os cartões de modo entram dentro dele, com a
            lista de quem está por aqui, o chat e a voz ao lado. Esperar para
            jogar deixa de ser esperar sozinho.
          */}
          <ArenaLobby
            you={user ? { userId: user.id, name: user.name } : null}
            onEntrar={
              <div className="flex flex-wrap justify-center gap-md">
                {ARENA_MODES.map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => entrar(opcao)}
                    className="flex w-64 flex-col gap-1 rounded-lg border border-outline-variant/40 bg-surface-container p-lg text-left transition hover:border-primary/60 hover:bg-surface-container-high"
                  >
                    <span className="font-headline text-title-md text-on-surface">
                      {ARENA_MODE_LABELS[opcao]}
                    </span>
                    <span className="font-label text-label-md text-on-surface-variant">
                      {MODO_DESCRICAO[opcao]}
                    </span>
                  </button>
                ))}
              </div>
            }
          />

          <button
            type="button"
            onClick={() => navigate('/escritorio')}
            className="font-label text-label-md text-on-surface-variant underline-offset-4 transition hover:text-on-surface hover:underline"
          >
            ← voltar ao escritório
          </button>
        </div>
      )}

      {fase === 'entrando' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-md bg-surface/85 font-label text-label-md text-on-surface-variant backdrop-blur">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
          <span>Entrando na arena — {modo ? ARENA_MODE_LABELS[modo] : ''}…</span>
        </div>
      )}

      {fase === 'jogando' && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <ArenaMediaBar
            media={media}
            chatAberto={chatAberto}
            chatNaoLidas={chat.unread}
            onToggleChat={() =>
              setChatAberto((aberto) => {
                if (!aberto) chat.markRead()
                return !aberto
              })
            }
            pessoas={jogadores.length || 1}
          />
        </div>
      )}

      {fase === 'jogando' && chatAberto && (
        /*
         * Enquanto o foco está dentro do painel, a cena para de ouvir teclado e
         * gatilho: sem isso, digitar "was" sairia andando (e o `addCapture` do
         * WASD engoliria as próprias letras antes de chegarem ao campo).
         */
        <div
          onFocusCapture={() => sceneRef.current?.setInputEnabled(false)}
          onBlurCapture={() => sceneRef.current?.setInputEnabled(true)}
          className="absolute bottom-0 right-0 top-0 z-20 flex w-80 flex-col border-l border-outline-variant/40 bg-surface-container/95 backdrop-blur"
        >
          <RoomChatPanel
            messages={chat.messages}
            occupants={jogadores}
            canSend={arena.connected && user !== null}
            onSendMessage={chat.sendMessage}
            onClose={() => setChatAberto(false)}
            title="Chat da arena"
            emptyText="Fale com quem está em campo."
            closeLabel="Fechar chat da arena"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => (fase === 'jogando' ? voltarAoMenu() : navigate('/escritorio'))}
        className="pointer-events-auto absolute left-4 top-4 z-10 rounded-full border border-outline-variant/30 bg-surface-container/80 px-3 py-1 font-label text-label-sm text-on-surface-variant shadow-sm backdrop-blur transition hover:bg-surface-container-highest hover:text-on-surface"
      >
        {fase === 'jogando' ? '← modos' : '← escritório'}
      </button>

      {debugVisivel && (
        <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col gap-0.5 rounded-lg border border-outline-variant/30 bg-surface-container/85 px-3 py-2 text-right font-label text-label-sm text-on-surface-variant shadow-sm backdrop-blur">
          <span>
            x {debug.x.toFixed(0)} · y {debug.y.toFixed(0)} · {debug.fps} fps · {zoom}×
          </span>
          <span>
            {arena.connected ? 'socket ok' : 'socket off'} · {debug.mode} · {debug.players}{' '}
            {debug.players === 1 ? 'jogador' : 'jogadores'} · {debug.pending} pendente(s)
            {debug.stalled && <span className="text-error"> · sem resposta</span>}
          </span>
          <label className="pointer-events-auto flex items-center justify-end gap-2">
            <input
              type="checkbox"
              checked={showCollision}
              onChange={(event) => setShowCollision(event.target.checked)}
            />
            colisão
          </label>
        </div>
      )}

    </div>
  )
}
