import type { CalendarProvider } from '@prisma/client'
import {
  CALENDAR_PROVIDER_LABELS,
  type CalendarIntegrationStateDTO,
  type CalendarProviderKey,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { adapterFor, CalendarReauthRequiredError } from '../lib/calendar'
import { signCalendarState, verifyCalendarState, CalendarStateError } from '../lib/calendar/state'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { toCalendarConnectionDTO } from '../lib/serialize'
import {
  availableCalendarProviders,
  calendarRedirectUri,
  getCalendarCredentials,
} from './calendar-settings-service'

/** Erro de domínio com status HTTP — padrão VoteError. */
export class CalendarError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CalendarError'
    this.status = status
  }
}

function toPrismaProvider(provider: CalendarProviderKey): CalendarProvider {
  return provider.toUpperCase() as CalendarProvider
}

/** Renova um pouco antes do vencimento para não corrermos atrás do relógio. */
const REFRESH_MARGIN_MS = 60_000

async function requireCredentials(companyId: string, provider: CalendarProviderKey) {
  const creds = await getCalendarCredentials(companyId, provider)
  if (!creds) {
    throw new CalendarError(
      `${CALENDAR_PROVIDER_LABELS[provider]} ainda não foi configurado pelo administrador da sua empresa.`,
      409,
    )
  }
  return creds
}

export async function startCalendarConnection(input: {
  userId: string
  companyId: string
  provider: CalendarProviderKey
}): Promise<{ authorizeUrl: string }> {
  const creds = await requireCredentials(input.companyId, input.provider)
  const state = signCalendarState({
    userId: input.userId,
    companyId: input.companyId,
    provider: input.provider,
  })
  const authorizeUrl = adapterFor(input.provider).authorizeUrl({
    creds,
    redirectUri: calendarRedirectUri(input.provider),
    state,
  })
  return { authorizeUrl }
}

export async function completeCalendarConnection(input: {
  provider: CalendarProviderKey
  code: string
  state: string
}): Promise<{ userId: string }> {
  let payload
  try {
    payload = verifyCalendarState(input.state)
  } catch (err) {
    if (err instanceof CalendarStateError) throw new CalendarError(err.message, 400)
    throw err
  }
  // O provedor da URL tem que casar com o que assinamos — o userId vem do state,
  // nunca do request.
  if (payload.provider !== input.provider) {
    throw new CalendarError('Autorização inválida. Tente conectar novamente.', 400)
  }

  const creds = await requireCredentials(payload.companyId, input.provider)
  const tokens = await adapterFor(input.provider).exchangeCode({
    creds,
    redirectUri: calendarRedirectUri(input.provider),
    code: input.code,
  })

  const data = {
    companyId: payload.companyId,
    providerAccountEmail: tokens.email,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt,
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    scopes: tokens.scopes,
    status: 'ACTIVE' as const,
    lastSyncError: null,
  }
  await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId: payload.userId, provider: toPrismaProvider(input.provider) } },
    create: { ...data, userId: payload.userId, provider: toPrismaProvider(input.provider) },
    update: data,
  })
  return { userId: payload.userId }
}

export async function getCalendarIntegrationState(input: {
  userId: string
  companyId: string
}): Promise<CalendarIntegrationStateDTO> {
  const [connections, available] = await Promise.all([
    prisma.calendarConnection.findMany({
      where: { userId: input.userId, companyId: input.companyId },
      orderBy: { provider: 'asc' },
    }),
    availableCalendarProviders(input.companyId),
  ])
  return { connections: connections.map(toCalendarConnectionDTO), available }
}

export async function disconnectCalendar(input: {
  userId: string
  provider: CalendarProviderKey
}): Promise<void> {
  const connection = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: input.userId, provider: toPrismaProvider(input.provider) } },
  })
  if (!connection) throw new CalendarError('Conexão não encontrada.', 404)

  const creds = await getCalendarCredentials(connection.companyId, input.provider)
  if (creds) {
    // Best-effort: revogar é cortesia com o provedor; o que garante que o Legends
    // perde o acesso é apagar a linha.
    await adapterFor(input.provider).revoke({ creds, refreshToken: decryptSecret(connection.refreshTokenEnc) })
  }
  await prisma.calendarConnection.delete({ where: { id: connection.id } })
}

/**
 * Access token válido da conexão, renovando quando necessário. Consumido pelas
 * fases 2 e 3. Consentimento revogado vira NEEDS_REAUTH — a pessoa vê
 * "reconectar" no perfil em vez de um erro opaco.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } })
  if (connection.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decryptSecret(connection.accessTokenEnc)
  }

  const provider = connection.provider.toLowerCase() as CalendarProviderKey
  const creds = await requireCredentials(connection.companyId, provider)
  try {
    const tokens = await adapterFor(provider).refresh({
      creds,
      refreshToken: decryptSecret(connection.refreshTokenEnc),
    })
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        scopes: tokens.scopes,
        status: 'ACTIVE',
        lastSyncError: null,
      },
    })
    return tokens.accessToken
  } catch (err) {
    if (err instanceof CalendarReauthRequiredError) {
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { status: 'NEEDS_REAUTH', lastSyncError: err.message },
      })
    }
    throw err
  }
}
