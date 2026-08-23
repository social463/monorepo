import { ASSISTANT_DEFAULT_PERSONA_NAME, type AssistantPersonaDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'

/**
 * Nome da assistente de RH, por empresa — mesmo mecanismo de
 * `ai-settings-service.ts` (`AppSetting` sob `(key, companyId)`), sem cifra:
 * não é segredo, é rótulo de UI.
 */
const PERSONA_NAME_KEY = 'assistant_persona_name'

/**
 * Avatar fixo da Emily, portado do portal EMR. Só para a empresa de slug
 * `emr` — mesmo gate provisório do bloco de acolhimento emocional em
 * `agent-service.ts` — até existir upload de avatar por empresa.
 */
const EMR_SLUG = 'emr'
const EMR_AVATAR_URL = '/assistant/emily-avatar.jpg'

export async function getAssistantPersonaName(companyId: string): Promise<string> {
  const row = await prisma.appSetting.findUnique({
    where: { key_companyId: { key: PERSONA_NAME_KEY, companyId } },
  })
  return row?.value?.trim() || ASSISTANT_DEFAULT_PERSONA_NAME
}

export async function getAssistantPersona(companyId: string): Promise<AssistantPersonaDTO> {
  const [name, company] = await Promise.all([
    getAssistantPersonaName(companyId),
    prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } }),
  ])
  return { name, avatarUrl: company?.slug === EMR_SLUG ? EMR_AVATAR_URL : null }
}

export async function setAssistantPersonaName(companyId: string, name: string): Promise<AssistantPersonaDTO> {
  const trimmed = name.trim()
  await prisma.appSetting.upsert({
    where: { key_companyId: { key: PERSONA_NAME_KEY, companyId } },
    create: { key: PERSONA_NAME_KEY, companyId, value: trimmed },
    update: { value: trimmed },
  })
  return getAssistantPersona(companyId)
}
