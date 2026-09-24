import { type AvatarStyleKey } from "./avatar";
import { defaultCharacterFromSeed, type CharacterOptions } from "./character";
import { type OfficeAnnotationPoint } from "./office-annotation";
import type {
  OfficeRoomAudioDeniedReason,
  OfficeRoomAudioEntry,
  OfficeRoomAudioTrack,
} from "./office-audio-share";
import type { OfficeBall, OfficeBallPower } from "./office-ball";
import type { BodyInput } from "./body-move";
import type { PaintSplat } from "./office-paintball";
import type { BodyShot } from "./body-paintball";
import type { OfficeDeskReminderSummaryDTO } from "./office-map";

/** Lado do tile em pixels. O mapa inteiro é medido nesta unidade. */
export const TILE_SIZE = 32;

/** O gesto que dispara o high-five. Comparado com o TEXTO da reação, não com a
 *  tecla: a lista de reações é customizável por usuário (localStorage), então a
 *  posição 1 não é garantidamente o 👋. */
export const HIGH_FIVE_EMOJI = "👋";

/**
 * Chance de um high-five sair como "palma perfeita" — aquela em que as mãos se
 * encontram no ponto exato e o estalo sai alto. Raro de propósito: se saísse
 * toda hora deixaria de ser um evento e viraria só o volume normal.
 */
export const PERFECT_HIGH_FIVE_CHANCE = 0.2;

/**
 * Por quanto tempo uma reação conta como "ativa" para efeito de high-five.
 * Casado com a fase visível do balão no cliente (entrada 350ms + 3 pulos
 * ~2700ms ≈ 3.05s até começar a sumir) — se fosse maior, o servidor dispararia
 * com as mãos já saindo da tela.
 */
export const REACTION_ACTIVE_WINDOW_MS = 3000;

/**
 * Planta do escritório. Uma linha por fileira de tiles.
 *
 * Legenda:
 *   `.` chão (andável) · `S` spawn (andável) ·
 *   `#` parede · `D` mesa · `P` planta · `C` bancada da copa
 * - A parede na coluna 16 fecha duas salas de reunião; portas em (16,12) e (16,15).
 *
 * Servidor e cliente leem ESTA constante — o servidor para validar colisão, o
 * cliente para desenhar. Não duplique a planta em lugar nenhum.
 */
export const OFFICE_MAP: readonly string[] = [
  "#########################",
  "#.......................#",
  "#..DDDD.......DDDD......#",
  "#..DDDD.......DDDD......#",
  "#.......................#",
  "#.......................#",
  "#..DDDD.......DDDD......#",
  "#..DDDD.......DDDD......#",
  "#.......................#",
  "#.......................#",
  "##########.....##########",
  "#CCCC..........P#..DD...#",
  "#CCCC...................#",
  "#...............#########",
  "#..........SSS..#.......#",
  "#..........SSS.....DD...#",
  "#...............#.......#",
  "#########################",
];

export const OFFICE_HEIGHT = OFFICE_MAP.length;
export const OFFICE_WIDTH = OFFICE_MAP[0].length;

/** Tiles que uma pessoa pode ocupar. Todo o resto é cenário sólido. */
export const WALKABLE_TILES: ReadonlySet<string> = new Set([".", "S"]);

export interface TilePosition {
  x: number;
  y: number;
}

/**
 * O TILE em que um ponto em pixel cai.
 *
 * Existe porque `OfficeOccupant.x/y` viraram pixel com o movimento livre, e
 * sala, mesa, radar e alcance de voz continuam sendo conceitos de tile — como
 * devem ser: uma sala tem borda de tile, não de pixel.
 *
 * Um helper só, e no shared, porque o compilador NÃO distingue as duas unidades
 * (as duas são `number`): a única defesa contra confundi-las é haver um lugar
 * evidente para converter, e ele aparecer no call site.
 *
 * `tileSize` é OBRIGATÓRIO, e já foi opcional (`= TILE_SIZE`). O default era
 * uma segunda unidade escondida: quatro chamadas — radar, grade de câmeras,
 * reações e assinatura de áudio — omitiram o argumento e passaram a medir o
 * mapa da empresa com a régua do mapa legado. Num mapa de 48 o raio de voz
 * encolhia a dois terços, e não havia erro de tipo em lugar nenhum. Passar
 * `document.map.tileWidth` custa o mesmo e diz de que mapa se está falando.
 */
export function tileOfPixel(point: { x: number; y: number }, tileSize: number): TilePosition {
  return { x: Math.floor(point.x / tileSize), y: Math.floor(point.y / tileSize) };
}

/** Tiles `S`, calculados uma vez no load do módulo. */
export const OFFICE_SPAWN_TILES: readonly TilePosition[] = OFFICE_MAP.flatMap(
  (row, y) =>
    [...row].flatMap((tile, x) => (tile === "S" ? [{ x, y }] : [])),
);

