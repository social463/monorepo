import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from '../../lib/api'
import { saveDecorationDraft, publishDecoration, acquireDecorationLock } from './decorationApi'

describe('decorationApi', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset())

  it('envia lock token no header ao salvar', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ revision: 2, savedAt: 'x', validationSummary: { valid: true, errorCount: 0 } })
    await saveDecorationDraft({ revision: 1, document: {} as any, lockToken: 'tok' })
    expect(apiFetch).toHaveBeenCalledWith('/office/map/edit/draft', expect.objectContaining({
      method: 'PUT', headers: expect.objectContaining({ 'x-map-lock-token': 'tok' }),
    }))
  })

  it('publica com a revisão', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ activated: true })
    const r = await publishDecoration(2)
    expect(r.activated).toBe(true)
    expect(apiFetch).toHaveBeenCalledWith('/office/map/edit/publish', expect.objectContaining({ method: 'POST' }))
  })

  it('adquire lock via POST', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ lockToken: 'tok', expiresAt: 'x', owner: { id: '1', name: 'a' } })
    const r = await acquireDecorationLock()
    expect(r.lockToken).toBe('tok')
    expect(apiFetch).toHaveBeenCalledWith('/office/map/edit/lock', expect.objectContaining({ method: 'POST' }))
  })
})
