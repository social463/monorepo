/**
 * Operações de bloco sobre a `data` de uma tile layer.
 *
 * Duas famílias:
 *
 * - **carimbo** (`tileStamp`, `paintStamp`, `fillWithStamp`): a paleta pode
 *   selecionar um bloco `cols×rows` de tiles; o pincel e o balde aplicam o
 *   bloco inteiro, não só o tile da âncora.
 * - **área** (`rectFromCells`, `readClip`, `clearRect`, `pasteClip`,
 *   `moveRect`): um retângulo de tiles *já pintados* que a ferramenta de
 *   seleção move, copia ou apaga em conjunto.
 *
 * Tudo aqui é puro e trabalha em cópias — quem chama decide o que comitar.
 * `null` de retorno significa "nada mudaria", para o editor não empilhar
 * revisão à toa no histórico.
 */

/** Célula do mapa, em coordenadas de tile. */
export interface TileCell {
  column: number;
  row: number;
}

/** Retângulo de células, em coordenadas de tile. */
export interface TileRect extends TileCell {
  cols: number;
  rows: number;
}

/** Tamanho do mapa em células. */
export interface TileGrid {
  width: number;
  height: number;
}

/** Um tile do carimbo, deslocado de `(dc, dr)` a partir da âncora. */
export interface StampTile {
  dc: number;
  dr: number;
  reference: string;
}

/** Bloco de tiles recortado do mapa, em row-major de `cols × rows`. */
export interface TileClip {
  cols: number;
  rows: number;
  tiles: Array<string | null>;
}

type TileData = ReadonlyArray<string | null>;

function indexOf(grid: TileGrid, column: number, row: number): number {
  return row * grid.width + column;
}

function insideGrid(grid: TileGrid, column: number, row: number): boolean {
  return column >= 0 && row >= 0 && column < grid.width && row < grid.height;
}

/**
 * Referências (`tilesetId:index`) do bloco `cols×rows` ancorado em
 * `tileIndex`. O bloco é **recortado na borda do tileset**: pedir 3 colunas a
 * partir da última coluna devolve só a que existe, em vez de dobrar para a
 * linha de baixo (que no tileset é outro desenho).
 */
export function tileStamp(params: {
  tilesetId: string;
  columns: number;
  tileCount: number;
  tileIndex: number;
  cols?: number;
  rows?: number;
}): StampTile[] {
  const { tilesetId, columns, tileCount, tileIndex } = params;
  if (
    columns <= 0 ||
    !Number.isInteger(tileIndex) ||
    tileIndex < 0 ||
    tileIndex >= tileCount
  ) {
    return [];
  }

  const cols = Math.max(1, Math.trunc(params.cols ?? 1));
  const rows = Math.max(1, Math.trunc(params.rows ?? 1));
  const anchorColumn = tileIndex % columns;
  const anchorRow = Math.floor(tileIndex / columns);

  const tiles: StampTile[] = [];
  for (let dr = 0; dr < rows; dr += 1) {
    for (let dc = 0; dc < cols; dc += 1) {
      const column = anchorColumn + dc;
      if (column >= columns) continue;
      const index = (anchorRow + dr) * columns + column;
      if (index >= tileCount) continue;
      tiles.push({ dc, dr, reference: `${tilesetId}:${index}` });
    }
  }
  return tiles;
}

/**
 * Pinta o carimbo com a âncora em `anchor`. Células fora do mapa são
 * descartadas (o carimbo não vaza para a linha seguinte).
 */
export function paintStamp(
  data: TileData,
  grid: TileGrid,
  anchor: TileCell,
  stamp: readonly StampTile[],
): Array<string | null> | null {
  if (stamp.length === 0) return null;

  let next: Array<string | null> | null = null;
  for (const tile of stamp) {
    const column = anchor.column + tile.dc;
    const row = anchor.row + tile.dr;
    if (!insideGrid(grid, column, row)) continue;
    const index = indexOf(grid, column, row);
    if ((data[index] ?? null) === tile.reference) continue;
    next ??= [...data];
    next[index] = tile.reference;
  }
  return next;
}

/**
 * Balde: preenche a região contígua que tem a mesma referência de `origin`,
 * repetindo o carimbo como padrão (ancorado em `origin`). Com carimbo 1×1 é o
 * flood fill de sempre.
 *
 * Usa conjunto de visitados em vez de comparar com a referência antiga: com
 * padrão, parte das células recebe de volta o mesmo tile que já tinham e a
 * varredura entraria em laço.
 */
