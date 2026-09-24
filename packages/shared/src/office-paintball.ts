import type { CharacterLayer } from './character'
import type { Direction, MapDocumentV1, OfficeUserStatus, TilePosition } from './index'
import { DIRECTION_DELTAS, officeHash } from './office'
import { isMapTileWalkable } from './office-map-runtime'

/**
 * Paintball no escritório. Mesma anatomia do chute (`office-ball.ts`): o
 * cliente manda só o GESTO, o servidor resolve a trajetória INTEIRA de uma vez
 * (`firePaintball`) e cada cliente apenas anima. O hub é orientado a evento e
 * não ganhou loop de tick por causa desta feature — como não ganhou pela bola.
 *
 * O que sobra no mundo depois do tiro é o `PaintSplat`: uma marca no
 * personagem de quem levou, que vence sozinha.
 */

// ── o marcador (a "arma") ────────────────────────────────────────────────────

/**
 * Camadas LPC do marcador de paintball — o **estilingue**. Além de ler como
 * marcador nas quatro poses (o `Y` aparece de frente, de lado e de costas), ele
 * é a peça menos "arma" do acervo: num escritório, um paintball com besta ou
 * espingarda pesa diferente de um com estilingue.
 *
 * Referenciado por CAMINHO, e não pelo item do catálogo
 * (`weapon_ranged_slingshot`), de propósito: pelo catálogo o estilingue não
 * serve `teen` nem `child`, e criança desarmada no meio de uma partida seria um
 * bug, não uma regra. O sheet é universal — um arquivo só para todos os corpos
 * —, então aqui ele vale para os seis.
 *
 * O marcador também NÃO é guarda-roupa: não persiste em `avatarOptions` nem
 * aparece no editor de personagem. É estado de jogo, e some ao guardar a arma.
 *
 * Os dois zPos são os do catálogo, e são bem diferentes entre si: o fundo entra
 * **antes do corpo** (9 contra os 10 do body), porque nas poses de lado, de
 * costas e para cima o estilingue fica atrás do tronco; só a pose de frente
 * usa a camada da frente. Trocar a ordem põe a forquilha por cima das costas.
 */
export const PAINTBALL_MARKER_LAYERS: readonly CharacterLayer[] = [
  { path: 'weapon/ranged/slingshot/background/slingshot.png', zPos: 9 },
  { path: 'weapon/ranged/slingshot/foreground/slingshot.png', zPos: 140 },
]

/**
 * Categorias do guarda-roupa que somem enquanto o marcador está na mão.
 *
 * Ninguém segura duas coisas: sem isto, quem escolheu espada, escudo, enxada
 * ou cajado no editor de personagem aparece empunhando aquilo **e** o
 * estilingue, um por cima do outro. `shield_pattern`/`shield_trim` entram
 * junto porque são a pintura do escudo — deixá-los sozinhos faria o brasão
 * flutuar sem escudo embaixo, e `ammo` e `weapon_magic_crystal` pelo mesmo
 * motivo (a flecha é do arco, o cristal é do cajado).
 *
 * Nada disso encosta em `avatarOptions`: o marcador é efêmero, então guardar a
 * arma devolve sozinho o que a pessoa tinha na mão.
 */
export const PAINTBALL_MARKER_HIDES: readonly string[] = [
  'ammo',
  'shield',
  'shield_pattern',
  'shield_trim',
  'weapon',
  'weapon_magic_crystal',
]

// ── constantes do tiro ───────────────────────────────────────────────────────

/** Até onde a bolinha chega, em tiles, se nada a parar antes. */
export const PAINTBALL_RANGE = 8

/** Tempo de voo por tile. Bem mais rápido que a bola: é um tiro, não um chute. */
export const PAINTBALL_TILE_MS = 28

/**
 * Cadência do marcador. Mora no servidor porque cada tiro aceito é broadcast
 * para o escritório inteiro: sem cadência de lá, um teclado com auto-repeat
 * (ou um cliente adulterado) vira metralhadora de broadcast. O cliente espelha
 * o mesmo valor só para apagar o botão.
 */
export const PAINTBALL_COOLDOWN_MS = 600

/** Quanto tempo uma marca fica no personagem antes de sumir sozinha. */
export const PAINT_SPLAT_TTL_MS = 25_000

/**
 * Marcas simultâneas por pessoa; a mais velha sai para a nova entrar. Sem
 * teto, uma rajada em cima de alguém parado empilharia dezenas de sprites no
 * mesmo container.
 */
