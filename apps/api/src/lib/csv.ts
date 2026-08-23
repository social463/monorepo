/**
 * Células de CSV para exportação de fila (desafios, loja, …).
 *
 * Separador `;` e BOM UTF-8 no arquivo final porque o Excel em pt-BR abre assim
 * sem pedir importação — quem monta o arquivo cuida disso; aqui só a célula.
 */

/**
 * Aspas duplicadas e campo entre aspas quando contém `;`, aspas ou quebra de
 * linha. ANTES disso, neutraliza injeção de fórmula: um valor começando com
 * `=`, `+`, `-`, `@` (ou tab/CR) é interpretado como fórmula pelo Excel/Sheets
 * ao abrir o CSV — e a primeira coluna costuma ser `user.name`, que a própria
 * pessoa escolhe no cadastro, sem restrição de charset. Prefixar `'` faz esses
 * programas tratarem a célula como texto puro.
 */
export function csvCell(value: string | null): string {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (!/[;"\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function csvDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
