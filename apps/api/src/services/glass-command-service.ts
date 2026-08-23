import {
  GLASS_ALERT_LABELS,
  GLASS_BREAKDOWN_DIMENSIONS,
  parseGlassCommand,
  type GlassAlertKey,
  type GlassDimension,
  type GlassOverviewDTO,
} from '@legends/shared'
import { formatOverviewContext } from '../lib/glass-prompt'
import { getGlassCrossTab } from './glass-overview-service'
import { listGlassReviews, type GlassActor } from './glass-review-service'

/**
 * Comandos de relatório. A mensagem que começa com `/` **nunca chega crua ao
 * modelo**: aqui ela vira uma consulta agregada, e o modelo recebe os números já
 * calculados para redigir em cima.
 *
 * É a diferença que separa esta implementação do portal de origem, onde o
 * modelo somava de cabeça o que coubesse na janela de contexto. Número
 * inventado em relatório de RH vira decisão sobre pessoas.
 *
 * Devolve `null` quando a mensagem não é comando — aí o fluxo normal do chat
 * segue, com o acumulado já no system prompt.
 *
 * `overview` chega pronto de quem monta o turno: ele já precisou calculá-lo para
 * o system prompt, e recalcular aqui seria uma segunda leitura completa do banco
 * por turno.
 */
export async function resolveGlassCommand(
  actor: GlassActor,
  message: string,
  overview: GlassOverviewDTO,
): Promise<string | null> {
  const parsed = parseGlassCommand(message)
  if (!parsed) return null

  switch (parsed.command) {
    case '/relatorio': {
      return `PAINEL COMPLETO\n${formatOverviewContext(overview)}`
    }

    case '/tendencia': {
      if (overview.trend.length === 0) return 'TENDÊNCIA\nNenhuma avaliação com data cadastrada ainda.'
      const linhas = overview.trend.map((p) => `- ${p.month}: média ${p.averageRating} (${p.count} avaliação(ões))`)
      return `TENDÊNCIA MENSAL\n${linhas.join('\n')}`
    }

    case '/criticos': {
      const reviews = await listGlassReviews(actor, { withAlerts: true, limit: 20 })
      if (reviews.length === 0) return 'AVALIAÇÕES CRÍTICAS\nNenhuma avaliação com alerta no momento.'
      const linhas = reviews.map((review) => {
        const alertas = (review.alerts as GlassAlertKey[]).map((key) => GLASS_ALERT_LABELS[key] ?? key).join(', ')
        const data = review.reviewDate ? review.reviewDate.toISOString().slice(0, 10) : 'sem data'
        const nota = review.rating === null ? 'sem nota' : `nota ${Number(review.rating)}`
        return `- ${data} | ${review.sector ?? 'setor não informado'} | ${nota} | alertas: ${alertas}\n  ${review.aiSummary ?? review.negatives ?? ''}`
      })
      return `AVALIAÇÕES CRÍTICAS (${reviews.length})\n${linhas.join('\n')}`
    }

    case '/cruzamento': {
      const [primeira, segunda] = parsed.args
      const rowDim = (primeira ?? 'setor') as GlassDimension
      const columnDim = (segunda ?? 'tempo') as GlassDimension
      const validas = GLASS_BREAKDOWN_DIMENSIONS.join(', ')

      if (!GLASS_BREAKDOWN_DIMENSIONS.includes(rowDim) || !GLASS_BREAKDOWN_DIMENSIONS.includes(columnDim)) {
        return `CRUZAMENTO\nDimensão desconhecida. As dimensões válidas são: ${validas}.`
      }
      // `groupBy` com a mesma coluna duas vezes é inválido no Prisma — explicar
      // é melhor que deixar estourar erro de banco na cara de quem perguntou.
      if (rowDim === columnDim) {
        return `CRUZAMENTO\nEscolha duas dimensões diferentes. As válidas são: ${validas}.`
      }

      const celulas = await getGlassCrossTab(actor, rowDim, columnDim)
      if (celulas.length === 0) return 'CRUZAMENTO\nNenhuma avaliação com essas duas informações preenchidas.'

      const linhas = celulas.map(
        (c) => `- ${c.rowKey} × ${c.columnKey}: ${c.count} avaliação(ões), média ${c.averageRating ?? 'sem nota'}`,
      )
      return `CRUZAMENTO ${rowDim.toUpperCase()} × ${columnDim.toUpperCase()}\n${linhas.join('\n')}`
    }

    default:
      return comandoSemTratamento(parsed.command)
  }
}

/**
 * Comando conhecido pelo contrato e sem `case` aqui. O `never` faz o compilador
 * apontar isso no instante em que alguém acrescenta um comando a
 * `GLASS_COMMANDS`; em runtime devolvemos um bloco tratado, porque cair fora do
 * switch devolveria `undefined`, o comando seguiria ao modelo como pergunta
 * livre e ele responderia com números inventados — exatamente o comportamento
 * que esta reimplementação existe para matar.
 */
function comandoSemTratamento(command: never): string {
  return `COMANDO INDISPONÍVEL\nO comando ${String(command)} ainda não está disponível. Diga isso a quem perguntou e ofereça os comandos que funcionam; não estime nenhum número.`
}
