/**
 * Publicação automática do item do calendário editorial.
 *
 * Até aqui, `scheduledFor` era só data de planejamento: o item ficava no
 * calendário até alguém abrir e clicar "Publicar agora". Quem agendava para as
 * 13h30 de hoje esperava o comunicado sair às 13h30 — e ele não saía, sem aviso
 * nenhum. Este tick é o que faz a data significar o que diz.
 *
 * **Só o canal `MURAL`.** Teams e e-mail continuam com entrega manual (spec,
 * Decisão 6): o Legends registra o que foi combinado, não dispara. Item desses
 * canais nunca é reivindicado aqui.
 *
 * A reivindicação da linha é a mesma de `publishCampaignPost`: o
 * `updateMany({ where: { status: 'SCHEDULED' } })` dentro da transação é o
 * ponto de serialização, então dois ticks concorrentes (sobreposição no mesmo
 * processo, ou dois processos) não publicam o item duas vezes — o perdedor
 * recebe 409 e segue. Mesmo molde do tick dos agendados do feed.
 */
import { CampaignError } from '../lib/campaign-error'
import { listDueCampaignPosts, publishScheduledCampaignPost } from '../services/campaign-service'

const TICK_MS = 60 * 1000

/**
 * Itens cujo autor não pode mais publicar (saiu da base, perdeu o papel) ou que
 * nasceram sem autor: o tick não tem o que fazer com eles, e reclamar a cada
 * minuto por semanas afogaria o log. Avisa uma vez por processo — o suficiente
 * para alguém agir, e o item continua no calendário com o "Publicar agora".
 */
const jaAvisados = new Set<string>()

/** Um tick. `now` é injetável, para o teste não depender de timer. */
export async function runCampaignPostTick(now: Date): Promise<void> {
  const vencidos = await listDueCampaignPosts(now)

  for (const post of vencidos) {
    try {
      await publishScheduledCampaignPost(post)
    } catch (err) {
      // 409 aqui é esperado e não é falha: ou outra transação ganhou a linha,
      // ou o item não tem autor que possa publicar. Só o segundo caso merece
      // aviso, e uma vez só.
      if (err instanceof CampaignError && err.status === 409) {
        if (!jaAvisados.has(post.id)) {
          jaAvisados.add(post.id)
          console.warn(`[campaign-posts] comunicado ${post.id} não publicou sozinho: ${err.message}`)
        }
        continue
      }
      console.error(`[campaign-posts] falha no comunicado ${post.id}`, err)
    }
  }
}

/**
 * Tick de 1 minuto, igual ao dos agendados do feed: "agendado para 13h30" tem
 * que sair às 13h30. Não sobe em teste (que usa só `buildApp`).
 */
export function startCampaignPostScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runCampaignPostTick(new Date()).catch((err) =>
      console.error('[campaign-posts] tick falhou', err),
    )
  }, TICK_MS)
}
