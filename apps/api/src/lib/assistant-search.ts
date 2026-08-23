import { ASSISTANT_MAX_SOURCES } from '@legends/shared'

export interface RankableEntry {
  id: string
  category: string | null
  question: string
  answer: string
  keywords: string[]
}

/**
 * Palavras que sozinhas não dizem nada sobre o assunto perguntado. Sem essa lista,
 * "como faço para..." casaria com metade da base.
 */
const STOPWORDS = new Set([
  'para', 'como', 'qual', 'quais', 'quanto', 'quantos', 'quantas', 'sobre', 'posso',
  'preciso', 'tenho', 'tem', 'uma', 'uns', 'meu', 'minha', 'com', 'sem', 'por', 'que',
  'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'onde', 'quem', 'quando', 'faco', 'fazer',
  'ser', 'esta', 'este', 'esse', 'essa', 'isso', 'aqui', 'mais', 'menos', 'saber',
  'funciona', 'ano', 'ver', 'vejo',
])

const MIN_TOKEN_LENGTH = 3

/**
 * Forma canônica de um texto: minúscula, sem acento, sem pontuação. Usada tanto na
 * busca quanto no agrupamento de perguntas no painel de lacunas — as duas coisas
 * precisam concordar sobre o que é "a mesma pergunta".
 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFD')
    // Escape explícito da faixa de acentos combinantes — nada de caractere invisível no fonte.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokens significativos: sem stopword, sem token curto demais. */
export function tokenize(text: string): string[] {
  return normalizeQuestion(text)
    .split(' ')
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token))
}

/**
 * Tokens crus, sem MIN_TOKEN_LENGTH nem stopword. Palavra-chave é curada (não é
 * ruído de linguagem natural) — "RH", "TI", "VR" precisam poder casar mesmo
 * sendo curtas. Usada tanto para tokenizar as `keywords` da entrada quanto a
 * pergunta do usuário, especificamente na checagem de palavra-chave.
 */
function tokenizeRaw(text: string): string[] {
  return normalizeQuestion(text)
    .split(' ')
    .filter((token) => token.length > 0)
}

const KEYWORD_WEIGHT = 3
const QUESTION_WEIGHT = 2
const ANSWER_WEIGHT = 1

/**
 * Piso de pontuação. Em 2, dois termos combinados já sustentam uma resposta
 * potencialmente útil; um único termo genérico não — ver `matchedTokens` abaixo.
 */
const MIN_SCORE = 2

/**
 * Palavra-chave de uma palavra só casa por token; de várias, casa como FRASE
 * inteira.
 *
 * Quebrar "plano de saude" em tokens dava a "de" o peso de palavra-chave (3),
 * e "de" aparece em quase toda pergunta em português: "quantos dias de férias
 * eu tenho?" empatava a entrada do plano de saúde com a de férias, e o
 * desempate alfabético respondia férias com plano de saúde. Frase inteira mata
 * o falso positivo sem perder a sigla curta ("RH", "TI"), que é de uma palavra
 * só e continua casando por token.
 */
function keywordMatches(keywords: string[], rawTokens: Set<string>, normalized: string): number {
  let hits = 0
  for (const keyword of keywords) {
    const parts = tokenizeRaw(keyword).filter((token) => !STOPWORDS.has(token))
    if (parts.length === 0) continue
    if (parts.length === 1) {
      if (rawTokens.has(parts[0]!)) hits += 1
      continue
    }
    const phrase = parts.join(' ')
    if (normalized.includes(phrase)) hits += 1
  }
  return hits
}

