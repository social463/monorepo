import { PRESENCE_ONLINE_WINDOW_MINUTES } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'

/**
 * Presença "on-line na plataforma": quem deu sinal de vida há pouco.
 *
 * É uma coluna só (`User.lastSeenAt`), atualizada por dois caminhos:
 *
 * 1. **Troca de rota** — o ping que já existe (`POST /access-logs`) passa por
 *    aqui de carona, porque quem navegou obviamente está ali.
 * 2. **Heartbeat** — `POST /me/presence`, batido pelo front a cada
 *    `PRESENCE_HEARTBEAT_INTERVAL_MS` enquanto a aba está visível. Sem ele,
 *    quem fica parado numa tela sumiria em minutos, e ficar lendo o mural é
 *    justamente estar usando a plataforma.
 *
 * Não virou tabela de sessão de propósito: o que a bolinha precisa é do ÚLTIMO
 * sinal, nunca da série. Série de navegação é `AccessLog`, que continua sendo
 * gravada em paralelo e para outro fim (People Analytics).
 */

/** Instante a partir do qual um sinal ainda conta como on-line. */
export function onlineSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - PRESENCE_ONLINE_WINDOW_MINUTES * 60 * 1000)
}

/**
 * Marca que a pessoa está ali agora.
 *
 * `updateMany` e não `update`: a chamada é best-effort e disparada em toda
 * navegação — se o usuário sumiu do banco entre o token e o ping, o certo é não
 * fazer nada, não estourar `RecordNotFound` numa rota de telemetria.
 */
export async function touchPresence(
  userId: string,
  companyId: string,
  now: Date = new Date(),
): Promise<void> {
  await scopedPrisma(companyId).user.updateMany({
    where: { id: userId },
    data: { lastSeenAt: now },
  })
}

/**
 * Quem da empresa está on-line agora. Uma query só, para as telas de lista não
 * caírem em N+1 — o ranking inteiro resolve presença com esta chamada.
 */
export async function onlineUserIds(companyId: string, now: Date = new Date()): Promise<Set<string>> {
  const rows = await scopedPrisma(companyId).user.findMany({
    where: { lastSeenAt: { gte: onlineSince(now) } },
    select: { id: true },
  })
  return new Set(rows.map((row) => row.id))
}
