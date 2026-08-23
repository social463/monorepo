import {
  MAP_DOCUMENT_V1_LIMITS,
  MapDocumentV1StructuralSchema,
  MapTileSizeSchema,
  RESERVED_MAP_LAYERS,
  validateMapDocumentV1,
  builtinTilesetAsset,
  builtinAssetToDTO,
  isBuiltinTilesetAssetId,
  type MapDocumentV1,
  type MapLayerV1,
  type MapObjectV1,
  type MapTileSize,
  type MapValidationError,
} from "@legends/shared";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../auth/AuthContext";
import "./editor.css";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MapCanvas, type MapEditorTool } from "./MapCanvas";
import TilesetPalette, {
  useTileRegionDrag,
  type TileRegion,
} from "./TilesetPalette";
import {
  clearRect,
  pasteClip,
  readClip,
  type TileClip,
  type TileRect,
} from "./tileRegion";
import { pruneUnusedTilesets } from "../editing/decorationDoc";
import {
  layersTopFirst,
  moveLayerOneStep,
  nextVisualLayerZIndex,
} from "./layerOrder";

type Session = {
  accessToken: string;
  user: { id: string; name: string };
};

type DraftResponse = {
  map: { id: string; name: string };
  revision: number;
  document: MapDocumentV1;
  savedAt: string;
  updatedBy?: { id: string; name: string };
};

type LockResponse = {
  lockToken: string;
  expiresAt: string;
  owner: { id: string; name: string };
};

type MapAsset = {
  id: string;
  fileName: string;
  mimeType: "image/png" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  url: string;
};

type Publication = {
  id: string;
  version: number;
  schemaVersion: string;
  createdAt: string;
  active: boolean;
  createdBy?: { id: string; name: string } | null;
};

type SaveResponse = {
  revision: number;
  savedAt: string;
  validationSummary: { valid: boolean; errorCount: number };
};

type ValidationResponse = {
  valid: boolean;
  errors: ValidationIssue[];
};

type ValidationIssue = Omit<MapValidationError, "code"> & { code: string };

type HistoryEntry = {
  description: string;
  document: MapDocumentV1;
};

type PanelTab = "tilesets" | "layers" | "properties" | "validation";
type SaveState = "saved" | "saving" | "error";

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  _token?: string,
) {
  return apiFetch<T>(`/${path}`, options);
}

function cloneDocument(document: MapDocumentV1) {
  return structuredClone(document);
}