/** Fora do mapa também é "não andável" — quem chama não precisa checar limites. */
export function isWalkable(x: number, y: number): boolean {
  const row = OFFICE_MAP[y];
  if (row === undefined) return false;
  const tile = row[x];
  return tile !== undefined && WALKABLE_TILES.has(tile);
}

export const DIRECTIONS = ["up", "down", "left", "right"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * Direções de PASSO — as quatro cardeais mais as diagonais.
 *
 * Não confundir com `Direction`, que é o FACING: o personagem LPC só tem
 * quatro poses de caminhada, então um passo na diagonal é desenhado com a pose
 * horizontal (`facingForMove`). Manter os dois tipos separados é o que faz a
 * diagonal caber sem tocar em sprite, kart, high-five, confete ou no contato
 * da bola — todos continuam falando `Direction`.
 */
export const MOVE_DIRECTIONS = [
  "up",
  "down",
  "left",
  "right",
  "up-left",
  "up-right",
  "down-left",
  "down-right",
] as const;

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

export function isMoveDirection(value: unknown): value is MoveDirection {
  return (MOVE_DIRECTIONS as readonly unknown[]).includes(value);
}

export const MOVE_DIRECTION_DELTAS: Record<MoveDirection, TilePosition> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  "up-left": { x: -1, y: -1 },
  "up-right": { x: 1, y: -1 },
  "down-left": { x: -1, y: 1 },
  "down-right": { x: 1, y: 1 },
};

export function isDiagonalMove(move: MoveDirection): boolean {
  const delta = MOVE_DIRECTION_DELTAS[move];
  return delta.x !== 0 && delta.y !== 0;
}

/**
 * Pose que o sprite mostra num passo. Na diagonal quem ganha é a HORIZONTAL:
 * as poses de lado do LPC leem melhor de perfil do que as de costas/frente com
 * o corpo indo de banda.
 */
export function facingForMove(move: MoveDirection): Direction {
  const delta = MOVE_DIRECTION_DELTAS[move];
  if (delta.x !== 0) return delta.x > 0 ? "right" : "left";
  return delta.y > 0 ? "down" : "up";
}

/**
 * Um passo na diagonal cobre √2 tiles. Sem esticar a duração (e a cadência da
 * tecla) na mesma proporção, andar na diagonal ficaria 41% mais rápido — o bug
 * clássico de quem acrescenta oito direções a um jogo de grade.
 */
export const DIAGONAL_STEP_FACTOR = Math.SQRT2;

export type OfficeNearbyMessageKind = "speech" | "thought" | "reaction";

export const OFFICE_NEARBY_MESSAGE_MAX_LENGTH = 80;

export function isDirection(value: unknown): value is Direction {
  return (DIRECTIONS as readonly unknown[]).includes(value);
}

export const DIRECTION_DELTAS: Record<Direction, TilePosition> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * BFS no grid do escritório: menor caminho de `from` até um tile ANDÁVEL
 * ADJACENTE a `to` (nunca em cima do alvo — pessoas se atravessam, mas parar
 * sobre alguém é estranho). Custo uniforme, mapa 25×18 — BFS basta, A* não paga.
 *
 * Retorno: lista de direções (`[]` se `from` já é adjacente a `to`), ou `null`
 * se nenhum tile adjacente andável é alcançável.
 *
 * O alvo em si NÃO precisa ser andável (pode-se "chamar" alguém parado numa
 * borda), e os OUTROS ocupantes não são obstáculo (o hub não bloqueia
 * sobreposição) — o BFS considera só o cenário (`isWalkable`).
 */
export function findPath(from: TilePosition, to: TilePosition): Direction[] | null {
  const isGoal = (x: number, y: number) =>
    Math.abs(x - to.x) + Math.abs(y - to.y) === 1 && isWalkable(x, y);

  if (isGoal(from.x, from.y)) return [];
  if (!isWalkable(from.x, from.y)) return null;

  const key = (x: number, y: number) => y * OFFICE_WIDTH + x;
  const visited = new Set<number>([key(from.x, from.y)]);
  const queue: { x: number; y: number; path: Direction[] }[] = [
    { x: from.x, y: from.y, path: [] },
  ];

  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; path: Direction[] };
    for (const dir of DIRECTIONS) {
      const nx = node.x + DIRECTION_DELTAS[dir].x;
      const ny = node.y + DIRECTION_DELTAS[dir].y;
      if (!isWalkable(nx, ny) || visited.has(key(nx, ny))) continue;
      const path = [...node.path, dir];
      if (isGoal(nx, ny)) return path;
      visited.add(key(nx, ny));
      queue.push({ x: nx, y: ny, path });
    }
  }
  return null;
}

