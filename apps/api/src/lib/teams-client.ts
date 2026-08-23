/**
 * Comunicação com o Microsoft Teams via fluxo Power Automate. Três camadas:
 *   - TeamsNudgePayload: payload neutro (não conhece o Teams).
 *   - buildStreakAtRiskCard: traduz o payload no Adaptive Card (único ponto
 *     que conhece o formato do Teams).
 *   - postTeamsNudge: sender HTTP best-effort.
 *
 * **Destinatário no payload.** Todo card leva o e-mail de quem deve recebê-lo
 * (`recipient`, no topo do envelope). Isso permite um fluxo ÚNICO para a
 * empresa inteira — o campo "Recipient" da ação do Teams vira a expressão
 * `triggerBody()?['recipient']` em vez de um e-mail cravado. O modelo antigo
 * (uma URL por pessoa, destinatário fixo no fluxo) continua funcionando: fluxo
 * que não lê o campo simplesmente o ignora.
 */
import { absoluteUrl } from './app-url'

export interface TeamsNudgePayload {
  event: 'streak_at_risk'
  name: string
  streakDays: number
  /** URL absoluta que o botão de CTA abre. */
  ctaUrl: string
  /** E-mail de quem recebe a DM; o fluxo único lê daqui. */
  recipient?: string
}

const TIMEOUT_MS = 5000

/** Escapa caracteres que quebram o markdown de link do Adaptive Card. */
function escapeAdaptiveText(text: string): string {
  return text.replace(/\]/g, '］').replace(/\)/g, '）')
}

/**
 * O destinatário só entra no envelope quando existe — fluxo de canal (ex.: o da
 * Quinta de Desenvolvimento) não tem uma pessoa, e mandar `recipient: undefined`
 * viraria `null` no JSON, que a expressão do fluxo leria como e-mail vazio.
 */
function recipientField(recipient?: string): { recipient?: string } {
  return recipient ? { recipient } : {}
}

/**
 * Rodapé com o logo e o nome do produto. O logo é o mesmo arquivo que o web
 * serve em `/illustration/logo-mark.png` — o Teams busca a imagem pela internet
 * pública, então precisa ser uma URL absoluta do app (nada de data URI, que o
 * cliente do Teams não renderiza de forma confiável).
 */
export interface TeamsBrand {
  appName: string
  /**
   * URL **absoluta e pública** da logo. O Teams busca a imagem pela internet a
   * partir dos servidores dele: caminho relativo ou data URI não renderizam.
   */
  logoUrl: string | null
}

/**
 * Formatos que o cliente do Teams realmente desenha dentro de um Adaptive Card.
 *
 * **SVG fica de fora**, e é a pegadinha: a URL responde 200 e o logo aparece
 * perfeito no web, mas o renderizador do card não rasteriza SVG — sai o ícone
 * de imagem quebrada e, pior, o `altText` toma a coluna `auto` e quebra letra a
 * letra, espremendo o resto do rodapé. WebP também não entra: os clientes de
 * desktop mais antigos não desenham.
 *
 * Logo que não passa aqui vale o mesmo que logo ausente — o rodapé cai na arte
 * do produto, que é PNG.
 */
const FORMATOS_DE_LOGO = /\.(png|jpe?g|gif)$/i

export function isTeamsRenderableLogo(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (!/^https?:$/i.test(parsed.protocol)) return false
    return FORMATOS_DE_LOGO.test(parsed.pathname)
  } catch {
    return false
  }
}

function assinaturaMarca(brand?: TeamsBrand): unknown {
  const appName = brand?.appName ?? 'Legends'
  const logoUrl = isTeamsRenderableLogo(brand?.logoUrl)
    ? (brand?.logoUrl as string)
    : absoluteUrl('/illustration/logo-mark.png')
  return {
    type: 'ColumnSet',
    spacing: 'Medium',
    separator: true,
    columns: [
      {
        type: 'Column',
        // Largura em pixels, e não `auto`: com `auto` a coluna se dimensiona
        // pelo conteúdo, então imagem que o Teams não conseguir buscar troca o
        // logo pelo altText e rouba a linha inteira do nome ao lado.
        width: '20px',
        verticalContentAlignment: 'Center',
        items: [
          {
            type: 'Image',
            url: logoUrl,
            altText: appName,
            width: '20px',
            spacing: 'None',
          },
        ],
      },
      {
        type: 'Column',
        width: 'stretch',
        verticalContentAlignment: 'Center',
        items: [{ type: 'TextBlock', text: appName, size: 'Small', isSubtle: true, spacing: 'None' }],
      },
    ],
  }
}

/**
 * Traduz o payload neutro no envelope de Adaptive Card que o Teams espera.
 * Único ponto que conhece o formato do Teams.
 */
