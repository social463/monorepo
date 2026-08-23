/**
 * Geração de CSV no cliente. É intencionalmente pequeno: os dados já estão
 * carregados na tela, então exportar não precisa de round-trip na API.
 */

/**
 * Escapa um campo para CSV (RFC 4180): sempre entre aspas, com as aspas
 * internas duplicadas. Aspas em tudo evita a classe inteira de bugs de
 * separador — vírgula, ponto e vírgula, quebra de linha e acento no meio do
 * texto passam a ser irrelevantes.
 *
 * Aspas **não** resolvem injeção de fórmula: o Excel avalia uma célula que
 * começa com `=`, `+`, `-` ou `@` mesmo aspada, e boa parte do que exportamos
 * (nome, cargo) é texto que a própria pessoa escolheu. Prefixar `'` faz o
 * programa tratar como texto puro — mesma proteção do `csvCell` do backend, e
 * a importação sabe desfazer o prefixo na volta.
 */
function escapeCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF é o que o Excel espera; \n sozinho quebra a leitura em algumas versões.
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n')
}

/**
 * Dispara o download de um CSV. O BOM inicial não é enfeite: sem ele o Excel
 * no Windows lê UTF-8 como Latin-1 e "João" vira "JoÃ£o".
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
