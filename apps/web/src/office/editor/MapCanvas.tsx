import {
  MAP_DOCUMENT_V1_LIMITS,
  type MapDocumentV1,
  type MapGeometryV1,
  type MapObjectV1,
  type TileObjectV1,
  type MapTileLayerV1,
  type PointCoordinatesV1,
  type PolygonGeometryV1,
  type RectangleGeometryV1,
  type ReservedMapLayerKey,
} from "@legends/shared";
import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import styles from "./MapCanvas.module.css";
import { deskPlacementGeometry, deskPlacementObjects } from "./deskPlacement";
import {
  clampRect,
  fillWithStamp,
  moveRect,
  paintStamp,
  rectContains,
  rectFromCells,
  tileStamp,
  type StampTile,
  type TileCell,
  type TileRect,
} from "./tileRegion";

export const MAP_EDITOR_TOOLS = [
  "select",
  "free-select",
  "area-select",
  "hand",
  "brush",
  "eraser",
  "fill",
  "eyedropper",
  "collision",
  "spawn",
  "private-zone",
  "meeting-room",
  "desk",
  "door",
  "link",
  "action-point",
] as const;

export type MapEditorTool = (typeof MAP_EDITOR_TOOLS)[number];

export interface MapCanvasCursor {
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  insideMap: boolean;
}

export type MapCanvasSelection =
  | { kind: "object"; objectId: string }
  | { kind: "tile"; tilesetId: string; tileIndex: number }
  | null;

export interface MapCanvasAsset {
  id: string;
  url: string;
}

export interface MapCanvasProps {
  assets?: readonly MapCanvasAsset[];
  document: MapDocumentV1;
  activeLayerKey: string;
  selectedTilesetId: string | null;
  selectedTileIndex: number | null;
  /** Bloco escolhido na paleta: o pincel carimba `cols × rows` tiles. */
  selectedTileSpan?: { cols: number; rows: number };
  /** Retângulo de tiles pintados sob a ferramenta "selecionar área". */
  tileSelection?: TileRect | null;
  onTileSelectionChange?: (selection: TileRect | null) => void;
  tool: MapEditorTool;
  preview: boolean;
  readOnly: boolean;
  selectedObjectId: string | null;
  onDocumentChange: (document: MapDocumentV1, description?: string) => void;
  onSelection: (selection: MapCanvasSelection) => void;
  onCursor: (cursor: MapCanvasCursor) => void;
  onZoom: (zoom: number) => void;
  ariaLabel?: string;
}

interface SceneBridge {
  syncFromProps: () => void;
  /** Só o overlay da seleção de área — não redesenha o mapa. */
  redrawTileSelection: () => void;
}

interface CellCoordinate {
  column: number;
  row: number;
}

interface PanGesture {
  pointerX: number;
  pointerY: number;
  scrollX: number;
  scrollY: number;
}

interface RectangleGesture {
  tool: "collision" | "private-zone" | "meeting-room" | "desk";
  start: CellCoordinate;
  current: CellCoordinate;
}

interface FreeTileDragGesture {
  objectId: string;
  offsetX: number;
  offsetY: number;
}

/** Arrasto que desenha o retângulo de seleção de tiles. */
interface AreaSelectGesture {
  start: TileCell;
  current: TileCell;
}

/** Arrasto que carrega a seleção (e os tiles dentro dela) para outro lugar. */
interface AreaMoveGesture {
  origin: TileRect;
  grab: TileCell;
  current: TileCell;
}

/** Cor do retângulo de seleção de tiles (âmbar, distinta dos objetos). */
const AREA_SELECT_COLOR = 0xfbbf24;

const OBJECT_COLORS: Record<MapObjectV1["type"], number> = {
  collision: 0xef4444,
  "spawn-point": 0x22c55e,
  "private-zone": 0x8b5cf6,
  "meeting-room": 0x06b6d4,
  desk: 0x84cc16,
  door: 0xf59e0b,
  link: 0x3b82f6,
  "action-point": 0xec4899,
  "tile-object": 0xfacc15,
};

const RECTANGLE_TOOLS = new Set<MapEditorTool>([
  "collision",
  "private-zone",
  "meeting-room",
  "desk",
]);

const INTERACTIVE_TOOLS = new Set<MapEditorTool>([
  "door",
  "link",
  "action-point",
]);

function cloneDocument(document: MapDocumentV1): MapDocumentV1 {
  return structuredClone(document);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function colorFromHex(value: string): number {
  return Number.parseInt(value.slice(1, 7), 16);
}

function tilePlaceholderColor(reference: string): number {
  let hash = 2166136261;
  for (let index = 0; index < reference.length; index += 1) {
    hash ^= reference.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const red = 70 + ((hash >>> 16) & 0x7f);
  const green = 70 + ((hash >>> 8) & 0x7f);
  const blue = 70 + (hash & 0x7f);
  return (red << 16) | (green << 8) | blue;
}

function pointOnSegment(
  point: PointCoordinatesV1,
  start: PointCoordinatesV1,
  end: PointCoordinatesV1,
): boolean {
  const crossProduct =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(crossProduct) > 0.001) return false;

  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function pointInPolygon(
  point: PointCoordinatesV1,
  polygon: PointCoordinatesV1[],
): boolean {
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]!;
    const previous = polygon[previousIndex]!;
    if (pointOnSegment(point, previous, current)) return true;

    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crossesRay) inside = !inside;
  }

  return inside;
}

