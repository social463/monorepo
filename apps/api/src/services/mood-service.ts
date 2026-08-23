import { Prisma } from '@prisma/client'
import type { MoodLevel, MoodReason } from '@legends/shared'
import { MOOD_ALREADY_ANSWERED_MESSAGE, isNegativeMood } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

// Re-exporta para consumidores existentes (ex.: routes/mood.ts).
export { todayInSaoPaulo }

export interface TodayMood {
  mood: MoodLevel
  note: string | null
  reason: MoodReason | null
}

export async function getTodayMood(userId: string, companyId: string): Promise<TodayMood | null> {
  const { day } = todayInSaoPaulo()
  const entry = await scopedPrisma(companyId).moodEntry.findUnique({
    where: { userId_day: { userId, day } },
  })
  return entry
    ? { mood: entry.mood as MoodLevel, note: entry.note, reason: (entry.reason as MoodReason | null) ?? null }
    : null
}

/** Já existe resposta para hoje — o dia é de uma resposta só. */
export class MoodAlreadyAnsweredError extends Error {
  readonly status = 409

  constructor() {
    super(MOOD_ALREADY_ANSWERED_MESSAGE)
    this.name = 'MoodAlreadyAnsweredError'
  }
}

/**
 * Grava o humor do dia. **Só a primeira resposta conta**: a segunda tentativa
 * do mesmo dia é recusada, e não sobrescreve.
 *
 * A regra vive aqui, e não só na tela, porque o painel de clima é o produto do
 * dado: se der para regravar pela API, a série passa a medir o humor que a
 * pessoa achou apresentável depois de pensar, não o do momento.
 */
export async function setTodayMood(
  userId: string,
  companyId: string,
  mood: MoodLevel,
  note: string | null,
  reason: MoodReason | null = null,
): Promise<TodayMood> {
  const { day } = todayInSaoPaulo()
  const db = scopedPrisma(companyId)
  // O motivo só faz sentido em humor negativo: um "Bem" com motivo deixaria a
  // categoria órfã no registro.
  const data = { mood, note, reason: isNegativeMood(mood) ? reason : null }
  const existing = await db.moodEntry.findUnique({ where: { userId_day: { userId, day } } })
  if (existing) throw new MoodAlreadyAnsweredError()

  let entry
  try {
    entry = await db.moodEntry.create({ data: { userId, day, ...data } })
  } catch (err) {
    // Corrida: dois PUTs concorrentes podem ambos ver existing=null; o segundo
    // create colide na unique (userId, day). A unique é a rede de verdade —
    // a checagem acima só evita o erro no caminho comum.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new MoodAlreadyAnsweredError()
    }
    throw err
  }
  return { mood: entry.mood as MoodLevel, note: entry.note, reason: (entry.reason as MoodReason | null) ?? null }
}
