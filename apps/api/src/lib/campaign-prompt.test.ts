import { describe, expect, it } from 'vitest'
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

  it('informa o limite de caracteres do corpo', () => {
    const prompt = buildCampaignPrompt({ companyName: 'EMR', theme: 'X', audience: 'ALL', slots })
    expect(prompt).toContain('280')
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
      { title: 'A', body: 'x'.repeat(281), visualHint: null },
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
