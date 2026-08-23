import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  builtinTilesetAsset,
  isCollidableAssetCategory,
  isProtectedFromMembers,
  MAP_DOCUMENT_V1_LIMITS,
  MapTileSizeSchema,
  type MapDocumentV1,
  type MapObjectV1,
  type TileObjectV1,
} from '@legends/shared'
import type { OfficeCanvasHandle } from '../OfficeCanvas'
import {
  stampTile,
  ensureBuiltinTileset,
  addRectObject,
  areaOverlays,
  addTileObject,
  addTileObjectGroupAtPixel,
  GROUP_ID_SEPARATOR,
  groupBounds,
  groupKeyOf,
  moveGroupTo,
  removeGroup,
  removeFurnitureCollision,
  removeObjectById,
  topCollisionAtPixel,
  removeTopTileObjectAt,
  reorderFurnitureGroup,
  topTileObjectAt,
  topTileObjectAtPixel,
  topErasableObjectAtPixel,
  pruneUnusedTilesets,
  removeDecorationObjectsInRect,
  tileObjectsInGroup,
  geometryBounds,
  orientationOf,
  rotateGroupInPlace,
  flipGroupInPlace,
  isFurnitureCollisionId,
  furnitureCollisionId,
  type FurnitureOrderDirection,
} from './decorationDoc'
import * as api from './decorationApi'
import { ApiError } from '../../lib/api'

export type EditTool =
  | 'brush'
  | 'eraser'
  | 'silence-zone'
  | 'call-zone'
  | 'link'
  | 'action-point'
  | 'collision'
  /** Borracha SÓ de colisão: tira o bloqueio e deixa a peça no lugar. */
  | 'collision-eraser'
  | 'door'
  | 'select'

/** Ferramentas de área (Task C5) — desenhadas por drag; a cena entra em `editMode: 'rect'` para elas. */
const RECT_TOOLS: ReadonlySet<EditTool> = new Set(['silence-zone', 'call-zone', 'collision'])
/**
 * Ferramentas de ponto (bugfix double-fire) — colocam um objeto único por
 * clique; a cena entra em `editMode: 'point'` para elas (single-shot no
 * pointerdown, sem repetir no pointermove — ver `OfficeScene.editMode`).
 */
const POINT_TOOLS: ReadonlySet<EditTool> = new Set(['link', 'action-point', 'door'])

/** Modo de edição da cena correspondente à ferramenta ativa. */
function editModeForTool(tool: EditTool): 'paint' | 'rect' | 'point' | 'object' {
  // Mobília, borracha e seleção (rotação/espelho) operam por OBJETO em pixel
  // livre (clique único no grupo sob o cursor) — só as ferramentas de área
  // usam arraste retangular.
  if (tool === 'brush' || tool === 'eraser' || tool === 'select' || tool === 'collision-eraser') return 'object'
  if (RECT_TOOLS.has(tool)) return 'rect'
  if (POINT_TOOLS.has(tool)) return 'point'
  return 'object'
}

/** Região retangular escolhida no palette (bloco de tiles), em coords de tile. */
export interface SelectedTileRegion {
  assetId: string
  col: number
  row: number
  cols: number
  rows: number
  /** Categoria do asset no catálogo — decide se a peça bloqueia passagem ao ser colocada (`isCollidableAssetCategory`). */
  category: string
}

export interface OfficeMapEditingState {
  active: boolean
  tool: EditTool
  selectedTile: SelectedTileRegion | null
  dirty: boolean
  saving: boolean
  /** Recusa de uma operação (teto de objetos, giro sem espaço). Some na operação seguinte que der certo. */
  limitError: string | null
  /**
   * Falha ao salvar (Task 11b) — o `save()` não lança mais (o único chamador,
   * `OfficeEditDrawer`, dispara com `void save()`, então uma rejeição não
   * capturada virava uma unhandled rejection silenciosa aos olhos do
   * usuário). Mensagem pt-BR pronta para exibir; limpa no INÍCIO da próxima
   * tentativa de `save()` (e ao entrar/cancelar a sessão).
   */
  saveError: string | null
  /** Há pelo menos um passo para desfazer nesta sessão de edição. */
  canUndo: boolean
  /** Grupo de mobília selecionado (ferramenta "Girar") — um único objeto por vez. */
  selection: SelectedFurniture | null
}

/**
 * Seleção da ferramenta "Girar": um único GRUPO de mobília por vez (nunca um
 * bloco de vários objetos) — clicar em outra peça troca a seleção, não
 * acumula. `bounds` é a bbox do grupo em pixel, já pronta para o overlay azul
 * da cena e para posicionar a `SelectionToolbar`.
 */
export interface SelectedFurniture {
  groupKey: string
  bounds: { x: number; y: number; width: number; height: number }
  /** Se o grupo tem uma colisão pareada — decide se a ação "remover colisão" aparece. */
  hasCollision: boolean
}

const INITIAL_STATE: OfficeMapEditingState = {
  active: false,
  tool: 'brush',
  selectedTile: null,
  dirty: false,
  saving: false,
  limitError: null,
  saveError: null,
  canUndo: false,
  selection: null,
}

/** Mensagem genérica quando o erro não expõe uma mensagem específica do servidor (ex.: falha de rede). */
const GENERIC_SAVE_ERROR = 'Não foi possível salvar o mapa. Tente novamente.'

/**
 * Teto de FOLHAS de mobília do documento (`maxTilesets`). Cada folha usada pelo
 * mapa ocupa um slot; a peça de uma folha nova só cabe se ainda houver espaço.
 *
 * Sem esta trava a peça entrava no documento de trabalho e só o servidor
 * reprovava — com um 400 "Documento inválido" que não dizia o motivo, e depois
 * de todo o trabalho de decoração feito (foi o que aconteceu com o mapa ativo
 * de homologação, parado em 20/20 quando o teto era 20). Mesma defesa que o
 * teto de objetos (`maxObjects`) já tinha.
 */
const TILESET_LIMIT_MESSAGE =
  `Limite de ${MAP_DOCUMENT_V1_LIMITS.maxTilesets} conjuntos de mobília atingido — ` +
  'apague as peças de um conjunto já usado antes de trazer um novo.'

function exceedsTilesetLimit(doc: MapDocumentV1): boolean {
  return doc.tilesets.length > MAP_DOCUMENT_V1_LIMITS.maxTilesets
}

/**
 * Cor do overlay pendente por tipo de objeto — espelha as cores escolhidas por
 * ferramenta em `handleRectEnd`/`placeLinkPoint`, mas indexada por tipo para
 * que o redesenho pós-desfazer (`repaintOverlays`) reconstrua os mesmos
 * overlays sem saber qual ferramenta os criou.
 */
const OBJECT_OVERLAY_COLORS: Partial<Record<MapObjectV1['type'], number>> = {
  'private-zone': 0xff5d5d,
  'meeting-room': 0x8ab4f8,
  collision: 0xff6b6b,
  link: 0xf6c667,
}

/** Áreas do documento com a cor de cada tipo, no formato que a cena desenha. */
function paintedAreaOverlays(doc: MapDocumentV1) {
  return areaOverlays(doc).map(({ id, type, rect }) => ({ id, rect, color: OBJECT_OVERLAY_COLORS[type] }))
}

/**
 * Estado de edição in-place do mapa do escritório (Task C4; Task 9 removeu o
 * lock exclusivo — a edição agora é colaborativa). O documento de trabalho e
 * a versão de publicação-base vivem em refs — NÃO em state — para que uma
 * pincelada não dispare re-render do React a cada célula (a cena Phaser já
 * desenha o feedback visual via `applyTileStamp`). `state` só reflete o que a
 * UI React precisa mostrar (toolbar, dirty, saving).
 */