/**
 * Status de presença, escolhido manualmente pela pessoa (sem detecção de
 * inatividade). Vive só na sessão do escritório — reseta pra `online` a
 * cada entrada, nunca persiste no banco.
 */
export type OfficeUserStatus = "online" | "away" | "brb" | "busy";

export const OFFICE_USER_STATUSES: readonly OfficeUserStatus[] = ["online", "away", "brb", "busy"];

export function isOfficeUserStatus(value: unknown): value is OfficeUserStatus {
  return (OFFICE_USER_STATUSES as readonly unknown[]).includes(value);
}

/**
 * `busy` ("Ocupado") é o único status que corta áudio por conta própria, nos
 * DOIS sentidos: quem está ocupado não ouve ninguém e não é ouvido por
 * ninguém, dentro ou fora de sala. Os demais status só afetam o áudio por
 * proximidade, no espaço aberto (ver `applyProximity`, no cliente).
 */
export function isOfficeAudioIsolated(status: OfficeUserStatus | undefined): boolean {
  return status === "busy";
}

/**
 * Quem manda numa sala de reunião: é quem pode tirar alguém da chamada
 * (`remove-from-room`). Não é cargo do produto nem papel de usuário — é do
 * momento, e o servidor recalcula sozinho.
 *
 * A regra, em ordem: se a sala contém uma mesa reivindicada e o dono dela está
 * lá dentro, a sala é dele. Senão, é de quem entrou primeiro; quando essa
 * pessoa sai, passa para a seguinte, na ordem de entrada. Sala vazia não tem
 * manager (e some de `room-managers-changed`).
 *
 * `byDeskOwner` distingue os dois casos para a interface poder explicar por que
 * aquela pessoa manda ali.
 */
export interface OfficeRoomManager {
  roomId: string;
  userId: string;
  byDeskOwner: boolean;
}

/** Veículo efêmero derivado de um asset de kart publicado no mapa. */
export interface OfficeKart {
  /** Id do `tile-object` que ancora a posição inicial no editor. */
  id: string;
  /**
   * Posição em PIXEL, como a das pessoas. Estacionado, é o centro do tile em
   * que o editor o publicou; com piloto, é onde o piloto está.
   */
  x: number;
  y: number;
  dir: Direction;
  /** Ausente enquanto o kart está estacionado. */
  riderUserId?: string;
}

/** Uma pessoa presente no escritório. Existe só em memória, some ao desconectar. */
export interface OfficeOccupant {
  userId: string;
  /** Nome real do usuário; continua sendo usado em cards, perfil, chamadas e chat. */
  name: string;
  /** Presença temporária criada por convite; não existe na tabela User. */
  isGuest?: boolean;
  /** Alias opcional exibido apenas no rótulo do personagem no mapa. */
  characterName?: string | null;
  /**
   * Posição em PIXEL, e float — não em tile.
   *
   * Mudou junto com o movimento livre
   * (`2026-08-25-movimento-livre-no-escritorio-design.md`). Quem precisa do
   * tile deriva: `Math.floor(x / tileWidth)`. Sala, mesa, spawn e alcance de
   * voz continuam raciocinando em tile; o que deixou de existir é o passo
   * discreto.
   */
  x: number;
  y: number;
  /** Pose do sprite. O LPC tem quatro — continua discreta, ao contrário da posição. */
  dir: Direction;
  /**
   * Rumo do kart, em radianos. Só de quem está MONTADO; ausente a pé.
   *
   * Faz parte da presença porque é o estado INICIAL de quem chega: sem ele, o
   * kart de quem acabou de entrar apareceria apontado para a direita até o
   * primeiro snapshot.
   */
  heading?: number;
  photoUrl?: string | null;
  avatarStyle?: AvatarStyleKey | null;
  /** Seed do personagem — quem nunca customizou ganha o padrão derivado dela (defaultCharacterFromSeed). */
  avatarSeed?: string | null;
  /** Personagem LPC do perfil (CharacterOptions); legado open-peeps é ignorado pelo cliente via isCharacterOptions. */
  avatarOptions?: CharacterOptions | null;
  /** Pensamento ativo, efêmero, limpo quando a pessoa se movimenta. */
  thoughtText?: string;
  /** Ausente = tratado como "online" por quem lê (default, compat com occupant antigo/replay sem o campo). */
  status?: OfficeUserStatus;
  /** Id do kart dirigido agora; ausente enquanto está a pé. */
  ridingKartId?: string;
  /**
   * Marcador de paintball equipado. Ausente = desarmado, que é o normal — é o
   * que impede o escritório de virar campo de tiro por acidente e o que deixa
   * ver pelo sprite quem está jogando. Efêmero como o resto da presença: não
   * é guarda-roupa e não encosta em `avatarOptions`.
   */
  paintMarker?: boolean;
}

