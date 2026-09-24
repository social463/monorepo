/**
 * Leitura das células que uma planilha de verdade traz — data e horário
 * escritos à mão, do jeito que uma pessoa escreve no Excel ou no Sheets.
 *
 * Fica fora dos services de importação porque as duas importações (colaboradores
 * e calendário) leem o mesmo tipo de célula, e porque é lógica pura: dá pra
 * testar com uma string, sem banco.
 */

/**
 * `DD/MM/AAAA` (o que o Excel pt-BR grava) ou `AAAA-MM-DD` (o que o input date
 * manda). Devolve um `Date` à meia-noite **UTC**, que é como o produto inteiro
 * representa data civil.
 */
export function parseSpreadsheetDate(raw: string): Date | null {
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  let year: number
  let month: number
  let day: number
  if (brazilian) {
    day = Number(brazilian[1])
    month = Number(brazilian[2])
    year = Number(brazilian[3])
  } else if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else {
    return null
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  // Rejeita 31/02 e afins: o Date normaliza em silêncio para 03/03.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

/** Horário de um evento: `null` nos dois campos é "dia todo". */
export interface SpreadsheetTimeRange {
  /** HH:MM, ou null quando o evento é de dia inteiro. */
  start: string | null
  /** HH:MM, ou null quando só a hora de início foi informada. */
  end: string | null
}

const ALL_DAY = /^(dia (todo|inteiro)|o dia todo|integral)$/

/**
 * `"15h-22h"`, `"16h-16h50"`, `"15h00-16h00"`, `"14h30 às 15h"`, `"14:00-15:30"`,
 * `"Dia todo"`, vazio. Devolve `null` quando a célula tem texto que não dá pra
 * ler como horário — aí quem chamou transforma em erro de linha, em vez de
 * gravar um evento de dia inteiro que a planilha dizia ter hora marcada.
 *
 * A escrita com `h` é a que a planilha usa e a que o Excel **não** entende como
 * hora, então ela chega aqui como texto livre: `16h50` e `16h` na mesma célula
 * são normais, e é por isso que os minutos são opcionais em cada lado.
 */
export function parseSpreadsheetTimeRange(raw: string): SpreadsheetTimeRange | null {
  const text = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (!text) return { start: null, end: null }
  if (ALL_DAY.test(text)) return { start: null, end: null }

  // "das 14h as 15h", "14h30 ate 15h", "14h–15h": tudo vira o mesmo separador.
  const flat = text
    .replace(/\b(das|de|entre)\b/g, ' ')
    .replace(/\b(as|ate|a)\b/g, '-')
    .replace(/[–—]/g, '-')

  const parts = [...flat.matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/g)]
  if (parts.length === 0 || parts.length > 2) return null

  const times: string[] = []
  for (const part of parts) {
    const hour = Number(part[1])
    const minute = Number(part[2] ?? '0')
    if (hour > 23 || minute > 59) return null
    times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }

  // Sobrou dígito solto fora dos horários lidos? A célula não é só horário
  // ("Sexta, 15h", "15h e 16h30 na sala 2") e chutar qual deles vale seria pior
  // que devolver o problema para quem escreveu.
  const consumed = parts.map((part) => part[0]).join('')
  if (flat.replace(/[^0-9]/g, '').length !== consumed.replace(/[^0-9]/g, '').length) return null

  return { start: times[0], end: times[1] ?? null }
}