export const PAINTBALL_MAX_SPLATS = 5

/**
 * Paleta das tintas. Cores saturadas e distinguíveis entre si — a cor é a
 * resposta visual de "quem me acertou", então duas pessoas do mesmo escritório
 * precisam cair em tons que ninguém confunde a 48px.
 */
export const PAINTBALL_COLORS: readonly number[] = [
  0xff3b7b, 0xffd23f, 0x2ec4b6, 0x4d8bff, 0xa06cff, 0xff7f2a, 0x59e07a, 0xff5ce1,
]

/**
 * Cor da tinta de quem atira, derivada como o spawn e o confete: hash estável
 * sobre a paleta, nada de sorteio.
 *
 * É por AQUI que os modos por time entram depois — basta a cor passar a vir do
 * time em vez do usuário, sem tocar em trajetória, marca ou render.
 */
export function paintballColorFor(userId: string): number {
  return PAINTBALL_COLORS[officeHash(userId) % PAINTBALL_COLORS.length]
}

/**
 * Se uma pessoa entra na conta do tiro. `away`/`brb` são status manuais: quem
 * marcou já disse que não está aqui, então não leva marca — e, principalmente,
 * NÃO para a bolinha de quem está atrás. Se o corpo de quem se ausentou
 * barrasse o tiro, o status de presença viraria posição tática.
 */
export function isPaintballTarget(status: OfficeUserStatus | undefined): boolean {
  return (status ?? 'online') === 'online'
}

// ── a marca ──────────────────────────────────────────────────────────────────

/** Uma mancha de tinta num personagem. Efêmera: vive no hub e vence sozinha. */
export interface PaintSplat {
  /**
   * Id da marca. Além de identificar, é a SEMENTE do visual: posição no
   * torso, tamanho e giro saem de `paintSplatPlacement(id)`, então todo mundo
   * vê a mancha no mesmo lugar sem que isso ocupe payload.
   */
  id: string
  /** Quem levou. */
  userId: string
  /** Quem acertou — é dele a cor. */
  byUserId: string
  color: number
  /**
   * Quanto AINDA falta para a marca vencer, em ms. Nunca um instante
   * absoluto: quem chega no meio da vida dela recebe o que sobrou e conta a
   * partir dali, sem depender de relógios sincronizados (mesma escolha do
   * áudio de sala, que manda a faixa com a posição já avançada).
   */
  ttlMs: number
}

/**
 * Quantos desenhos de mancha existem. A arte mora no cliente
 * (`PAINT_SPLAT_MASKS`, na cena), mas a CONTAGEM mora aqui: é ela que fecha a
 * escolha da variante no hash, e a escolha precisa dar o mesmo resultado em
 * todo mundo.
 */
export const PAINT_SPLAT_VARIANTS = 4

/** Onde a mancha cai no personagem, e qual desenho ela usa. */
export interface PaintSplatPlacement {
  /** −1 (borda esquerda do torso) a 1 (direita). */
  ox: number
  /** −1 (ombros) a 1 (quadril). */
  oy: number
  /** Índice em `PAINT_SPLAT_MASKS` — a variedade vem daqui, não de transformação. */
  variant: number
}

/**
 * Aparência da mancha, derivada do id. O servidor manda o FATO (id, cor,
 * prazo) e o cliente deriva o visual — como o hash é compartilhado e o id é o
 * mesmo para todos, ninguém precisa combinar nada.
 *
 * A variedade vem de DESENHOS diferentes, não de girar e redimensionar um
 * desenho só. O jogo roda com `pixelArt: true` (nearest-neighbour, sem
 * suavização): girar em ângulo livre, ou desenhar uma textura de 16px num
 * espaço de 7px, reamostra a arte e devolve um borrão serrilhado no lugar da
 * mancha. Com máscaras desenhadas no tamanho real e escolhidas por hash, cada
 * pixel sai como foi desenhado.
 *
 * Cada campo sai de um hash PRÓPRIO, com um prefixo diferente, em vez de
 * fatias de bits do mesmo número. Fatiar não serve aqui: ids de tiros
 * seguidos do mesmo par diferem só nos últimos dígitos do instante, e o djb2
 * quase não leva essa diferença para os bits altos — o giro saía idêntico e o
 * tamanho quase igual em todas as manchas de uma pessoa, que é exatamente o
 * "carimbo repetido" que esta função existe para evitar.
 */