function geometryAnchor(geometry: MapGeometryV1): PointCoordinatesV1 {
  if (geometry.kind === "point") return { x: geometry.x, y: geometry.y };
  if (geometry.kind === "rectangle") {
    return {
      x: geometry.x + geometry.width / 2,
      y: geometry.y + geometry.height / 2,
    };
  }

  const totals = geometry.points.reduce(
    (result, point) => ({ x: result.x + point.x, y: result.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: totals.x / geometry.points.length,
    y: totals.y / geometry.points.length,
  };
}

function objectLabel(object: MapObjectV1): string {
  switch (object.type) {
    case "spawn-point":
      return object.properties.name;
    case "collision":
      return object.properties.name ?? "Colisão";
    case "private-zone":
    case "meeting-room":
      return object.properties.name;
    case "desk":
      return object.properties.name;
    case "door":
      return object.properties.label ?? "Porta";
    case "link":
    case "action-point":
      return object.properties.label;
    case "tile-object":
      return `Tile ${object.properties.tileIndex}`;
  }
}

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function objectLayerForTool(tool: MapEditorTool): ReservedMapLayerKey | null {
  switch (tool) {
    case "collision":
      return "collision";
    case "spawn":
      return "spawn-points";
    case "private-zone":
      return "private-zones";
    case "meeting-room":
      return "meeting-rooms";
    case "desk":
      return "desks";
    case "door":
    case "link":
    case "action-point":
      return "interactive-objects";
    default:
      return null;
  }
}

export function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const sceneRef = useRef<SceneBridge | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  propsRef.current = props;

  useEffect(() => {
    sceneRef.current?.syncFromProps();
  }, [
    props.activeLayerKey,
    props.assets,
    props.document,
    props.preview,
    props.selectedObjectId,
  ]);

  useEffect(() => {
    sceneRef.current?.redrawTileSelection();
  }, [props.tileSelection, props.tool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let game: Phaser.Game | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initialize(target: HTMLDivElement) {
      try {
        const PhaserRuntime = (await import("phaser")).default;
        if (disposed) return;

        class EditorScene extends PhaserRuntime.Scene implements SceneBridge {
          private content: Phaser.GameObjects.Container | null = null;
          private draftGraphics: Phaser.GameObjects.Graphics | null = null;
          private currentDocument = cloneDocument(propsRef.current.document);
          private previousMapSize = "";
          private previousSelectedObjectId: string | null = null;
          private panGesture: PanGesture | null = null;
          private rectangleGesture: RectangleGesture | null = null;
          private freeTileDragGesture: FreeTileDragGesture | null = null;
          private areaSelectGesture: AreaSelectGesture | null = null;
          private areaMoveGesture: AreaMoveGesture | null = null;
          private selectionGraphics: Phaser.GameObjects.Graphics | null = null;
          private painting = false;
          private lastPaintedCell = "";
          private spaceKey: Phaser.Input.Keyboard.Key | null = null;
          private readonly requestedAssetUrls = new Map<string, string>();

          constructor() {
            super({ key: "MapEditorCanvas" });
          }

          create() {
            this.content = this.add.container(0, 0);
            this.draftGraphics = this.add.graphics().setDepth(10_000);
            this.selectionGraphics = this.add.graphics().setDepth(9_500);
            this.cameras.main.roundPixels = true;
            this.input.mouse?.disableContextMenu();
            this.spaceKey =
              this.input.keyboard?.addKey(
                PhaserRuntime.Input.Keyboard.KeyCodes.SPACE,
                true,
              ) ?? null;

            this.input.on("pointerdown", this.handlePointerDown, this);
            this.input.on("pointermove", this.handlePointerMove, this);
            this.input.on("pointerup", this.handlePointerUp, this);
            this.input.on("pointerupoutside", this.handlePointerUp, this);
            this.input.on("wheel", this.handleWheel, this);

            sceneRef.current = this;
            this.syncFromProps(true);
          }

          syncFromProps(forceCenter = false) {
            this.currentDocument = cloneDocument(propsRef.current.document);
            this.ensureAssetTextures();
            this.renderDocument(forceCenter);
            this.redrawTileSelection();
            const selectedObjectId = propsRef.current.selectedObjectId;
            if (
              selectedObjectId &&
              selectedObjectId !== this.previousSelectedObjectId &&
              propsRef.current.tool !== "free-select"
            ) {
              const selected = this.currentDocument.objects.find(
                ({ id }) => id === selectedObjectId,
              );
              if (selected) {
                const anchor = geometryAnchor(selected.geometry);
                this.cameras.main.centerOn(anchor.x, anchor.y);
              }
            }
            this.previousSelectedObjectId = selectedObjectId;
          }

          private textureKey(assetId: string) {
            return `map-asset-${assetId}`;
          }

          private ensureAssetTextures() {
            const pending = (propsRef.current.assets ?? []).filter((asset) => {
              const textureKey = this.textureKey(asset.id);
              return (
                !this.textures.exists(textureKey) &&
                this.requestedAssetUrls.get(asset.id) !== asset.url
              );
            });
            if (pending.length === 0) return;

            pending.forEach((asset) => {
              this.requestedAssetUrls.set(asset.id, asset.url);
              this.load.image(this.textureKey(asset.id), asset.url);
            });
            this.load.once(PhaserRuntime.Loader.Events.COMPLETE, () => {
              if (!disposed) this.renderDocument();
            });
            if (!this.load.isLoading()) this.load.start();
          }

          private mapWidth() {
            return (
              this.currentDocument.map.width *
              this.currentDocument.map.tileWidth
            );
          }

          private mapHeight() {
            return (
              this.currentDocument.map.height *
              this.currentDocument.map.tileHeight
            );
          }

          private renderDocument(forceCenter = false) {
            if (!this.content) return;

            this.content.removeAll(true);
            const backgroundGraphics = this.add.graphics();
            this.content.add(backgroundGraphics);

            const { activeLayerKey, preview, selectedObjectId } =
              propsRef.current;
            const document = this.currentDocument;
            const mapWidth = this.mapWidth();
            const mapHeight = this.mapHeight();
            const mapSize = `${mapWidth}x${mapHeight}`;

            this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
            this.cameras.main.setBackgroundColor(0x0e1424);

            if (forceCenter || mapSize !== this.previousMapSize) {
              const horizontalFit = (this.scale.width * 0.9) / mapWidth;
              const verticalFit = (this.scale.height * 0.9) / mapHeight;
              const zoom = clamp(
                Math.min(horizontalFit, verticalFit, 1),
                MAP_DOCUMENT_V1_LIMITS.minZoom,
                MAP_DOCUMENT_V1_LIMITS.maxZoom,
              );
              this.cameras.main.setZoom(zoom);
              this.cameras.main.centerOn(mapWidth / 2, mapHeight / 2);
              propsRef.current.onZoom(zoom);
              this.previousMapSize = mapSize;
            }

            backgroundGraphics.fillStyle(
              colorFromHex(document.map.backgroundColor),
              1,
            );
            backgroundGraphics.fillRect(0, 0, mapWidth, mapHeight);

            const layers = [...document.layers].sort(
              (first, second) => first.zIndex - second.zIndex,
            );
            layers.forEach((layer) => {
              if (layer.type !== "tile" || !layer.visible) return;
              this.drawTileLayer(layer);
            });

            const gridGraphics = this.add.graphics();
            this.content.add(gridGraphics);
            const gridAlpha = preview ? 0.06 : 0.15;
            gridGraphics.lineStyle(1, 0xcbd5e1, gridAlpha);
            for (let x = 0; x <= mapWidth; x += document.map.tileWidth) {
              gridGraphics.lineBetween(x, 0, x, mapHeight);
            }
            for (let y = 0; y <= mapHeight; y += document.map.tileHeight) {
              gridGraphics.lineBetween(0, y, mapWidth, y);
            }

            const activeLayer = document.layers.find(
              ({ key }) => key === activeLayerKey,
            );
            if (activeLayer?.visible && !preview) {
              gridGraphics.lineStyle(2, 0xa78bfa, 0.85);
              gridGraphics.strokeRect(0, 0, mapWidth, mapHeight);
            } else {
              gridGraphics.lineStyle(2, 0x64748b, 0.9);
              gridGraphics.strokeRect(0, 0, mapWidth, mapHeight);
            }
            if (!preview) this.drawRulers();

            const layerByKey = new Map(
              document.layers.map((layer) => [layer.key, layer]),
            );
            const objects = [...document.objects]
              .filter(
                (object) => layerByKey.get(object.layerKey)?.visible !== false,
              )
              .sort(
                (first, second) =>
                  (layerByKey.get(first.layerKey)?.zIndex ?? 0) -
                  (layerByKey.get(second.layerKey)?.zIndex ?? 0),
              );

            objects.forEach((object) => {
              const selected = object.id === selectedObjectId;
              if (object.type === "tile-object") {
                this.drawTileObject(object, selected, preview);
                return;
              }
              const objectGraphics = this.add.graphics();
              this.content?.add(objectGraphics);
              this.drawObject(objectGraphics, object, selected, preview);

              const showLabel =
                selected ||
                preview ||
                object.type === "spawn-point" ||
                object.type === "meeting-room";
              if (!showLabel) return;

              const anchor = geometryAnchor(object.geometry);
              const text = this.add
                .text(anchor.x, anchor.y, objectLabel(object), {
                  color: "#f8fafc",
                  fontFamily: "Inter, Segoe UI, sans-serif",
                  fontSize: `${Math.max(10, document.map.tileWidth * 0.34)}px`,
                  backgroundColor: "rgba(15, 23, 42, 0.78)",
                  padding: { x: 4, y: 2 },
                })
                .setOrigin(0.5, 0.5);
              this.content?.add(text);
            });
          }

          private drawRulers() {
            const { width, height, tileWidth, tileHeight } =
              this.currentDocument.map;
            const style: Phaser.Types.GameObjects.Text.TextStyle = {
              color: "#cbd5e1",
              fontFamily: "Inter, Segoe UI, sans-serif",
              fontSize: `${Math.max(8, Math.floor(tileWidth * 0.25))}px`,
              backgroundColor: "rgba(15, 23, 42, 0.72)",
              padding: { x: 2, y: 1 },
            };
            for (let column = 0; column < width; column += 5) {
              this.content?.add(
                this.add.text(column * tileWidth + 2, 2, String(column), style),
              );
            }
            for (let row = 5; row < height; row += 5) {
              this.content?.add(
                this.add.text(2, row * tileHeight + 2, String(row), style),
              );
            }
          }

          private drawTileLayer(layer: MapTileLayerV1) {
            const graphics = this.add.graphics();
            this.content?.add(graphics);
            const { width, tileWidth, tileHeight } = this.currentDocument.map;
            const tilesets = new Map(
              this.currentDocument.tilesets.map((tileset) => [
                tileset.id,
                tileset,
              ]),
            );
            layer.data.forEach((reference, index) => {
              if (reference === null) return;
              const column = index % width;
              const row = Math.floor(index / width);
              const separator = reference.lastIndexOf(":");
              const tilesetId = reference.slice(0, separator);
              const tileIndex = Number(reference.slice(separator + 1));
              const tileset = tilesets.get(tilesetId);
              const asset = (propsRef.current.assets ?? []).find(
                ({ id }) => id === tileset?.assetId,
              );
              const textureKey = asset ? this.textureKey(asset.id) : null;
              if (
                tileset &&
                textureKey &&
                this.textures.exists(textureKey) &&
                Number.isInteger(tileIndex)
              ) {
                const tileColumn = tileIndex % tileset.columns;
                const tileRow = Math.floor(tileIndex / tileset.columns);
                const frameName = `${tileset.id}-${tileIndex}`;
                const texture = this.textures.get(textureKey);
                if (!texture.has(frameName)) {
                  texture.add(
                    frameName,
                    0,
                    tileColumn * tileset.tileWidth,
                    tileRow * tileset.tileHeight,
                    tileset.tileWidth,
                    tileset.tileHeight,
                  );
                }
                const image = this.add
                  .image(
                    column * tileWidth,
                    row * tileHeight,
                    textureKey,
                    frameName,
                  )
                  .setOrigin(0, 0)
                  .setDisplaySize(tileWidth, tileHeight)
                  .setAlpha(layer.opacity);
                this.content?.add(image);
                return;
              }
              graphics.fillStyle(
                tilePlaceholderColor(reference),
                0.78 * layer.opacity,
              );
              graphics.fillRect(
                column * tileWidth,
                row * tileHeight,
                tileWidth,
                tileHeight,
              );
            });
          }

          private drawObject(
            graphics: Phaser.GameObjects.Graphics,
            object: MapObjectV1,
            selected: boolean,
            preview: boolean,
          ) {
            const color = selected ? 0xfacc15 : OBJECT_COLORS[object.type];
            const alpha = selected ? 0.38 : preview ? 0.3 : 0.2;
            const lineWidth = selected ? 4 : 2;
            graphics.fillStyle(color, alpha);
            graphics.lineStyle(lineWidth, color, selected ? 1 : 0.9);

            if (object.geometry.kind === "point") {
              const radius = Math.max(
                6,
                this.currentDocument.map.tileWidth / 4,
              );
              graphics.fillCircle(object.geometry.x, object.geometry.y, radius);
              graphics.strokeCircle(
                object.geometry.x,
                object.geometry.y,
                radius,
              );
              graphics.lineBetween(
                object.geometry.x - radius * 1.5,
                object.geometry.y,
                object.geometry.x + radius * 1.5,
                object.geometry.y,
              );
              graphics.lineBetween(
                object.geometry.x,
                object.geometry.y - radius * 1.5,
                object.geometry.x,
                object.geometry.y + radius * 1.5,
              );
              return;
            }

            if (object.geometry.kind === "rectangle") {
              graphics.fillRect(
                object.geometry.x,
                object.geometry.y,
                object.geometry.width,
                object.geometry.height,
              );
              graphics.strokeRect(
                object.geometry.x,
                object.geometry.y,
                object.geometry.width,
                object.geometry.height,
              );
              return;
            }

            this.drawPolygon(graphics, object.geometry);
          }

          private drawTileObject(
            object: TileObjectV1,
            selected: boolean,
            preview: boolean,
          ) {
            const tileset = this.currentDocument.tilesets.find(
              ({ id }) => id === object.properties.tilesetId,
            );
            const asset = (propsRef.current.assets ?? []).find(
              ({ id }) => id === tileset?.assetId,
            );
            const layer = this.currentDocument.layers.find(
              ({ key }) => key === object.layerKey,
            );
            const textureKey = asset ? this.textureKey(asset.id) : null;

            if (
              tileset &&
              textureKey &&
              this.textures.exists(textureKey) &&
              object.properties.tileIndex < tileset.tileCount
            ) {
              const tileIndex = object.properties.tileIndex;
              const frameName = `${tileset.id}-${tileIndex}`;
              const texture = this.textures.get(textureKey);
              if (!texture.has(frameName)) {
                texture.add(
                  frameName,
                  0,
                  (tileIndex % tileset.columns) * tileset.tileWidth,
                  Math.floor(tileIndex / tileset.columns) * tileset.tileHeight,
                  tileset.tileWidth,
                  tileset.tileHeight,
                );
              }
              const image = this.add
                .image(
                  object.geometry.x,
                  object.geometry.y,
                  textureKey,
                  frameName,
                )
                .setOrigin(0, 0)
                .setDisplaySize(
                  object.geometry.width,
                  object.geometry.height,
                )
                .setAlpha(layer?.opacity ?? 1);
              this.content?.add(image);
            } else {
              const placeholder = this.add.graphics();
              placeholder.fillStyle(
                tilePlaceholderColor(
                  `${object.properties.tilesetId}:${object.properties.tileIndex}`,
                ),
                0.78 * (layer?.opacity ?? 1),
              );
              placeholder.fillRect(
                object.geometry.x,
                object.geometry.y,
                object.geometry.width,
                object.geometry.height,
              );
              this.content?.add(placeholder);
            }

            if (selected && !preview) {
              const outline = this.add.graphics();
              outline.lineStyle(2 / this.cameras.main.zoom, 0xfacc15, 1);
              outline.strokeRect(
                object.geometry.x,
                object.geometry.y,
                object.geometry.width,
                object.geometry.height,
              );
              this.content?.add(outline);
            }
          }

          private drawPolygon(
            graphics: Phaser.GameObjects.Graphics,
            geometry: PolygonGeometryV1,
          ) {
            const [first, ...remaining] = geometry.points;
            if (!first) return;
            graphics.beginPath();
            graphics.moveTo(first.x, first.y);
            remaining.forEach((point) => graphics.lineTo(point.x, point.y));
            graphics.closePath();
            graphics.fillPath();
            graphics.strokePath();
          }

          private pointerWorld(pointer: Phaser.Input.Pointer) {
            return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          }

          private cellAt(
            x: number,
            y: number,
            clampToMap = false,
          ): CellCoordinate | null {
            const { width, height, tileWidth, tileHeight } =
              this.currentDocument.map;
            let column = Math.floor(x / tileWidth);
            let row = Math.floor(y / tileHeight);

            if (clampToMap) {
              column = clamp(column, 0, width - 1);
              row = clamp(row, 0, height - 1);
            } else if (
              column < 0 ||
              row < 0 ||
              column >= width ||
              row >= height
            ) {
              return null;
            }

            return { column, row };
          }

          private emitCursor(pointer: Phaser.Input.Pointer) {
            const world = this.pointerWorld(pointer);
            const cell = this.cellAt(world.x, world.y);
            propsRef.current.onCursor({
              x: Math.round(world.x),
              y: Math.round(world.y),
              tileX:
                cell?.column ??
                Math.floor(world.x / this.currentDocument.map.tileWidth),
              tileY:
                cell?.row ??
                Math.floor(world.y / this.currentDocument.map.tileHeight),
              insideMap: cell !== null,
            });
          }

          private handlePointerDown(pointer: Phaser.Input.Pointer) {
            this.game.canvas.focus({ preventScroll: true });
            this.emitCursor(pointer);

            const shouldPan =
              propsRef.current.tool === "hand" ||
              this.spaceKey?.isDown === true ||
              pointer.middleButtonDown() ||
              pointer.rightButtonDown();
            if (shouldPan) {
              this.panGesture = {
                pointerX: pointer.x,
                pointerY: pointer.y,
                scrollX: this.cameras.main.scrollX,
                scrollY: this.cameras.main.scrollY,
              };
              return;
            }

            if (!pointer.leftButtonDown()) return;
            const world = this.pointerWorld(pointer);
            const cell = this.cellAt(world.x, world.y);
            if (!cell) return;

            if (propsRef.current.tool === "select") {
              this.selectObjectAt(world.x, world.y);
              return;
            }

            if (propsRef.current.tool === "free-select") {
              this.beginFreeTileSelection(world.x, world.y, cell);
              return;
            }

            if (propsRef.current.tool === "area-select") {
              this.beginAreaSelection(cell);
              return;
            }

            if (propsRef.current.tool === "eyedropper") {
              this.pickTile(cell);
              return;
            }

            if (propsRef.current.readOnly || propsRef.current.preview) return;

            if (
              propsRef.current.tool === "brush" ||
              propsRef.current.tool === "eraser"
            ) {
              this.painting = true;
              this.lastPaintedCell = "";
              this.paintCell(cell, propsRef.current.tool);
              return;
            }

            if (propsRef.current.tool === "fill") {
              this.fillArea(cell);
              return;
            }

            if (RECTANGLE_TOOLS.has(propsRef.current.tool)) {
              const tool = propsRef.current.tool;
              if (
                tool === "collision" ||
                tool === "private-zone" ||
                tool === "meeting-room" ||
                tool === "desk"
              ) {
                if (!this.canEditObjectLayer(tool)) return;
                this.rectangleGesture = { tool, start: cell, current: cell };
                this.drawRectangleGesture();
              }
              return;
            }

            if (
              propsRef.current.tool === "spawn" ||
              INTERACTIVE_TOOLS.has(propsRef.current.tool)
            ) {
              this.createPointObject(propsRef.current.tool, cell);
            }
          }

          private handlePointerMove(pointer: Phaser.Input.Pointer) {
            this.emitCursor(pointer);

            if (this.panGesture) {
              if (!pointer.isDown) {
                this.panGesture = null;
                return;
              }
              const camera = this.cameras.main;
              camera.scrollX =
                this.panGesture.scrollX -
                (pointer.x - this.panGesture.pointerX) / camera.zoom;
              camera.scrollY =
                this.panGesture.scrollY -
                (pointer.y - this.panGesture.pointerY) / camera.zoom;
              return;
            }

            const world = this.pointerWorld(pointer);
            if (this.freeTileDragGesture) {
              if (!pointer.isDown) {
                this.freeTileDragGesture = null;
                return;
              }
              this.moveFreeTile(world.x, world.y);
              return;
            }
            if (this.painting && pointer.isDown) {
              const cell = this.cellAt(world.x, world.y);
              if (
                cell &&
                (propsRef.current.tool === "brush" ||
                  propsRef.current.tool === "eraser")
              ) {
                this.paintCell(cell, propsRef.current.tool);
              }
            }

            if (this.areaSelectGesture || this.areaMoveGesture) {
              if (!pointer.isDown) {
                this.finishAreaGesture();
                return;
              }
              const cell = this.cellAt(world.x, world.y, true);
              if (cell) {
                if (this.areaSelectGesture) this.areaSelectGesture.current = cell;
                if (this.areaMoveGesture) this.areaMoveGesture.current = cell;
                this.redrawTileSelection();
              }
              return;
            }

            if (this.rectangleGesture) {
              const cell = this.cellAt(world.x, world.y, true);
              if (cell) {
                this.rectangleGesture.current = cell;
                this.drawRectangleGesture();
              }
            }
          }

          private handlePointerUp(pointer: Phaser.Input.Pointer) {
            this.emitCursor(pointer);
            this.panGesture = null;
            this.painting = false;
            this.lastPaintedCell = "";
            this.freeTileDragGesture = null;

            if (this.areaSelectGesture || this.areaMoveGesture) {
              this.finishAreaGesture();
              return;
            }

            if (!this.rectangleGesture) return;
            const gesture = this.rectangleGesture;
            this.rectangleGesture = null;
            this.draftGraphics?.clear();
            this.createRectangleObject(gesture);
          }

          private handleWheel(
            pointer: Phaser.Input.Pointer,
            _objects: Phaser.GameObjects.GameObject[],
            _deltaX: number,
            deltaY: number,
          ) {
            const camera = this.cameras.main;
            const before = camera.getWorldPoint(pointer.x, pointer.y);
            const factor = deltaY > 0 ? 0.9 : 1.1;
            const nextZoom = clamp(
              camera.zoom * factor,
              MAP_DOCUMENT_V1_LIMITS.minZoom,
              MAP_DOCUMENT_V1_LIMITS.maxZoom,
            );
            if (nextZoom === camera.zoom) return;

            camera.setZoom(nextZoom);
            camera.preRender();
            const after = camera.getWorldPoint(pointer.x, pointer.y);
            camera.scrollX += before.x - after.x;
            camera.scrollY += before.y - after.y;
            propsRef.current.onZoom(nextZoom);
          }

          private editableTileLayer(document = this.currentDocument) {
            if (propsRef.current.readOnly || propsRef.current.preview)
              return null;
            const layer = document.layers.find(
              ({ key }) => key === propsRef.current.activeLayerKey,
            );
            if (layer?.type !== "tile" || layer.locked || !layer.visible) {
              return null;
            }
            return layer;
          }

          /** Grade do mapa em células, para as operações de `tileRegion`. */
          private tileGrid() {
            return {
              width: this.currentDocument.map.width,
              height: this.currentDocument.map.height,
            };
          }

          /** Bloco de tiles escolhido na paleta (1×1 quando não há bloco). */
          private selectedStamp(): {
            tiles: StampTile[];
            span: { cols: number; rows: number };
          } | null {
            const { selectedTilesetId, selectedTileIndex, selectedTileSpan } =
              propsRef.current;
            if (selectedTilesetId === null || selectedTileIndex === null)
              return null;
            const tileset = this.currentDocument.tilesets.find(
              ({ id }) => id === selectedTilesetId,
            );
            if (!tileset) return null;

            const span = {
              cols: Math.max(1, selectedTileSpan?.cols ?? 1),
              rows: Math.max(1, selectedTileSpan?.rows ?? 1),
            };
            const tiles = tileStamp({
              tilesetId: selectedTilesetId,
              columns: tileset.columns,
              tileCount: tileset.tileCount,
              tileIndex: selectedTileIndex,
              ...span,
            });
            return tiles.length > 0 ? { tiles, span } : null;
          }

          private paintCell(cell: CellCoordinate, tool: "brush" | "eraser") {
            const cellKey = `${cell.column}:${cell.row}:${tool}`;
            if (cellKey === this.lastPaintedCell) return;
            this.lastPaintedCell = cellKey;

            const nextDocument = cloneDocument(this.currentDocument);
            const layer = this.editableTileLayer(nextDocument);
            if (!layer) return;

            // A borracha continua apagando um tile por vez: o bloco da paleta
            // diz o que pintar, não a espessura do apagador.
            if (tool === "eraser") {
              const index = cell.row * nextDocument.map.width + cell.column;
              if (layer.data[index] === null) return;
              layer.data[index] = null;
              this.commitDocument(nextDocument, "Apagar tile");
              return;
            }

            const stamp = this.selectedStamp();
            if (!stamp) return;
            const painted = paintStamp(
              layer.data,
              this.tileGrid(),
              cell,
              stamp.tiles,
            );
            if (!painted) return;
            layer.data = painted;
            this.commitDocument(
              nextDocument,
              stamp.tiles.length > 1 ? "Pintar tiles" : "Pintar tile",
            );
          }

          private fillArea(cell: CellCoordinate) {
            const stamp = this.selectedStamp();
            if (!stamp) return;

            const nextDocument = cloneDocument(this.currentDocument);
            const layer = this.editableTileLayer(nextDocument);
            if (!layer) return;

            const filled = fillWithStamp(
              layer.data,
              this.tileGrid(),
              cell,
              stamp.tiles,
              stamp.span,
            );
            if (!filled) return;
            layer.data = filled;
            this.commitDocument(nextDocument, "Preencher área");
          }

          private pickTile(cell: CellCoordinate) {
            const layer = this.currentDocument.layers.find(
              ({ key }) => key === propsRef.current.activeLayerKey,
            );
            if (layer?.type !== "tile") {
              propsRef.current.onSelection(null);
              return;
            }

            const index =
              cell.row * this.currentDocument.map.width + cell.column;
            const reference = layer.data[index];
            if (!reference) {
              propsRef.current.onSelection(null);
              return;
            }

            const separator = reference.lastIndexOf(":");
            const tilesetId = reference.slice(0, separator);
            const tileIndex = Number(reference.slice(separator + 1));
            if (!tilesetId || !Number.isSafeInteger(tileIndex)) {
              propsRef.current.onSelection(null);
              return;
            }
            propsRef.current.onSelection({
              kind: "tile",
              tilesetId,
              tileIndex,
            });
          }

          private visibleObjects() {
            const layerByKey = new Map(
              this.currentDocument.layers.map((layer) => [layer.key, layer]),
            );
            return [...this.currentDocument.objects]
              .filter(
                (object) => layerByKey.get(object.layerKey)?.visible !== false,
              )
              .sort(
                (first, second) =>
                  (layerByKey.get(second.layerKey)?.zIndex ?? 0) -
                  (layerByKey.get(first.layerKey)?.zIndex ?? 0),
              );
          }

          private selectObjectAt(x: number, y: number) {
            const selected = this.visibleObjects().find((object) =>
              this.geometryContainsPoint(object.geometry, x, y),
            );
            propsRef.current.onSelection(
              selected ? { kind: "object", objectId: selected.id } : null,
            );
          }

          private beginFreeTileSelection(
            x: number,
            y: number,
            cell: CellCoordinate,
          ) {
            const existing = this.visibleObjects().find(
              (object): object is TileObjectV1 =>
                object.type === "tile-object" &&
                this.geometryContainsPoint(object.geometry, x, y),
            );
            if (existing) {
              propsRef.current.onSelection({
                kind: "object",
                objectId: existing.id,
              });
              if (this.canEditVisualLayer(existing.layerKey)) {
                this.freeTileDragGesture = {
                  objectId: existing.id,
                  offsetX: x - existing.geometry.x,
                  offsetY: y - existing.geometry.y,
                };
              }
              return;
            }

            const layer = this.editableTileLayer();
            if (!layer) {
              propsRef.current.onSelection(null);
              return;
            }
            const cellIndex =
              cell.row * this.currentDocument.map.width + cell.column;
            const reference = layer.data[cellIndex];
            if (!reference) {
              propsRef.current.onSelection(null);
              return;
            }
            if (
              this.currentDocument.objects.length >=
              MAP_DOCUMENT_V1_LIMITS.maxObjects
            ) {
              return;
            }
            const separator = reference.lastIndexOf(":");
            const tilesetId = reference.slice(0, separator);
            const tileIndex = Number(reference.slice(separator + 1));
            const tileset = this.currentDocument.tilesets.find(
              ({ id }) => id === tilesetId,
            );
            if (
              !tileset ||
              !Number.isSafeInteger(tileIndex) ||
              tileIndex < 0 ||
              tileIndex >= tileset.tileCount
            ) {
              return;
            }

            const object: TileObjectV1 = {
              id: `tile-object-${randomToken()}`,
              layerKey: layer.key,
              type: "tile-object",
              geometry: {
                kind: "rectangle",
                x: cell.column * this.currentDocument.map.tileWidth,
                y: cell.row * this.currentDocument.map.tileHeight,
                width: tileset.tileWidth,
                height: tileset.tileHeight,
              },
              properties: { tilesetId, tileIndex },
            };
            const nextDocument = cloneDocument(this.currentDocument);
            const nextLayer = nextDocument.layers.find(
              (candidate) => candidate.key === layer.key,
            );
            if (nextLayer?.type !== "tile") return;
            nextLayer.data[cellIndex] = null;
            nextDocument.objects.push(object);
            this.freeTileDragGesture = {
              objectId: object.id,
              offsetX: x - object.geometry.x,
              offsetY: y - object.geometry.y,
            };
            this.commitDocument(nextDocument, "Mover objeto livre");
            propsRef.current.onSelection({
              kind: "object",
              objectId: object.id,
            });
          }

          private canEditVisualLayer(layerKey: string) {
            if (propsRef.current.readOnly || propsRef.current.preview)
              return false;
            const layer = this.currentDocument.layers.find(
              ({ key }) => key === layerKey,
            );
            return layer?.type === "tile" && layer.visible && !layer.locked;
          }

          private moveFreeTile(pointerX: number, pointerY: number) {
            const gesture = this.freeTileDragGesture;
            if (!gesture) return;
            const current = this.currentDocument.objects.find(
              (object): object is TileObjectV1 =>
                object.id === gesture.objectId && object.type === "tile-object",
            );
            if (!current || !this.canEditVisualLayer(current.layerKey)) return;

            const nextX = Math.round(
              clamp(
                pointerX - gesture.offsetX,
                0,
                this.mapWidth() - current.geometry.width,
              ),
            );
            const nextY = Math.round(
              clamp(
                pointerY - gesture.offsetY,
                0,
                this.mapHeight() - current.geometry.height,
              ),
            );
            if (nextX === current.geometry.x && nextY === current.geometry.y)
              return;

            const nextDocument = cloneDocument(this.currentDocument);
            const moved = nextDocument.objects.find(
              (object): object is TileObjectV1 =>
                object.id === gesture.objectId && object.type === "tile-object",
            );
            if (!moved) return;
            moved.geometry.x = nextX;
            moved.geometry.y = nextY;
            this.commitDocument(nextDocument, "Mover objeto livre");
          }

          private geometryContainsPoint(
            geometry: MapGeometryV1,
            x: number,
            y: number,
          ) {
            if (geometry.kind === "point") {
              const hitRadius = Math.max(
                this.currentDocument.map.tileWidth / 3,
                10 / this.cameras.main.zoom,
              );
              return Math.hypot(x - geometry.x, y - geometry.y) <= hitRadius;
            }
            if (geometry.kind === "rectangle") {
              return (
                x >= geometry.x &&
                x <= geometry.x + geometry.width &&
                y >= geometry.y &&
                y <= geometry.y + geometry.height
              );
            }
            return pointInPolygon({ x, y }, geometry.points);
          }

          private canEditObjectLayer(tool: MapEditorTool) {
            if (propsRef.current.readOnly || propsRef.current.preview)
              return false;
            const layerKey = objectLayerForTool(tool);
            if (!layerKey) return false;
            const layer = this.currentDocument.layers.find(
              ({ key }) => key === layerKey,
            );
            return layer?.type === "object" && layer.visible && !layer.locked;
          }

          private pointAtCellCenter(cell: CellCoordinate) {
            const { tileWidth, tileHeight } = this.currentDocument.map;
            return {
              x: cell.column * tileWidth + Math.floor(tileWidth / 2),
              y: cell.row * tileHeight + Math.floor(tileHeight / 2),
            };
          }

          private createPointObject(tool: MapEditorTool, cell: CellCoordinate) {
            if (!this.canEditObjectLayer(tool)) return;

            const token = randomToken();
            const point = this.pointAtCellCenter(cell);
            let object: MapObjectV1 | null = null;

            if (tool === "spawn") {
              const spawnNumber =
                this.currentDocument.objects.filter(
                  ({ type }) => type === "spawn-point",
                ).length + 1;
              object = {
                id: `spawn-${token}`,
                layerKey: "spawn-points",
                type: "spawn-point",
                geometry: { kind: "point", ...point },
                properties: {
                  name: `Entrada ${spawnNumber}`,
                  isDefault: !this.currentDocument.objects.some(
                    (candidate) =>
                      candidate.type === "spawn-point" &&
                      candidate.properties.isDefault,
                  ),
                },
              };
            } else if (tool === "door") {
              object = {
                id: `door-${token}`,
                layerKey: "interactive-objects",
                type: "door",
                geometry: { kind: "point", ...point },
                properties: { key: `door-${token}` },
              };
            } else if (tool === "link") {
              object = {
                id: `link-${token}`,
                layerKey: "interactive-objects",
                type: "link",
                geometry: { kind: "point", ...point },
                properties: {
                  key: `link-${token}`,
                  label: "Novo link",
                  url: "https://example.com",
                },
              };
            } else if (tool === "action-point") {
              object = {
                id: `action-${token}`,
                layerKey: "interactive-objects",
                type: "action-point",
                geometry: { kind: "point", ...point },
                properties: {
                  key: `action-${token}`,
                  label: "Nova ação",
                  actionKey: `action-${token}`,
                },
              };
            }

            if (!object) return;
            const nextDocument = cloneDocument(this.currentDocument);
            nextDocument.objects.push(object);
            this.commitDocument(nextDocument, `Criar ${object.type}`);
            propsRef.current.onSelection({
              kind: "object",
              objectId: object.id,
            });
          }

          private rectangleFromGesture(
            gesture: RectangleGesture,
          ): RectangleGeometryV1 {
            // Mesa tem tamanho fixo: arrastar só reposiciona a âncora (célula sob o
            // cursor agora), nunca redimensiona.
            if (gesture.tool === "desk") {
              return deskPlacementGeometry(this.currentDocument, {
                column: gesture.current.column,
                row: gesture.current.row,
              });
            }
            const { tileWidth, tileHeight } = this.currentDocument.map;
            const minimumColumn = Math.min(
              gesture.start.column,
              gesture.current.column,
            );
            const maximumColumn = Math.max(
              gesture.start.column,
              gesture.current.column,
            );
            const minimumRow = Math.min(gesture.start.row, gesture.current.row);
            const maximumRow = Math.max(gesture.start.row, gesture.current.row);
            return {
              kind: "rectangle",
              x: minimumColumn * tileWidth,
              y: minimumRow * tileHeight,
              width: (maximumColumn - minimumColumn + 1) * tileWidth,
              height: (maximumRow - minimumRow + 1) * tileHeight,
            };
          }

          /**
           * Clique dentro da seleção pega os tiles para arrastar; fora dela,
           * começa uma seleção nova.
           */
          private beginAreaSelection(cell: CellCoordinate) {
            const selection = propsRef.current.tileSelection ?? null;
            if (
              selection &&
              rectContains(selection, cell) &&
              this.editableTileLayer()
            ) {
              this.areaMoveGesture = {
                origin: selection,
                grab: cell,
                current: cell,
              };
            } else {
              // Sem objeto selecionado o Delete pertence à área de tiles.
              propsRef.current.onSelection(null);
              propsRef.current.onTileSelectionChange?.(null);
              this.areaSelectGesture = { start: cell, current: cell };
            }
            this.redrawTileSelection();
          }

          /** Destino do arrasto, preso ao mapa para a seleção não sair pela borda. */
          private areaMoveTarget(gesture: AreaMoveGesture): TileCell {
            const { width, height } = this.currentDocument.map;
            return {
              column: clamp(
                gesture.origin.column + (gesture.current.column - gesture.grab.column),
                0,
                Math.max(0, width - gesture.origin.cols),
              ),
              row: clamp(
                gesture.origin.row + (gesture.current.row - gesture.grab.row),
                0,
                Math.max(0, height - gesture.origin.rows),
              ),
            };
          }

          private finishAreaGesture() {
            const selectGesture = this.areaSelectGesture;
            const moveGesture = this.areaMoveGesture;
            this.areaSelectGesture = null;
            this.areaMoveGesture = null;

            if (selectGesture) {
              propsRef.current.onTileSelectionChange?.(
                clampRect(
                  rectFromCells(selectGesture.start, selectGesture.current),
                  this.tileGrid(),
                ),
              );
            } else if (moveGesture) {
              const target = this.areaMoveTarget(moveGesture);
              const nextDocument = cloneDocument(this.currentDocument);
              const layer = this.editableTileLayer(nextDocument);
              const moved = layer
                ? moveRect(
                    layer.data,
                    this.tileGrid(),
                    moveGesture.origin,
                    target,
                  )
                : null;
              if (layer && moved) {
                layer.data = moved;
                propsRef.current.onTileSelectionChange?.({
                  ...moveGesture.origin,
                  ...target,
                });
                this.commitDocument(nextDocument, "Mover tiles");
              }
            }

            this.redrawTileSelection();
          }

          /**
           * Retângulo âmbar da ferramenta de área. Durante o arrasto de mover,
           * a origem fica esmaecida e o destino sólido.
           */
          redrawTileSelection() {
            const graphics = this.selectionGraphics;
            if (!graphics) return;
            graphics.clear();
            if (propsRef.current.tool !== "area-select") return;

            const { tileWidth, tileHeight } = this.currentDocument.map;
            const stroke = (rect: TileRect, alpha: number) => {
              graphics.fillStyle(AREA_SELECT_COLOR, alpha * 0.18);
              graphics.lineStyle(2, AREA_SELECT_COLOR, alpha);
              const x = rect.column * tileWidth;
              const y = rect.row * tileHeight;
              const width = rect.cols * tileWidth;
              const height = rect.rows * tileHeight;
              graphics.fillRect(x, y, width, height);
              graphics.strokeRect(x, y, width, height);
            };

            if (this.areaSelectGesture) {
              stroke(
                rectFromCells(
                  this.areaSelectGesture.start,
                  this.areaSelectGesture.current,
                ),
                1,
              );
              return;
            }

            if (this.areaMoveGesture) {
              stroke(this.areaMoveGesture.origin, 0.35);
              stroke(
                {
                  ...this.areaMoveGesture.origin,
                  ...this.areaMoveTarget(this.areaMoveGesture),
                },
                1,
              );
              return;
            }

            const selection = propsRef.current.tileSelection;
            if (selection) stroke(selection, 1);
          }

          private drawRectangleGesture() {
            const graphics = this.draftGraphics;
            const gesture = this.rectangleGesture;
            if (!graphics || !gesture) return;
            const rectangle = this.rectangleFromGesture(gesture);
            const color =
              gesture.tool === "collision"
                ? OBJECT_COLORS.collision
                : gesture.tool === "private-zone"
                  ? OBJECT_COLORS["private-zone"]
                  : gesture.tool === "desk"
                    ? OBJECT_COLORS.desk
                    : OBJECT_COLORS["meeting-room"];
            graphics.clear();
            graphics.fillStyle(color, 0.18);
            graphics.lineStyle(3, color, 1);
            graphics.fillRect(
              rectangle.x,
              rectangle.y,
              rectangle.width,
              rectangle.height,
            );
            graphics.strokeRect(
              rectangle.x,
              rectangle.y,
              rectangle.width,
              rectangle.height,
            );
          }

          private createRectangleObject(gesture: RectangleGesture) {
            if (!this.canEditObjectLayer(gesture.tool)) return;

            if (gesture.tool === "desk") {
              const objects = deskPlacementObjects(
                this.currentDocument,
                { column: gesture.current.column, row: gesture.current.row },
                randomToken(),
                { withRoom: this.canEditObjectLayer("meeting-room") },
              );
              const nextDocument = cloneDocument(this.currentDocument);
              nextDocument.objects.push(...objects);
              this.commitDocument(nextDocument, "Criar desk");
              propsRef.current.onSelection({
                kind: "object",
                objectId: objects[0]!.id,
              });
              return;
            }

            const token = randomToken();
            const geometry = this.rectangleFromGesture(gesture);
            let object: MapObjectV1;

            if (gesture.tool === "collision") {
              object = {
                id: `collision-${token}`,
                layerKey: "collision",
                type: "collision",
                geometry,
                properties: { name: "Nova colisão" },
              };
            } else if (gesture.tool === "private-zone") {
              object = {
                id: `private-zone-${token}`,
                layerKey: "private-zones",
                type: "private-zone",
                geometry,
                properties: {
                  name: "Nova zona privada",
                  externalKey: `private-${token}`,
                  accessPolicy: "ALLOWLIST",
                },
              };
            } else {
              object = {
                id: `meeting-room-${token}`,
                layerKey: "meeting-rooms",
                type: "meeting-room",
                geometry,
                properties: {
                  externalKey: `room-${token}`,
                  name: "Nova sala",
                  status: "OPEN",
                  voiceEnabled: true,
                  accessPolicy: "OPEN",
                },
              };
            }

            const nextDocument = cloneDocument(this.currentDocument);
            nextDocument.objects.push(object);
            this.commitDocument(nextDocument, `Criar ${object.type}`);
            propsRef.current.onSelection({
              kind: "object",
              objectId: object.id,
            });
          }

          private commitDocument(
            document: MapDocumentV1,
            description?: string,
          ) {
            this.currentDocument = document;
            this.renderDocument();
            propsRef.current.onDocumentChange(document, description);
          }
        }

        const bounds = target.getBoundingClientRect();
        const config: Phaser.Types.Core.GameConfig = {
          // Canvas renderer can display presigned cross-origin S3/MinIO images
          // without requiring WebGL texture CORS permissions.
          type: PhaserRuntime.CANVAS,
          parent: target,
          width: Math.max(320, Math.round(bounds.width)),
          height: Math.max(240, Math.round(bounds.height)),
          backgroundColor: "#0e1424",
          pixelArt: true,
          antialias: false,
          scene: EditorScene,
          scale: { mode: PhaserRuntime.Scale.NONE },
          input: {
            mouse: { preventDefaultWheel: true },
            touch: { capture: true },
          },
          render: { roundPixels: true },
          loader: { imageLoadType: "HTMLImageElement" },
        };

        game = new PhaserRuntime.Game(config);
        game.canvas.tabIndex = 0;
        game.canvas.setAttribute(
          "aria-label",
          propsRef.current.ariaLabel ?? "Canvas do editor de mapa",
        );

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || !game || disposed) return;
          const width = Math.max(320, Math.round(entry.contentRect.width));
          const height = Math.max(240, Math.round(entry.contentRect.height));
          if (game.scale.width === width && game.scale.height === height)
            return;
          game.scale.resize(width, height);
        });
        resizeObserver.observe(target);
        setLoadState("ready");
      } catch (error) {
        if (!disposed) {
          console.error("Não foi possível iniciar o Phaser", error);
          setLoadState("error");
        }
      }
    }

    void initialize(container);

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);

  const modeLabel = props.preview
    ? "Pré-visualização"
    : props.readOnly
      ? "Somente leitura"
      : null;

  return (
    <div
      aria-label={props.ariaLabel ?? "Canvas do editor de mapa"}
      className={styles.frame}
      data-tool={props.tool}
      role="application"
    >
      <div
        className={styles.canvasHost}
        onContextMenu={(event) => event.preventDefault()}
        ref={containerRef}
      />
      {loadState === "loading" && (
        <div className={styles.status}>Preparando canvas…</div>
      )}
      {loadState === "error" && (
        <div className={`${styles.status} ${styles.error}`}>
          Não foi possível carregar o editor gráfico.
        </div>
      )}
      {loadState === "ready" && modeLabel && (
        <div className={styles.modeBadge}>{modeLabel}</div>
      )}
    </div>
  );
}

export default MapCanvas;