function uniqueId(prefix: string, existing: Iterable<string>) {
  const values = new Set(existing);
  let candidate = `${prefix}-${Date.now().toString(36)}`;
  let suffix = 2;
  while (values.has(candidate)) {
    candidate = `${prefix}-${Date.now().toString(36)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** Seleção na paleta: tile-âncora e o tamanho do bloco a carimbar. */
interface SelectedTile {
  index: number;
  cols: number;
  rows: number;
}

function isFormControl(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

const tools: Array<{
  tool: MapEditorTool;
  icon: string;
  label: string;
  description: string;
  dividerBefore?: boolean;
}> = [
  {
    tool: "select",
    icon: "↖",
    label: "Selecionar (V)",
    description: "Seleciona e edita objetos do mapa.",
  },
  {
    tool: "free-select",
    icon: "⤢",
    label: "Selecionar livre (G)",
    description: "Transforma um tile pintado em objeto e o arrasta sem grade.",
  },
  {
    tool: "area-select",
    icon: "▭",
    label: "Selecionar área (R)",
    description:
      "Marca um retângulo de tiles pintados para arrastar, copiar (Ctrl+C/V) ou apagar (Delete).",
  },
  {
    tool: "hand",
    icon: "✋",
    label: "Mover câmera (H)",
    description: "Arrasta a visualização sem alterar o mapa.",
  },
  {
    tool: "brush",
    icon: "✎",
    label: "Pincel (B)",
    description: "Pinta tiles na camada ativa.",
    dividerBefore: true,
  },
  {
    tool: "eraser",
    icon: "◇",
    label: "Borracha (E)",
    description: "Apaga tiles da camada ativa.",
  },
  {
    tool: "fill",
    icon: "▨",
    label: "Preencher (F)",
    description: "Preenche uma área contínua com o tile selecionado.",
  },
  {
    tool: "eyedropper",
    icon: "⌁",
    label: "Conta-gotas (I)",
    description: "Copia um tile existente do mapa.",
  },
  {
    tool: "collision",
    icon: "▧",
    label: "Colisão",
    description: "Define áreas que bloqueiam a movimentação.",
    dividerBefore: true,
  },
  {
    tool: "spawn",
    icon: "⌖",
    label: "Ponto de spawn",
    description: "Define onde os usuários entram no mapa.",
  },
  {
    tool: "private-zone",
    icon: "⬡",
    label: "Zona privada",
    description: "Cria uma área de acesso restrito.",
  },
  {
    tool: "meeting-room",
    icon: "▣",
    label: "Sala de reunião",
    description: "Delimita uma sala para reuniões.",
  },
  {
    tool: "desk",
    icon: "▭",
    label: "Mesa",
    description: "Mesa de 3×2 tiles com sala de chamada própria.",
  },
  {
    tool: "door",
    icon: "▯",
    label: "Porta",
    description: "Adiciona uma passagem entre ambientes.",
    dividerBefore: true,
  },
  {
    tool: "link",
    icon: "↗",
    label: "Link HTTPS",
    description: "Cria uma área que abre um endereço externo.",
  },
  {
    tool: "action-point",
    icon: "⚡",
    label: "Ponto de ação",
    description: "Adiciona um ponto interativo ao mapa.",
  },
];

type ToolDefinition = (typeof tools)[number];

function MapEditorToolButton({
  active,
  disabled,
  item,
  onSelect,
}: {
  active: boolean;
  disabled: boolean;
  item: ToolDefinition;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipTop, setTooltipTop] = useState(0);
  const tooltipId = `map-editor-tool-${item.tool}-tooltip`;

  function positionTooltip() {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (bounds) setTooltipTop(bounds.top + bounds.height / 2);
  }

  return (
    <div>
      {item.dividerBefore && <div className="map-editor-tool-divider" />}
      <div
        className="map-editor-tool-slot"
        onFocus={positionTooltip}
        onMouseEnter={positionTooltip}
      >
        <button
          ref={buttonRef}
          aria-describedby={tooltipId}
          aria-label={item.label}
          className={`map-editor-tool ${active ? "active" : ""}`}
          disabled={disabled}
          onClick={onSelect}
        >
          {item.icon}
        </button>
        <span
          className="map-editor-tool-tooltip"
          id={tooltipId}
          role="tooltip"
          style={{ top: tooltipTop }}
        >
          <strong>{item.label}</strong>
          <small>{item.description}</small>
        </span>
      </div>
    </div>
  );
}

export function MapEditor({ mapId }: { mapId: string }) {
  const { user: authUser } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [document, setDocument] = useState<MapDocumentV1 | null>(null);
  const [revision, setRevision] = useState(0);
  const [mapName, setMapName] = useState("Mapa");
  const [savedMapName, setSavedMapName] = useState("Mapa");
  const [savedAt, setSavedAt] = useState("");
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [lock, setLock] = useState<LockResponse | null>(null);
  const [lockOwner, setLockOwner] = useState<LockResponse["owner"] | null>(
    null,
  );
  const [readOnly, setReadOnly] = useState(false);
  const [narrowScreen, setNarrowScreen] = useState(
    () => window.innerWidth < 1024,
  );
  const [booting, setBooting] = useState(true);
  const [fatalError, setFatalError] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [tool, setTool] = useState<MapEditorTool>("select");
  const [panel, setPanel] = useState<PanelTab>(() =>
    window.location.hash === "#validation" || window.location.hash === "#publication"
      ? "validation"
      : "layers",
  );
  const [activeLayerKey, setActiveLayerKey] = useState("floor");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedTilesetId, setSelectedTilesetId] = useState<string | null>(
    null,
  );
  // Tile da paleta: índice da âncora + tamanho do bloco arrastado (`cols×rows`).
  const [selectedTile, setSelectedTile] = useState<SelectedTile>({
    index: 0,
    cols: 1,
    rows: 1,
  });
  const [tileSelection, setTileSelection] = useState<TileRect | null>(null);
  const [tileClipboard, setTileClipboard] = useState<TileClip | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationIssue[]>(
    [],
  );
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0, tileX: 0, tileY: 0 });
  const [zoom, setZoom] = useState(1);
  const importInput = useRef<HTMLInputElement>(null);
  const documentRef = useRef<MapDocumentV1 | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const lockRef = useRef<LockResponse | null>(null);
  const bootstrappedRef = useRef(false);
  const saveInFlightRef = useRef<Promise<number> | null>(null);
  const lastCommitRef = useRef({ description: "", at: 0 });

  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    lockRef.current = lock;
  }, [lock]);

  const loadEditor = useCallback(async () => {
    setBooting(true);
    setFatalError("");
    try {
      if (!authUser || authUser.role !== "ADMIN") {
        throw new Error("Acesso restrito a administradores.");
      }
      const auth: Session = {
        accessToken: "",
        user: { id: authUser.id, name: authUser.name },
      };
      setSession(auth);

      let acquiredLock: LockResponse | null = null;
      if (!narrowScreen) {
        try {
          acquiredLock = await apiRequest<LockResponse>(
            `admin/office-maps/${mapId}/lock`,
            { method: "POST" },
            auth.accessToken,
          );
          setLock(acquiredLock);
          setLockOwner(null);
          setReadOnly(false);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 423) {
            const owner = cause.payload?.owner;
            if (owner && typeof owner === "object") {
              const ownerRecord = owner as Record<string, unknown>;
              setLockOwner({
                id: String(ownerRecord.id ?? ""),
                name: String(ownerRecord.name ?? "Outro administrador"),
              });
            }
            setReadOnly(true);
          } else {
            throw cause;
          }
        }
      } else {
        setReadOnly(true);
      }

      const [draft, assetList, publicationList] = await Promise.all([
        apiRequest<DraftResponse>(`admin/office-maps/${mapId}/draft`, {}, auth.accessToken),
        apiRequest<MapAsset[]>(`admin/office-maps/${mapId}/assets`, {}, auth.accessToken),
        apiRequest<Publication[]>(
          `admin/office-maps/${mapId}/publications`,
          {},
          auth.accessToken,
        ),
      ]);
      const recoveryKey = `map-draft-recovery:${mapId}`;
      const recovery = localStorage.getItem(recoveryKey);
      let initialDocument = draft.document;
      if (recovery) {
        try {
          const recovered = JSON.parse(recovery) as unknown;
          const parsed = MapDocumentV1StructuralSchema.safeParse(recovered);
          if (
            parsed.success &&
            JSON.stringify(parsed.data) !==
              JSON.stringify(draft.document) &&
            confirm(
              "Encontramos alterações locais que não haviam sido confirmadas. Deseja recuperá-las?",
            )
          ) {
            initialDocument = parsed.data;
            setDirty(true);
          }
        } catch {
          localStorage.removeItem(recoveryKey);
        }
      }
      setDocument(initialDocument);
      setRevision(draft.revision);
      setMapName(draft.map.name);
      setSavedMapName(draft.map.name);
      setSavedAt(draft.savedAt);
      setAssets(assetList);
      setPublications(publicationList);
      setSelectedTilesetId(initialDocument.tilesets[0]?.id ?? null);
      documentRef.current = initialDocument;
      revisionRef.current = draft.revision;
      lockRef.current = acquiredLock;
    } catch (cause) {
      setFatalError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir o editor.",
      );
    } finally {
      setBooting(false);
    }
  }, [authUser, mapId, narrowScreen]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void loadEditor();
  }, [loadEditor]);

  useEffect(() => {
    const update = () => setNarrowScreen(window.innerWidth < 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!narrowScreen && !booting && session && !lock && !lockOwner) {
      void acquireLock();
    }
  }, [booting, lock, lockOwner, narrowScreen, session]);

  const commitDocument = useCallback(
    (next: MapDocumentV1, description = "Alterar mapa") => {
      if (readOnly || narrowScreen) return;
      setDocument((current) => {
        if (!current || current === next) return current;
        const now = Date.now();
        const coalesced =
          lastCommitRef.current.description === description &&
          now - lastCommitRef.current.at < 450;
        if (!coalesced) {
          setPast((entries) =>
            [
              ...entries,
              { description, document: cloneDocument(current) },
            ].slice(-MAP_DOCUMENT_V1_LIMITS.maxUndoOperations),
          );
        }
        lastCommitRef.current = { description, at: now };
        setFuture([]);
        setDirty(true);
        setSaveState("saving");
        documentRef.current = next;
        return next;
      });
    },
    [narrowScreen, readOnly],
  );

  const undo = useCallback(() => {
    if (readOnly || narrowScreen || !document) return;
    const previous = past.at(-1);
    if (!previous) return;
    setPast((entries) => entries.slice(0, -1));
    setFuture((entries) => [
      { description: "Refazer alteração", document: cloneDocument(document) },
      ...entries,
    ]);
    setDocument(previous.document);
    documentRef.current = previous.document;
    lastCommitRef.current = { description: "", at: 0 };
    setDirty(true);
    setSaveState("saving");
  }, [document, narrowScreen, past, readOnly]);

  const redo = useCallback(() => {
    if (readOnly || narrowScreen || !document) return;
    const next = future[0];
    if (!next) return;
    setFuture((entries) => entries.slice(1));
    setPast((entries) => [
      ...entries,
      { description: "Desfazer alteração", document: cloneDocument(document) },
    ]);
    setDocument(next.document);
    documentRef.current = next.document;
    lastCommitRef.current = { description: "", at: 0 };
    setDirty(true);
    setSaveState("saving");
  }, [document, future, narrowScreen, readOnly]);

  const saveDraft = useCallback(() => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const operation = (async () => {
      const current = documentRef.current;
      const currentLock = lockRef.current;
      if (!current || !currentLock || !dirtyRef.current || readOnly) {
        return revisionRef.current;
      }
      const serialized = JSON.stringify(current);
      setSaveState("saving");
      setError("");
      try {
        const result = await apiRequest<SaveResponse>(
          `admin/office-maps/${mapId}/draft`,
          {
            method: "PUT",
            headers: { "X-Map-Lock-Token": currentLock.lockToken },
            body: JSON.stringify({
              revision: revisionRef.current,
              document: current,
            }),
          },
          session?.accessToken,
        );
        setRevision(result.revision);
        revisionRef.current = result.revision;
        setSavedAt(result.savedAt);
        if (JSON.stringify(documentRef.current) === serialized) {
          setDirty(false);
          dirtyRef.current = false;
          localStorage.removeItem(`map-draft-recovery:${mapId}`);
          setSaveState("saved");
        } else {
          window.setTimeout(
            () => void saveDraft().catch(() => undefined),
            0,
          );
        }
        return result.revision;
      } catch (cause) {
        setSaveState("error");
        if (cause instanceof ApiError && cause.status === 409) {
          setConflict(true);
          setError(
            "O rascunho mudou no servidor. Suas alterações locais foram preservadas.",
          );
        } else if (cause instanceof ApiError && cause.status === 423) {
          setReadOnly(true);
          setError(
            "O lock de edição expirou. O mapa está em modo somente leitura.",
          );
        } else {
          setError(cause instanceof Error ? cause.message : "Falha ao salvar.");
        }
        throw cause;
      }
    })();
    saveInFlightRef.current = operation;
    const clearInFlight = () => {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
    };
    void operation.then(clearInFlight, clearInFlight);
    return operation;
  }, [mapId, readOnly, session?.accessToken]);

  useEffect(() => {
    if (!dirty || readOnly || !document) return;
    const recoveryTimeout = window.setTimeout(() => {
      localStorage.setItem(
        `map-draft-recovery:${mapId}`,
        JSON.stringify(document),
      );
    }, 400);
    const saveTimeout = window.setTimeout(
      () => void saveDraft().catch(() => undefined),
      2_000,
    );
    return () => {
      window.clearTimeout(recoveryTimeout);
      window.clearTimeout(saveTimeout);
    };
  }, [dirty, document, mapId, readOnly, saveDraft]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (dirtyRef.current) void saveDraft().catch(() => undefined);
    }, MAP_DOCUMENT_V1_LIMITS.autosaveForceIntervalMs);
    return () => window.clearInterval(interval);
  }, [saveDraft]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, []);

  useEffect(() => {
    if (!lock || !session) return;
    const heartbeat = window.setInterval(async () => {
      const currentLock = lockRef.current;
      if (!currentLock) return;
      try {
        const renewed = await apiRequest<LockResponse>(
          `admin/office-maps/${mapId}/lock/heartbeat`,
          {
            method: "POST",
            headers: { "X-Map-Lock-Token": currentLock.lockToken },
          },
          session.accessToken,
        );
        setLock({ ...currentLock, expiresAt: renewed.expiresAt });
      } catch {
        setReadOnly(true);
        setError("O lock expirou; as alterações locais continuam disponíveis.");
      }
    }, MAP_DOCUMENT_V1_LIMITS.editLockHeartbeatMs);
    return () => window.clearInterval(heartbeat);
  }, [lock, mapId, session]);

  useEffect(() => {
    return () => {
      const currentLock = lockRef.current;
      if (!currentLock || !session) return;
      void apiRequest(`admin/office-maps/${mapId}/lock`, {
        method: "DELETE",
        headers: {
          "X-Map-Lock-Token": currentLock.lockToken,
        },
      });
    };
  }, [mapId, session]);

  const deleteSelected = useCallback(() => {
    if (!document || !selectedObjectId || readOnly) return;
    const next = cloneDocument(document);
    next.objects = next.objects.filter((item) => item.id !== selectedObjectId);
    commitDocument(next, "Excluir objeto");
    setSelectedObjectId(null);
  }, [commitDocument, document, readOnly, selectedObjectId]);

  /**
   * Layer de tiles onde a seleção de área age: a ativa, se der para editar.
   * Devolve a layer de `target` (uma cópia), pronta para receber `data`.
   */
  const editableTileLayer = useCallback(
    (target: MapDocumentV1) => {
      if (readOnly) return null;
      const layer = target.layers.find(({ key }) => key === activeLayerKey);
      if (layer?.type !== "tile" || layer.locked || !layer.visible) return null;
      return layer;
    },
    [activeLayerKey, readOnly],
  );

  const tileGrid = useMemo(
    () =>
      document
        ? { width: document.map.width, height: document.map.height }
        : null,
    [document],
  );

  const copyTileSelection = useCallback(() => {
    if (!document || !tileGrid || !tileSelection) return;
    const layer = document.layers.find(({ key }) => key === activeLayerKey);
    if (layer?.type !== "tile") return;
    setTileClipboard(readClip(layer.data, tileGrid, tileSelection));
  }, [activeLayerKey, document, tileGrid, tileSelection]);

  const eraseTileSelection = useCallback(() => {
    if (!document || !tileGrid || !tileSelection) return;
    const next = cloneDocument(document);
    const layer = editableTileLayer(next);
    if (!layer) return;
    const cleared = clearRect(layer.data, tileGrid, tileSelection);
    if (!cleared) return;
    layer.data = cleared;
    commitDocument(next, "Apagar tiles");
  }, [commitDocument, document, editableTileLayer, tileGrid, tileSelection]);

  /** Cola o recorte com o canto superior esquerdo na célula sob o cursor. */
  const pasteTileClipboard = useCallback(() => {
    if (!document || !tileGrid || !tileClipboard) return;
    const next = cloneDocument(document);
    const layer = editableTileLayer(next);
    if (!layer) return;
    const target = { column: cursor.tileX, row: cursor.tileY };
    const pasted = pasteClip(layer.data, tileGrid, target, tileClipboard);
    if (!pasted) return;
    layer.data = pasted;
    commitDocument(next, "Colar tiles");
    setTileSelection({
      ...target,
      cols: tileClipboard.cols,
      rows: tileClipboard.rows,
    });
  }, [
    commitDocument,
    cursor.tileX,
    cursor.tileY,
    document,
    editableTileLayer,
    tileClipboard,
    tileGrid,
  ]);

  // Trocar de ferramenta larga a seleção de área: ela só existe (e só é
  // desenhada) enquanto a ferramenta está ativa.
  useEffect(() => {
    if (tool !== "area-select") setTileSelection(null);
  }, [tool]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDraft().catch(() => undefined);
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        command &&
        event.key.toLowerCase() === "c" &&
        tileSelection &&
        !isFormControl(event.target)
      ) {
        event.preventDefault();
        copyTileSelection();
      } else if (
        command &&
        event.key.toLowerCase() === "x" &&
        tileSelection &&
        !isFormControl(event.target)
      ) {
        event.preventDefault();
        copyTileSelection();
        eraseTileSelection();
      } else if (
        command &&
        event.key.toLowerCase() === "v" &&
        tileClipboard &&
        !isFormControl(event.target)
      ) {
        event.preventDefault();
        pasteTileClipboard();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !isFormControl(event.target)
      ) {
        event.preventDefault();
        // Com área de tiles marcada o Delete apaga os tiles; senão, o objeto.
        if (tileSelection) eraseTileSelection();
        else deleteSelected();
      } else if (event.key === "Escape") {
        setPreview(false);
        setTileSelection(null);
      } else if (!command && !isFormControl(event.target)) {
        const shortcutTools: Partial<Record<string, MapEditorTool>> = {
          v: "select",
          g: "free-select",
          r: "area-select",
          h: "hand",
          b: "brush",
          e: "eraser",
          f: "fill",
          i: "eyedropper",
        };
        const shortcutTool = shortcutTools[event.key.toLowerCase()];
        if (shortcutTool) setTool(shortcutTool);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [
    copyTileSelection,
    deleteSelected,
    eraseTileSelection,
    pasteTileClipboard,
    redo,
    saveDraft,
    tileClipboard,
    tileSelection,
    undo,
  ]);

  async function validateDraft() {
    if (!document) return false;
    setValidating(true);
    setError("");
    const local = validateMapDocumentV1(document);
    if (!local.valid) {
      setValidationErrors(local.errors);
      setPanel("validation");
    }
    try {
      let savedRevision = await saveDraft();
      for (let attempt = 0; dirtyRef.current && attempt < 4; attempt += 1) {
        savedRevision = await saveDraft();
      }
      if (dirtyRef.current) {
        setError(
          "O mapa continua recebendo alterações. Aguarde o salvamento concluir e valide novamente.",
        );
        return false;
      }
      const result = await apiRequest<ValidationResponse>(
        `admin/office-maps/${mapId}/validate`,
        {
          method: "POST",
          body: JSON.stringify({ revision: savedRevision }),
        },
        session?.accessToken,
      );
      setValidationErrors(result.errors);
      setPanel("validation");
      return result.valid;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao validar.");
      return false;
    } finally {
      setValidating(false);
    }
  }

  async function publishDraft() {
    setPublishing(true);
    try {
      const valid = await validateDraft();
      if (!valid) return;
      const result = await apiRequest<{
        publication: Publication;
        version: number;
        roomsCreated: number;
        activated: boolean;
        document?: MapDocumentV1;
      }>(
        `admin/office-maps/${mapId}/publications`,
        {
          method: "POST",
          body: JSON.stringify({
            revision: revisionRef.current,
            activate: true,
          }),
        },
        session?.accessToken,
      );
      // O servidor mescla o rascunho com o que foi decorado pelo mapa durante
      // a sessão, então o publicado não é necessariamente o que este editor
      // mandou. Adotar o resultado é o que impede o próximo autosave daqui de
      // reescrever o rascunho sem a decoração que o merge acabou de trazer.
      if (result.document) {
        setDocument(result.document);
        documentRef.current = result.document;
        setDirty(false);
        dirtyRef.current = false;
      }
      setPublications((items) => [
        { ...result.publication, active: result.activated },
        ...items.map((item) => ({ ...item, active: false })),
      ]);
      setError("");
      alert(
        `Versão ${result.version} publicada com ${result.roomsCreated} sala(s) e ativada.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao publicar.");
    } finally {
      setPublishing(false);
    }
  }

  async function acquireLock() {
    if (!session) return;
    try {
      const nextLock = await apiRequest<LockResponse>(
        `admin/office-maps/${mapId}/lock`,
        { method: "POST" },
        session.accessToken,
      );
      setLock(nextLock);
      lockRef.current = nextLock;
      setLockOwner(null);
      setReadOnly(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lock indisponível.");
    }
  }

  async function reloadServerDraft() {
    if (
      !session ||
      !confirm("Descartar as alterações locais e recarregar o servidor?")
    ) {
      return;
    }
    try {
      const draft = await apiRequest<DraftResponse>(
        `admin/office-maps/${mapId}/draft`,
        {},
        session.accessToken,
      );
      setDocument(draft.document);
      documentRef.current = draft.document;
      setRevision(draft.revision);
      revisionRef.current = draft.revision;
      setDirty(false);
      dirtyRef.current = false;
      setPast([]);
      setFuture([]);
      setConflict(false);
      setSaveState("saved");
      localStorage.removeItem(`map-draft-recovery:${mapId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao recarregar.");
    }
  }

  async function saveName() {
    const normalized = mapName.trim();
    if (!session || normalized.length < 2 || normalized === savedMapName) {
      setMapName(savedMapName);
      return;
    }
    try {
      await apiRequest(
        `admin/office-maps/${mapId}`,
        { method: "PATCH", body: JSON.stringify({ name: normalized }) },
        session.accessToken,
      );
      setMapName(normalized);
      setSavedMapName(normalized);
    } catch (cause) {
      setMapName(savedMapName);
      setError(cause instanceof Error ? cause.message : "Falha ao renomear.");
    }
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !session || !document) return;
    if (file.size > MAP_DOCUMENT_V1_LIMITS.maxAssetBytes) {
      setError("O asset deve ter no máximo 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const asset = await apiRequest<MapAsset>(
        `admin/office-maps/${mapId}/assets`,
        { method: "POST", body: data },
        session.accessToken,
      );
      setAssets((items) => [
        asset,
        ...items.filter((item) => item.id !== asset.id),
      ]);
      const columns = Math.floor(asset.width / document.map.tileWidth);
      const rows = Math.floor(asset.height / document.map.tileHeight);
      if (columns < 1 || rows < 1) {
        setError("A imagem é menor que um tile deste mapa.");
        return;
      }
      const next = cloneDocument(document);
      const existing = next.tilesets.find((item) => item.assetId === asset.id);
      let tilesetId = existing?.id;
      if (!existing) {
        tilesetId = uniqueId(
          `tileset-${file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "-")}`,
          next.tilesets.map((item) => item.id),
        );
        next.tilesets.push({
          id: tilesetId,
          assetId: asset.id,
          name: file.name.replace(/\.[^.]+$/, ""),
          tileWidth: next.map.tileWidth,
          tileHeight: next.map.tileHeight,
          columns,
          tileCount: columns * rows,
        });
        commitDocument(next, "Importar tileset");
      }
      setSelectedTilesetId(tilesetId ?? null);
      setSelectedTile({ index: 0, cols: 1, rows: 1 });
      setPanel("tilesets");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function removeAsset(asset: MapAsset) {
    if (!session || !document || !confirm(`Excluir ${asset.fileName}?`)) return;
    const builtin = isBuiltinTilesetAssetId(asset.id);
    try {
      if (!builtin) {
        await apiRequest(
          `admin/office-maps/${mapId}/assets/${asset.id}`,
          { method: "DELETE" },
          session.accessToken,
        );
      }
      const removedTilesets = new Set(
        document.tilesets
          .filter((item) => item.assetId === asset.id)
          .map((item) => item.id),
      );
      const next = cloneDocument(document);
      next.tilesets = next.tilesets.filter((item) => item.assetId !== asset.id);
      next.layers = next.layers.map((layer) => {
        if (layer.type !== "tile") return layer;
        return {
          ...layer,
          data: layer.data.map((cell) =>
            cell && removedTilesets.has(cell.split(":")[0] ?? "") ? null : cell,
          ),
        };
      });
      next.objects = next.objects.filter(
        (object) =>
          object.type !== "tile-object" ||
          !removedTilesets.has(object.properties.tilesetId),
      );
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      if (selectedTilesetId && removedTilesets.has(selectedTilesetId)) {
        setSelectedTilesetId(null);
      }
      commitDocument(next, "Excluir tileset");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao excluir asset.",
      );
    }
  }

  function ensureBuiltinTileset(assetId: string): string | null {
    if (!document) return null;
    const builtin = builtinTilesetAsset(assetId);
    if (!builtin) return null;
    const parsedTileWidth = MapTileSizeSchema.safeParse(builtin.tileWidth);
    const parsedTileHeight = MapTileSizeSchema.safeParse(builtin.tileHeight);
    if (!parsedTileWidth.success || !parsedTileHeight.success) return null;
    // 1) injeta o asset builtin sintético em `assets` para o canvas resolver a URL
    setAssets((items) =>
      items.some((item) => item.id === assetId)
        ? items
        : [builtinAssetToDTO(builtin) as MapAsset, ...items],
    );
    // 2) garante o tileset no documento (via clone/commit, padrão do editor)
    const existing = document.tilesets.find((t) => t.assetId === assetId);
    if (existing) return existing.id;
    const tilesetId = uniqueId(
      `builtin-${assetId.split("/").pop()}`,
      document.tilesets.map((t) => t.id),
    );
    const next = cloneDocument(document);
    next.tilesets.push({
      id: tilesetId,
      assetId,
      name: builtin.name,
      tileWidth: parsedTileWidth.data,
      tileHeight: parsedTileHeight.data,
      columns: builtin.columns,
      tileCount: builtin.tileCount,
    });
    // Só folhear a paleta já grava um tileset por escolha, e o documento aceita
    // no máximo `maxTilesets` — sem podar os builtins que ninguém pintou, a
    // escolha seguinte ao teto faz todo autosave morrer em 422
    // MAP_DOCUMENT_INVALID.
    commitDocument(
      pruneUnusedTilesets(next, { keep: [tilesetId], onlyBuiltin: true }),
      "Adicionar tileset padrão",
    );
    return tilesetId;
  }

  function exportDocument() {
    if (!document) return;
    const blob = new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${mapName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "mapa"}.map-v1.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const input = JSON.parse(await file.text()) as unknown;
      const parsed = validateMapDocumentV1(input);
      if (!parsed.valid) {
        setValidationErrors(parsed.errors);
        setPanel("validation");
        setError("O arquivo possui erros e não foi importado.");
        return;
      }
      commitDocument(parsed.document, "Importar backup JSON");
      setValidationErrors([]);
    } catch {
      setError("O arquivo não contém um MapDocumentV1 JSON válido.");
    }
  }

  function updateLayer(layerKey: string, patch: Partial<MapLayerV1>) {
    if (!document) return;
    const next = cloneDocument(document);
    next.layers = next.layers.map((layer) =>
      layer.key === layerKey ? ({ ...layer, ...patch } as MapLayerV1) : layer,
    );
    commitDocument(next, "Editar layer");
  }

  function addLayer() {
    if (!document || document.layers.length >= MAP_DOCUMENT_V1_LIMITS.maxLayers)
      return;
    const key = uniqueId(
      "visual",
      document.layers.map((item) => item.key),
    );
    const next = cloneDocument(document);
    next.layers.push({
      id: uniqueId(
        "layer",
        document.layers.map((item) => item.id),
      ),
      key,
      name: "Nova layer visual",
      type: "tile",
      zIndex: nextVisualLayerZIndex(next.layers),
      visible: true,
      locked: false,
      opacity: 1,
      data: Array.from(
        { length: next.map.width * next.map.height },
        () => null,
      ),
    });
    commitDocument(next, "Criar layer");
    setActiveLayerKey(key);
  }

  function moveLayer(layerKey: string, direction: -1 | 1) {
    if (!document) return;
    const layers = moveLayerOneStep(document.layers, layerKey, direction);
    if (!layers) return;
    const next = cloneDocument(document);
    next.layers = layers;
    commitDocument(next, "Reordenar layers");
  }

  function removeLayer(layerKey: string) {
    if (!document || RESERVED_MAP_LAYERS.some((item) => item.key === layerKey))
      return;
    const next = cloneDocument(document);
    next.layers = next.layers.filter((item) => item.key !== layerKey);
    next.objects = next.objects.filter((item) => item.layerKey !== layerKey);
    commitDocument(next, "Excluir layer");
    setActiveLayerKey("floor");
  }

  function patchSelectedObject(
    section: "geometry" | "properties",
    key: string,
    value: unknown,
  ) {
    if (!document || !selectedObjectId) return;
    const next = cloneDocument(document);
    if (section === "properties" && key === "isDefault" && value === true) {
      next.objects.forEach((candidate) => {
        if (candidate.type === "spawn-point")
          candidate.properties.isDefault = false;
      });
    }
    const selected = next.objects.find((item) => item.id === selectedObjectId);
    if (!selected) return;
    const mutable = selected as unknown as {
      geometry: Record<string, unknown>;
      properties: Record<string, unknown>;
    };
    mutable[section][key] = value;
    commitDocument(next, "Editar propriedades do objeto");
  }

  function duplicateSelected() {
    if (!document || !selectedObjectId) return;
    const selected = document.objects.find(
      (item) => item.id === selectedObjectId,
    );
    if (!selected) return;
    const duplicate = structuredClone(selected) as MapObjectV1;
    duplicate.id = uniqueId(
      `${selected.id}-copy`,
      document.objects.map((item) => item.id),
    );
    if (duplicate.geometry.kind === "point") {
      duplicate.geometry.x += document.map.tileWidth;
      duplicate.geometry.y += document.map.tileHeight;
    } else if (duplicate.geometry.kind === "rectangle") {
      duplicate.geometry.x += document.map.tileWidth;
      duplicate.geometry.y += document.map.tileHeight;
    } else {
      duplicate.geometry.points = duplicate.geometry.points.map((point) => ({
        x: point.x + document.map.tileWidth,
        y: point.y + document.map.tileHeight,
      }));
    }
    if (duplicate.type === "spawn-point")
      duplicate.properties.isDefault = false;
    if (duplicate.type === "meeting-room") {
      duplicate.properties.externalKey = uniqueId(
        duplicate.properties.externalKey,
        document.objects
          .filter((item) => item.type === "meeting-room")
          .map((item) => item.properties.externalKey),
      );
    }
    if (
      duplicate.type === "door" ||
      duplicate.type === "link" ||
      duplicate.type === "action-point"
    ) {
      duplicate.properties.key = uniqueId(
        duplicate.properties.key,
        document.objects
          .filter(
            (item) =>
              item.type === "door" ||
              item.type === "link" ||
              item.type === "action-point",
          )
          .map((item) => item.properties.key),
      );
    }
    const next = cloneDocument(document);
    next.objects.push(duplicate);
    commitDocument(next, "Duplicar objeto");
    setSelectedObjectId(duplicate.id);
  }

  function convertSelectedGeometry(target: "rectangle" | "polygon") {
    if (!document || !selectedObjectId) return;
    const next = cloneDocument(document);
    const selected = next.objects.find((item) => item.id === selectedObjectId);
    if (!selected || selected.type === "spawn-point") return;
    const geometry = selected.geometry;
    if (target === "polygon" && geometry.kind === "rectangle") {
      selected.geometry = {
        kind: "polygon",
        points: [
          { x: geometry.x, y: geometry.y },
          { x: geometry.x + geometry.width, y: geometry.y },
          {
            x: geometry.x + geometry.width,
            y: geometry.y + geometry.height,
          },
          { x: geometry.x, y: geometry.y + geometry.height },
        ],
      };
    } else if (target === "rectangle" && geometry.kind === "point") {
      const width = next.map.tileWidth;
      const height = next.map.tileHeight;
      selected.geometry = {
        kind: "rectangle",
        x: Math.max(0, geometry.x - Math.floor(width / 2)),
        y: Math.max(0, geometry.y - Math.floor(height / 2)),
        width,
        height,
      };
    } else if (target === "rectangle" && geometry.kind === "polygon") {
      const xs = geometry.points.map((point) => point.x);
      const ys = geometry.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      selected.geometry = {
        kind: "rectangle",
        x,
        y,
        width: Math.max(1, Math.max(...xs) - x),
        height: Math.max(1, Math.max(...ys) - y),
      };
    } else {
      return;
    }
    commitDocument(next, `Converter geometria para ${target}`);
  }

  async function activatePublication(publicationId: string) {
    if (!session) return;
    try {
      await apiRequest(
        "admin/office-map-active",
        {
          method: "PATCH",
          body: JSON.stringify({ publicationId }),
        },
        session.accessToken,
      );
      setPublications((items) =>
        items.map((item) => ({ ...item, active: item.id === publicationId })),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao ativar versão.",
      );
    }
  }

  const selectedObject = useMemo(
    () =>
      document?.objects.find((item) => item.id === selectedObjectId) ?? null,
    [document, selectedObjectId],
  );
  const activeLayer = useMemo(
    () => document?.layers.find((item) => item.key === activeLayerKey) ?? null,
    [activeLayerKey, document],
  );
  if (booting) {
    return (
      <main className="map-editor-loading" aria-label="Carregando editor">
        <span />
      </main>
    );
  }
  if (fatalError || !document || !session) {
    return (
      <main className="map-editor-fatal">
        <div>
          <h1>Não foi possível abrir o editor</h1>
          <p>{fatalError || "O rascunho do mapa não está disponível."}</p>
          <Link to="/admin">Voltar ao painel</Link>
        </div>
      </main>
    );
  }

  const editorReadOnly = readOnly || narrowScreen;
  const saveLabel =
    saveState === "saving"
      ? "Salvando…"
      : saveState === "error"
        ? "Com erro"
        : "Salvo";

  return (
    <>
      <div className="map-editor-mobile-readonly">
        <div>
          <h1>Editor disponível no desktop</h1>
          <p>
            Para proteger o mapa contra alterações acidentais, a edição exige
            uma janela com pelo menos 1024 px. O conteúdo permanece somente
            leitura.
          </p>
          <Link to="/admin">Voltar ao painel</Link>
        </div>
      </div>
      <main className="map-editor-shell">
        <header className="map-editor-topbar">
          <Link className="map-editor-back" to="/admin" title="Voltar ao painel">
            ←
          </Link>
          <div className="map-editor-title">
            <input
              aria-label="Nome do mapa"
              disabled={editorReadOnly}
              maxLength={120}
              minLength={2}
              onBlur={() => void saveName()}
              onChange={(event) => setMapName(event.target.value)}
              value={mapName}
            />
            <small>Rascunho · revisão {revision}</small>
          </div>
          <span className={`map-editor-save-state ${saveState}`}>
            {saveLabel}
          </span>
          <div className="map-editor-actions">
            <button
              className="map-editor-ghost"
              disabled={editorReadOnly || !dirty}
              onClick={() => void saveDraft().catch(() => undefined)}
              title="Salvar (Ctrl/Cmd+S)"
            >
              Salvar
            </button>
            <button
              aria-label="Desfazer"
              className="map-editor-icon"
              disabled={editorReadOnly || past.length === 0}
              onClick={undo}
              title="Desfazer (Ctrl/Cmd+Z)"
            >
              ↶
            </button>
            <button
              aria-label="Refazer"
              className="map-editor-icon"
              disabled={editorReadOnly || future.length === 0}
              onClick={redo}
              title="Refazer (Ctrl/Cmd+Shift+Z)"
            >
              ↷
            </button>
            <button
              className="map-editor-ghost"
              onClick={() => setPreview((value) => !value)}
            >
              {preview ? "Sair da prévia" : "Pré-visualizar"}
            </button>
            <button
              className="map-editor-ghost"
              disabled={validating}
              onClick={() => void validateDraft()}
            >
              {validating ? "Validando…" : "Validar"}
            </button>
            <button
              className="map-editor-primary"
              disabled={editorReadOnly || publishing}
              onClick={() => void publishDraft()}
            >
              {publishing ? "Publicando…" : "Publicar e ativar"}
            </button>
          </div>
        </header>

        <section className="map-editor-main">
          <aside className="map-editor-toolbar" aria-label="Ferramentas">
            {tools.map((item) => (
              <MapEditorToolButton
                key={item.tool}
                active={tool === item.tool}
                disabled={
                  editorReadOnly &&
                  item.tool !== "hand" &&
                  item.tool !== "select" &&
                  item.tool !== "free-select"
                }
                item={item}
                onSelect={() => setTool(item.tool)}
              />
            ))}
          </aside>

          <div className="map-editor-stage">
            {lockOwner && (
              <div className="map-editor-stage-banner">
                {lockOwner.name} está editando este mapa. Você está em modo
                somente leitura.{" "}
                <button onClick={() => void acquireLock()}>
                  Tentar novamente
                </button>
              </div>
            )}
            {error && !conflict && (
              <div className="map-editor-stage-banner">{error}</div>
            )}
            {conflict && (
              <div className="map-editor-conflict">
                Conflito de revisão. O backup local continua seguro.
                <button onClick={() => void reloadServerDraft()}>
                  Recarregar servidor
                </button>
              </div>
            )}
            {preview && (
              <span className="map-editor-preview-badge">PRÉ-VISUALIZAÇÃO</span>
            )}
            <MapCanvas
              activeLayerKey={activeLayerKey}
              assets={assets}
              document={document}
              onCursor={(position) =>
                setCursor({
                  x: position.x,
                  y: position.y,
                  tileX: position.tileX,
                  tileY: position.tileY,
                })
              }
              onDocumentChange={commitDocument}
              onSelection={(selection) => {
                if (selection?.kind === "object") {
                  setSelectedObjectId(selection.objectId);
                  setPanel("properties");
                } else if (selection?.kind === "tile") {
                  setSelectedTilesetId(selection.tilesetId);
                  // Conta-gotas pega um tile só: o bloco volta para 1×1.
                  setSelectedTile({
                    index: selection.tileIndex,
                    cols: 1,
                    rows: 1,
                  });
                  setPanel("tilesets");
                } else {
                  setSelectedObjectId(null);
                }
              }}
              onTileSelectionChange={setTileSelection}
              onZoom={setZoom}
              preview={preview}
              readOnly={editorReadOnly}
              selectedObjectId={selectedObjectId}
              selectedTileIndex={selectedTile.index}
              selectedTileSpan={{
                cols: selectedTile.cols,
                rows: selectedTile.rows,
              }}
              selectedTilesetId={selectedTilesetId}
              tileSelection={tileSelection}
              tool={tool}
            />
          </div>

          <aside className="map-editor-panel">
            <div className="map-editor-tabs">
              {(
                [
                  ["tilesets", "Tilesets"],
                  ["layers", "Layers"],
                  ["properties", "Propriedades"],
                  [
                    "validation",
                    `Validação${validationErrors.length ? ` (${validationErrors.length})` : ""}`,
                  ],
                ] as Array<[PanelTab, string]>
              ).map(([id, label]) => (
                <button
                  className={`map-editor-tab ${panel === id ? "active" : ""}`}
                  key={id}
                  onClick={() => setPanel(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="map-editor-panel-scroll">
              {panel === "tilesets" && (
                <TilesetsPanel
                  assets={assets}
                  document={document}
                  onRemove={(asset) => void removeAsset(asset)}
                  onSelect={(id, tile) => {
                    setSelectedTilesetId(id);
                    setSelectedTile(tile);
                    setTool("brush");
                  }}
                  onSelectBuiltin={(assetId, tile) => {
                    const tilesetId = ensureBuiltinTileset(assetId);
                    if (!tilesetId) return;
                    setSelectedTilesetId(tilesetId);
                    setSelectedTile(tile);
                    setTool("brush");
                  }}
                  onUpload={uploadAsset}
                  readOnly={editorReadOnly}
                  selectedTile={selectedTile}
                  selectedTilesetId={selectedTilesetId}
                  uploading={uploading}
                />
              )}
              {panel === "layers" && (
                <LayersPanel
                  activeLayerKey={activeLayerKey}
                  document={document}
                  onAdd={addLayer}
                  onMove={moveLayer}
                  onRemove={removeLayer}
                  onSelect={setActiveLayerKey}
                  onUpdate={updateLayer}
                  readOnly={editorReadOnly}
                />
              )}
              {panel === "properties" && (
                <PropertiesPanel
                  activeLayer={activeLayer}
                  document={document}
                  object={selectedObject}
                  onDelete={deleteSelected}
                  onDuplicate={duplicateSelected}
                  onMapColor={(backgroundColor) => {
                    const next = cloneDocument(document);
                    next.map.backgroundColor = backgroundColor;
                    commitDocument(next, "Alterar cor de fundo");
                  }}
                  onConvertGeometry={convertSelectedGeometry}
                  onPatch={patchSelectedObject}
                  onUpdateLayer={updateLayer}
                  readOnly={editorReadOnly}
                />
              )}
              {panel === "validation" && (
                <ValidationPanel
                  errors={validationErrors}
                  importInput={importInput}
                  onActivate={(id) => void activatePublication(id)}
                  onExport={exportDocument}
                  onImport={importDocument}
                  onSelectError={(issue) => {
                    if (issue.objectId) {
                      setSelectedObjectId(issue.objectId);
                      setPanel("properties");
                    } else if (issue.layerKey) {
                      setActiveLayerKey(issue.layerKey);
                      setPanel("layers");
                    }
                  }}
                  publications={publications}
                />
              )}
            </div>
          </aside>
        </section>

        <footer className="map-editor-bottom">
          <span>
            X {Math.round(cursor.x)} · Y {Math.round(cursor.y)}
          </span>
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <span>Layer: {activeLayer?.name ?? activeLayerKey}</span>
          <span>Revisão {revision}</span>
          <span>
            {lock
              ? `Lock até ${new Date(lock.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
              : "Somente leitura"}
          </span>
          <span>
            {savedAt
              ? `Último save ${new Date(savedAt).toLocaleTimeString("pt-BR")}`
              : ""}
          </span>
        </footer>
      </main>
    </>
  );
}

function TilesetsPanel({
  assets,
  document,
  onRemove,
  onSelect,
  onSelectBuiltin,
  onUpload,
  readOnly,
  selectedTile,
  selectedTilesetId,
  uploading,
}: {
  assets: MapAsset[];
  document: MapDocumentV1;
  onRemove: (asset: MapAsset) => void;
  onSelect: (tilesetId: string, tile: SelectedTile) => void;
  onSelectBuiltin: (assetId: string, tile: SelectedTile) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  readOnly: boolean;
  selectedTile: SelectedTile;
  selectedTilesetId: string | null;
  uploading: boolean;
}) {
  const selectedIndex = selectedTile.index;
  const selected = document.tilesets.find(
    (item) => item.id === selectedTilesetId,
  );
  const selectedAsset = assets.find((item) => item.id === selected?.assetId);

  // A grade "Paleta · <tileset>" escolhe bloco pelo mesmo arraste da paleta
  // de tilesets padrão.
  const paletteColumns = selected?.columns ?? 1;
  const paletteDrag = useTileRegionDrag(
    paletteColumns,
    useCallback(
      (region: TileRegion) => {
        if (!selected) return;
        onSelect(selected.id, {
          index: region.row * selected.columns + region.col,
          cols: region.cols,
          rows: region.rows,
        });
      },
      [onSelect, selected],
    ),
  );
  const paletteRegion = paletteDrag.dragRegion ?? {
    col: selectedIndex % paletteColumns,
    row: Math.floor(selectedIndex / paletteColumns),
    cols: selectedTile.cols,
    rows: selectedTile.rows,
  };
  return (
    <>
      <section className="map-editor-panel-section">
        <div className="map-editor-panel-heading">
          <div>
            <h3>Assets do mapa</h3>
            <small>{assets.length}/20 imagens</small>
          </div>
          <label className="map-editor-secondary">
            {uploading ? "Enviando…" : "+ Importar"}
            <input
              accept="image/png,image/webp"
              disabled={readOnly || uploading}
              hidden
              onChange={onUpload}
              type="file"
            />
          </label>
        </div>
        <p className="map-editor-hint">
          PNG ou WebP, até 10 MB. A grade usa tiles de {document.map.tileWidth}
          px.
        </p>
        <div className="map-editor-asset-list">
          {document.tilesets.map((tileset) => {
            const asset = assets.find((item) => item.id === tileset.assetId);
            return (
              <div
                className={`map-editor-asset ${tileset.id === selectedTilesetId ? "active" : ""}`}
                key={tileset.id}
              >
                <button
                  className="map-editor-asset-thumb"
                  onClick={() => onSelect(tileset.id, { index: 0, cols: 1, rows: 1 })}
                  style={
                    asset
                      ? {
                          backgroundImage: `url(${asset.url})`,
                          backgroundSize: "cover",
                        }
                      : undefined
                  }
                  title={tileset.name}
                />
                <button
                  className="map-editor-asset-info"
                  onClick={() => onSelect(tileset.id, { index: 0, cols: 1, rows: 1 })}
                >
                  <strong>{tileset.name}</strong>
                  <small>
                    {tileset.columns} colunas · {tileset.tileCount} tiles
                  </small>
                </button>
                {asset && !readOnly && (
                  <button
                    aria-label="Excluir asset"
                    onClick={() => onRemove(asset)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {!document.tilesets.length && (
            <p className="map-editor-empty">
              Importe a primeira imagem para começar a pintar.
            </p>
          )}
        </div>
      </section>
      <section className="map-editor-panel-section">
        <TilesetPalette
          mapAssets={[]}
          mapTilesets={document.tilesets}
          mapTileWidth={document.map.tileWidth}
          selected={(() => {
            const ts = document.tilesets.find(
              (t) => t.id === selectedTilesetId,
            );
            if (!ts) return null;
            return {
              assetId: ts.assetId,
              col: selectedIndex % ts.columns,
              row: Math.floor(selectedIndex / ts.columns),
              cols: selectedTile.cols,
              rows: selectedTile.rows,
            };
          })()}
          onSelectTile={({ entry, isBuiltin, col, row, cols, rows }) => {
            if (isBuiltin) {
              const e = entry as { assetId: string; columns: number };
              onSelectBuiltin(e.assetId, {
                index: row * e.columns + col,
                cols,
                rows,
              });
            }
          }}
        />
      </section>
      {selected && (
        <section className="map-editor-panel-section">
          <div className="map-editor-panel-heading">
            <h3>Paleta · {selected.name}</h3>
            <small>
              {paletteRegion.cols * paletteRegion.rows > 1
                ? `Bloco ${paletteRegion.cols}×${paletteRegion.rows} · tile ${selectedIndex}`
                : `Tile ${selectedIndex}`}
            </small>
          </div>
          <p className="map-editor-hint">Arraste para escolher vários tiles.</p>
          <div
            aria-label={`Tiles de ${selected.name}`}
            className="map-editor-palette"
            role="region"
            style={{ touchAction: "none", userSelect: "none" }}
            tabIndex={0}
          >
            {Array.from({ length: selected.tileCount }, (_, index) => {
              const column = index % selected.columns;
              const row = Math.floor(index / selected.columns);
              const cellSize = 50;
              const active =
                column >= paletteRegion.col &&
                column < paletteRegion.col + paletteRegion.cols &&
                row >= paletteRegion.row &&
                row < paletteRegion.row + paletteRegion.rows;
              return (
                <button
                  aria-label={`Tile ${index}`}
                  aria-pressed={active}
                  className={`map-editor-tile ${active ? "active" : ""}`}
                  draggable={false}
                  key={index}
                  // O arraste responde a pointer; o clique cobre o teclado
                  // (Enter/Espaço), que escolhe sempre um tile só.
                  onClick={() =>
                    onSelect(selected.id, { index, cols: 1, rows: 1 })
                  }
                  {...paletteDrag.cellHandlers(index)}
                  style={
                    selectedAsset
                      ? {
                          backgroundImage: `url(${selectedAsset.url})`,
                          backgroundPosition: `${-column * cellSize}px ${-row * cellSize}px`,
                          backgroundSize: `${selected.columns * cellSize}px auto`,
                        }
                      : undefined
                  }
                >
                  {!selectedAsset && index}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function LayersPanel({
  activeLayerKey,
  document,
  onAdd,
  onMove,
  onRemove,
  onSelect,
  onUpdate,
  readOnly,
}: {
  activeLayerKey: string;
  document: MapDocumentV1;
  onAdd: () => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onRemove: (key: string) => void;
  onSelect: (key: string) => void;
  onUpdate: (key: string, patch: Partial<MapLayerV1>) => void;
  readOnly: boolean;
}) {
  return (
    <section className="map-editor-panel-section">
      <div className="map-editor-panel-heading">
        <div>
          <h3>Layers</h3>
          <small>{document.layers.length}/50</small>
        </div>
        <button
          className="map-editor-secondary"
          disabled={readOnly}
          onClick={onAdd}
        >
          + Visual
        </button>
      </div>
      <div className="map-editor-layer-list">
        {/* Mesma ordenação que `moveLayerOneStep` usa para decidir a vizinha —
            as duas precisam concordar sobre o que é "acima". */}
        {layersTopFirst(document.layers).map((layer) => {
            const reserved = RESERVED_MAP_LAYERS.some(
              (item) => item.key === layer.key,
            );
            return (
              <div
                className={`map-editor-layer ${layer.key === activeLayerKey ? "active" : ""}`}
                key={layer.id}
              >
                <button
                  aria-label={layer.visible ? "Ocultar layer" : "Mostrar layer"}
                  disabled={readOnly}
                  onClick={() =>
                    onUpdate(layer.key, { visible: !layer.visible })
                  }
                >
                  {layer.visible ? "◉" : "○"}
                </button>
                <button
                  className="map-editor-layer-name"
                  onClick={() => onSelect(layer.key)}
                >
                  {layer.name}
                  <small>
                    {layer.type} · z{layer.zIndex}
                  </small>
                </button>
                <button
                  aria-label={layer.locked ? "Desbloquear" : "Bloquear"}
                  disabled={readOnly}
                  onClick={() => onUpdate(layer.key, { locked: !layer.locked })}
                >
                  {layer.locked ? "●" : "○"}
                </button>
                <button
                  aria-label="Excluir layer"
                  disabled={readOnly || reserved}
                  onClick={() => onRemove(layer.key)}
                >
                  ×
                </button>
                {layer.key === activeLayerKey && (
                  <div
                    className="map-editor-inline-actions"
                    style={{ gridColumn: "1 / -1" }}
                  >
                    <button
                      disabled={readOnly}
                      onClick={() => onMove(layer.key, -1)}
                    >
                      Subir
                    </button>
                    <button
                      disabled={readOnly}
                      onClick={() => onMove(layer.key, 1)}
                    >
                      Descer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <p className="map-editor-hint">
        As layers canônicas não podem ser removidas ou ter o tipo alterado.
      </p>
    </section>
  );
}

function PropertiesPanel({
  activeLayer,
  document,
  object,
  onDelete,
  onDuplicate,
  onConvertGeometry,
  onMapColor,
  onPatch,
  onUpdateLayer,
  readOnly,
}: {
  activeLayer: MapLayerV1 | null;
  document: MapDocumentV1;
  object: MapObjectV1 | null;
  onDelete: () => void;
  onDuplicate: () => void;
  onConvertGeometry: (target: "rectangle" | "polygon") => void;
  onMapColor: (value: string) => void;
  onPatch: (
    section: "geometry" | "properties",
    key: string,
    value: unknown,
  ) => void;
  onUpdateLayer: (key: string, patch: Partial<MapLayerV1>) => void;
  readOnly: boolean;
}) {
  if (!object) {
    return (
      <>
        <section className="map-editor-panel-section">
          <div className="map-editor-panel-heading">
            <h3>Mapa</h3>
          </div>
          <div className="map-editor-field-row">
            <label className="map-editor-field">
              Largura
              <input disabled value={document.map.width} />
            </label>
            <label className="map-editor-field">
              Altura
              <input disabled value={document.map.height} />
            </label>
          </div>
          <div className="map-editor-field-row">
            <label className="map-editor-field">
              Tile
              <input disabled value={`${document.map.tileWidth}px`} />
            </label>
            <label className="map-editor-field">
              Fundo
              <input
                disabled={readOnly}
                onChange={(event) => onMapColor(event.target.value)}
                type="color"
                value={document.map.backgroundColor.slice(0, 7)}
              />
            </label>
          </div>
        </section>
        {activeLayer && (
          <section className="map-editor-panel-section">
            <div className="map-editor-panel-heading">
              <h3>Layer ativa</h3>
            </div>
            <label className="map-editor-field">
              Nome
              <input
                disabled={readOnly}
                onChange={(event) =>
                  onUpdateLayer(activeLayer.key, { name: event.target.value })
                }
                value={activeLayer.name}
              />
            </label>
            <label className="map-editor-field">
              Opacidade ({Math.round(activeLayer.opacity * 100)}%)
              <input
                disabled={readOnly}
                max={1}
                min={0}
                onChange={(event) =>
                  onUpdateLayer(activeLayer.key, {
                    opacity: Number(event.target.value),
                  })
                }
                step={0.05}
                type="range"
                value={activeLayer.opacity}
              />
            </label>
          </section>
        )}
        <p className="map-editor-empty">
          Selecione um objeto no canvas para editar sua geometria e regras.
        </p>
      </>
    );
  }

  const geometry = object.geometry;
  return (
    <section className="map-editor-panel-section">
      <div className="map-editor-object-title">
        <div>
          <h3>{objectLabel(object.type)}</h3>
          <code>{object.id}</code>
        </div>
        <div className="map-editor-inline-actions">
          <button
            className="map-editor-ghost"
            disabled={readOnly}
            onClick={onDuplicate}
          >
            Duplicar
          </button>
          <button
            className="map-editor-danger"
            disabled={readOnly}
            onClick={onDelete}
          >
            Excluir
          </button>
        </div>
      </div>
      <label className="map-editor-field">
        Layer
        <input disabled value={object.layerKey} />
      </label>
      <label className="map-editor-field">
        Geometria
        <input disabled value={geometry.kind} />
      </label>
      {object.type !== "spawn-point" && object.type !== "tile-object" && (
        <div className="map-editor-inline-actions">
          {geometry.kind === "rectangle" && (
            <button
              className="map-editor-ghost"
              disabled={readOnly}
              onClick={() => onConvertGeometry("polygon")}
            >
              Converter em polígono
            </button>
          )}
          {(geometry.kind === "point" || geometry.kind === "polygon") && (
            <button
              className="map-editor-ghost"
              disabled={readOnly}
              onClick={() => onConvertGeometry("rectangle")}
            >
              Converter em retângulo
            </button>
          )}
        </div>
      )}
      {geometry.kind === "point" && (
        <div className="map-editor-field-row">
          <NumberField
            disabled={readOnly}
            label="X"
            onChange={(value) => onPatch("geometry", "x", value)}
            value={geometry.x}
          />
          <NumberField
            disabled={readOnly}
            label="Y"
            onChange={(value) => onPatch("geometry", "y", value)}
            value={geometry.y}
          />
        </div>
      )}
      {geometry.kind === "rectangle" && (
        <>
          <div className="map-editor-field-row">
            <NumberField
              disabled={readOnly}
              label="X"
              onChange={(value) => onPatch("geometry", "x", value)}
              value={geometry.x}
            />
            <NumberField
              disabled={readOnly}
              label="Y"
              onChange={(value) => onPatch("geometry", "y", value)}
              value={geometry.y}
            />
          </div>
          <div className="map-editor-field-row">
            <NumberField
              disabled={readOnly || object.type === "tile-object"}
              label="Largura"
              min={1}
              onChange={(value) => onPatch("geometry", "width", value)}
              value={geometry.width}
            />
            <NumberField
              disabled={readOnly || object.type === "tile-object"}
              label="Altura"
              min={1}
              onChange={(value) => onPatch("geometry", "height", value)}
              value={geometry.height}
            />
          </div>
        </>
      )}
      {geometry.kind === "polygon" && (
        <label className="map-editor-field">
          Vértices (JSON)
          <textarea
            disabled={readOnly}
            onBlur={(event) => {
              try {
                const points = JSON.parse(event.target.value) as unknown;
                if (Array.isArray(points))
                  onPatch("geometry", "points", points);
              } catch {
                event.target.value = JSON.stringify(geometry.points);
              }
            }}
            defaultValue={JSON.stringify(geometry.points)}
          />
        </label>
      )}
      <ObjectPropertyFields
        disabled={readOnly}
        object={object}
        onPatch={onPatch}
      />
    </section>
  );
}

function ObjectPropertyFields({
  disabled,
  object,
  onPatch,
}: {
  disabled: boolean;
  object: MapObjectV1;
  onPatch: (
    section: "geometry" | "properties",
    key: string,
    value: unknown,
  ) => void;
}) {
  if (object.type === "tile-object") {
    return (
      <div className="map-editor-field-row">
        <label className="map-editor-field">
          Tileset
          <input disabled value={object.properties.tilesetId} />
        </label>
        <label className="map-editor-field">
          Tile
          <input disabled value={object.properties.tileIndex} />
        </label>
      </div>
    );
  }
  if (object.type === "collision") {
    return (
      <TextField
        disabled={disabled}
        label="Nome"
        onChange={(value) => onPatch("properties", "name", value || undefined)}
        value={object.properties.name ?? ""}
      />
    );
  }
  if (object.type === "spawn-point") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Nome"
          onChange={(value) => onPatch("properties", "name", value)}
          value={object.properties.name}
        />
        <label className="map-editor-check">
          <input
            checked={object.properties.isDefault}
            disabled={disabled}
            onChange={(event) =>
              onPatch("properties", "isDefault", event.target.checked)
            }
            type="checkbox"
          />{" "}
          Spawn padrão
        </label>
      </>
    );
  }
  if (object.type === "private-zone") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Nome"
          onChange={(value) => onPatch("properties", "name", value)}
          value={object.properties.name}
        />
        <TextField
          disabled={disabled}
          label="Chave externa"
          onChange={(value) =>
            onPatch("properties", "externalKey", value || undefined)
          }
          value={object.properties.externalKey ?? ""}
        />
        <PolicyField
          disabled={disabled}
          onChange={(value) => onPatch("properties", "accessPolicy", value)}
          value={object.properties.accessPolicy}
        />
      </>
    );
  }
  if (object.type === "meeting-room") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Nome"
          onChange={(value) => onPatch("properties", "name", value)}
          value={object.properties.name}
        />
        <TextField
          disabled={disabled}
          label="Chave externa"
          onChange={(value) => onPatch("properties", "externalKey", value)}
          value={object.properties.externalKey}
        />
        <div className="map-editor-field-row">
          <label className="map-editor-field">
            Status
            <select
              disabled={disabled}
              onChange={(event) =>
                onPatch("properties", "status", event.target.value)
              }
              value={object.properties.status}
            >
              <option value="OPEN">Aberta</option>
              <option value="LOCKED">Trancada</option>
            </select>
          </label>
          <NumberField
            disabled={disabled}
            label="Capacidade"
            min={1}
            onChange={(value) =>
              onPatch("properties", "capacity", value || undefined)
            }
            value={object.properties.capacity ?? 1}
          />
        </div>
        <PolicyField
          disabled={disabled}
          onChange={(value) => onPatch("properties", "accessPolicy", value)}
          value={object.properties.accessPolicy}
        />
        <label className="map-editor-check">
          <input
            checked={object.properties.voiceEnabled}
            disabled={disabled}
            onChange={(event) =>
              onPatch("properties", "voiceEnabled", event.target.checked)
            }
            type="checkbox"
          />{" "}
          Voz habilitada
        </label>
      </>
    );
  }
  if (object.type === "desk") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Nome"
          onChange={(value) => onPatch("properties", "name", value)}
          value={object.properties.name}
        />
        <TextField
          disabled={disabled}
          label="Chave externa"
          onChange={(value) => onPatch("properties", "externalKey", value)}
          value={object.properties.externalKey}
        />
      </>
    );
  }
  if (object.type === "door") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Chave"
          onChange={(value) => onPatch("properties", "key", value)}
          value={object.properties.key}
        />
        <TextField
          disabled={disabled}
          label="Rótulo"
          onChange={(value) =>
            onPatch("properties", "label", value || undefined)
          }
          value={object.properties.label ?? ""}
        />
        <TextField
          disabled={disabled}
          label="externalKey da sala"
          onChange={(value) =>
            onPatch("properties", "roomExternalKey", value || undefined)
          }
          value={object.properties.roomExternalKey ?? ""}
        />
      </>
    );
  }
  if (object.type === "link") {
    return (
      <>
        <TextField
          disabled={disabled}
          label="Chave"
          onChange={(value) => onPatch("properties", "key", value)}
          value={object.properties.key}
        />
        <TextField
          disabled={disabled}
          label="Rótulo"
          onChange={(value) => onPatch("properties", "label", value)}
          value={object.properties.label}
        />
        <TextField
          disabled={disabled}
          label="URL HTTPS"
          onChange={(value) => onPatch("properties", "url", value)}
          value={object.properties.url}
        />
      </>
    );
  }
  return (
    <>
      <TextField
        disabled={disabled}
        label="Chave"
        onChange={(value) => onPatch("properties", "key", value)}
        value={object.properties.key}
      />
      <TextField
        disabled={disabled}
        label="Rótulo"
        onChange={(value) => onPatch("properties", "label", value)}
        value={object.properties.label}
      />
      <TextField
        disabled={disabled}
        label="Chave da ação"
        onChange={(value) => onPatch("properties", "actionKey", value)}
        value={object.properties.actionKey}
      />
    </>
  );
}

function TextField({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="map-editor-field">
      {label}
      <input
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function NumberField({
  disabled,
  label,
  min,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  min?: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="map-editor-field">
      {label}
      <input
        disabled={disabled}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}

function PolicyField({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: "OPEN" | "ALLOWLIST") => void;
  value: "OPEN" | "ALLOWLIST";
}) {
  return (
    <label className="map-editor-field">
      Política de acesso
      <select
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value as "OPEN" | "ALLOWLIST")
        }
        value={value}
      >
        <option value="OPEN">Livre</option>
        <option value="ALLOWLIST">Lista permitida</option>
      </select>
    </label>
  );
}

function ValidationPanel({
  errors,
  importInput,
  onActivate,
  onExport,
  onImport,
  onSelectError,
  publications,
}: {
  errors: ValidationIssue[];
  importInput: React.RefObject<HTMLInputElement>;
  onActivate: (id: string) => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectError: (issue: ValidationIssue) => void;
  publications: Publication[];
}) {
  return (
    <>
      <section className="map-editor-panel-section">
        <div className="map-editor-panel-heading">
          <h3>Portabilidade</h3>
        </div>
        <div className="map-editor-inline-actions">
          <button className="map-editor-secondary" onClick={onExport}>
            Exportar JSON
          </button>
          <button
            className="map-editor-secondary"
            onClick={() => importInput.current?.click()}
          >
            Reimportar
          </button>
          <input
            accept="application/json,.json"
            hidden
            onChange={onImport}
            ref={importInput}
            type="file"
          />
        </div>
      </section>
      <section className="map-editor-panel-section">
        <div className="map-editor-panel-heading">
          <h3>Resultado da validação</h3>
          <small>
            {errors.length ? `${errors.length} erro(s)` : "Sem erros"}
          </small>
        </div>
        {!errors.length && (
          <p className="map-editor-empty">
            Valide o rascunho para confirmar que está pronto para publicação.
          </p>
        )}
        <div className="map-editor-error-list">
          {errors.map((issue, index) => (
            <button
              className="map-editor-error"
              key={`${issue.code}-${issue.path}-${index}`}
              onClick={() => onSelectError(issue)}
            >
              <code>
                {issue.code} · {issue.path}
              </code>
              <span>{issue.message}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="map-editor-panel-section">
        <div className="map-editor-panel-heading">
          <h3>Histórico publicado</h3>
          <small>{publications.length} versão(ões)</small>
        </div>
        <div className="map-editor-history-list">
          {publications.map((publication) => (
            <div className="map-editor-history-item" key={publication.id}>
              <div>
                <strong>Versão {publication.version}</strong>
                <small>
                  {new Date(publication.createdAt).toLocaleString("pt-BR")}
                </small>
              </div>
              {publication.active ? (
                <span>ATIVA</span>
              ) : (
                <button
                  className="map-editor-ghost"
                  onClick={() => onActivate(publication.id)}
                >
                  Ativar
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function objectLabel(type: MapObjectV1["type"]) {
  const labels: Record<MapObjectV1["type"], string> = {
    "spawn-point": "Ponto de spawn",
    collision: "Colisão",
    "private-zone": "Zona privada",
    "meeting-room": "Sala de reunião",
    desk: "Mesa",
    door: "Porta",
    link: "Link",
    "action-point": "Ponto de ação",
    "tile-object": "Objeto visual livre",
  };
  return labels[type];
}