export function fillWithStamp(
  data: TileData,
  grid: TileGrid,
  origin: TileCell,
  stamp: readonly StampTile[],
  span: { cols: number; rows: number },
): Array<string | null> | null {
  if (stamp.length === 0) return null;
  if (!insideGrid(grid, origin.column, origin.row)) return null;

  const cols = Math.max(1, Math.trunc(span.cols));
  const rows = Math.max(1, Math.trunc(span.rows));
  const pattern = new Map(
    stamp.map((tile) => [`${tile.dc}:${tile.dr}`, tile.reference]),
  );

  const target = data[indexOf(grid, origin.column, origin.row)] ?? null;
  const next = [...data];
  const visited = new Set<number>();
  const pending = [indexOf(grid, origin.column, origin.row)];
  let changed = false;

  while (pending.length > 0) {
    const index = pending.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    if ((data[index] ?? null) !== target) continue;

    const column = index % grid.width;
    const row = Math.floor(index / grid.width);
    const dc = (((column - origin.column) % cols) + cols) % cols;
    const dr = (((row - origin.row) % rows) + rows) % rows;
    const reference = pattern.get(`${dc}:${dr}`);
    if (reference !== undefined && next[index] !== reference) {
      next[index] = reference;
      changed = true;
    }

    if (column > 0) pending.push(index - 1);
    if (column < grid.width - 1) pending.push(index + 1);
    if (row > 0) pending.push(index - grid.width);
    if (row < grid.height - 1) pending.push(index + grid.width);
  }

  return changed ? next : null;
}

/** Retângulo normalizado entre duas células (arrasto em qualquer direção). */
export function rectFromCells(first: TileCell, second: TileCell): TileRect {
  return {
    column: Math.min(first.column, second.column),
    row: Math.min(first.row, second.row),
    cols: Math.abs(first.column - second.column) + 1,
    rows: Math.abs(first.row - second.row) + 1,
  };
}

/** Recorta o retângulo ao mapa. `null` quando não sobra nada dentro. */
export function clampRect(rect: TileRect, grid: TileGrid): TileRect | null {
  const left = Math.max(0, rect.column);
  const top = Math.max(0, rect.row);
  const right = Math.min(grid.width, rect.column + rect.cols);
  const bottom = Math.min(grid.height, rect.row + rect.rows);
  if (right <= left || bottom <= top) return null;
  return { column: left, row: top, cols: right - left, rows: bottom - top };
}

export function rectContains(rect: TileRect, cell: TileCell): boolean {
  return (
    cell.column >= rect.column &&
    cell.column < rect.column + rect.cols &&
    cell.row >= rect.row &&
    cell.row < rect.row + rect.rows
  );
}

/** Copia o retângulo (inclusive os vazios, para o colar ser fiel ao recorte). */
export function readClip(
  data: TileData,
  grid: TileGrid,
  rect: TileRect,
): TileClip {
  const tiles: Array<string | null> = [];
  for (let dr = 0; dr < rect.rows; dr += 1) {
    for (let dc = 0; dc < rect.cols; dc += 1) {
      const column = rect.column + dc;
      const row = rect.row + dr;
      tiles.push(
        insideGrid(grid, column, row)
          ? (data[indexOf(grid, column, row)] ?? null)
          : null,
      );
    }
  }
  return { cols: rect.cols, rows: rect.rows, tiles };
}

/** Apaga os tiles do retângulo. */
export function clearRect(
  data: TileData,
  grid: TileGrid,
  rect: TileRect,
): Array<string | null> | null {
  let next: Array<string | null> | null = null;
  for (let dr = 0; dr < rect.rows; dr += 1) {
    for (let dc = 0; dc < rect.cols; dc += 1) {
      const column = rect.column + dc;
      const row = rect.row + dr;
      if (!insideGrid(grid, column, row)) continue;
      const index = indexOf(grid, column, row);
      if ((data[index] ?? null) === null) continue;
      next ??= [...data];
      next[index] = null;
    }
  }
  return next;
}

/**
 * Cola o recorte com o canto superior esquerdo em `target`, inclusive os
 * vazios: o que se vê no recorte é o que aparece no destino.
 */
export function pasteClip(
  data: TileData,
  grid: TileGrid,
  target: TileCell,
  clip: TileClip,
): Array<string | null> | null {
  let next: Array<string | null> | null = null;
  for (let dr = 0; dr < clip.rows; dr += 1) {
    for (let dc = 0; dc < clip.cols; dc += 1) {
      const column = target.column + dc;
      const row = target.row + dr;
      if (!insideGrid(grid, column, row)) continue;
      const index = indexOf(grid, column, row);
      const reference = clip.tiles[dr * clip.cols + dc] ?? null;
      if ((data[index] ?? null) === reference) continue;
      next ??= [...data];
      next[index] = reference;
    }
  }
  return next;
}

/** Recorta o retângulo e cola em `target` (origem fica vazia). */
export function moveRect(
  data: TileData,
  grid: TileGrid,
  rect: TileRect,
  target: TileCell,
): Array<string | null> | null {
  if (target.column === rect.column && target.row === rect.row) return null;
  // O recorte é lido antes de apagar, então origem e destino podem se
  // sobrepor sem perder tile.
  const clip = readClip(data, grid, rect);
  const cleared = clearRect(data, grid, rect);
  const pasted = pasteClip(cleared ?? data, grid, target, clip);
  return pasted ?? cleared;
}
