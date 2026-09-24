import type { DevelopmentSettingsDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/** Exigir validação do líder para concluir ação de PDI (por empresa). */
export const PDI_LEADER_APPROVAL_KEY = 'pdi_leader_approval_required'
/** URL do ImpulseUP (Avaliações e Pesquisas). Sem valor, o item some do menu. */
export const IMPULSEUP_URL_KEY = 'impulseup_url'
/** Liga o módulo nativo do INOVA (por empresa; ver EMR_SLUG em inova-service.ts). */
export const INOVA_MODULE_ENABLED_KEY = 'inova_module_enabled'
/** Webhook do Teams para notificação de projeto do INOVA criado/editado. */
export const INOVA_TEAMS_WEBHOOK_KEY = 'inova_teams_webhook_url'

const PDI_LEADER_APPROVAL_DEFAULT = true

// `AppSetting` tem chave composta (key, companyId): igual ao resto do repo, o
// companyId vai explícito no seletor em vez de passar pelo scopedPrisma, cuja
// injeção genérica não monta o seletor `key_companyId`.
async function readSetting(key: string, companyId: string): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key_companyId: { key, companyId } } })
  return setting?.value ?? null
}

async function writeSetting(key: string, companyId: string, value: string | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key, companyId } },
    create: { key, companyId, value },
    update: { value },
  })
}

export async function getDevelopmentSettings(companyId: string): Promise<DevelopmentSettingsDTO> {
  const [approval, impulseUpUrl, inovaModuleEnabled, inovaTeamsWebhookUrl] = await Promise.all([
    readSetting(PDI_LEADER_APPROVAL_KEY, companyId),
    readSetting(IMPULSEUP_URL_KEY, companyId),
    readSetting(INOVA_MODULE_ENABLED_KEY, companyId),
    readSetting(INOVA_TEAMS_WEBHOOK_KEY, companyId),
  ])
  return {
    leaderApprovalRequired: approval == null ? PDI_LEADER_APPROVAL_DEFAULT : approval === 'true',
    impulseUpUrl: impulseUpUrl?.trim() || null,
    inovaModuleEnabled: inovaModuleEnabled === 'true',
    inovaTeamsWebhookUrl: inovaTeamsWebhookUrl?.trim() || null,
  }
}

export async function leaderApprovalRequired(companyId: string): Promise<boolean> {
  return (await getDevelopmentSettings(companyId)).leaderApprovalRequired
}

export async function updateDevelopmentSettings(input: {
  leaderApprovalRequired?: boolean
  impulseUpUrl?: string | null
  inovaModuleEnabled?: boolean
  inovaTeamsWebhookUrl?: string | null
  actorId: string
  companyId: string
}): Promise<DevelopmentSettingsDTO> {
  const before = await getDevelopmentSettings(input.companyId)

  if (input.leaderApprovalRequired !== undefined) {
    await writeSetting(PDI_LEADER_APPROVAL_KEY, input.companyId, String(input.leaderApprovalRequired))
  }
  if (input.impulseUpUrl !== undefined) {
    await writeSetting(IMPULSEUP_URL_KEY, input.companyId, input.impulseUpUrl?.trim() || null)
  }
  if (input.inovaModuleEnabled !== undefined) {
    await writeSetting(INOVA_MODULE_ENABLED_KEY, input.companyId, String(input.inovaModuleEnabled))
  }
  if (input.inovaTeamsWebhookUrl !== undefined) {
    await writeSetting(INOVA_TEAMS_WEBHOOK_KEY, input.companyId, input.inovaTeamsWebhookUrl?.trim() || null)
  }

  const after = await getDevelopmentSettings(input.companyId)
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'AppSetting',
    entityId: 'development',
    action: 'UPDATE',
    before,
    after,
    companyId: input.companyId,
  })
  return after
}
