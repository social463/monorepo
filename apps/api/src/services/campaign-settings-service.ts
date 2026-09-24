/**
 * Modelo padrão de comunicado, por empresa (Documento 4, seção 13.4).
 *
 * O texto oficial da Brevidade Inteligente é o valor **padrão**, não o valor
 * cravado: a OBS da seção pede que a G&G refine o modelo sem depender do time
 * de TI. Sem nada gravado vale o oficial (`SMART_BREVITY_PROMPT`); gravado,
 * vale o da empresa.
 *
 * Serve aos DOIS geradores — o de campanhas e o do Feed Corporativo —, que é o
 * que a mesma OBS pede. Um modelo por empresa, não um por tela: a voz da
 * comunicação interna é uma só.
 */

import { SMART_BREVITY_PROMPT, type CampaignPromptTemplateResponse } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/** Chave em `AppSetting`. */
export const CAMPAIGN_PROMPT_TEMPLATE_KEY = 'campaign_prompt_template'

// `AppSetting` tem chave composta (key, companyId): igual ao resto do repo, o
// companyId vai explícito no seletor em vez de passar pelo scopedPrisma, cuja
// injeção genérica não monta o seletor `key_companyId`.
async function readTemplate(companyId: string): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({
    where: { key_companyId: { key: CAMPAIGN_PROMPT_TEMPLATE_KEY, companyId } },
  })
  return setting?.value?.trim() || null
}

/** O que está valendo, e se é o oficial ou um texto da empresa. */
export async function getCampaignPromptTemplate(companyId: string): Promise<CampaignPromptTemplateResponse> {
  const gravado = await readTemplate(companyId)
  return { template: gravado ?? SMART_BREVITY_PROMPT, isDefault: gravado === null }
}

/**
 * Só o texto, para quem monta prompt. Existe separado do DTO acima porque o
 * chamador do prompt não tem o que fazer com `isDefault` — e um `.template`
 * espalhado por dois builders é fácil de esquecer.
 */
export async function resolveCampaignPromptTemplate(companyId: string): Promise<string> {
  return (await readTemplate(companyId)) ?? SMART_BREVITY_PROMPT
}

/**
 * Grava o modelo da empresa. Texto vazio **restaura o oficial** apagando a
 * linha, em vez de gravar string vazia: gravar vazio deixaria o gerador sem
 * modelo nenhum e sem como voltar pela tela.
 */
export async function setCampaignPromptTemplate(input: {
  companyId: string
  actorId: string
  template: string
}): Promise<CampaignPromptTemplateResponse> {
  const before = await getCampaignPromptTemplate(input.companyId)
  const limpo = input.template.trim()

  if (!limpo) {
    await prisma.appSetting.deleteMany({
      where: { key: CAMPAIGN_PROMPT_TEMPLATE_KEY, companyId: input.companyId },
    })
  } else {
    await prisma.appSetting.upsert({
      where: { key_companyId: { key: CAMPAIGN_PROMPT_TEMPLATE_KEY, companyId: input.companyId } },
      create: { key: CAMPAIGN_PROMPT_TEMPLATE_KEY, companyId: input.companyId, value: limpo },
      update: { value: limpo },
    })
  }

  const after = await getCampaignPromptTemplate(input.companyId)
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'AppSetting',
    entityId: CAMPAIGN_PROMPT_TEMPLATE_KEY,
    action: 'UPDATE',
    before,
    after,
    companyId: input.companyId,
  })
  return after
}
