/**
 * O manifesto é um Markdown único, escrito pelo G&G no admin, com ~20 mil
 * caracteres. Em texto corrido ele é uma parede: ninguém acha onde parou nem
 * volta para reler um trecho.
 *
 * Aqui ele é quebrado nos títulos de nível 2 — que é como o texto já vem
 * escrito —, e cada pedaço vira um bloco na tela. Nada muda no editor: quem
 * escreve continua escrevendo Markdown, e um manifesto sem `##` nenhum
 * simplesmente sai como um bloco só.
 */
export interface ManifestoSection {
  title: string
  /** Markdown do corpo da seção, sem o título. */
  body: string
}

export interface ManifestoContent {
  /** O que vem antes do primeiro `##` — na prática, a frase de abertura. */
  intro: string
  sections: ManifestoSection[]
}

/** `## Título` — só nível 2 corta; `###` continua sendo subtítulo dentro do bloco. */
const SECTION_HEADING = /^##\s+(.+?)\s*$/

export function splitManifesto(body: string): ManifestoContent {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n')
  const intro: string[] = []
  const sections: ManifestoSection[] = []
  let current: { title: string; lines: string[] } | null = null

  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line)
    if (heading) {
      if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() })
      current = { title: heading[1]!, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else intro.push(line)
  }
  if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() })

  return { intro: intro.join('\n').trim(), sections }
}