export function paintSplatPlacement(id: string): PaintSplatPlacement {
  const unit = (salt: string) => (officeHash(`${salt}:${id}`) % 1000) / 999
  return {
    ox: unit('x') * 2 - 1,
    oy: unit('y') * 2 - 1,
    variant: officeHash(`v:${id}`) % PAINT_SPLAT_VARIANTS,
  }
}

// ── o tiro ───────────────────────────────────────────────────────────────────

/** Resultado de um tiro: a trajetória INTEIRA, resolvida de uma vez. */
export interface PaintballShot {
  shooterId: string
  /** Tile de onde saiu — o cliente começa a animação aqui. */
  from: TilePosition
  dir: Direction
  /**
   * Tiles por onde a bolinha passa, em ordem, sem o de origem. O último é onde
   * ela estoura (na parede, em quem levou, ou no fim do alcance). Vazio =
   * atirou contra a parede colada.
   */
  path: TilePosition[]
  durationMs: number
  color: number
  /** A marca criada, ou `null` quando o tiro não achou ninguém. */
  splat: PaintSplat | null
}

/** Uma pessoa que o tiro pode encontrar pelo caminho. */
export interface PaintballTarget extends TilePosition {
  userId: string
  status?: OfficeUserStatus
}

export interface FirePaintballOptions {
  document: MapDocumentV1
  shooter: TilePosition & { userId: string; dir: Direction }
  /** Todo mundo no escritório; quem atira é ignorado sozinho. */
  occupants: readonly PaintballTarget[]
  /** Semente do id da marca — o instante do tiro, passado pelo hub. */
  now: number
}

/**
 * Resolve o tiro inteiro na hora, em vez de simular a bolinha quadro a quadro
 * no servidor. Mesma divisão de `kickBall`: o servidor manda a trajetória, o
 * cliente interpola.
 *
 * A bolinha anda reto na direção ENCARADA (quatro direções — `Direction` é o
 * facing, e o personagem LPC tem quatro poses) e para no primeiro de:
 *
 * - alguém no caminho → a marca é dessa pessoa;
 * - tile não andável (parede, mesa, planta) → estoura no cenário, sem marca;
 * - fim do alcance.
 *
 * `isMapTileWalkable` continua sendo a regra ÚNICA de colisão, e mesa parando
 * tiro é de propósito: cobertura é o que transforma o mapa em arena, e é a
 * peça que "pegue a bandeira" e "mata-mata" herdam de graça.
 */
export function firePaintball({
  document,
  shooter,
  occupants,
  now,
}: FirePaintballOptions): PaintballShot {
  const delta = DIRECTION_DELTAS[shooter.dir]
  const color = paintballColorFor(shooter.userId)
  const from = { x: shooter.x, y: shooter.y }
  // Só quem pode levar marca entra no índice: quem está ausente é atravessado,
  // e não vira escudo para quem estiver atrás (ver `isPaintballTarget`).
  const targets = new Map(
    occupants
      .filter((other) => other.userId !== shooter.userId && isPaintballTarget(other.status))
      .map((other) => [`${other.x},${other.y}`, other] as const),
  )

  const path: TilePosition[] = []
  let hit: PaintballTarget | null = null

  for (let step = 1; step <= PAINTBALL_RANGE; step += 1) {
    const tile = { x: from.x + delta.x * step, y: from.y + delta.y * step }
    // A parede não entra no caminho: a bolinha estoura no tile ANTERIOR, que é
    // onde o cliente desenha o respingo.
    if (!isMapTileWalkable(document, tile.x, tile.y)) break
    path.push(tile)
    const target = targets.get(`${tile.x},${tile.y}`)
    if (target) {
      hit = target
      break
    }
  }

  return {
    shooterId: shooter.userId,
    from,
    dir: shooter.dir,
    path,
    durationMs: path.length * PAINTBALL_TILE_MS,
    color,
    splat: hit
      ? {
          // Determinístico e único: mesma dupla, mesmo instante, mesmo id em
          // todos os clientes — é o que faz a mancha cair no mesmo lugar em
          // todas as telas sem mandar coordenada nenhuma.
          id: `${shooter.userId}:${hit.userId}:${now}`,
          userId: hit.userId,
          byUserId: shooter.userId,
          color,
          ttlMs: PAINT_SPLAT_TTL_MS,
        }
      : null,
  }
}