/** Uma pessoa dentro de um snapshot do escritório. */
export interface OfficeSnapshotPlayer {
  userId: string;
  /** Pixel, como em `OfficeOccupant`. */
  x: number;
  y: number;
  dir: Direction;
  /**
   * Último `seq` desta pessoa que o servidor já processou. É por ele que o dono
   * da predição sabe quais inputs ainda precisa reexecutar — e é o que torna a
   * reconciliação possível.
   */
  seq: number;
  /** Correndo agora — a animação das pernas acompanha. */
  sprint?: boolean;
  /**
   * Rumo do kart, em radianos. Só de quem está MONTADO.
   *
   * Curto (`h`, e não `heading`) porque isto viaja por pessoa, vinte vezes por
   * segundo — mesma razão de `seq` e `dir` serem curtos. É o mesmo campo que a
   * corrida usa, e pelo mesmo motivo: sem ele a reconciliação do dono
   * reexecutaria os pendentes a partir de um kart apontado para outro lado.
   */
  h?: number;
  /** Velocidade do kart, em px/s (negativa = ré). Só de quem está montado. */
  v?: number;
}

export type OfficeClientMessage =
  /**
   * Intenção de movimento, nunca posição: cliente que manda posição é cliente
   * que teleporta. O servidor integra com `stepBody`, a MESMA função que a
   * predição do cliente roda — é o que impede os dois de divergirem por
   * construção.
   *
   * Substituiu o `move` de grade, que mandava uma DIREÇÃO por passo e vinha com
   * `seq` para o `sync` poder desfazer a predição de um passo. Aqui isso é o
   * caso normal, não a exceção: o snapshot traz posição autoritativa e o último
   * `seq` processado, e a reconciliação reancora e reexecuta o resto.
   */
  | { type: "input"; input: BodyInput }
  /** Saída intencional do escritório: remove a presença imediatamente, sem período de reconexão. */
  | { type: "leave-office" }
  | { type: "call"; targetUserId: string }
  | { type: "call-response"; callerId: string; accepted: boolean }
  | { type: "nearby-message"; text: string; kind?: OfficeNearbyMessageKind }
  | { type: "room-chat-message"; text: string }
  /** Início/fim de "segurar F" — enviado no keydown/keyup físico (evento, não polling). */
  | { type: "confetti"; active: boolean }
  /** Levantar (true) ou abaixar (false) a própria mão — fila FIFO por sala de reunião. */
  | { type: "raise-hand"; active: boolean }
  /** Troca manual de status de presença, pelo menu do chip de identidade. */
  | { type: "set-status"; status: OfficeUserStatus }
  /** Troca o alias exibido no rótulo do personagem no mapa; vazio limpa. */
  | { type: "set-character-name"; name: string }
  /** Girar no lugar (atalho R) — nunca move x,y, só a direção encarada. */
  | { type: "face"; dir: Direction }
  /** Monta no kart livre próximo ou estaciona o atual — tecla de ação E. */
  | { type: "ride-kart" }
  /**
   * Toca (Q) ou chuta (Espaço) a bola ao alcance. Só o GESTO vem do cliente: a
   * direção, a força e a trajetória são calculadas pelo servidor a partir de
   * onde a pessoa está e para onde encara — senão cada cliente mandaria a bola
   * para onde quisesse.
   */
  | { type: "kick-ball"; power: OfficeBallPower; sprint?: boolean; charge?: number }
  /** Equipar (`active: true`) ou guardar o marcador de paintball. */
  | { type: "set-paint-marker"; active: boolean }
  /**
   * Atirar (V). Como o chute, só o GESTO vem do cliente: direção é o facing
   * autoritativo, alcance é constante e o alvo é quem estiver na linha — senão
   * um cliente adulterado escolheria em quem acerta. Desarmado, não faz nada.
   */
  | { type: "fire-paintball" }
  /** Iniciar ou encerrar edição — notifica outros de presença de edição. */
  | { type: "set-editing"; editing: boolean }
  /**
   * Trancar/destrancar a sala de reunião onde o remetente ESTÁ agora — como
   * `room-chat-message`, o servidor deriva a sala da posição, o cliente não
   * manda `roomId`. A tranca é da sala (não de quem trancou): qualquer
   * ocupante liga, desliga e responde aos pedidos.
   */
  | { type: "set-room-lock"; locked: boolean }
  /**
   * Tirar alguém da reunião onde o remetente ESTÁ — como `set-room-lock`, o
   * servidor deriva a sala da posição e o cliente só manda quem. Ao contrário
   * da tranca, esta ação NÃO é de qualquer ocupante: só do manager da sala
   * (ver `OfficeRoomManager`) ou de um ADMIN.
   *
   * Remove da CHAMADA, não do escritório: o personagem continua no mapa, onde
   * estava. Para voltar à conversa, precisa sair da área da sala e entrar de
   * novo.
   */
  | { type: "remove-from-room"; userId: string }
  /**
   * Tocar um vídeo do YouTube (só o áudio importa) para a sala onde o
   * remetente ESTÁ — como `set-room-lock`, o servidor deriva a sala da
   * posição. Uma faixa por sala: com outra no ar, vem `room-audio-denied`.
   */
  | { type: "start-room-audio"; videoId: string; playlistId?: string | null }
  /**
   * Quem iniciou avisa que o player dele passou para outro item da playlist.
   * É o que mantém a sala na mesma música: ninguém mais avança sozinho.
   */
  | { type: "set-room-audio-item"; playlistIndex: number; videoId: string }
  /** Encerrar a faixa que VOCÊ iniciou. De mais ninguém. */
  | { type: "stop-room-audio" }
  /**
   * Pausar/retomar a faixa que VOCÊ iniciou, para a sala inteira. Ouvinte não
   * pausa: o player dele é travado e volta a tocar sozinho se algo o parar
   * (clique no iframe, tecla de mídia do sistema).
   */
  | { type: "set-room-audio-paused"; paused: boolean }
  /**
   * Pedir (`active: true`) ou desistir de pedir (`active: false`) para entrar
   * numa sala trancada. Aqui o `roomId` VEM do cliente porque quem pede está
   * fora da sala — a posição dele não a identifica.
   */
  | { type: "knock"; roomId: string; active: boolean }
  /** Resposta de quem está DENTRO da sala ao pedido de `userId`. */
  | { type: "knock-response"; userId: string; accepted: boolean }
  /**
   * Um lote de pontos de um traço sobre a tela de `sharerId` (o userId de quem
   * compartilha, mesmo quando é a própria). `strokeId` agrupa os lotes de um
   * mesmo traço; `done` marca o último e dispara a contagem do TTL.
   */
  | {
      type: "screen-annotation";
      sharerId: string;
      strokeId: string;
      points: OfficeAnnotationPoint[];
      done?: boolean;
    };

