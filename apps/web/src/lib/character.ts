import {
  CHARACTER_FRAME_SIZE,
  CHARACTER_ROW_BY_DIRECTION,
  CHARACTER_SHEET_HEIGHT,
  CHARACTER_SHEET_WIDTH,
  characterLayers,
  characterSignature,
  type CharacterLayer,
  type CharacterOptions,
} from "@legends/shared";

/** Onde os PNGs curados vivem (ver scripts/vendor-lpc.mjs). */
export function characterAssetUrl(path: string): string {
  return `/lpc/${path}`;
}

/**
 * Recorte do retrato: cabeça + início do ombro, do frame frontal parado
 * (linha down, col 0). Maior que só a cabeça (era 32px) pra não cortar o
 * cabelo rente à borda do círculo do avatar e deixar um pouco de ombro
 * visível embaixo, centralizando melhor o personagem no círculo.
 */
export const CHARACTER_PORTRAIT_CROP = {
  x: 10,
  y: CHARACTER_ROW_BY_DIRECTION.down * CHARACTER_FRAME_SIZE + 10,
  size: 44,
  scale: 4, // 44px * 4 = retrato 176×176
} as const;

export interface CharacterRenderDeps {
  createCanvas: () => HTMLCanvasElement;
  loadImage: (src: string) => Promise<HTMLImageElement>;
}

const defaultDeps: CharacterRenderDeps = {
  createCanvas: () => document.createElement("canvas"),
  loadImage: (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`falha ao carregar ${src}`));
      img.src = src;
    }),
};

// Cache por assinatura das options: composição é derivada e determinística.
const sheetCache = new Map<string, Promise<HTMLCanvasElement>>();
const portraitCache = new Map<string, Promise<string>>();

/** Só para testes. */
export function __clearCharacterCaches(): void {
  sheetCache.clear();
  portraitCache.clear();
}

/**
 * Assinatura de uma composição — o guarda-roupa mais as camadas extras. É a
 * chave do cache e, via `occupantTextureKey`, a key da textura no Phaser:
 * equipar algo que não é guarda-roupa (o marcador de paintball) precisa
 * mudá-la, senão o personagem armado reusaria a textura do desarmado.
 */
export function characterSheetKey(
  options: CharacterOptions,
  extraLayers: readonly CharacterLayer[] = [],
): string {
  return [characterSignature(options), ...extraLayers.map((layer) => layer.path)].join("|");
}

/**
 * Compõe o spritesheet do personagem (576×256, 9 frames × 4 direções):
 * desenha cada camada LPC em ordem de zPos num canvas. Cacheado por opções.
 *
 * `extraLayers` são camadas que NÃO vêm do guarda-roupa: hoje, o marcador de
 * paintball (`PAINTBALL_MARKER_LAYERS`). Elas entram por caminho, e não por
 * item do catálogo, porque são estado de JOGO — não persistem em
 * `avatarOptions`, não aparecem no editor de personagem e valem para todo tipo
 * de corpo, inclusive os que o catálogo do estilingue não lista.
 */
export function composeCharacterSheet(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
  extraLayers: readonly CharacterLayer[] = [],
): Promise<HTMLCanvasElement> {
  const key = characterSheetKey(options, extraLayers);
  const cached = sheetCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const layers = [...characterLayers(options), ...extraLayers].sort((a, b) => a.zPos - b.zPos);
    const images = await Promise.all(
      layers.map((l) => deps.loadImage(characterAssetUrl(l.path))),
    );
    const canvas = deps.createCanvas();
    canvas.width = CHARACTER_SHEET_WIDTH;
    canvas.height = CHARACTER_SHEET_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d indisponível");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const img of images) ctx.drawImage(img, 0, 0);
    return canvas;
  })();
  // Falha (404 de camada, etc.): não envenena o cache — a próxima chamada tenta de novo.
  promise.catch(() => sheetCache.delete(key));
  sheetCache.set(key, promise);
  return promise;
}

export async function characterSheetDataUri(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
): Promise<string> {
  const sheet = await composeCharacterSheet(options, deps);
  return sheet.toDataURL("image/png");
}

/** Retrato 128×128: recorte da cabeça, nearest-neighbor (pixel-art). */
export function characterPortraitDataUri(
  options: CharacterOptions,
  deps: CharacterRenderDeps = defaultDeps,
): Promise<string> {
  const key = characterSignature(options);
  const cached = portraitCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const sheet = await composeCharacterSheet(options, deps);
    const { x, y, size, scale } = CHARACTER_PORTRAIT_CROP;
    const canvas = deps.createCanvas();
    canvas.width = size * scale;
    canvas.height = size * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d indisponível");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, x, y, size, size, 0, 0, size * scale, size * scale);
    return canvas.toDataURL("image/png");
  })();
  promise.catch(() => portraitCache.delete(key));
  portraitCache.set(key, promise);
  return promise;
}
