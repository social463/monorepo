import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimOfficeDesk, releaseOfficeDesk, listAdminOfficeDesks, adminReleaseOfficeDesk } from './office-desk-api'

describe('office-desk-api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      return new Response(JSON.stringify({ desk: { id: 'd1', name: 'Mesa 1', externalKey: 'mesa-1', claimedBy: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  })

  it('claimOfficeDesk chama POST /office/desks/:id/claim', async () => {
    await claimOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desks/d1/claim')
    expect(init.method).toBe('POST')
  })

  it('releaseOfficeDesk chama POST /office/desks/:id/release', async () => {
    await releaseOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desks/d1/release')
    expect(init.method).toBe('POST')
  })

  it('listAdminOfficeDesks chama GET /admin/office-desks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ desks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await listAdminOfficeDesks()
    const [url] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/admin/office-desks')
  })

  it('adminReleaseOfficeDesk chama DELETE /admin/office-desks/:id/claim', async () => {
    await adminReleaseOfficeDesk('d1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/admin/office-desks/d1/claim')
    expect(init.method).toBe('DELETE')
  })
})