export function buildStreakAtRiskCard(payload: TeamsNudgePayload): unknown {
  const name = escapeAdaptiveText(payload.name)
  const days = payload.streakDays
  const diaLabel = days === 1 ? 'dia' : 'dias'
  return {
    type: 'message',
    ...recipientField(payload.recipient),
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'Container',
              style: 'attention',
              bleed: true,
              items: [
                {
                  type: 'TextBlock',
                  size: 'Medium',
                  weight: 'Bolder',
                  text: '🔥 Sua ofensiva está em risco',
                  wrap: true,
                },
              ],
            },
            {
              type: 'TextBlock',
              text: `Olá, ${name}! Você está há **${days} ${diaLabel}** seguidos registrando seu humor. Não perca a sequência — registre o de hoje antes do fim do expediente.`,
              wrap: true,
            },
            { type: 'FactSet', facts: [{ title: 'Ofensiva atual', value: `${days} ${diaLabel}` }] },
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Registrar meu humor', url: payload.ctaUrl }],
        },
      },
    ],
  }
}

export interface TeamsNotification {
  title: string
  /** URL absoluta que o botão de CTA abre. */
  ctaUrl: string
  ctaLabel: string
  /** Emoji da manchete (default 🔔). */
  emoji?: string
  /** Corpo opcional (parágrafo abaixo da manchete). */
  body?: string
  /** Detalhes em pares rótulo/valor, abaixo do corpo (ex.: "Quando"). */
  facts?: { title: string; value: string }[]
  /** E-mail de quem recebe a DM; o fluxo único lê daqui. */
  recipient?: string
  /** Marca da empresa no rodapé. Ausente = a do produto. */
  brand?: TeamsBrand
}

/**
 * Adaptive Card de notificação: faixa de destaque com o emoji grande à esquerda
 * e a manchete em negrito ao lado, corpo e detalhes opcionais, botão de CTA e
 * assinatura do Legends no rodapé.
 *
 * O emoji fica numa coluna própria (não colado no texto) para poder crescer sem
 * arrastar o tamanho da manchete junto — é o que dá a "cara" do card na lista de
 * conversas do Teams, onde só a primeira linha aparece.
 *
 * **Cor.** O verde do Legends (`#52fba2`) não entra como hex: Adaptive Card no
 * Teams só aceita a paleta nomeada do tema, e `good` é o verde dela — que o
 * próprio Teams ajusta entre tema claro e escuro, coisa que um hex fixo não
 * faria (ficaria ilegível num dos dois). A marca de verdade vem do logo no
 * rodapé, esse sim com a arte do produto.
 */
export function buildNotificationCard(n: TeamsNotification): unknown {
  const body: unknown[] = [
    {
      type: 'Container',
      style: 'good',
      bleed: true,
      spacing: 'None',
      items: [
        {
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [{ type: 'TextBlock', text: n.emoji ?? '🔔', size: 'ExtraLarge', spacing: 'None' }],
            },
            {
              type: 'Column',
              width: 'stretch',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'TextBlock',
                  size: 'Medium',
                  weight: 'Bolder',
                  text: escapeAdaptiveText(n.title),
                  wrap: true,
                  spacing: 'None',
                },
              ],
            },
          ],
        },
      ],
    },
  ]
  if (n.body) {
    body.push({ type: 'TextBlock', text: escapeAdaptiveText(n.body), wrap: true, spacing: 'Medium' })
  }
  if (n.facts && n.facts.length > 0) {
    body.push({
      type: 'FactSet',
      spacing: 'Medium',
      facts: n.facts.map((f) => ({ title: f.title, value: escapeAdaptiveText(f.value) })),
    })
  }
  body.push(assinaturaMarca(n.brand))
  return {
    type: 'message',
    ...recipientField(n.recipient),
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body,
          actions: [{ type: 'Action.OpenUrl', title: n.ctaLabel, url: n.ctaUrl, style: 'positive' }],
        },
      },
    ],
  }
}

/**
 * Sender HTTP genérico best-effort: posta um card já montado no fluxo Power
 * Automate da pessoa. Qualquer falha (rede, timeout, status != 2xx) é logada e
 * engolida — não derruba o chamador.
 */
export async function postTeamsCard(url: string, card: unknown): Promise<void> {
  // Chave geral do envio ao Teams. Existe para o ambiente LOCAL: o webhook
  // cadastrado no banco de desenvolvimento é o mesmo da empresa de verdade, e
  // qualquer teste do feed (o comunicado publicado avisa a empresa inteira)
  // vira DM para todo mundo. `TEAMS_NOTIFICATIONS_ENABLED=false` no `.env`
  // desliga o envio sem mexer em regra de notificação nenhuma — a notificação
  // interna (sininho) continua sendo criada.
  if (process.env.TEAMS_NOTIFICATIONS_ENABLED === 'false') {
    console.info('[teams-client] envio desligado por TEAMS_NOTIFICATIONS_ENABLED=false')
    return
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[teams-client] POST falhou com status ${res.status}`)
    }
  } catch (err) {
    console.error('[teams-client] POST lançou exceção', err)
  }
}

/** Posta o card de nudge de ofensiva (mantém a assinatura original). */
export async function postTeamsNudge(url: string, payload: TeamsNudgePayload): Promise<void> {
  await postTeamsCard(url, buildStreakAtRiskCard(payload))
}

/** Posta um card genérico de notificação. */
export async function postTeamsNotification(url: string, n: TeamsNotification): Promise<void> {
  await postTeamsCard(url, buildNotificationCard(n))
}