/** Por que o servidor recusou a entrada numa sala (ver `room-entry-denied`). */
export type OfficeRoomEntryDeniedReason =
  /** Trancada por quem está dentro, nesta sessão — a única que aceita "pedir para entrar". */
  | "locked"
  /** Bloqueada pelo admin (`Room.status`), persistida — não há a quem pedir. */
  | "admin-locked"
  | "capacity"
  | "allowlist";

/**
 * Quanto tempo um pedido de entrada fica de pé antes de o próprio cliente
 * desistir sozinho. Espelha o timeout do popup de chamada recebida, que
 * também é client-side.
 */
export const OFFICE_KNOCK_TIMEOUT_MS = 30_000;

/** Limite do alias mostrado acima do personagem no mapa. */
export const OFFICE_CHARACTER_NAME_MAX_LENGTH = 32;

/** Convites temporários para visitantes do escritório. */
export const OFFICE_GUEST_NAME_MAX_LENGTH = 40;
export const OFFICE_GUEST_INVITE_MIN_MINUTES = 5;
export const OFFICE_GUEST_INVITE_MAX_MINUTES = 7 * 24 * 60;

const OFFICE_GUEST_PRESET_SEEDS = [
  "guest-orion",
  "guest-vega",
  "guest-rio",
  "guest-luna",
  "guest-nova",
  "guest-iris",
  "guest-cedro",
  "guest-aurora",
  "guest-solar",
  "guest-cometa",
  "guest-atlas",
  "guest-mira",
] as const;

export interface OfficeGuestCharacterPreset {
  id: string;
  seed: string;
  options: CharacterOptions;
}

export const OFFICE_GUEST_CHARACTER_PRESETS: readonly OfficeGuestCharacterPreset[] =
  OFFICE_GUEST_PRESET_SEEDS.map((seed, index) => ({
    id: `guest-preset-${index + 1}`,
    seed,
    options: defaultCharacterFromSeed(seed),
  }));