export function useOfficeMapEditing(
  canvasRef: RefObject<OfficeCanvasHandle>,
  actor: { id: string; isAdmin: boolean } | null,
) {
  const [state, setState] = useState<OfficeMapEditingState>(INITIAL_STATE)
  const documentRef = useRef<MapDocumentV1 | null>(null)
  /** Espelho do ator — os callbacks da cena leem sem virar dependência de `useCallback`. */
  const actorRef = useRef(actor)
  actorRef.current = actor
  /**
   * Revisão de decoração em que `documentRef`/`baseDocRef` estão ancorados
   * (Task 9) — enviada como `baseRevision` no `mergePublish`. Substitui a
   * revisão de draft do fluxo com lock: aqui não há draft exclusivo, só o mapa
   * ativo, mesclado no servidor a cada Salvar. Desde o card 22041 o Salvar não
   * cria publicação, então a âncora é o `decorRevision`, não a versão.
   */
  const baseRevisionRef = useRef(0)
  /**
   * Publicação em que `baseRevisionRef` foi lido. Sozinha, a revisão não
   * identifica a base: publicação nova nasce com `decorRevision` 0, então uma
   * âncora antiga bate por coincidência com a publicação que o admin acabou de
   * criar, e o servidor mesclaria como se este documento fosse edição em cima
   * dela — revertendo o publish inteiro.
   */
  const basePublicationIdRef = useRef<string | null>(null)
  /**
   * Verdadeiro enquanto `save()` está em voo (Task 9: um único round-trip
   * HTTP — `mergePublish`). A cena continua aceitando input durante o save —
   * é o objetivo da feature "salvar sem sair" —, mas uma pincelada que caia
   * nessa janela não pode ser perdida quando o save resolve e re-ancora
   * `baseDocRef`/zera o histórico (review C4 — Important 2). Os callbacks
   * entregues à cena em `setEditing` checam este ref e ignoram a entrada
   * enquanto ele for verdadeiro.
   */
  const savingRef = useRef(false)
  const toolRef = useRef<EditTool>('brush')
  const selectedTileRef = useRef<SelectedTileRegion | null>(null)
  /**
   * Espelho de `state.selection` — os callbacks da cena e os atalhos de
   * teclado (Task 7: girar/espelhar) leem a seleção atual sem entrar no array
   * de dependências dos `useCallback`.
   */
  const selectionRef = useRef<SelectedFurniture | null>(null)
  /** Contador local (Task C5) — só para desempatar ids gerados na mesma sessão; nunca persiste. */
  const objectCounterRef = useRef(0)
  /**
   * Desfazer: pilha de snapshots do documento ANTES de cada operação. Os
   * helpers de `decorationDoc` são puros (todo mutador devolve um documento
   * novo), então um snapshot é só a referência antiga — sem clone.
   * `baseDocRef` guarda o draft pristino da sessão, usado por
   * `repaintOverlays` para recalcular os overlays por diff.
   */
  const historyRef = useRef<MapDocumentV1[]>([])
  const pendingSnapshotRef = useRef<MapDocumentV1 | null>(null)
  const baseDocRef = useRef<MapDocumentV1 | null>(null)

  /**
   * Predicado do lado cliente que espelha a checagem do servidor
   * (`isProtectedFromMembers` de `@legends/shared`): admin nunca é bloqueado;
   * comum só é bloqueado se o objeto está na BASE PUBLICADA (`baseDocRef`) —
   * não em `documentRef`, que já inclui edições da própria sessão. Um objeto
   * criado NESTA sessão (fora da base) nunca é protegido do seu criador,
   * mesmo que seja um admin editando: sem base, não há como o servidor ter
   * carimbado `createdBy` ainda, então não carimbamos nada otimista aqui — só
   * checamos membership na base.
   */
  const isProtectedFromActor = useCallback((object: MapObjectV1): boolean => {
    if (actorRef.current?.isAdmin) return false
    const fromBase = baseDocRef.current?.objects.some((o) => o.id === object.id) ?? false
    return fromBase && isProtectedFromMembers(object)
  }, [])

  /**
   * Recusa uma edição bloqueada por `isProtectedFromActor`, setando a mensagem
   * pt-BR de erro sem mais nada (Task 5 review — o bloco reject+`setState`
   * repetia idêntico em `eraseAt`/`eraseObjectAt`; `selectGroup` reusa aqui).
   */
  const rejectProtected = useCallback((message: string) => {
    setState((s) => ({ ...s, limitError: message }))
  }, [])

  /**
   * Mensagem de recusa para `rejectProtected`, distinguindo os DOIS motivos de
   * `isProtectedFromMembers` (`createdBy == null || createdBy.role === 'ADMIN'`)
   * — sem isso, toda peça LEGADA (publicada antes desta proteção existir, sem
   * `createdBy` registrado) aparecia como "criada pelo admin", mesmo quando foi
   * o próprio comum que a colocou antes do backend carimbar autoria.
   */
  const protectionMessage = useCallback((object: MapObjectV1, action: string): string => {
    if (object.createdBy?.role === 'ADMIN') return `Essa peça foi criada pelo admin e não pode ${action}.`
    return `Essa peça não tem autor registrado (foi adicionada antes deste controle) e por segurança não pode ${action}.`
  }, [])

  /**
   * Gesto de arraste de mobília livre (modo `'object'`): o GRUPO agarrado e o
   * offset do cursor dentro da bbox do grupo. `null` fora de um arraste. Um asset
   * fatiado move como um todo — o gesto guarda a chave do grupo, não um slice.
   */
  const furnitureDragRef = useRef<{
    groupKey: string
    offsetX: number
    offsetY: number
  } | null>(null)
  /** Abriu o passo de desfazer do arraste atual (lazy: só quando a posição muda de fato). */
  const dragOpenedRef = useRef(false)

  const nextObjectId = useCallback(() => {
    objectCounterRef.current += 1
    return `obj-${Date.now().toString(36)}-${objectCounterRef.current}`
  }, [])

  /** Chave de grupo de mobília (asset fatiado). Os slices viram `<groupId>:<dc>-<dr>`. */
  const nextGroupId = useCallback(() => {
    objectCounterRef.current += 1
    return `grp-${Date.now().toString(36)}-${objectCounterRef.current}`
  }, [])

  /**
   * Abre uma operação desfazível: guarda o documento atual como candidato a
   * passo de undo. Só vira um passo de fato quando `commitOp` confirma que
   * algo mudou — assim um clique que não pinta nada (sem tile escolhido,
   * borracha em célula vazia) não gera um Ctrl+Z que não faz nada.
   *
   * Numa pincelada arrastada, `beginOp` roda uma vez (no `onStrokeStart` do
   * pointerdown) e o primeiro `commitOp` consome o candidato — as células
   * seguintes do mesmo traço não abrem novos passos.
   */
  const beginOp = useCallback(() => {
    pendingSnapshotRef.current = documentRef.current
  }, [])

  /** Confirma a operação aberta por `beginOp` como um passo de desfazer. */
  const commitOp = useCallback(() => {
    const snapshot = pendingSnapshotRef.current
    if (!snapshot) return
    pendingSnapshotRef.current = null
    historyRef.current = [...historyRef.current, snapshot].slice(-MAP_DOCUMENT_V1_LIMITS.maxUndoOperations)
    setState((s) => (s.canUndo ? s : { ...s, canUndo: true }))
  }, [])

  const resetHistory = useCallback(() => {
    historyRef.current = []
    pendingSnapshotRef.current = null
  }, [])

  const paintAt = useCallback(
    async (col: number, row: number) => {
      const scene = canvasRef.current?.getScene()
      const doc = documentRef.current
      const picked = selectedTileRef.current
      if (!scene || !doc || !picked) return
      const { assetId } = picked
      const builtin = builtinTilesetAsset(assetId)
      if (!builtin) return

      // Nota (herdada da revisão C3): `registerBuiltinAsset` resolve mesmo se
      // o load da textura falhar — o próprio Phaser engole erros de loader
      // silenciosamente. Não há como esta camada detectar a falha aqui; o
      // pior caso é uma estampa sem imagem (frame ausente na textura).
      await scene.registerBuiltinAsset(assetId, builtin.url)

      // Relê o estado DEPOIS do await (re-review — Critical A): dezenas de
      // `pointermove` entram em `paintAt` enquanto a textura carrega, todas
      // capturando o MESMO `doc`/`picked` pré-await. Sem reler aqui, cada
      // chamada em voo constrói seu documento a partir do mesmo `doc` antigo
      // e grava `documentRef.current` no fim — last writer wins: uma
      // pincelada arrastada por N células vira só a última no documento
      // salvo (as demais ficam só como estampa visual, órfãs, nem apagáveis
      // pela borracha). As chamadas empilhadas resolvem em FIFO (mesma
      // promise de load, dedupada em `OfficeScene.registerBuiltinAsset`),
      // então cada uma agora acrescenta sobre o doc que a anterior já
      // gravou. Também relê `picked`: se o usuário trocou de tile enquanto
      // esta pincelada aguardava a textura, aborta em vez de pintar com uma
      // seleção que não é mais a atual.
      const freshDoc = documentRef.current
      const freshPicked = selectedTileRef.current
      if (!freshDoc || !freshPicked || freshPicked.assetId !== assetId) return

      // Valida ANTES de mutar `documentRef.current`: uma falha de validação
      // não pode deixar uma estampa não-renderizada/suja no documento de
      // trabalho (Task C4 review — finding #4).
      const tileWidth = MapTileSizeSchema.safeParse(builtin.tileWidth)
      const tileHeight = MapTileSizeSchema.safeParse(builtin.tileHeight)
      if (!tileWidth.success || !tileHeight.success) return

      const ensured = ensureBuiltinTileset(freshDoc, assetId)
      if (exceedsTilesetLimit(ensured.doc)) {
        setState((s) => ({ ...s, limitError: TILESET_LIMIT_MESSAGE }))
        return
      }
      const tilesetMeta = {
        id: ensured.tilesetId,
        assetId,
        name: builtin.name,
        tileWidth: tileWidth.data,
        tileHeight: tileHeight.data,
        columns: builtin.columns,
        tileCount: builtin.tileCount,
      }

      // Cada célula do bloco vira UM `tile-object` acrescentado ao fim de
      // `doc.objects` — é isso que empilha (ver `addTileObject`). O antigo
      // `stampTile` sobrescrevia o slot único da célula e fazia a peça de
      // baixo desaparecer.
      //
      // Repintar exatamente o MESMO sprite (mesmo tileset+tileIndex) sobre a
      // célula que já o tem no topo é semanticamente nulo — PULA a célula
      // (review C4 — Critical 1). Sem isso, `OfficeScene.handleEditPointerMove`
      // redespacha um pointerdown a cada pointermove sem lembrar a última
      // célula pintada, e uma pincelada arrastada devagar acrescenta dezenas
      // de `tile-object` idênticos e sobrepostos na mesma célula. Peça
      // diferente sobre peça diferente continua empilhando normalmente.
      let nextDoc = ensured.doc
      const cells: { col: number; row: number; tileIndex: number }[] = []
      for (let dr = 0; dr < freshPicked.rows; dr++) {
        for (let dc = 0; dc < freshPicked.cols; dc++) {
          const mapCol = col + dc
          const mapRow = row + dr
          if (mapCol >= nextDoc.map.width || mapRow >= nextDoc.map.height) continue
          const tileIdx = (freshPicked.row + dr) * builtin.columns + (freshPicked.col + dc)
          const top = topTileObjectAt(nextDoc, mapCol, mapRow)
          if (top && top.properties.tilesetId === ensured.tilesetId && top.properties.tileIndex === tileIdx) continue
          cells.push({ col: mapCol, row: mapRow, tileIndex: tileIdx })
        }
      }
      if (cells.length === 0) return

      // Teto do documento: recusa a pincelada inteira em vez de deixar o save
      // estourar na validação do servidor (`maxObjects` — dividido com áreas,
      // links e colisões).
      if (nextDoc.objects.length + cells.length > MAP_DOCUMENT_V1_LIMITS.maxObjects) {
        setState((s) => ({
          ...s,
          limitError: `Limite de ${MAP_DOCUMENT_V1_LIMITS.maxObjects} objetos do mapa atingido — apague algo antes de continuar.`,
        }))
        return
      }

      // Conta quantas células de fato entraram no documento (re-review —
      // Minor D): `cells.length > 0` só garante que havia CANDIDATAS: se
      // `registerTileFrame` falhar para TODAS (textura do asset não
      // carregou), o laço abaixo não muta `nextDoc` em nenhuma iteração, mas
      // `commitOp`/`dirty: true` não podem rodar mesmo assim — senão sobra um
      // passo de desfazer fantasma e o botão Salvar habilita sem nada de novo
      // na tela.
      let added = 0
      for (const cell of cells) {
        // Resolve o frame ANTES de acrescentar ao documento (review C4 —
        // Minor 4): se `registerTileFrame` devolver `null` (textura do asset
        // não carregou — o Phaser engole erros de loader silenciosamente), a
        // célula é pulada por inteiro, para o documento nunca guardar um
        // `tile-object` que a cena não chegou a desenhar.
        const registered = scene.registerTileFrame(tilesetMeta, cell.tileIndex)
        if (!registered) continue
        const id = nextObjectId()
        nextDoc = addTileObject(nextDoc, {
          id,
          col: cell.col,
          row: cell.row,
          tilesetId: ensured.tilesetId,
          tileIndex: cell.tileIndex,
          tileWidth: tileWidth.data,
          tileHeight: tileHeight.data,
        })
        scene.applyTileObjectStamp(
          id,
          { x: cell.col * nextDoc.map.tileWidth, y: cell.row * nextDoc.map.tileHeight, width: tileWidth.data, height: tileHeight.data },
          registered.textureKey,
          registered.frameKey,
        )
        added += 1
      }
      if (added === 0) return
      commitOp()
      documentRef.current = nextDoc
      setState((s) => ({ ...s, dirty: true, limitError: null }))
    },
    [canvasRef, commitOp, nextObjectId],
  )

  const eraseAt = useCallback(
    (col: number, row: number) => {
      const scene = canvasRef.current?.getScene()
      const doc = documentRef.current
      if (!scene || !doc) return

      // Mobília primeiro: tira a peça do TOPO da pilha daquela célula. Uma
      // borrachada = uma camada, para dar pra corrigir a cadeira sem perder a
      // mesa embaixo.
      const { doc: withoutTop, removed } = removeTopTileObjectAt(doc, col, row)
      if (removed) {
        // Espelha a checagem do servidor (contrato `@legends/shared`): peça
        // publicada do admin/legado é intocável pelo comum — recusa ANTES de
        // commitar, para não montar uma edição que o servidor recusaria.
        if (isProtectedFromActor(removed)) {
          rejectProtected(protectionMessage(removed, 'ser apagada'))
          return
        }
        commitOp()
        documentRef.current = withoutTop
        // Peça já publicada some só no `applyMap` pós-save; até lá, marca
        // vermelha. Peça desta sessão: basta apagar a estampa pendente.
        const wasPublished = baseDocRef.current?.objects.some((object) => object.id === removed.id) ?? false
        if (wasPublished) scene.markTileObjectErased(removed.id, geometryBounds(removed.geometry))
        else scene.removeTileObjectStamp(removed.id)
        setState((s) => ({ ...s, dirty: true }))
        return
      }

      // Sem mobília empilhada: cai no caminho legado, que limpa o tile da
      // própria tile layer `objects` (mapas publicados antes do empilhamento).
      const objects = doc.layers.find((l) => l.key === 'objects')
      const index = row * doc.map.width + col
      const hadTile = objects?.type === 'tile' && objects.data[index] != null
      if (hadTile) commitOp()
      documentRef.current = stampTile(doc, 'objects', col, row, null)
      scene.eraseTileStamp('objects', col, row, hadTile)
      if (hadTile) setState((s) => ({ ...s, dirty: true }))
    },
    [canvasRef, commitOp, isProtectedFromActor, rejectProtected, protectionMessage],
  )

  /**
   * Seleciona um único GRUPO de mobília pelo id (ferramenta "Girar") — clicar
   * em outra peça troca a seleção inteira, nunca acumula (era isso que fazia
   * "todos os objetos clicados" ficarem marcados ao mesmo tempo). `null` de
   * `groupBounds` (grupo sumiu, ex.: apagado por outra sessão) é no-op.
   *
   * Estrutura publicada do admin/legado é intocável pelo comum (Task 5) — se
   * QUALQUER slice do grupo estiver protegido, a seleção inteira é recusada:
   * mover/girar age no grupo como um todo, não dá pra "escapar" a proteção
   * agarrando só um slice desprotegido de um grupo majoritariamente do admin.
   */
  const selectGroup = useCallback(
    (groupKey: string) => {
      const doc = documentRef.current
      if (!doc) return
      const groupObjects = tileObjectsInGroup(doc, groupKey)
      const protectedObject = groupObjects.find((object) => isProtectedFromActor(object))
      if (protectedObject) {
        rejectProtected(protectionMessage(protectedObject, 'ser movida'))
        return
      }
      const bounds = groupBounds(doc, groupKey)
      if (!bounds) return
      const hasCollision = doc.objects.some((object) => object.id === furnitureCollisionId(groupKey))
      const next: SelectedFurniture = { groupKey, bounds, hasCollision }
      selectionRef.current = next
      setState((s) => ({ ...s, selection: next }))
      canvasRef.current?.getScene()?.setSelectionOverlay(bounds)
    },
    [canvasRef, isProtectedFromActor, rejectProtected, protectionMessage],
  )

  const clearSelection = useCallback(() => {
    selectionRef.current = null
    canvasRef.current?.getScene()?.setSelectionOverlay(null)
    setState((s) => (s.selection ? { ...s, selection: null } : s))
  }, [canvasRef])

  /**
   * Solta o asset escolhido na paleta e volta o pincel ao modo "mover"
   * (review PR 10555 — item "não é possível voltar ao cursor normal"): sem
   * isso, uma vez que um asset está selecionado, todo clique em espaço vazio
   * cria uma cópia nova para sempre, e não há como simplesmente clicar em
   * mobília existente para arrastá-la. Chamado pelo Esc (ver o `useEffect`
   * mais abaixo), por clicar de novo no mesmo asset na paleta (toggle-off) e
   * pelo botão "Cursor" do drawer.
   */
  const clearSelectedTile = useCallback(() => {
    selectedTileRef.current = null
    canvasRef.current?.getScene()?.setPlacementPreview(null)
    setState((s) => (s.selectedTile ? { ...s, selectedTile: null } : s))
  }, [canvasRef])

  /**
   * Resolve a seleção da paleta (bloco `cols×rows`) para colocação livre como um
   * GRUPO: garante o tileset, carrega o asset e registra o frame de CADA slice.
   * Devolve os slices com seus offsets `dc/dr` e as chaves de textura já
   * registradas (usadas na estampa e no fantasma). `null` se não há seleção ou
   * nenhum slice registrou. Re-lê `documentRef`/seleção DEPOIS do await (o asset
   * builtin pode demorar) — mesma defesa da corrida de `paintAt`.
   */
  const resolveSelectedGroup = useCallback(async () => {
    const scene = canvasRef.current?.getScene()
    const picked = selectedTileRef.current
    if (!scene || !picked) return null
    const builtin = builtinTilesetAsset(picked.assetId)
    if (!builtin) return null
    await scene.registerBuiltinAsset(picked.assetId, builtin.url)
    const doc = documentRef.current
    const freshPicked = selectedTileRef.current
    if (!doc || !freshPicked || freshPicked.assetId !== picked.assetId) return null
    const tileWidth = MapTileSizeSchema.safeParse(builtin.tileWidth)
    const tileHeight = MapTileSizeSchema.safeParse(builtin.tileHeight)
    if (!tileWidth.success || !tileHeight.success) return null
    const ensured = ensureBuiltinTileset(doc, picked.assetId)
    const tilesetMeta = {
      id: ensured.tilesetId,
      assetId: picked.assetId,
      name: builtin.name,
      tileWidth: tileWidth.data,
      tileHeight: tileHeight.data,
      columns: builtin.columns,
      tileCount: builtin.tileCount,
    }
    const tiles: { dc: number; dr: number; tileIndex: number; textureKey: string; frameKey: string }[] = []
    for (let dr = 0; dr < freshPicked.rows; dr++) {
      for (let dc = 0; dc < freshPicked.cols; dc++) {
        const tileIndex = (freshPicked.row + dr) * builtin.columns + (freshPicked.col + dc)
        const registered = scene.registerTileFrame(tilesetMeta, tileIndex)
        if (registered) tiles.push({ dc, dr, tileIndex, ...registered })
      }
    }
    if (tiles.length === 0) return null
    const cols = Math.max(...tiles.map((t) => t.dc)) + 1
    const rows = Math.max(...tiles.map((t) => t.dr)) + 1
    return {
      doc: ensured.doc,
      tilesetId: ensured.tilesetId,
      tileWidth: tileWidth.data,
      tileHeight: tileHeight.data,
      cols,
      rows,
      tiles,
      category: freshPicked.category,
      assetId: picked.assetId,
    }
  }, [canvasRef])

  /**
   * Atualiza o fantasma de colocação: sprites esmaecidos de TODOS os slices do
   * asset selecionado, seguindo o cursor, quando a ferramenta é o pincel e há
   * seleção; some caso contrário. Re-checa ferramenta/seleção depois do await.
   */
  const updatePlacementPreview = useCallback(async () => {
    const scene = canvasRef.current?.getScene()
    if (!scene) return
    if (toolRef.current !== 'brush' || !selectedTileRef.current) {
      scene.setPlacementPreview(null)
      return
    }
    const resolved = await resolveSelectedGroup()
    if (!resolved || toolRef.current !== 'brush' || !selectedTileRef.current) {
      scene.setPlacementPreview(null)
      return
    }
    scene.setPlacementPreview({
      groupWidth: resolved.cols * resolved.tileWidth,
      groupHeight: resolved.rows * resolved.tileHeight,
      tileWidth: resolved.tileWidth,
      tileHeight: resolved.tileHeight,
      slices: resolved.tiles.map((t) => ({
        textureKey: t.textureKey,
        frameKey: t.frameKey,
        dx: t.dc * resolved.tileWidth,
        dy: t.dr * resolved.tileHeight,
      })),
    })
  }, [canvasRef, resolveSelectedGroup])

  /** Re-estampa uma peça (`tile-object`) na posição atual — usado a cada passo do arraste. */
  const restampFurniture = useCallback((object: TileObjectV1) => {
    const scene = canvasRef.current?.getScene()
    const doc = documentRef.current
    if (!scene || !doc) return
    const tileset = doc.tilesets.find((t) => t.id === object.properties.tilesetId)
    if (!tileset) return
    const registered = scene.registerTileFrame(tileset, object.properties.tileIndex)
    if (registered) {
      scene.applyTileObjectStamp(
        object.id,
        geometryBounds(object.geometry),
        registered.textureKey,
        registered.frameKey,
        orientationOf(object),
      )
    }
  }, [canvasRef])

  /** Faz sprites publicados e estampas pendentes seguirem a ordem do documento de trabalho. */
  const syncFurnitureOrder = useCallback((doc: MapDocumentV1) => {
    canvasRef.current?.getScene()?.syncTileObjectOrder(
      doc.objects.filter((object): object is TileObjectV1 => object.type === 'tile-object'),
    )
  }, [canvasRef])

  /**
   * Coloca o asset selecionado (grupo de slices) numa posição LIVRE, com a bbox
   * do grupo centrada no cursor, e já agarra o grupo para arrastar no mesmo
   * gesto (espelha `beginFreeTileSelection` do editor admin). A colocação é um
   * passo de desfazer atômico; o arraste que a segue abre o seu próprio passo.
   */
  const placeFurnitureGroupAtPixel = useCallback(
    async (x: number, y: number) => {
      const scene = canvasRef.current?.getScene()
      if (!scene) return
      const resolved = await resolveSelectedGroup()
      if (!resolved) return
      // Colisão pareada (se a categoria bloquear passagem) conta mais um
      // objeto pro teto — ver `addTileObjectGroupAtPixel`.
      // `tileIndex` só para peça de UM tile: é a granularidade em que a
      // exceção da bola existe (ver `isCollidableAssetCategory`).
      const collidable = isCollidableAssetCategory(
        resolved.category,
        resolved.assetId,
        resolved.tiles.length === 1 ? resolved.tiles[0].tileIndex : undefined,
      )
      const addedCount = resolved.tiles.length + (collidable ? 1 : 0)
      if (exceedsTilesetLimit(resolved.doc)) {
        setState((s) => ({ ...s, limitError: TILESET_LIMIT_MESSAGE }))
        return
      }
      if (resolved.doc.objects.length + addedCount > MAP_DOCUMENT_V1_LIMITS.maxObjects) {
        setState((s) => ({
          ...s,
          limitError: `Limite de ${MAP_DOCUMENT_V1_LIMITS.maxObjects} objetos do mapa atingido — apague algo antes de continuar.`,
        }))
        return
      }
      const groupW = resolved.cols * resolved.tileWidth
      const groupH = resolved.rows * resolved.tileHeight
      const groupId = nextGroupId()
      beginOp()
      const next = addTileObjectGroupAtPixel(resolved.doc, {
        groupId,
        x: x - groupW / 2,
        y: y - groupH / 2,
        tilesetId: resolved.tilesetId,
        tileWidth: resolved.tileWidth,
        tileHeight: resolved.tileHeight,
        tiles: resolved.tiles.map((t) => ({ dc: t.dc, dr: t.dr, tileIndex: t.tileIndex })),
        collidable,
      })
      documentRef.current = next
      // Estampa cada slice com o frame que já resolvemos (evita re-registrar).
      for (const tile of resolved.tiles) {
        const id = `${groupId}${GROUP_ID_SEPARATOR}${tile.dc}-${tile.dr}`
        const placed = next.objects.find((o): o is TileObjectV1 => o.id === id && o.type === 'tile-object')
        if (placed) scene.applyTileObjectStamp(id, geometryBounds(placed.geometry), tile.textureKey, tile.frameKey)
      }
      commitOp()
      setState((s) => ({ ...s, dirty: true, limitError: null }))
      // Agarra o grupo recém-colocado — o arraste seguinte o leva ao ponto final.
      const bounds = groupBounds(next, groupId)
      if (bounds) {
        furnitureDragRef.current = { groupKey: groupId, offsetX: x - bounds.x, offsetY: y - bounds.y }
        dragOpenedRef.current = false
      }
    },
    [canvasRef, resolveSelectedGroup, nextGroupId, beginOp, commitOp],
  )

  /** Aplica um passo do arraste: move o GRUPO agarrado e re-estampa cada slice (no-op se não moveu). */
  const moveFurnitureGroup = useCallback((x: number, y: number) => {
    const gesture = furnitureDragRef.current
    const scene = canvasRef.current?.getScene()
    const doc = documentRef.current
    if (!gesture || !scene || !doc) return
    const next = moveGroupTo(doc, gesture.groupKey, x - gesture.offsetX, y - gesture.offsetY)
    if (next === doc) return
    // Primeiro movimento de fato: abre o passo de desfazer.
    if (!dragOpenedRef.current) {
      beginOp()
      dragOpenedRef.current = true
    }
    documentRef.current = next
    // Esconde o sprite publicado de cada slice (no-op p/ peça da sessão) e
    // re-estampa na nova posição — sem isso o lugar antigo ficaria com fantasma.
    for (const member of next.objects) {
      if (member.type !== 'tile-object' || groupKeyOf(member.id) !== gesture.groupKey) continue
      scene.hidePublishedObject(member.id)
      restampFurniture(member)
    }
    setState((s) => (s.dirty ? s : { ...s, dirty: true }))
  }, [canvasRef, beginOp, restampFurniture])

  /**
   * Gira 90° o grupo ATUALMENTE agarrado (review PR 10555 — item "adicionar
   * rotação no R na edição"): funciona tanto para a peça recém-colocada
   * (`placeFurnitureGroupAtPixel` já a agarra para o mesmo gesto) quanto para
   * uma peça existente agarrada por cima — em ambos os casos o usuário ainda
   * está com o botão do mouse pressionado, arrastando. Reaproveita o mesmo
   * passo de desfazer do arraste (`dragOpenedRef`), então soltar o mouse
   * depois de girar commita giro+posição como uma coisa só.
   */
  const rotateHeldFurniture = useCallback(
    (direction: 'cw' | 'ccw') => {
      if (savingRef.current) return
      // Invariante: não há checagem de proteção aqui — depende de
      // `furnitureDragRef` já só conter um grupo que o comum pôde agarrar
      // (o grab em `handleObjectPointerDown` recusa grupo protegido antes de
      // preenchê-lo). Se o caminho de agarrar mudar, revalide aqui também.
      const gesture = furnitureDragRef.current
      const doc = documentRef.current
      const scene = canvasRef.current?.getScene()
      if (!gesture || !doc || !scene) return
      const result = rotateGroupInPlace(doc, gesture.groupKey, direction)
      if (!result.ok) {
        if (result.reason === 'out-of-bounds') {
          setState((s) => ({ ...s, limitError: 'Não há espaço para girar aqui.' }))
        }
        return
      }
      if (!dragOpenedRef.current) {
        beginOp()
        dragOpenedRef.current = true
      }
      documentRef.current = result.doc
      for (const member of result.doc.objects) {
        if (member.type !== 'tile-object' || groupKeyOf(member.id) !== gesture.groupKey) continue
        scene.hidePublishedObject(member.id)
        restampFurniture(member)
      }
      setState((s) => (s.dirty ? s : { ...s, dirty: true, limitError: null }))
    },
    [canvasRef, beginOp, restampFurniture],
  )

  /** Borracha por objeto: exclui o GRUPO apagável do topo sob o ponto (mobília > área). */
  const eraseObjectAt = useCallback((x: number, y: number) => {
    const scene = canvasRef.current?.getScene()
    const doc = documentRef.current
    if (!scene || !doc) return
    const target = topErasableObjectAtPixel(doc, x, y)
    if (!target) {
      // Nada apagável sob o cursor: cai no caminho legado (limpa o tile pintado
      // na tile-layer `objects` daquela célula — mapas anteriores ao empilhamento).
      eraseAt(Math.floor(x / doc.map.tileWidth), Math.floor(y / doc.map.tileHeight))
      return
    }
    // Espelha a checagem do servidor: estrutura publicada do admin/legado é
    // intocável pelo comum — recusa ANTES de montar a remoção do grupo.
    if (isProtectedFromActor(target)) {
      rejectProtected(protectionMessage(target, 'ser apagada'))
      return
    }
    if (target.type === 'tile-object') {
      // Apaga o GRUPO inteiro — asset fatiado some como um só.
      const { doc: next, removed } = removeGroup(doc, groupKeyOf(target.id))
      if (removed.length === 0) return
      beginOp()
      documentRef.current = next
      for (const member of removed) {
        const published = baseDocRef.current?.objects.some((o) => o.id === member.id) ?? false
        // Publicada: esconde o sprite (some na hora, reversível no Cancelar).
        // Da sessão: remove a estampa pendente.
        if (published) scene.hidePublishedObject(member.id)
        else scene.removeTileObjectStamp(member.id)
      }
    } else {
      const { doc: next, removed } = removeObjectById(doc, target.id)
      if (!removed) return
      const published = baseDocRef.current?.objects.some((o) => o.id === target.id) ?? false
      beginOp()
      documentRef.current = next
      if (published) scene.eraseAreaMarker(target.id, geometryBounds(target.geometry))
      else scene.removeEditZoneOverlay(target.id)
    }
    commitOp()
    scene.setEraseHover(null)
    setState((s) => ({ ...s, dirty: true }))
  }, [canvasRef, beginOp, commitOp, eraseAt, isProtectedFromActor, rejectProtected, protectionMessage])

  /**
   * Apaga o GRUPO atualmente selecionado (tecla Del/Backspace) — mesmo
   * caminho de `eraseObjectAt` para um `tile-object` (some o GRUPO inteiro,
   * publicada esconde o sprite / da sessão remove a estampa), mas partindo
   * da seleção da ferramenta "Girar" em vez de um ponto de clique.
   */
  const deleteSelection = useCallback(() => {
    if (savingRef.current) return
    const doc = documentRef.current
    const scene = canvasRef.current?.getScene()
    const selected = selectionRef.current
    if (!doc || !scene || !selected) return
    // Invariante: não há checagem de proteção aqui — depende de
    // `selectionRef` já só conter um grupo que o comum pôde selecionar
    // (`selectGroup` recusa grupo protegido). Se o caminho de seleção mudar,
    // revalide aqui também.
    const { doc: next, removed } = removeGroup(doc, selected.groupKey)
    if (removed.length === 0) return
    beginOp()
    documentRef.current = next
    for (const member of removed) {
      const published = baseDocRef.current?.objects.some((o) => o.id === member.id) ?? false
      if (published) scene.hidePublishedObject(member.id)
      else scene.removeTileObjectStamp(member.id)
    }
    commitOp()
    clearSelection()
    setState((s) => ({ ...s, dirty: true }))
  }, [canvasRef, beginOp, commitOp, clearSelection])

  /**
   * Remove SÓ a colisão da mobília selecionada — a peça continua no mapa,
   * visível e no lugar, só deixa de bloquear passagem (dá pra "subir" nela).
   * Mesma regra de proteção do admin que as outras ações destrutivas: recusa
   * se a colisão pertence a uma peça protegida (`isProtectedFromActor`), sem
   * mexer no documento. Sem overlay/estampa própria pra atualizar na cena —
   * a colisão pareada nunca teve representação visual (ver `repaintOverlays`).
   */
  const removeSelectionCollision = useCallback(() => {
    if (savingRef.current) return
    const doc = documentRef.current
    const selected = selectionRef.current
    if (!doc || !selected || !selected.hasCollision) return
    const collisionObject = doc.objects.find((object) => object.id === furnitureCollisionId(selected.groupKey))
    if (!collisionObject) return
    if (isProtectedFromActor(collisionObject)) {
      rejectProtected(protectionMessage(collisionObject, 'ter a colisão removida'))
      return
    }
    const { doc: next, removed } = removeFurnitureCollision(doc, selected.groupKey)
    if (!removed) return
    beginOp()
    documentRef.current = next
    commitOp()
    const nextSelection: SelectedFurniture = { ...selected, hasCollision: false }
    selectionRef.current = nextSelection
    setState((s) => ({ ...s, selection: nextSelection, dirty: true, limitError: null }))
  }, [beginOp, commitOp, isProtectedFromActor, rejectProtected, protectionMessage])

  /**
   * Apaga SÓ a colisão sob o cursor (ferramenta "Apagar colisão"), deixando
   * intacto o que estiver embaixo — móvel, parede ou piso. É o par da
   * ferramenta "Colisão": quem desenha um bloqueio no lugar errado precisa
   * conseguir desfazê-lo depois de salvar, e a borracha comum não serve porque
   * ela apaga a peça inteira antes de chegar na colisão.
   *
   * Vale para colisão avulsa e para a pareada de um móvel (`furnitureCollisionId`)
   * — nesse caso o efeito é o mesmo do botão "Remover colisão" da seleção, e a
   * seleção aberta é atualizada para o botão não prometer o que já foi feito.
   *
   * A regra de autoria é a de sempre (`isProtectedFromActor`, espelho do
   * servidor): colisão publicada pelo admin — ou sem autor registrado — é
   * intocável para quem não é admin.
   */
  const eraseCollisionAt = useCallback((x: number, y: number) => {
    if (savingRef.current) return
    const scene = canvasRef.current?.getScene()
    const doc = documentRef.current
    if (!scene || !doc) return
    const target = topCollisionAtPixel(doc, x, y)
    if (!target) return
    if (isProtectedFromActor(target)) {
      rejectProtected(protectionMessage(target, 'ter a colisão apagada'))
      return
    }
    const { doc: next, removed } = removeObjectById(doc, target.id)
    if (!removed) return
    beginOp()
    documentRef.current = next
    const published = baseDocRef.current?.objects.some((o) => o.id === target.id) ?? false
    // A colisão pareada de um móvel não tem overlay próprio (ver `areaOverlays`),
    // então não há marca a apagar na cena — só as avulsas desenham retângulo.
    if (!isFurnitureCollisionId(target.id)) {
      if (published) scene.eraseAreaMarker(target.id, geometryBounds(target.geometry))
      else scene.removeEditZoneOverlay(target.id)
    }
    commitOp()
    scene.setEraseHover(null)
    const selected = selectionRef.current
    const nextSelection =
      selected && furnitureCollisionId(selected.groupKey) === target.id
        ? { ...selected, hasCollision: false }
        : selected
    selectionRef.current = nextSelection
    setState((s) => ({ ...s, selection: nextSelection, dirty: true, limitError: null }))
  }, [canvasRef, beginOp, commitOp, isProtectedFromActor, rejectProtected, protectionMessage])


  /**
   * Down no modo `'object'` (pixels): pincel coloca/agarra o grupo; borracha
   * exclui.
   *
   * Com um asset ESCOLHIDO na paleta (`selectedTileRef`), o clique sempre
   * EMPILHA uma peça nova por cima de qualquer coisa sob o cursor — nunca
   * agarra o que já existe (review PR 10555 — antes disso não dava pra
   * colocar, por ex., um monitor sobre uma mesa: o clique sempre "roubava" a
   * mesa para arrastar, e o monitor tinha que nascer do lado e ser arrastado
   * por cima depois). Sem asset escolhido, o clique volta ao modo "mover":
   * em cima de mobília existente agarra o grupo; em espaço vazio é no-op —
   * ver `clearSelectedTile` para voltar a este modo depois de colocar algo.
   */
  const handleObjectPointerDown = useCallback((x: number, y: number) => {
    if (savingRef.current) return
    const doc = documentRef.current
    if (!doc) return
    if (toolRef.current === 'eraser') {
      eraseObjectAt(x, y)
      return
    }
    if (toolRef.current === 'collision-eraser') {
      eraseCollisionAt(x, y)
      return
    }
    if (toolRef.current === 'select') {
      // Clique único seleciona o GRUPO sob o cursor — nunca acumula: cada
      // clique troca a seleção inteira (a peça anterior perde o destaque),
      // e clicar em espaço vazio limpa. É o que faz "só o último clicado"
      // ficar marcado, em vez de todo objeto tocado na sessão.
      const hit = topTileObjectAtPixel(doc, x, y)
      if (hit) selectGroup(groupKeyOf(hit.id))
      else clearSelection()
      return
    }
    if (toolRef.current !== 'brush') return
    if (selectedTileRef.current) {
      void placeFurnitureGroupAtPixel(x, y)
      return
    }
    const hit = topTileObjectAtPixel(doc, x, y)
    if (hit) {
      // Agarra o GRUPO do slice sob o cursor — offset relativo à bbox do grupo.
      // A seleção em si só é atualizada no solto (`handleObjectPointerUp`):
      // clicar E girar sem precisar da ferramenta "Girar" não pode exigir que
      // o usuário troque de ferramenta primeiro.
      const groupKey = groupKeyOf(hit.id)
      // Espelha a checagem do servidor ANTES de agarrar (Task 5 review —
      // Important): sem isso, `moveFurnitureGroup`/`rotateHeldFurniture`
      // mutam `documentRef` e commitam o passo de desfazer a cada
      // pointermove, e só a SELEÇÃO (no soltar) era recusada — tarde demais,
      // o movimento já tinha entrado no documento. Recusar aqui, no grab,
      // impede o arraste de começar: `furnitureDragRef` nunca é setado, então
      // `moveFurnitureGroup` e `rotateHeldFurniture` (que só agem sobre o
      // gesto agarrado) ficam no-op naturalmente para o resto do gesto.
      const protectedObject = tileObjectsInGroup(doc, groupKey).find((object) => isProtectedFromActor(object))
      if (protectedObject) {
        rejectProtected(protectionMessage(protectedObject, 'ser movida'))
        return
      }
      const bounds = groupBounds(doc, groupKey)
      if (bounds) {
        furnitureDragRef.current = { groupKey, offsetX: x - bounds.x, offsetY: y - bounds.y }
        dragOpenedRef.current = false
      }
    } else {
      clearSelection()
    }
  }, [eraseObjectAt, eraseCollisionAt, placeFurnitureGroupAtPixel, selectGroup, clearSelection, isProtectedFromActor, rejectProtected, protectionMessage])

  /** Move no modo `'object'`: pincel arrasta o grupo agarrado; borracha realça o hover (bbox do grupo). */
  const handleObjectPointerMove = useCallback((x: number, y: number, isDown: boolean) => {
    if (savingRef.current) return
    if (toolRef.current === 'eraser') {
      const scene = canvasRef.current?.getScene()
      const doc = documentRef.current
      if (!scene || !doc) return
      const target = topErasableObjectAtPixel(doc, x, y)
      const bounds = target
        ? target.type === 'tile-object'
          ? groupBounds(doc, groupKeyOf(target.id))
          : geometryBounds(target.geometry)
        : null
      scene.setEraseHover(bounds)
      return
    }
    if (toolRef.current === 'collision-eraser') {
      const scene = canvasRef.current?.getScene()
      const doc = documentRef.current
      if (!scene || !doc) return
      const target = topCollisionAtPixel(doc, x, y)
      scene.setEraseHover(target ? geometryBounds(target.geometry) : null)
      return
    }
    if (toolRef.current !== 'brush' || !isDown || !furnitureDragRef.current) return
    moveFurnitureGroup(x, y)
  }, [canvasRef, moveFurnitureGroup])

  /**
   * Up no modo `'object'`: fecha o arraste (commita o passo se algo moveu) e
   * seleciona o grupo que estava agarrado — clique rápido ou arraste longo,
   * tanto faz: no fim do gesto a peça fica selecionada (contorno azul), e R
   * gira na hora sem precisar da ferramenta "Girar". Seleciona no SOLTO, não
   * no clique, para não desenhar um contorno que fica desalinhado enquanto a
   * peça ainda está sendo arrastada.
   */
  const handleObjectPointerUp = useCallback(() => {
    const gesture = furnitureDragRef.current
    if (!gesture) return
    if (dragOpenedRef.current) {
      commitOp()
      dragOpenedRef.current = false
    }
    furnitureDragRef.current = null
    selectGroup(gesture.groupKey)
  }, [commitOp, selectGroup])

  /**
   * Fim do drag de uma ferramenta de área (Task C5) — a cena já converteu o
   * gesto em pixels; aqui só decide o TIPO de objeto conforme a ferramenta
   * ativa (`toolRef`) e empurra pro documento de trabalho via `addRectObject`
   * (C2, puro). `dirty` só sobe se um objeto foi de fato adicionado — um
   * `onRectEnd` chegando fora de silence-zone/call-zone/collision (não deveria,
   * a cena só entra em modo `'rect'` para essas) é no-op.
   */
  const handleRectEnd = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const doc = documentRef.current
      if (!doc) return
      // Um arraste inteiro (apagar bloco ou desenhar área) é UM passo de
      // desfazer — o `eraseAt` do laço abaixo consome este mesmo candidato.
      beginOp()
      // Borracha em retângulo: apaga os tiles do bloco E remove as áreas/objetos
      // de decoração (silêncio, chamada, colisão, link…) que o retângulo cobre.
      if (toolRef.current === 'eraser') {
        const tw = doc.map.tileWidth
        const th = doc.map.tileHeight
        const startCol = Math.floor(rect.x / tw)
        const startRow = Math.floor(rect.y / th)
        const endCol = Math.floor((rect.x + rect.width - 1) / tw)
        const endRow = Math.floor((rect.y + rect.height - 1) / th)
        for (let r = startRow; r <= endRow; r++) {
          for (let c = startCol; c <= endCol; c++) eraseAt(c, r)
        }
        // Espelha a checagem do servidor: área/objeto de decoração publicado do
        // admin/legado é intocável pelo comum — o predicado deixa o objeto de
        // fora do que a borracha em retângulo remove (Task 5).
        const { doc: prunedDoc, removed } = removeDecorationObjectsInRect(documentRef.current!, rect, isProtectedFromActor)
        if (removed.length) {
          commitOp()
          documentRef.current = prunedDoc
          const scene = canvasRef.current?.getScene()
          removed.forEach((obj) => scene?.eraseAreaMarker(obj.id, geometryBounds(obj.geometry)))
          setState((s) => ({ ...s, dirty: true }))
        }
        return
      }
      const id = nextObjectId()
      const geometry = { kind: 'rectangle' as const, ...rect }
      let color: number | undefined
      let next: MapDocumentV1 | null = null
      switch (toolRef.current) {
        case 'silence-zone':
          next = addRectObject(doc, {
            id,
            layerKey: 'private-zones',
            type: 'private-zone',
            geometry,
            properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' },
          })
          color = 0xff5d5d
          break
        case 'call-zone':
          next = addRectObject(doc, {
            id,
            layerKey: 'meeting-rooms',
            type: 'meeting-room',
            geometry,
            properties: { externalKey: id, name: 'Sala de chamada', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
          })
          color = 0x8ab4f8
          break
        case 'collision':
          next = addRectObject(doc, { id, layerKey: 'collision', type: 'collision', geometry, properties: {} })
          color = 0xff6b6b
          break
        default:
          return
      }
      commitOp()
      documentRef.current = next
      canvasRef.current?.getScene()?.addEditZoneOverlay(id, rect, color)
      setState((s) => ({ ...s, dirty: true }))
    },
    [canvasRef, nextObjectId, eraseAt, beginOp, commitOp, isProtectedFromActor],
  )

  /**
   * Ferramenta "link" (Task C5) — v1 mínima: um clique único pede rótulo/URL
   * via `window.prompt` e adiciona um objeto ponto. Cancelar (campo vazio) ou
   * uma URL que não seja `https://` aborta sem tocar no documento.
   *
   * Bugfix double-fire: chamada a partir de `onPointPlace` (cena em
   * `editMode: 'point'`), que dispara exatamente uma vez por
   * pointerdown — nunca a partir do pipe de pintura contínua
   * (`onTilePaint`), que repetiria no pointermove e empilharia prompts.
   *
   * TODO(C5+): `action-point`/`door` ficam de fora desta v1 — mesmo padrão
   * de prompt serviria (label+actionKey / key), mas não foram ligados ainda
   * para manter o escopo desta task nas ferramentas de área + o drawer.
   */
  const placeLinkPoint = useCallback(
    (col: number, row: number) => {
      const doc = documentRef.current
      if (!doc) return
      const label = window.prompt('Rótulo do link:')?.trim()
      if (!label) return
      const url = window.prompt('URL (https://...):')?.trim()
      if (!url || !url.startsWith('https://')) return
      const id = nextObjectId()
      const point = {
        x: col * doc.map.tileWidth + Math.floor(doc.map.tileWidth / 2),
        y: row * doc.map.tileHeight + Math.floor(doc.map.tileHeight / 2),
      }
      const geometry = { kind: 'point' as const, ...point }
      // Só abre o passo de desfazer depois dos prompts: cancelar o diálogo não
      // pode virar um Ctrl+Z vazio.
      beginOp()
      commitOp()
      documentRef.current = addRectObject(doc, {
        id,
        layerKey: 'interactive-objects',
        type: 'link',
        geometry,
        properties: { key: id, label, url },
      })
      // Mesma caixa que `repaintOverlays` recalcula ao desfazer — usar
      // `geometryBounds` nos dois lados evita o overlay mudar de tamanho.
      canvasRef.current?.getScene()?.addEditZoneOverlay(id, geometryBounds(geometry), OBJECT_OVERLAY_COLORS.link)
      setState((s) => ({ ...s, dirty: true }))
    },
    [canvasRef, nextObjectId, beginOp, commitOp],
  )

  /**
   * Colocação single-shot de ferramentas de ponto (bugfix double-fire) —
   * despacha por `toolRef.current`. `action-point`/`door` seguem inertes
   * (TODO acima, fora do escopo desta v1); só `link` está de fato ligado.
   */
  const placePoint = useCallback(
    (cell: { col: number; row: number }) => {
      if (toolRef.current === 'link') placeLinkPoint(cell.col, cell.row)
      // action-point/door: ver TODO em placeLinkPoint — fora do escopo desta v1.
    },
    [placeLinkPoint],
  )

  /**
   * Redesenha TODOS os overlays de edição a partir do diff entre o draft
   * pristino da sessão (`baseDocRef`) e um documento de trabalho.
   *
   * A cena não guarda histórico: os overlays (estampas verdes, marcas
   * vermelhas de remoção, retângulos de área) são puramente uma função desse
   * diff. Então desfazer não precisa de operação inversa por ferramenta —
   * basta restaurar o documento e recalcular tudo. É O(células do mapa), mas
   * só roda no Ctrl+Z, nunca durante a pincelada.
   */
  const repaintOverlays = useCallback(
    async (doc: MapDocumentV1) => {
      const scene = canvasRef.current?.getScene()
      const base = baseDocRef.current
      if (!scene || !base) return
      scene.discardLocalEdits()
      // Toda peça publicada volta a ficar visível antes de recalcular quais
      // devem sumir — os overlays são uma função pura do diff, sem histórico.
      scene.resetPublishedObjectsVisibility()
      // `discardLocalEdits` também apagou os retângulos das áreas publicadas;
      // repõe só as que vieram do documento-base — as criadas nesta sessão são
      // responsabilidade do laço de diff abaixo, e pintar as duas coisas aqui
      // deixaria overlay em dobro.
      const baseAreaIds = new Set(base.objects.map((object) => object.id))
      scene.setPublishedAreaOverlays(paintedAreaOverlays(doc).filter((area) => baseAreaIds.has(area.id)))

      const current = doc.layers.find((l) => l.key === 'objects')
      const pristine = base.layers.find((l) => l.key === 'objects')
      if (current?.type === 'tile' && pristine?.type === 'tile') {
        for (let index = 0; index < current.data.length; index++) {
          const ref = current.data[index]
          if (ref === pristine.data[index]) continue
          const col = index % doc.map.width
          const row = Math.floor(index / doc.map.width)
          if (!ref) {
            // Célula que tinha tile publicado e foi apagada: marca vermelha.
            scene.eraseTileStamp('objects', col, row, true)
            continue
          }
          const [tilesetId, rawTileIndex] = ref.split(':')
          const tileset = doc.tilesets.find((t) => t.id === tilesetId)
          if (!tileset) continue
          const builtin = builtinTilesetAsset(tileset.assetId)
          if (builtin) await scene.registerBuiltinAsset(tileset.assetId, builtin.url)
          const registered = scene.registerTileFrame(tileset, Number(rawTileIndex))
          scene.applyTileStamp('objects', col, row, registered?.textureKey ?? '', registered?.frameKey ?? null)
        }
      }

      const pristineById = new Map(base.objects.map((o) => [o.id, o]))
      const currentIds = new Set(doc.objects.map((o) => o.id))
      for (const object of doc.objects) {
        const pristine = pristineById.get(object.id)
        // Mobília: redesenha a estampa quando é NOVA (colocada nesta sessão) ou
        // quando foi MOVIDA (mesma id, geometria diferente da publicada). Peça
        // publicada movida também esconde o sprite antigo, senão fica fantasma
        // no lugar original. `discardLocalEdits` (acima) já restaurou toda a
        // visibilidade publicada, então só reesconde o que ainda está movido.
        if (object.type === 'tile-object') {
          const moved =
            pristine?.type === 'tile-object' &&
            (pristine.geometry.x !== object.geometry.x || pristine.geometry.y !== object.geometry.y)
          if (pristine && !moved) continue
          if (moved) scene.hidePublishedObject(object.id)
          const tileset = doc.tilesets.find((t) => t.id === object.properties.tilesetId)
          if (!tileset) continue
          const builtin = builtinTilesetAsset(tileset.assetId)
          if (builtin) await scene.registerBuiltinAsset(tileset.assetId, builtin.url)
          const registered = scene.registerTileFrame(tileset, object.properties.tileIndex)
          if (registered) {
            // Mesmo objeto criado NESTA sessão pode já ter sido girado antes
            // do undo recalcular tudo — sem a orientação aqui, a peça voltaria
            // a aparecer sem rotação.
            scene.applyTileObjectStamp(
              object.id,
              geometryBounds(object.geometry),
              registered.textureKey,
              registered.frameKey,
              orientationOf(object),
            )
          }
          continue
        }
        // Áreas/links acrescentados nesta sessão: retângulo de overlay. A
        // colisão pareada de um grupo de mobília (`furnitureCollisionId`) fica
        // FORA disso — é puramente funcional, sem representação visual própria
        // (o overlay verde já é a estampa da peça; um retângulo vermelho por
        // cima de cada móvel colocado seria ruído, não sinal).
        if (pristine || isFurnitureCollisionId(object.id)) continue
        scene.addEditZoneOverlay(object.id, geometryBounds(object.geometry), OBJECT_OVERLAY_COLORS[object.type])
      }
      for (const object of base.objects) {
        if (currentIds.has(object.id)) continue
        // Mobília publicada removida: esconde o sprite (some na hora, como a
        // borracha por objeto — consistente com `eraseObjectAt`).
        if (object.type === 'tile-object') {
          scene.hidePublishedObject(object.id)
          continue
        }
        if (isFurnitureCollisionId(object.id)) continue
        scene.eraseAreaMarker(object.id, geometryBounds(object.geometry))
      }

      // Terceiro caso: id presente nos DOIS lados, com properties diferentes —
      // peça publicada modificada in-place nesta sessão (girada/espelhada).
      // Nenhum dos laços acima a alcança: o primeiro pula ids que já existiam
      // no base, o segundo só trata ids que sumiram. Sem isto, girar mobília
      // publicada não redesenha nada.
      const baseById = new Map(base.objects.map((object) => [object.id, object]))
      for (const object of doc.objects) {
        if (object.type !== 'tile-object') continue
        const pristine = baseById.get(object.id)
        if (!pristine || pristine.type !== 'tile-object') continue
        if (
          pristine.properties.rotation === object.properties.rotation &&
          pristine.properties.flipX === object.properties.flipX &&
          pristine.geometry.x === object.geometry.x &&
          pristine.geometry.y === object.geometry.y
        ) {
          continue
        }
        const tileset = doc.tilesets.find((t) => t.id === object.properties.tilesetId)
        if (!tileset) continue
        const builtin = builtinTilesetAsset(tileset.assetId)
        if (builtin) await scene.registerBuiltinAsset(tileset.assetId, builtin.url)
        const registered = scene.registerTileFrame(tileset, object.properties.tileIndex)
        if (!registered) continue
        // Esconde o publicado (orientação antiga) e desenha a versão atual
        // como estampa pendente, um degrau acima.
        scene.setPublishedObjectVisible(object.id, false)
        scene.applyTileObjectStamp(
          object.id,
          geometryBounds(object.geometry),
          registered.textureKey,
          registered.frameKey,
          orientationOf(object),
        )
      }

      // `discardLocalEdits` (no topo) apaga TODOS os overlays, inclusive o
      // retângulo de seleção — mas a seleção não é uma edição pendente, e sim
      // estado de UI que sobrevive ao desfazer. Redesenha por último, senão o
      // Ctrl+Z deixaria uma seleção invisível porém ativa: os atalhos de girar
      // continuariam operando sobre um grupo que o usuário não vê selecionado.
      const selection = selectionRef.current
      if (selection) scene.setSelectionOverlay(selection.bounds)
      syncFurnitureOrder(doc)
    },
    [canvasRef, syncFurnitureOrder],
  )

  /**
   * Aplica uma transformação (giro/espelho) ao GRUPO selecionado: muta o
   * documento de trabalho, re-estampa cada slice tocado e reancora a seleção
   * na nova bbox (a peça continua selecionada, dá pra girar de novo em
   * seguida). Mesmo par `rotateGroupInPlace`/`flipGroupInPlace` usado pelo
   * arraste livre (`rotateHeldFurniture`) — por isso é síncrono, sem a
   * corrida de `await registerBuiltinAsset` que o antigo `applyBlockTransform`
   * (baseado em `TileRect`/`rotateBlock`) precisava se defender: a textura já
   * está registrada desde que a peça foi colocada/re-estampada a primeira vez.
   * Recusa em silêncio quando não há seleção, quando um save está em voo, ou
   * (com aviso) quando o giro não cabe no mapa.
   */
  const applyGroupTransform = useCallback(
    (
      transform: (
        doc: MapDocumentV1,
        groupKey: string,
      ) => { ok: true; doc: MapDocumentV1 } | { ok: false; reason: 'out-of-bounds' | 'empty' },
    ) => {
      if (savingRef.current) return
      const doc = documentRef.current
      const scene = canvasRef.current?.getScene()
      const selected = selectionRef.current
      if (!doc || !scene || !selected) return
      // Invariante: não há checagem de proteção aqui (usado por
      // `rotateSelection`/`flipSelection`) — depende de `selectionRef` já
      // só conter um grupo que o comum pôde selecionar (`selectGroup`
      // recusa grupo protegido). Se o caminho de seleção mudar, revalide
      // aqui também.

      const result = transform(doc, selected.groupKey)
      if (!result.ok) {
        if (result.reason === 'out-of-bounds') {
          setState((s) => ({ ...s, limitError: 'Não há espaço para girar aqui.' }))
        }
        // `empty`: o grupo sumiu (apagado por outra sessão) — silêncio, não é erro.
        return
      }

      beginOp()
      commitOp()
      documentRef.current = result.doc
      for (const member of result.doc.objects) {
        if (member.type !== 'tile-object' || groupKeyOf(member.id) !== selected.groupKey) continue
        scene.hidePublishedObject(member.id)
        restampFurniture(member)
      }
      syncFurnitureOrder(result.doc)
      const bounds = groupBounds(result.doc, selected.groupKey)
      const nextSelection: SelectedFurniture | null = bounds
        ? { groupKey: selected.groupKey, bounds, hasCollision: selected.hasCollision }
        : null
      selectionRef.current = nextSelection
      if (nextSelection) scene.setSelectionOverlay(nextSelection.bounds)
      setState((s) => ({ ...s, selection: nextSelection, dirty: true, limitError: null }))
    },
    [canvasRef, beginOp, commitOp, restampFurniture, syncFurnitureOrder],
  )

  const rotateSelection = useCallback(
    (direction: 'cw' | 'ccw') => applyGroupTransform((doc, groupKey) => rotateGroupInPlace(doc, groupKey, direction)),
    [applyGroupTransform],
  )

  const flipSelection = useCallback(
    (axis: 'horizontal' | 'vertical') => applyGroupTransform((doc, groupKey) => flipGroupInPlace(doc, groupKey, axis)),
    [applyGroupTransform],
  )

  /** Move o grupo selecionado na pilha visual, preservando todos os seus slices. */
  const reorderSelection = useCallback((direction: FurnitureOrderDirection) => {
    if (savingRef.current) return
    const doc = documentRef.current
    const selected = selectionRef.current
    if (!doc || !selected) return
    const result = reorderFurnitureGroup(doc, selected.groupKey, direction)
    if (!result.changed) return

    beginOp()
    commitOp()
    documentRef.current = result.doc
    syncFurnitureOrder(result.doc)
    setState((s) => ({ ...s, dirty: true, limitError: null }))
  }, [beginOp, commitOp, syncFurnitureOrder])

  /**
   * Desfaz a última coisa colocada/apagada na sessão de edição atual. Como o
   * primeiro snapshot é o draft pristino, esvaziar a pilha equivale a voltar ao
   * estado inicial — daí `dirty` acompanhar o tamanho da pilha.
   *
   * Só vale antes de Salvar: `save()` publica e zera a sessão.
   */
  const undo = useCallback(async () => {
    // Bloqueia enquanto um save está em voo (re-review — Important C): o
    // botão Desfazer fica `disabled` durante o save, mas o atalho Ctrl+Z
    // continua alcançável pelo teclado. Sem esta guarda, `undo()` reverte
    // `documentRef.current` enquanto `save()` está publicando um `doc`
    // congelado de ANTES da reversão; na volta, a defesa por identidade em
    // `save()` (comparação `documentRef.current === doc`) detecta a
    // divergência e cai no `else` — que é rede de segurança para uma
    // pincelada concorrente, não um caminho esperado para desfazer — e por
    // isso NÃO re-ancora `baseDocRef`. A partir daí `baseDocRef` fica preso
    // no draft pré-save pelo resto da sessão: toda peça pintada antes
    // daquele save passa a parecer "local" (não publicada) para a borracha,
    // que chama `removeTileObjectStamp` (no-op — o sprite virou permanente)
    // em vez de `markTileObjectErased`, deixando a peça visível mesmo depois
    // de removida do documento.
    if (savingRef.current) return
    const previous = historyRef.current.at(-1)
    if (!previous) return
    historyRef.current = historyRef.current.slice(0, -1)
    pendingSnapshotRef.current = null
    documentRef.current = previous
    await repaintOverlays(previous)
    const remaining = historyRef.current.length > 0
    setState((s) => ({ ...s, canUndo: remaining, dirty: remaining }))
  }, [repaintOverlays])

  const exitScene = useCallback(() => {
    canvasRef.current?.getScene()?.setEditing(false)
  }, [canvasRef])

  const enter = useCallback(async () => {
    try {
      // Task 9: sem lock exclusivo — semeia a sessão a partir do mapa
      // PUBLICADO ativo (não mais de um draft privativo). `save()` mescla o
      // documento de trabalho com o documento corrente no servidor, então a
      // âncora aqui é a revisão de decoração, não uma revisão de draft.
      const active = await api.getActiveMapForEditing()
      documentRef.current = active.document
      // Base do diff de overlays e âncora do desfazer: o documento publicado
      // como veio.
      baseDocRef.current = active.document
      baseRevisionRef.current = active.decorRevision
      basePublicationIdRef.current = active.publication.id
      resetHistory()

      canvasRef.current?.getScene()?.setEditing(true, {
        // Abre um passo de desfazer por pincelada, não por célula pintada.
        onStrokeStart: () => beginOp(),
        onTilePaint: (col, row) => {
          // Save em voo (review C4 — Important 2): ignora a entrada até o
          // save resolver, para não deixar uma peça fora do `baseDocRef`
          // re-ancorado.
          if (savingRef.current) return
          if (toolRef.current === 'brush') void paintAt(col, row)
          else if (toolRef.current === 'eraser') eraseAt(col, row)
          // Ferramentas de ponto NÃO passam por aqui — `onTilePaint` repete no
          // pointermove (drag painting), o que faria um clique com jitter
          // disparar `placeLinkPoint` (e o `window.prompt`) mais de uma vez.
          // Elas usam `onPointPlace`, que a cena só invoca uma vez no down.
        },
        onTileErase: (col, row) => {
          if (savingRef.current) return
          eraseAt(col, row)
        },
        onRectEnd: (rect) => {
          if (savingRef.current) return
          handleRectEnd(rect)
        },
        onPointPlace: (cell) => {
          if (savingRef.current) return
          placePoint(cell)
        },
        onObjectPointerDown: handleObjectPointerDown,
        onObjectPointerMove: handleObjectPointerMove,
        onObjectPointerUp: handleObjectPointerUp,
      })
      canvasRef.current?.getScene()?.setEditMode(editModeForTool(toolRef.current))
      // Áreas que já existiam no mapa publicado (#22167): sem isto a paleta
      // ÁREAS abre "vazia" e não dá para saber onde já há sala de chamada.
      canvasRef.current?.getScene()?.setPublishedAreaOverlays(paintedAreaOverlays(active.document))

      selectionRef.current = null
      setState((s) => ({
        ...s,
        active: true,
        dirty: false,
        saving: false,
        limitError: null,
        saveError: null,
        canUndo: false,
        selection: null,
      }))
    } catch {
      // Falha ao carregar o mapa ativo: não deixa a cena em modo de edição
      // nem um documento de trabalho pela metade.
      canvasRef.current?.getScene()?.setEditing(false)
      documentRef.current = null
      baseDocRef.current = null
      resetHistory()
      setState((s) => ({ ...s, active: false, canUndo: false }))
    }
  }, [canvasRef, eraseAt, paintAt, placePoint, handleRectEnd, handleObjectPointerDown, handleObjectPointerMove, handleObjectPointerUp, beginOp, resetHistory])

  const cancel = useCallback(() => {
    // Cancelar: descarta as estampas/áreas locais (não há remonte da cena que
    // as substituiria, ao contrário do Salvar) — MAS só se houver algo de
    // fato não salvo (review PR 10555 — item "salvar não reflete sem F5").
    // `save()` publica no servidor e depende do broadcast `map-decor-updated`
    // (round-trip do WebSocket) chegar de volta pra promover as estampas
    // pendentes a sprites permanentes via `applyMap`. Fechar o drawer (este
    // botão OU o X do cabeçalho, que também chama `cancel`) logo depois de um
    // Salvar bem-sucedido é um gesto natural que cai bem dentro dessa janela:
    // sem esta guarda, `discardLocalEdits()` apaga a mobília recém-salva da
    // tela ANTES do WS confirmar, e ela só volta a aparecer com um F5 (que
    // força um fetch REST fresco). Com `!state.dirty`, tudo que está visível
    // já é a verdade publicada — não há nada "local" pra descartar.
    if (state.dirty) {
      canvasRef.current?.getScene()?.discardLocalEdits()
      if (baseDocRef.current) syncFurnitureOrder(baseDocRef.current)
    }
    exitScene()
    documentRef.current = null
    baseDocRef.current = null
    resetHistory()
    baseRevisionRef.current = 0
    basePublicationIdRef.current = null
    selectionRef.current = null
    setState((s) => ({
      ...s,
      active: false,
      dirty: false,
      saving: false,
      limitError: null,
      saveError: null,
      canUndo: false,
      selection: null,
    }))
  }, [canvasRef, exitScene, resetHistory, state.dirty, syncFurnitureOrder])

  const save = useCallback(async () => {
    if (!documentRef.current || savingRef.current) return
    // Remove tilesets órfãos (ex.: sobras de tile size antigo) antes de salvar,
    // senão a publicação falha com TILESET_TILE_SIZE_MISMATCH.
    const doc = pruneUnusedTilesets(documentRef.current)
    // Bloqueia a entrada de edição enquanto o save está em voo (review C4 —
    // Important 2) — ver comentário na declaração de `savingRef` e nos
    // callbacks de `setEditing` acima.
    savingRef.current = true
    // Limpa qualquer falha da tentativa anterior no INÍCIO desta — se der
    // certo desta vez, o aviso não pode ficar pendurado na tela.
    setState((s) => ({ ...s, saving: true, saveError: null }))
    try {
      // Task 9: um único round-trip — o servidor mescla `doc` com o documento
      // corrente a partir de `baseRevisionRef` e grava o resultado. Sem lock
      // exclusivo, não há mais o par persistir-rascunho/publicar-rascunho,
      // então não há mais a distinção "persistiu mas não publicou" do fluxo
      // anterior.
      const result = await api.mergePublish({
        baseRevision: baseRevisionRef.current,
        basePublicationId: basePublicationIdRef.current,
        document: doc,
      })
      // Re-ancora na revisão mesclada: o `applyMap` pós-refetch (broadcast do
      // próprio save) renderiza o documento de todos; `documentRef`/
      // `baseDocRef` passam a ser o merged devolvido pelo servidor — não mais
      // necessariamente o `doc` que este `save()` mandou, já que o merge pode
      // ter incorporado edições de outra sessão.
      baseRevisionRef.current = result.decorRevision
      documentRef.current = result.document
      baseDocRef.current = result.document
      resetHistory()
      setState((s) => ({ ...s, dirty: false, saving: false, canUndo: false, limitError: null }))
      // Salvar limpa a seleção ativa: a sessão de edição continua aberta (a
      // ferramenta e o drawer seguem de pé — é o "salvar sem fechar"), mas
      // manter o retângulo azul e a barra flutuante depois do save lê como
      // estado preso ("salvei, por que ainda está selecionado?").
      clearSelection()
    } catch (error) {
      // Não relança: o único chamador (`OfficeEditDrawer`) dispara com
      // `void save()` — uma rejeição não capturada aqui vira uma unhandled
      // rejection, e o usuário nunca fica sabendo que o salvamento falhou
      // (Task 11b). Em vez disso, guarda uma mensagem pt-BR em `saveError`
      // para o drawer exibir. Erros da API (`ApiError`) já trazem mensagem do
      // servidor em pt-BR (ex.: "Alterações estruturais não são permitidas",
      // "O mapa possui erros e não pode ser publicado"); qualquer outro erro
      // (rede, timeout) cai no genérico.
      setState((s) => ({
        ...s,
        saving: false,
        saveError: error instanceof ApiError ? error.message : GENERIC_SAVE_ERROR,
      }))
    } finally {
      savingRef.current = false
    }
  }, [resetHistory, clearSelection])

  // Cleanup de unmount: se o componente for desmontado com uma edição em
  // andamento, sai do modo de edição da cena. Sem lock exclusivo (Task 9) não
  // há mais nada a liberar no servidor.
  useEffect(() => {
    return () => {
      canvasRef.current?.getScene()?.setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ctrl/Cmd+Z desfaz — só enquanto a edição está ativa, para não sequestrar o
  // atalho no resto do escritório. Ignora quando o foco está num campo de
  // texto (o desfazer nativo do input tem precedência).
  useEffect(() => {
    if (!state.active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      void undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.active, undo])

  // Atalhos da seleção: R gira horário, Shift+R anti-horário, H/V espelham,
  // Del/Backspace apaga, Esc limpa. Só com seleção ativa, e nunca sobre um
  // campo de texto (a paleta e o drawer têm inputs).
  useEffect(() => {
    if (!state.active || !state.selection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === 'escape') {
        event.preventDefault()
        clearSelection()
        return
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault()
        deleteSelection()
        return
      }
      if (key === 'r') {
        // Uma peça agarrada (arraste em curso) tem seu próprio efeito de R
        // logo abaixo, que gira o grupo do `furnitureDragRef` no MESMO passo
        // de desfazer do arraste. `state.selection` aqui ainda aponta para a
        // seleção ANTERIOR (só é atualizada no solto) — sem este guard, as
        // duas teclas de atalho disparariam ao mesmo tempo e girariam a peça
        // errada.
        if (furnitureDragRef.current) return
        event.preventDefault()
        void rotateSelection(event.shiftKey ? 'ccw' : 'cw')
        return
      }
      if (key === 'h') {
        event.preventDefault()
        void flipSelection('horizontal')
        return
      }
      if (key === 'v') {
        event.preventDefault()
        void flipSelection('vertical')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.active, state.selection, clearSelection, rotateSelection, flipSelection, deleteSelection])

  // R/Shift+R durante o arraste de mobília LIVRE (review PR 10555 — item 1):
  // mesmo par de teclas da ferramenta "Girar" acima, mas para o grupo em
  // `furnitureDragRef` — não há seleção retangular nesse fluxo, então não dá
  // pra reaproveitar o efeito acima (que exige `state.selection`). Checa o
  // ref a cada tecla (em vez de depender de estado) porque o gesto de
  // arraste não passa por `setState` a cada pointermove.
  useEffect(() => {
    if (!state.active || state.tool !== 'brush') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() !== 'r') return
      if (!furnitureDragRef.current) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      rotateHeldFurniture(event.shiftKey ? 'ccw' : 'cw')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.active, state.tool, rotateHeldFurniture])

  // Esc solta o asset escolhido na paleta (review PR 10555 — item "voltar ao
  // cursor normal"): só quando não há também uma seleção retangular ativa —
  // nesse caso o efeito acima já trata o Esc (limpa a seleção, prioridade que
  // já existia antes desta task).
  useEffect(() => {
    if (!state.active || state.tool !== 'brush' || !state.selectedTile || state.selection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      clearSelectedTile()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.active, state.tool, state.selectedTile, state.selection, clearSelectedTile])

  const setTool = useCallback(
    (tool: EditTool) => {
      toolRef.current = tool
      const scene = canvasRef.current?.getScene()
      scene?.setEditMode(editModeForTool(tool))
      // Preview do arraste: vermelho na borracha e na área de silêncio, verde nas demais.
      scene?.setRectPreviewColor(tool === 'eraser' || tool === 'silence-zone' ? 0xff5d5d : 0x7de3a0)
      // Realce da borracha é por ferramenta: sem limpar, o retângulo da peça
      // sob o cursor ficava aceso depois de trocar para o pincel.
      scene?.setEraseHover(null)
      // Fantasma de colocação: só no pincel com tile escolhido; some no resto.
      void updatePlacementPreview()
      setState((s) => ({ ...s, tool }))
    },
    [canvasRef, updatePlacementPreview],
  )

  const selectTile = useCallback(
    (pick: SelectedTileRegion) => {
      selectedTileRef.current = pick
      toolRef.current = 'brush'
      canvasRef.current?.getScene()?.setEditMode('object')
      void updatePlacementPreview()
      setState((s) => ({ ...s, selectedTile: pick, tool: 'brush' }))
    },
    [canvasRef, updatePlacementPreview],
  )

  /**
   * "Limpar tudo": remove só a mobília adicionada NESTA sessão (ainda não
   * salva) — num único passo de desfazer. A mobília JÁ PUBLICADA (o que você
   * salvou antes) permanece: apagar o escritório inteiro seria destrutivo e
   * surpreendente. Para tirar uma peça publicada, use a borracha. Não toca em
   * áreas/zonas/spawn/paredes.
   *
   * `!isProtectedFromActor(o)` (Task 5): peça desta sessão nunca está na base
   * publicada, então nunca é protegida por definição — o filtro é hoje um
   * no-op na prática, mas deixa a regra "tile-object protegido nunca sai por
   * aqui" explícita no código, e não só um efeito colateral do escopo
   * "só sessão" acima.
   */
  const clearAllFurniture = useCallback(() => {
    const scene = canvasRef.current?.getScene()
    const doc = documentRef.current
    if (!scene || !doc) return
    const publishedIds = new Set(baseDocRef.current?.objects.map((o) => o.id) ?? [])
    const sessionFurniture = doc.objects.filter(
      (o): o is TileObjectV1 => o.type === 'tile-object' && !publishedIds.has(o.id) && !isProtectedFromActor(o),
    )
    if (sessionFurniture.length === 0) return
    // A colisão pareada (se houver) desta sessão sai junto — senão "Limpar
    // tudo" some com a mobília mas deixa um retângulo de colisão fantasma
    // bloqueando o lugar onde ela estava.
    const sessionGroupKeys = new Set(sessionFurniture.map((o) => groupKeyOf(o.id)))
    const sessionCollisions = doc.objects.filter(
      (o) => o.type === 'collision' && !publishedIds.has(o.id) && sessionGroupKeys.has(groupKeyOf(o.id)),
    )
    const removeSet = new Set<MapObjectV1>([...sessionFurniture, ...sessionCollisions])
    beginOp()
    documentRef.current = { ...doc, objects: doc.objects.filter((o) => !removeSet.has(o)) }
    for (const object of sessionFurniture) scene.removeTileObjectStamp(object.id)
    commitOp()
    setState((s) => ({ ...s, dirty: true }))
  }, [canvasRef, beginOp, commitOp, isProtectedFromActor])

  return {
    state,
    enter,
    cancel,
    save,
    undo,
    setTool,
    selectTile,
    clearSelectedTile,
    clearAllFurniture,
    selectGroup,
    clearSelection,
    rotateSelection,
    flipSelection,
    reorderSelection,
    removeSelectionCollision,
  }
}
