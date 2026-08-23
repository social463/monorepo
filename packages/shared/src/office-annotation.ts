/**
 * Ponto de um traço desenhado sobre a tela compartilhada, normalizado 0–1
 * SOBRE O CONTEÚDO do vídeo (não sobre o elemento): o vídeo é renderizado com
 * `object-contain`, então sobra letterbox, e normalizar pelo elemento faria o
 * traço cair em pixels diferentes para cada tamanho de janela.
 */
export interface OfficeAnnotationPoint {
  x: number;
  y: number;
}

/** Quanto tempo um traço terminado leva para sumir (fade) — comportamento de apontador. */
export const OFFICE_ANNOTATION_STROKE_TTL_MS = 3000;

/**
 * Rede de segurança para traço que nunca recebeu o lote final (quem desenhava
 * caiu no meio). Alto de propósito: enquanto o ponteiro está parado, nenhum
 * lote é enviado, e um valor curto apagaria traço legítimo.
 */
export const OFFICE_ANNOTATION_ABANDON_MS = 15_000;

/** Intervalo de envio dos lotes de pontos enquanto se desenha. */
export const OFFICE_ANNOTATION_BATCH_MS = 60;

/** Teto de pontos por mensagem. */
export const OFFICE_ANNOTATION_MAX_POINTS = 64;

/** Teto do identificador de traço aceito pelo servidor. */
export const OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH = 64;

/**
 * Teto de traços vivos simultâneos guardados pelo cliente. A poda por TTL
 * (`OFFICE_ANNOTATION_STROKE_TTL_MS`/`OFFICE_ANNOTATION_ABANDON_MS`) só
 * acontece no laço de rAF do canvas, que só existe com a grade expandida e
 * uma tela em destaque — no estado normal (grade recolhida) nada expira, e
 * um cliente adulterado mandando `strokeId` distintos faria o Map crescer
 * sem limite. Generoso para o uso legítimo: dezenas de pessoas riscando ao
 * mesmo tempo no escritório, cada uma com seu próprio traço vivo.
 */
export const OFFICE_ANNOTATION_MAX_LIVE_STROKES = 150;

/**
 * Teto de pontos acumulados por traço. Sem isto, um `strokeId` que nunca
 * recebe o lote final (`done`) cresce para sempre — e o rAF do canvas
 * redesenha O(n) pontos a 60fps, travando a aba muito antes de qualquer
 * limite de memória (`OFFICE_ANNOTATION_ABANDON_MS` não protege: ele conta a
 * partir do ÚLTIMO ponto, não do total acumulado). Generoso para um traço
 * humano de verdade: a ~16 pontos/s (cadência de `OFFICE_ANNOTATION_BATCH_MS`),
 * dá quase um minuto de desenho contínuo antes de parar de aceitar pontos novos.
 */
export const OFFICE_ANNOTATION_MAX_STROKE_POINTS = 1000;

function isPoint(value: unknown): value is OfficeAnnotationPoint {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as { x: unknown; y: unknown };
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  );
}

/**
 * Valida um lote vindo da rede e devolve os pontos arredondados, ou `null` se
 * qualquer coisa estiver fora do contrato. Recusa o lote inteiro em vez de
 * consertá-lo: cliente honesto nunca manda fora da faixa, e cortar em silêncio
 * esconderia bug de geometria.
 */
export function sanitizeAnnotationPoints(
  input: unknown,
): OfficeAnnotationPoint[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length === 0 || input.length > OFFICE_ANNOTATION_MAX_POINTS) return null;
  const points: OfficeAnnotationPoint[] = [];
  for (const item of input) {
    if (!isPoint(item)) return null;
    points.push({
      x: Math.round(item.x * 1000) / 1000,
      y: Math.round(item.y * 1000) / 1000,
    });
  }
  return points;
}
