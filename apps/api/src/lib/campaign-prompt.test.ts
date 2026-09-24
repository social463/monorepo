import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_BODY_TARGET_MAX,
  CAMPAIGN_BODY_TARGET_MIN,
  SMART_BREVITY_PROMPT,
} from '@legends/shared'
import { CampaignError } from './campaign-error'
import { buildCampaignPrompt, parseCampaignDrafts } from './campaign-prompt'

const slots = [new Date('2026-09-01T12:00:00.000Z'), new Date('2026-09-03T12:00:00.000Z')]

const draftsValidos = JSON.stringify([
  { title: 'Semana da segurança', body: 'Começa hoje a semana da segurança.', visualHint: 'Capacete' },
  { title: 'Encerramento', body: 'Obrigado a todos que participaram.', visualHint: null },
])

describe('prompt da campanha', () => {
  it('monta o prompt com tema, público e datas', () => {
    const prompt = buildCampaignPrompt({
      companyName: 'EMR',
      theme: 'Semana da segurança',
      audience: 'ALL',
      notes: 'Citar a CIPA',
      slots,
    })
    expect(prompt).toMatchSnapshot()
  })

  it('pede fôlego de comunicado, e não o teto, como alvo do corpo', () => {
    const prompt = buildCampaignPrompt({ companyName: 'EMR', theme: 'X', audience: 'ALL', slots })

    expect(prompt).toContain(`entre ${CAMPAIGN_BODY_TARGET_MIN} e ${CAMPAIGN_BODY_TARGET_MAX} caracteres`)
    expect(prompt).toContain(String(CAMPAIGN_BODY_MAX_LENGTH))
  })

  // A regressão que motivou tudo: as REGRAS proibiam markdown e emoji, que é
  // exatamente o que a Brevidade Inteligente pede acima delas. O modelo obedecia
  // às REGRAS e devolvia texto chapado.
  it('não proíbe a formatação que o modelo padrão pede', () => {
    const prompt = buildCampaignPrompt({
      companyName: 'EMR',
      theme: 'X',
      audience: 'ALL',
      slots,
      template: SMART_BREVITY_PROMPT,
    })

    expect(prompt).not.toContain('Sem markdown')
    expect(prompt).not.toContain('sem emojis')
    expect(prompt).toContain('**negrito**')
  })

  it('exige acentuação, que o modelo vinha comendo para poupar espaço', () => {
    const prompt = buildCampaignPrompt({ companyName: 'EMR', theme: 'X', audience: 'ALL', slots })
    expect(prompt).toContain('ACENTUAÇÃO')
  })

  it('diz que o título aparece para quem lê', () => {
    const prompt = buildCampaignPrompt({ companyName: 'EMR', theme: 'X', audience: 'ALL', slots })

    expect(prompt).not.toContain('não aparece no post')
    expect(prompt).toContain('O título é o do post')
    // Título público e corpo abrindo pelo mesmo texto sai repetido na tela.
    expect(prompt).toContain('não repita o título')
  })
})

describe('parser dos rascunhos', () => {
  it('aceita JSON válido e carimba a data da grade', () => {
    const drafts = parseCampaignDrafts(draftsValidos, slots)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      title: 'Semana da segurança',
      body: 'Começa hoje a semana da segurança.',
      visualHint: 'Capacete',
      scheduledFor: '2026-09-01T12:00:00.000Z',
    })
    expect(drafts[1].scheduledFor).toBe('2026-09-03T12:00:00.000Z')
  })

  it('aceita resposta embrulhada em cerca de markdown', () => {
    expect(parseCampaignDrafts('```json\n' + draftsValidos + '\n```', slots)).toHaveLength(2)
  })

  it('recusa quantidade diferente da pedida', () => {
    const um = JSON.stringify([{ title: 'A', body: 'B', visualHint: null }])
    expect(() => parseCampaignDrafts(um, slots)).toThrow(CampaignError)
  })

  it('recusa corpo acima do limite do mural', () => {
    const longo = JSON.stringify([
      { title: 'A', body: 'x'.repeat(CAMPAIGN_BODY_MAX_LENGTH + 1), visualHint: null },
      { title: 'B', body: 'ok', visualHint: null },
    ])
    expect(() => parseCampaignDrafts(longo, slots)).toThrow(CampaignError)
  })

  it('recusa JSON malformado', () => {
    expect(() => parseCampaignDrafts('desculpe, não consigo', slots)).toThrow(CampaignError)
  })

  it('nunca deixa passar um item pela metade', () => {
    const semCorpo = JSON.stringify([{ title: 'A', visualHint: null }, { title: 'B', body: 'ok' }])
    expect(() => parseCampaignDrafts(semCorpo, slots)).toThrow(CampaignError)
  })
})

/**
 * Documento 4, seção 13.4: o modelo padrão entra no prompt, e desligá-lo é a
 * saída para gerar algo fora do padrão.
 */
describe('modelo padrão de comunicado', () => {
  const base = {
    companyName: 'EMR',
    theme: 'Semana da segurança',
    audience: 'ALL' as const,
    slots: [new Date('2026-09-01T12:00:00.000Z')],
  }

  it('injeta o modelo antes das REGRAS quando ele vem', () => {
    const prompt = buildCampaignPrompt({ ...base, template: 'Título de no máximo 6 palavras.' })

    expect(prompt).toContain('MODELO PADRÃO DE COMUNICADO')
    expect(prompt).toContain('Título de no máximo 6 palavras.')
    // A ordem importa: o modelo é instrução de estrutura, e as REGRAS abaixo
    // dele são as que não se negociam (limites e formato da resposta).
    expect(prompt.indexOf('MODELO PADRÃO DE COMUNICADO')).toBeLessThan(prompt.indexOf('REGRAS'))
  })

  it('sem modelo, o prompt sai como antes', () => {
    const prompt = buildCampaignPrompt(base)

    expect(prompt).not.toContain('MODELO PADRÃO DE COMUNICADO')
    expect(prompt).toContain('REGRAS')
  })

  it('modelo em branco não vira um cabeçalho vazio', () => {
    expect(buildCampaignPrompt({ ...base, template: '   ' })).not.toContain('MODELO PADRÃO')
  })
})
