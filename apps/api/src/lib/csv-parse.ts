/**
 * Leitura de CSV (RFC 4180) — o par de entrada do `csv.ts`, que só escreve.
 *
 * É um parser próprio, e não uma dependência, porque o que precisamos é
 * pequeno e o que as bibliotecas trazem junto (streams, workers, inferência de
 * tipo) não serve pra nada aqui. Sem I/O e sem Prisma: dá pra testar com uma
 * string.
 */

export class CsvParseError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CsvParseError'
  }
}

export type CsvDelimiter = ';' | ','

export interface CsvRecord {
  /** Linha **física** no arquivo (1-based) onde o registro começa. */
  line: number
  cells: string[]
}

export interface CsvTable {
  headers: string[]
  headerLine: number
  rows: CsvRecord[]
  delimiter: CsvDelimiter
}

/**
 * Ponto e vírgula é o que o Excel em pt-BR grava, mas o export da própria tela
 * de Lendas sai com vírgula (`apps/web/src/lib/csv.ts`). Farejar o separador é
 * o que faz "exportar → editar → importar" fechar sem ninguém ter que saber
 * disso. Só o cabeçalho é analisado, e aspas são respeitadas: um nome de coluna
 * como `"Cargo, atual"` não pode contar como voto na vírgula.
 */
export function detectDelimiter(headerLine: string): CsvDelimiter {
  let semicolons = 0
  let commas = 0
  let quoted = false
  for (let i = 0; i < headerLine.length; i += 1) {
    const char = headerLine[i]
    if (char === '"') {
      if (quoted && headerLine[i + 1] === '"') i += 1
      else quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === ';') semicolons += 1
    else if (char === ',') commas += 1
  }
  return commas > semicolons ? ',' : ';'
}

/** Primeira linha física, respeitando aspas (usada só para farejar o separador). */
function firstPhysicalLine(text: string): string {
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i += 1
      else quoted = !quoted
      continue
    }
    if (!quoted && (char === '\n' || char === '\r')) return text.slice(0, i)
  }
  return text
}

/**
 * Desfaz a proteção contra injeção de fórmula que `csvCell` aplica na escrita.
 * Sem isso, exportar e reimportar gravaria um apóstrofo no nome de quem tem
 * sobrenome começando por hífen — e o round-trip deixaria de ser idempotente.
 */
function stripFormulaGuard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}

/**
 * Divide o texto em registros. Uma quebra de linha dentro de aspas pertence ao
 * campo e **não** inicia registro novo, mas conta para o número da linha — o
 * número que sai daqui é o que o admin vê no Excel, e é por ele que a mensagem
 * de erro vai ser procurada.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  let touched = false

  function endField(): void {
    cells.push(stripFormulaGuard(field))
    field = ''
  }

  function endRecord(): void {
    endField()
    records.push({ line: recordLine, cells })
    cells = []
    touched = false
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (!touched) {
      recordLine = line
      touched = true
    }

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
        continue
      }
      if (char === '\n') line += 1
      else if (char === '\r') {
        line += 1
        if (text[i + 1] === '\n') i += 1
      }
      field += char === '\r' ? '\n' : char
      continue
    }

    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      endField()
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      endRecord()
      line += 1
      continue
    }
    field += char
  }

  if (touched || field.length > 0 || cells.length > 0) endRecord()
  return records
}

/** Linha sem nenhum conteúdo — o Excel enche o fim do arquivo delas. */
function isBlank(record: CsvRecord): boolean {
  return record.cells.every((cell) => cell.trim().length === 0)
}

/**
 * Buffer cru → cabeçalho + linhas, já sem BOM, sem linha vazia e com o
 * separador resolvido.
 */
export function parseCsvTable(buffer: Buffer): CsvTable {
  let text = buffer.toString('utf8')
  if (text.startsWith('﻿')) text = text.slice(1)

  // U+FFFD só aparece quando o decodificador desistiu de um byte: é planilha
  // salva em ANSI/Latin-1, que o Excel ainda oferece como padrão em pt-BR.
  if (text.includes('�')) {
    throw new CsvParseError('Não foi possível ler o arquivo. Salve como CSV UTF-8 e tente de novo.', 400)
  }
  if (text.trim().length === 0) {
    throw new CsvParseError('A planilha não tem nenhuma linha preenchida.', 400)
  }

  const delimiter = detectDelimiter(firstPhysicalLine(text))
  const records = parseCsv(text, delimiter)
  const header = records.find((record) => !isBlank(record))
  if (!header) {
    throw new CsvParseError('A planilha não tem nenhuma linha preenchida.', 400)
  }

  const rows = records
    .filter((record) => record.line > header.line && !isBlank(record))
    .map((record) => ({ line: record.line, cells: record.cells.map((cell) => cell.trim()) }))

  return {
    headers: header.cells.map((cell) => cell.trim()),
    headerLine: header.line,
    rows,
    delimiter,
  }
}
