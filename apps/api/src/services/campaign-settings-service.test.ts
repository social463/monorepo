import { describe, expect, it } from 'vitest'
import { SMART_BREVITY_PROMPT } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  CAMPAIGN_PROMPT_TEMPLATE_KEY,
  getCampaignPromptTemplate,
  resolveCampaignPromptTemplate,
  setCampaignPromptTemplate,
} from './campaign-settings-service'

/**
 * Documento 4, seção 13.4: o texto oficial da Brevidade Inteligente é o valor
 * PADRÃO, não o valor cravado — a OBS da seção pede que a G&G possa refiná-lo
 * sem depender do time de TI.
 */

const COMPANY = 'company-emr'

async function ator() {
  const user = await prisma.user.create({
    data: { name: 'G&G', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x' },
  })
  return user.id
}

describe('getCampaignPromptTemplate', () => {
  it('sem nada gravado, vale o oficial', async () => {
    const { template, isDefault } = await getCampaignPromptTemplate(COMPANY)

    expect(template).toBe(SMART_BREVITY_PROMPT)
    expect(isDefault).toBe(true)
  })

  it('gravado, vale o da empresa', async () => {
    await setCampaignPromptTemplate({ companyId: COMPANY, actorId: await ator(), template: 'Escreva curto.' })

    const { template, isDefault } = await getCampaignPromptTemplate(COMPANY)
    expect(template).toBe('Escreva curto.')
    expect(isDefault).toBe(false)
  })

  it('o modelo é por empresa', async () => {
    await setCampaignPromptTemplate({ companyId: COMPANY, actorId: await ator(), template: 'Só da EMR.' })

    expect((await getCampaignPromptTemplate('company-legends-internal')).isDefault).toBe(true)
  })
})

describe('setCampaignPromptTemplate', () => {
  /**
   * Texto vazio APAGA a linha em vez de gravar o oficial: assim a empresa volta
   * a acompanhar o padrão se ele mudar, em vez de congelar uma cópia dele.
   */
  it('texto vazio restaura o oficial apagando a configuração', async () => {
    const actorId = await ator()
    await setCampaignPromptTemplate({ companyId: COMPANY, actorId, template: 'Personalizado.' })

    const depois = await setCampaignPromptTemplate({ companyId: COMPANY, actorId, template: '   ' })

    expect(depois.template).toBe(SMART_BREVITY_PROMPT)
    expect(depois.isDefault).toBe(true)
    expect(
      await prisma.appSetting.count({ where: { key: CAMPAIGN_PROMPT_TEMPLATE_KEY, companyId: COMPANY } }),
    ).toBe(0)
  })

  it('registra a mudança na auditoria', async () => {
    const actorId = await ator()
    await setCampaignPromptTemplate({ companyId: COMPANY, actorId, template: 'Novo texto.' })

    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'AppSetting', entityId: CAMPAIGN_PROMPT_TEMPLATE_KEY },
    })
    expect(log).not.toBeNull()
  })
})

describe('resolveCampaignPromptTemplate', () => {
  it('devolve só o texto — é o que os dois geradores consomem', async () => {
    expect(await resolveCampaignPromptTemplate(COMPANY)).toBe(SMART_BREVITY_PROMPT)

    await setCampaignPromptTemplate({ companyId: COMPANY, actorId: await ator(), template: 'Da empresa.' })
    expect(await resolveCampaignPromptTemplate(COMPANY)).toBe('Da empresa.')
  })
})
