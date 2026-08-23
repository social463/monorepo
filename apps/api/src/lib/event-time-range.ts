/**
 * Início e fim de um evento de calendário.
 *
 * O model `CalendarEvent` só guarda `startTime` — hora de término não existe
 * como campo. Na prática ela é escrita na descrição, num formato que o pessoal
 * de Provas B2B repete: uma linha "Data e Horário início: 31/08/2026 às 8h" e
 * outra "Data e Horário finalização: 31/08/2026 às 12h".
 *
 * Isto aqui é leitura best-effort desse texto, não um contrato: descrição fora
 * do padrão simplesmente não devolve horário, e o `startTime` (esse sim, campo)
 * continua valendo como fonte do início. Nada aqui muda o cadastro — o dia que
 * a hora de término virar campo de verdade, esta função sai de cena.
 */

const LINHA_INICIO = /in[íi]cio/i
const LINHA_FIM = /finaliza[çc]|t[ée]rmino|encerra|\bfim\b/i

/** Datas viram espaço antes da busca: "31/08/2026" não pode ser lido como hora. */
const DATA = /\d{1,2}\/\d{1,2}\/\d{2,4}/g

/** "8h", "08h", "13h30", "13:30", "13:30h" — o que aparece nas descrições. */
const HORA = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i

export interface EventTimeRange {
  /** HH:MM ou null. */
  start: string | null
  /** HH:MM ou null. */
  end: string | null
}

function normalizar(hora: string, minuto?: string): string | null {
  const h = Number(hora)
  const m = minuto ? Number(minuto) : 0
  if (!Number.isInteger(h) || h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function horaDaLinha(linha: string): string | null {
  const match = HORA.exec(linha.replace(DATA, ' '))
  return match ? normalizar(match[1], match[2]) : null
}

/**
 * `startTime` (campo) tem precedência sobre o texto para o início — é o que o
 * cadastro mostra no calendário, e discordância entre os dois é erro de
 * digitação na descrição, não fonte melhor.
 */
export function extractEventTimeRange(description: string, startTime: string | null): EventTimeRange {
  let start: string | null = null
  let end: string | null = null

  for (const linha of description.split(/\r?\n/)) {
    if (!start && LINHA_INICIO.test(linha)) start = horaDaLinha(linha)
    if (!end && LINHA_FIM.test(linha)) end = horaDaLinha(linha)
  }

  return { start: startTime ?? start, end }
}

/** "08:00 às 12:00", "08:00", ou null quando não há hora nenhuma. */
export function formatEventTimeRange(range: EventTimeRange): string | null {
  if (!range.start) return null
  return range.end ? `${range.start} às ${range.end}` : range.start
}