export interface OfficeGuestInviteDTO {
  id: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateOfficeGuestInviteRequest {
  expiresInMinutes: number;
}

export interface CreateOfficeGuestInviteResponse {
  invite: OfficeGuestInviteDTO;
}

export interface OfficeGuestInvitePublicDTO {
  expiresAt: string;
  presets: readonly OfficeGuestCharacterPreset[];
}

export interface CreateOfficeGuestSessionRequest {
  token: string;
  name: string;
  presetId: string;
}

export interface OfficeGuestSessionDTO {
  token: string;
  expiresAt: string;
  guest: {
    id: string;
    name: string;
    presetId: string;
    avatarSeed: string;
    avatarOptions: CharacterOptions;
  };
}

/** Limite compartilhado entre o campo do chat e a validação do servidor. */
export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 500;

export type OfficeServerMessage =
  /**
   * `confettiUserIds`: quem já está segurando F no instante do snapshot — pra quem entra/reconecta ver o confete em andamento sem esperar um novo keydown.
   * `handRaisedUserIds`: quem já está com a mão levantada (em qualquer lugar do escritório) no instante do snapshot — mesma ideia, para o ícone sobre o personagem.
   * `editorUserIds`: quem está ativamente editando (nomes resolvidos pelos `occupants`).
   * `lockedRoomIds`: salas de reunião trancadas nesta sessão, no instante do snapshot — mesma ideia dos anteriores, para quem entra/reconecta já ver o cadeado.
   */
  | {
      type: "welcome";
      youId: string;
      /**
       * Último `seq` SEU que o servidor já processou — de onde a predição deve
       * retomar a numeração.
       *
       * Existe porque a presença do escritório SOBREVIVE a uma queda (há período
       * de graça): reconectar reaproveita a mesma entrada, com o contador alto,
       * enquanto o cliente cria um preditor novo começando do zero. Sem isto,
       * todo input do cliente novo chega com `seq` menor que o já processado e é
       * descartado como atrasado — a pessoa anda até cair a conexão e nunca mais
       * sai do lugar.
       *
       * A arena não precisa: lá a presença é efêmera e sem período de graça, e a
       * entrada renasce zerada.
       */
      seq?: number;
      occupants: OfficeOccupant[];
      publicationId?: string;
      confettiUserIds?: string[];
      handRaisedUserIds?: string[];
      editorUserIds?: string[];
      lockedRoomIds?: string[];
      /**
       * Áudio tocando em cada sala no instante do snapshot, com a posição já
       * avançada — quem entra/reconecta cai no ponto certo da faixa.
       */
      roomAudio?: OfficeRoomAudioEntry[];
      /** Quem manda em cada sala ocupada no instante do snapshot. */
      roomManagers?: OfficeRoomManager[];
      /** Veículos dinâmicos derivados dos assets publicados no mapa. */
      karts?: OfficeKart[];
      /** Bolas chutáveis, na posição em que estão AGORA (não na de origem). */
      balls?: OfficeBall[];
      /**
       * Marcas de tinta ainda vivas, com o `ttlMs` já descontado do tempo
       * decorrido — quem entra no meio da vida de uma marca recebe o que
       * sobrou dela, e não o prazo cheio.
       */
      paintSplats?: PaintSplat[];
    }
  | { type: "joined"; occupant: OfficeOccupant }
  | { type: "left"; userId: string }
  /**
   * Estado autoritativo de quem está no escritório. Substitutivo, nunca
   * incremental: um pacote perdido não pode deixar o cliente permanentemente
   * errado.
   *
   * Substituiu o `moved` por evento, e a troca paga a si mesma em escala: por
   * evento, com M andando e N conectados, eram `M × 20 × N` mensagens por
   * segundo; por snapshot são `N × 20`, independente de quantos se mexem.
   *
   * O que ela piora é o escritório PARADO, que antes custava zero. Por isso o
   * servidor **não emite** snapshot quando nada mudou desde o último — o que
   * devolve o custo zero da sala vazia sem abrir mão do modelo.
   */
  | {
      type: "snapshot";
      players: OfficeSnapshotPlayer[];
      /**
       * Bolas em movimento. Só vão quando alguma está rolando — bola parada é
       * estado que o último snapshot já disse, e mandá-la sempre desfaria a
       * supressão que devolve o custo zero da sala parada.
       */
      balls?: OfficeBall[];
    }
  /** Alguém está te chamando — mostrado em todas as abas do alvo. */
  | { type: "incoming-call"; from: { userId: string; name: string } }
  /** Resposta a uma chamada que VOCÊ fez. */
  | { type: "call-result"; targetUserId: string; accepted: boolean }
  /** Sua chamada não foi entregue. */
  | { type: "call-failed"; targetUserId: string; reason: "offline" | "rate-limited" | "away" }
  /** Mensagem curta/reação/pensamento exibida como balão sobre o personagem. */
  | {
      type: "nearby-message";
      userId: string;
      text: string;
      kind: OfficeNearbyMessageKind;
    }
  /**
   * O pensamento de alguém saiu do ar — a pessoa se movimentou.
   *
   * Existe porque quem apaga o balão é o servidor, e o snapshot só carrega
   * posição: no modelo de grade o eco `moved` servia de aviso, e o movimento
   * livre o aposentou. Sem esta mensagem o balão de pensamento fica na tela
   * dos outros para sempre, mesmo com a pessoa já sem pensamento nenhum.
   */
  | { type: "thought-cleared"; userId: string }
  /** O avatar de alguém mudou — os clientes recompõem o personagem ao vivo. */
  | {
      type: "avatar-updated";
      userId: string;
      avatarSeed: string | null;
      avatarOptions: CharacterOptions | null;
    }
  /** Mensagem de texto do chat da sala — só chega a quem está na MESMA sala. */
  | {
      type: "room-chat-message";
      roomId: string;
      userId: string;
      name: string;
      text: string;
      sentAt: string;
    }
  /** Histórico da sala, enviado a quem acabou de entrar nela. */
  | {
      type: "room-chat-history";
      roomId: string;
      messages: Array<{ userId: string; name: string; text: string; sentAt: string }>;
    }
  /** Alguém começou/parou de lançar confete — rebroadcast pra todos, inclusive o remetente. */
  | { type: "confetti"; userId: string; active: boolean }
  /**
   * Alguém levantou/abaixou a mão — em QUALQUER lugar do escritório, não só
   * em sala de reunião. Rebroadcast pra todos, inclusive o remetente (mesmo
   * padrão do `confetti`). Dirige o ícone sobre o personagem no cliente.
   */
  | { type: "hand-raised"; userId: string; active: boolean }
  /**
   * Fila de mãos levantadas da sala — só chega a quem está na MESMA sala (mais o
   * próprio ao sair andando, para zerar a fila do lado dele). `queue` é sempre o
   * snapshot completo, na ordem de quem levantou primeiro. `event` ausente = sync
   * (ex.: snapshot para quem acabou de entrar na sala) — não deve tocar som;
   * presente = mudança real (alguém levantou ou abaixou agora).
   */
  | { type: "raised-hands"; roomId: string; queue: string[]; event?: { kind: "raised" | "lowered"; userId: string } }
  /** Sinal (sem payload) pra todo mundo comemorar junto: banner + burst + som. */
  | { type: "celebration" }
  /**
   * Duas pessoas acenando de frente uma pra outra — dispara a animação de
   * high-five. `perfect` é a "palma perfeita": de vez em quando o par acerta o
   * timing e o estalo sai mais alto, com o impacto reforçado. Quem sorteia é o
   * servidor, no broadcast — se cada cliente rolasse o próprio dado, uma pessoa
   * ouviria o estalo e a outra não, e a graça é justamente ser um momento
   * compartilhado.
   */
  | { type: "high-five"; userIds: [string, string]; perfect: boolean }
  /** Alguém montou ou estacionou um veículo. */
  | { type: "kart-ride"; userId: string; active: boolean; kart: OfficeKart }
  /** Snapshot substitutivo após uma publicação adicionar/remover karts. */
  | { type: "karts-updated"; karts: OfficeKart[] }
  /**
   * Alguém tocou ou chutou uma bola. `kick.path` é a trajetória INTEIRA já
   * resolvida pelo servidor (ver `kickBall`): o cliente anima a rolagem e não
   * precisa simular física nenhuma. Caminho vazio = a bola não saiu do lugar
   * (estava entalada), e ainda assim o gesto é transmitido — quem está perto
   * ouve a batida.
   */
  /**
   * Alguém chutou (ou tocou). Vem além da bola do snapshot porque é EVENTO: é
   * ele que toca o som e dá ao cliente a velocidade nova NA HORA, sem esperar
   * até 50ms pelo próximo snapshot.
   *
   * Substituiu o `kick` com a trajetória inteira resolvida: no contínuo não há
   * trajetória a mandar — há velocidade, e os dois lados integram a mesma
   * física a partir dela.
   */
  | { type: "ball-kicked"; userId: string; ball: OfficeBall; power: OfficeBallPower }
  /** Snapshot substitutivo após uma publicação adicionar/remover bolas. */
  | { type: "balls-updated"; balls: OfficeBall[] }
  /** Alguém equipou ou guardou o marcador de paintball. */
  | { type: "paint-marker"; userId: string; active: boolean }
  /**
   * Alguém atirou. `shot.path` é a trajetória INTEIRA já resolvida pelo
   * servidor (ver `firePaintball`): o cliente anima o voo e não simula nada.
   * `shot.splat` traz a marca quando o tiro achou alguém — é o mesmo objeto
   * que aparece no `welcome` de quem entrar depois, enquanto ela durar.
   */
  /**
   * Alguém atirou. O disparo já vem resolvido (`fireBodyShot`): o cliente anima
   * o projétil e gruda a marca, sem simular nada.
   *
   * Passou a ser o disparo CONTÍNUO da arena — de/para em pixel, em vez de uma
   * lista de tiles. A mira continua sendo o facing autoritativo: o escritório
   * não tem mouse apontando.
   */
  | { type: "paintball-shot"; shot: BodyShot }
  /** Uma mesa foi reivindicada — todo mundo atualiza o indicador de ocupação. */
  | { type: "desk-claimed"; deskId: string; externalKey: string; user: { id: string; name: string } }
  /** Uma mesa foi liberada (pelo dono ou por um admin). */
  | { type: "desk-released"; deskId: string; externalKey: string }
  /** Um lembrete foi deixado numa mesa — todo mundo desenha o presente. */
  | { type: "desk-reminder-created"; reminder: OfficeDeskReminderSummaryDTO }
  /** O dono leu o lembrete — todo mundo remove o presente. */
  | { type: "desk-reminder-read"; reminderId: string; deskId: string; deskExternalKey: string; senderId: string; recipientId: string }
  /**
   * Alguém entrou/saiu de uma sala de reunião — usado só para o sinal sonoro.
   * Entregue apenas a quem está na MESMA sala (mais o próprio no caso de sair
   * andando), nunca ao escritório inteiro.
   */
  | { type: "room-presence"; kind: "enter" | "leave"; userId: string; roomId: string }
  | { type: "map-changed"; publicationId: string }
  /** Publicação de decoração por membro — refresh suave, sem reload. */
  | { type: "map-decor-updated"; publicationId: string }
  /** Alguém trocou o próprio status de presença. */
  | { type: "status-changed"; userId: string; status: OfficeUserStatus }
  /** Alias do personagem mudou; `name: null` significa voltar ao nome real. */
  | { type: "character-name-changed"; userId: string; name: string | null }
  /** Alguém girou no lugar (atalho R) — rebroadcast pra todos, sem mudar x,y. */
  | { type: "faced"; userId: string; dir: Direction }
  /** Lista atualizada de quem está editando agora — broadcast pra todos. */
  | { type: "editors-changed"; userIds: string[] }
  /**
   * Uma sala de reunião foi trancada/destrancada nesta sessão. Broadcast pro
   * escritório inteiro: quem está dentro precisa do estado do botão, quem
   * está fora precisa saber que a porta fechou. `byUserId: null` = destrancou
   * sozinha porque a sala esvaziou.
   */
  | { type: "room-lock-changed"; roomId: string; locked: boolean; byUserId: string | null }
  /**
   * Quem manda em cada sala agora. Broadcast pro escritório inteiro, como
   * `room-lock-changed`: quem está fora já precisa saber quem vai receber o
   * pedido dele, e quem entra depois não depende de um evento novo. Salas sem
   * ninguém não aparecem no mapa.
   */
  | { type: "room-managers-changed"; managers: OfficeRoomManager[] }
  /**
   * Alguém foi tirado da chamada de uma sala — para quem está na sala e para
   * quem foi removido. Não mexe no mapa: o personagem continua onde estava.
   */
  | { type: "removed-from-room"; roomId: string; userId: string; byUserId: string; byName: string }
  /**
   * O áudio compartilhado de uma sala começou (`track`) ou acabou (`null`).
   * Broadcast pro escritório inteiro, como `room-lock-changed`: assim quem
   * ANDA para dentro de uma sala que já está tocando entra no ponto certo sem
   * depender de um evento novo. O cliente filtra pela sala em que está.
   */
  | { type: "room-audio-changed"; roomId: string; track: OfficeRoomAudioTrack | null }
  /** Seu `start-room-audio` foi recusado — só para quem pediu. */
  | { type: "room-audio-denied"; reason: OfficeRoomAudioDeniedReason }
  /**
   * Sua entrada numa sala foi recusada. Só para o socket barrado, junto do
   * `sync` que re-ancora a posição. `x`/`y` é o tile recusado — vira o alvo da
   * caminhada automática quando um pedido de entrada é aceito.
   */
  | {
      type: "room-entry-denied";
      roomId: string;
      roomName: string;
      reason: OfficeRoomEntryDeniedReason;
      x: number;
      y: number;
    }
  /**
   * Alguém quer entrar na sala trancada — só para quem está DENTRO dela. Foto
   * e personagem não vêm no payload: o cliente já tem tudo em `occupants`.
   */
  | { type: "knock-request"; roomId: string; userId: string; name: string }
  /**
   * Um pedido pendente terminou, por qualquer motivo (aceito, recusado,
   * cancelado, quem pediu saiu) — fecha o modal de todo mundo na sala.
   */
  | { type: "knock-cleared"; roomId: string; userId: string }
  /** Resposta ao SEU pedido de entrada. */
  | { type: "knock-result"; roomId: string; accepted: boolean; byUserId: string; byName: string }
  /** Rebroadcast de um lote de traço — `userId` é quem desenhou. */
  | {
      type: "screen-annotation";
      userId: string;
      sharerId: string;
      strokeId: string;
      points: OfficeAnnotationPoint[];
      done?: boolean;
    };

/** djb2 — hash estável para escolher spawn e cores sem depender de aleatório. */
export function officeHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
