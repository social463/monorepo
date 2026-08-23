import {
  CALENDAR_PROVIDERS,
  type CalendarProviderKey,
  type CalendarProviderSettingsDTO,
  type CalendarSettingsDTO,
  type UpdateCalendarSettingsRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { absoluteUrl } from '../lib/app-url'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import type { CalendarCredentials } from '../lib/calendar/provider'
import { recordAuditLog } from './audit-log-service'

/**
 * Credenciais OAuth são por empresa (BYO app — o Legends é whitelabel, cada
 * tenant registra o próprio app no Google Cloud / Entra ID). Ficam em
 * `AppSetting`, mesma mecânica do webhook da Quinta de Desenvolvimento.
 */
export const CALENDAR_SETTING_KEYS = {
  google: {
    clientId: 'calendar_google_client_id',
    clientSecret: 'calendar_google_client_secret_enc',
  },
  microsoft: {
    clientId: 'calendar_microsoft_client_id',
    clientSecret: 'calendar_microsoft_client_secret_enc',
    tenantId: 'calendar_microsoft_tenant_id',
  },
} as const

const AUDIT_ENTITY = 'CalendarSettings'

/**
 * URI que o admin registra no app do provedor. Derivado do app base URL e nunca
 * aceito por parâmetro — redirect URI controlável pelo cliente é o buraco
 * clássico deste fluxo. O `/api` existe porque o nginx faz proxy de `/api/`
 * para o Fastify.
 */
export function calendarRedirectUri(provider: CalendarProviderKey): string {
  return absoluteUrl(`/api/calendar/callback/${provider}`)
}

/**
 * `AppSetting` tem unique composta (key, companyId): o seletor precisa vir
 * inteiro em `key_companyId`, então `scopedPrisma` não se aplica e o companyId
 * vai explícito nos dois lados — igual ao development-thursday-service.
 */
async function readSetting(companyId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key_companyId: { key, companyId } } })
  return row?.value ?? null
}

async function writeSetting(companyId: string, key: string, value: string | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key, companyId } },
    create: { key, companyId, value },
    update: { value },
  })
}

export async function getCalendarCredentials(
  companyId: string,
  provider: CalendarProviderKey,
): Promise<CalendarCredentials | null> {
  const keys = CALENDAR_SETTING_KEYS[provider]
  const [clientId, secretEnc] = await Promise.all([
    readSetting(companyId, keys.clientId),
    readSetting(companyId, keys.clientSecret),
  ])
  if (!clientId || !secretEnc) return null

  if (provider === 'microsoft') {
    const tenantId = await readSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId)
    if (!tenantId) return null
    return { clientId, clientSecret: decryptSecret(secretEnc), tenantId }
  }
  return { clientId, clientSecret: decryptSecret(secretEnc) }
}

export async function availableCalendarProviders(companyId: string): Promise<CalendarProviderKey[]> {
  const available: CalendarProviderKey[] = []
  for (const provider of CALENDAR_PROVIDERS) {
    if (await getCalendarCredentials(companyId, provider)) available.push(provider)
  }
  return available
}

async function providerSettings(
  companyId: string,
  provider: CalendarProviderKey,
): Promise<CalendarProviderSettingsDTO> {
  const keys = CALENDAR_SETTING_KEYS[provider]
  const [clientId, secretEnc] = await Promise.all([
    readSetting(companyId, keys.clientId),
    readSetting(companyId, keys.clientSecret),
  ])
  const base = { clientId, redirectUri: calendarRedirectUri(provider) }
  if (provider === 'microsoft') {
    const tenantId = await readSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId)
    return { ...base, tenantId, configured: Boolean(clientId && secretEnc && tenantId) }
  }
  return { ...base, configured: Boolean(clientId && secretEnc) }
}

export async function getCalendarSettings(companyId: string): Promise<CalendarSettingsDTO> {
  return {
    google: await providerSettings(companyId, 'google'),
    microsoft: await providerSettings(companyId, 'microsoft'),
  }
}

/**
 * Campo ausente mantém o valor atual (permite salvar o formulário sem reenviar
 * o secret); string vazia limpa.
 */
export async function updateCalendarSettings(input: {
  companyId: string
  actorId: string
  body: UpdateCalendarSettingsRequest
}): Promise<CalendarSettingsDTO> {
  const { companyId, actorId, body } = input
  const before = await getCalendarSettings(companyId)

  for (const provider of CALENDAR_PROVIDERS) {
    const patch = body[provider]
    if (!patch) continue
    const keys = CALENDAR_SETTING_KEYS[provider]

    if (patch.clientId !== undefined) {
      await writeSetting(companyId, keys.clientId, patch.clientId.trim() || null)
    }
    if (patch.clientSecret !== undefined) {
      const trimmed = patch.clientSecret.trim()
      await writeSetting(companyId, keys.clientSecret, trimmed ? encryptSecret(trimmed) : null)
    }
    if (provider === 'microsoft' && 'tenantId' in patch && patch.tenantId !== undefined) {
      await writeSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId, patch.tenantId.trim() || null)
    }
  }

  const after = await getCalendarSettings(companyId)
  // `before`/`after` são os DTOs — que por construção não carregam secret.
  await recordAuditLog({
    actorId,
    entityType: AUDIT_ENTITY,
    entityId: companyId,
    action: 'UPDATE',
    companyId,
    before,
    after,
  })
  return after
}
