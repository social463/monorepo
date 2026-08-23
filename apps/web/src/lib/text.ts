/**
 * Texto dobrado para busca: sem caixa e sem acento, para "Joao" achar "João" e
 * "REUNIAO" achar "reunião". O `NFD` separa a letra do diacrítico e o `replace`
 * joga fora a marca combinante que sobra.
 */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