function scoreEntry(
  entry: RankableEntry,
  tokens: string[],
  rawTokens: string[],
  normalized: string,
): { score: number; matchedTokens: number } {
  // Keyword escapa do corte de tamanho (siglas como "RH"/"TI" precisam casar), mas não
  // do filtro de stopword: uma keyword cadastrada como "para" casaria sozinha, com peso
  // de palavra-chave, em quase toda pergunta.
  const keywordTokens = new Set(
    entry.keywords
      .filter((keyword) => tokenizeRaw(keyword).filter((token) => !STOPWORDS.has(token)).length === 1)
      .flatMap((keyword) => tokenizeRaw(keyword))
      .filter((token) => !STOPWORDS.has(token)),
  )
  const questionTokens = new Set(tokenize(entry.question))
  const answerTokens = new Set(tokenize(entry.answer))

  let score = 0
  let matchedTokens = 0
  const counted = new Set<string>()

  // Palavra-chave de várias palavras: só conta quando a frase inteira aparece.
  const phraseHits = keywordMatches(
    entry.keywords.filter((keyword) => tokenizeRaw(keyword).filter((t) => !STOPWORDS.has(t)).length > 1),
    new Set(rawTokens),
    normalized,
  )
  score += phraseHits * KEYWORD_WEIGHT
  matchedTokens += phraseHits

  // Palavra-chave de um termo, sobre os tokens crus: um acerto de keyword vale
  // por si só (ver filtro em rankKnowledgeEntries), então não pode ficar refém
  // do corte de tamanho/stopword que existe para pergunta/resposta.
  for (const token of new Set(rawTokens)) {
    if (counted.has(token) || !keywordTokens.has(token)) continue
    counted.add(token)
    score += KEYWORD_WEIGHT
    matchedTokens += 1
  }

  for (const token of new Set(tokens)) {
    if (counted.has(token)) continue
    // Cada token conta uma vez só, pelo campo de maior peso em que aparece.
    if (questionTokens.has(token)) {
      score += QUESTION_WEIGHT
      counted.add(token)
      matchedTokens += 1
    } else if (answerTokens.has(token)) {
      score += ANSWER_WEIGHT
      counted.add(token)
      matchedTokens += 1
    }
  }
  return { score, matchedTokens }
}

/**
 * Entradas mais relevantes para a pergunta, da melhor para a pior. Função pura: quem
 * carrega as entradas (já isoladas por empresa) é o service.
 */
export function rankKnowledgeEntries(
  entries: RankableEntry[],
  question: string,
  limit: number = ASSISTANT_MAX_SOURCES,
): RankableEntry[] {
  const tokens = tokenize(question)
  if (tokens.length === 0) return []
  const rawTokens = tokenizeRaw(question)
  const normalized = normalizeQuestion(question)

  return entries
    .map((entry) => ({ entry, ...scoreEntry(entry, tokens, rawTokens, normalized) }))
    // Um único termo genérico não sustenta match: exige dois tokens distintos
    // casados, salvo quando o acerto já vem de keyword (peso 3, basta sozinho).
    .filter((scored) => scored.score >= MIN_SCORE && (scored.score >= KEYWORD_WEIGHT || scored.matchedTokens >= 2))
    // Desempate por texto da pergunta: ordem estável, teste determinístico.
    .sort((a, b) => b.score - a.score || a.entry.question.localeCompare(b.entry.question))
    .slice(0, limit)
    .map((scored) => scored.entry)
}

/**
 * Teto de caracteres da base cadastrada que cabe inteira no prompt do chat.
 * Abaixo dele o modelo enxerga tudo que a empresa cadastrou; acima, o ranking
 * volta a recortar. ~24k caracteres é da ordem de 8k tokens — cabe folgado em
 * qualquer provedor do catálogo e ainda deixa espaço para o histórico da
 * conversa, que sobe a cada turno.
 */
export const KNOWLEDGE_CONTEXT_MAX_CHARS = 24_000

/**
 * Quantas entradas o ranking devolve quando a base não cabe inteira. Bem acima
 * de `ASSISTANT_MAX_SOURCES` (que é quantas viram `sources` na UI da pergunta
 * única): aqui não são citações mostradas à pessoa, é o que o modelo lê para
 * escrever a resposta, e recortar demais é justamente o que fazia "quais os
 * benefícios?" virar um item só.
 */
export const KNOWLEDGE_CONTEXT_RANKED_LIMIT = 12

function contextSize(entries: RankableEntry[]): number {
  return entries.reduce((total, entry) => total + entry.question.length + entry.answer.length, 0)
}

/**
 * O que vai para o prompt do chat: a base inteira quando ela cabe, o topo do
 * ranking quando não cabe.
 *
 * Diferente de `rankKnowledgeEntries`, que responde "o que casou com esta
 * pergunta" — e continua sendo a resposta certa para `matchedEntryIds` e para o
 * fallback sem IA. Aqui a pergunta é outra: "o que o modelo precisa ter lido".
 * Base pequena inteira no prompt custa pouco e resolve de uma vez o follow-up
 * sem assunto explícito, a pergunta ampla e o termo que a pessoa escreveu
 * diferente de como foi cadastrado.
 */
export function selectKnowledgeContext(
  entries: RankableEntry[],
  question: string,
  limit: number = KNOWLEDGE_CONTEXT_RANKED_LIMIT,
  maxChars: number = KNOWLEDGE_CONTEXT_MAX_CHARS,
): RankableEntry[] {
  if (contextSize(entries) <= maxChars) return entries
  return rankKnowledgeEntries(entries, question, limit)
}
