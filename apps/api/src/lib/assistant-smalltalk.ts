/**
 * Conversa que não é consulta à base: cumprimento, agradecimento, despedida,
 * "ok", "não ajudou".
 *
 * Existe por dois motivos, e nenhum deles é a IA. Com chave da empresa, é o
 * modelo que responde "oi" naturalmente (ver `assistant-prompt.ts`). Sem chave,
 * a assistente cai na base de conhecimento — e aí "oi" não casa com entrada
 * nenhuma e virava "Ainda não encontrei essa informação na base de
 * conhecimento", que é resposta para pergunta factual sem cobertura, nunca para
 * um cumprimento. O segundo motivo vale nos DOIS caminhos: toda pergunta sem
 * entrada casada entra no painel de lacunas de Gente e Gestão, então "oi",
 * "obrigada" e "ok" enterravam as lacunas de verdade.
 *
 * Classificar é deliberadamente conservador: só é conversa quando a mensagem
 * INTEIRA é feita de saudação/agradecimento/etc. "oi, quantos dias de férias?"
 * continua sendo pergunta — o "oi" não pode roubar a dúvida real.
 */

export const SMALL_TALK_KINDS = [
  'greeting',
  'wellbeing',
  'thanks',
  'farewell',
  'acknowledgement',
  'negative',
] as const

export type SmallTalkKind = (typeof SMALL_TALK_KINDS)[number]

/**
 * Acima disto não vale nem tentar: mensagem longa é dúvida de verdade, mesmo
 * que comece com "bom dia". Barato, e protege contra casamento patológico.
 */
const MAX_SMALL_TALK_LENGTH = 80

/** Minúsculas, sem acento, sem pontuação nem emoji, espaços colapsados. */
function normalize(message: string): string {
  return message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Ordem importa: a primeira expressão que casar tira o trecho da mensagem, e a
 * prioridade de `KIND_PRIORITY` decide o tipo quando a pessoa junta dois
 * ("valeu, tchau" é despedida).
 */
const PATTERNS: ReadonlyArray<{ re: RegExp; kind: SmallTalkKind }> = [
  { re: /\b(bom dia|boa tarde|boa noite)\b/g, kind: 'greeting' },
  { re: /\b(oi+|ola|opa|opah|eae|e ai|e ae|alo|hey|hi|hello|salve)\b/g, kind: 'greeting' },
  { re: /\b(tudo bem|tudo bom|td bem|td bom|como vai|como voce esta|como esta)\b/g, kind: 'wellbeing' },
  { re: /\b(muito obrigad[oa]|obrigad[oa]|obg|obgd|valeu|vlw|grat[oa]|agradecid[oa])\b/g, kind: 'thanks' },
  { re: /\b(tchau|ate mais|ate logo|ate breve|ate mais tarde|falou|flw|adeus|boa semana|bom trabalho)\b/g, kind: 'farewell' },
  { re: /\b(nao ajudou|nao era isso|nao e isso|nao entendi|nao foi isso)\b/g, kind: 'negative' },
  { re: /\b(ok|okay|okei|ta bom|ta bem|certo|entendi|entendido|show|legal|perfeito|joia|top|beleza|blz)\b/g, kind: 'acknowledgement' },
]

/**
 * Palavras que não mudam o sentido de um cumprimento e não podem impedir a
 * classificação: o nome da assistente, vocativo, cortesia.
 */
const FILLER = /\b(emily|assistente|bot|ai|entao|e|eh|a|o|voce|vc|por favor|pfv|favor|tudo|bem|bom|boa|dia|tarde|noite)\b/g

/** Quem vence quando a mensagem junta mais de um tipo. */
const KIND_PRIORITY: readonly SmallTalkKind[] = [
  'negative',
  'farewell',
  'thanks',
  'wellbeing',
  'greeting',
  'acknowledgement',
]

/**
 * O tipo de conversa, ou `null` quando a mensagem tem qualquer conteúdo além
 * dela — aí é pergunta e segue o fluxo normal da base de conhecimento.
 */
export function classifySmallTalk(message: string): SmallTalkKind | null {
  if (message.length > MAX_SMALL_TALK_LENGTH) return null
  let rest = normalize(message)
  if (!rest) return null

  const found = new Set<SmallTalkKind>()
  for (const { re, kind } of PATTERNS) {
    const replaced = rest.replace(re, ' ')
    if (replaced === rest) continue
    found.add(kind)
    rest = replaced
  }
  if (found.size === 0) return null
  // Sobrou palavra que não é saudação nem enfeite: é pergunta de verdade.
  if (rest.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().length > 0) return null

  return KIND_PRIORITY.find((kind) => found.has(kind)) ?? null
}

/**
 * A resposta da assistente para cada tipo. Texto fixo de propósito: este
 * caminho existe justamente quando não há modelo nenhum para redigir, e uma
 * resposta previsível é melhor do que uma recusa. O nome não aparece porque o
 * cabeçalho do chat já mostra quem está falando — e a persona é configurável
 * por empresa.
 */
const REPLIES: Record<SmallTalkKind, string> = {
  greeting: 'Oi! Que bom ter você por aqui 💚 Como posso te ajudar hoje?',
  wellbeing:
    'Tudo bem por aqui, obrigada por perguntar 😊 E com você? Se tiver alguma dúvida sobre políticas, benefícios ou processos, é só me contar.',
  thanks: 'Imagina, fico feliz em ajudar 💚 Precisa de mais alguma coisa?',
  farewell: 'Até mais! Estou por aqui sempre que precisar 💚',
  acknowledgement: 'Perfeito! Se surgir outra dúvida, é só me chamar 😊',
  negative:
    'Desculpe não ter ajudado. Me conta com outras palavras o que você precisa que eu tento de novo — e, se preferir falar com uma pessoa, o time de Gente e Gestão pode te ajudar diretamente.',
}

export function smallTalkReply(kind: SmallTalkKind): string {
  return REPLIES[kind]
}
