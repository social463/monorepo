import { describe, it, expect, vi, beforeEach } from 'vitest'

const putS3Object = vi.fn(async (_input: { key: string; contentType: string; body: Buffer }) => 'https://cdn.test/highlights/company-emr/2099-12.png')
let s3ConfigReturn: unknown = { bucket: 'b', region: 'r', publicBaseUrl: 'https://cdn.test' }

vi.mock('./s3-client', () => ({
  putS3Object: (input: { key: string; contentType: string; body: Buffer }) => putS3Object(input),
  s3Config: () => s3ConfigReturn,
}))

import { highlightKey, highlightStorageEnabled, saveCardPng } from './highlight-storage'

beforeEach(() => {
  vi.clearAllMocks()
  s3ConfigReturn = { bucket: 'b', region: 'r', publicBaseUrl: 'https://cdn.test' }
})

describe('highlightKey', () => {
  it('scopes the object key by company to avoid cross-tenant collisions', () => {
    expect(highlightKey('company-emr', '2026-06')).toBe('highlights/company-emr/2026-06.png')
  })
})

describe('highlightStorageEnabled', () => {
  it('reflects s3Config()', () => {
    expect(highlightStorageEnabled()).toBe(true)
    s3ConfigReturn = null
    expect(highlightStorageEnabled()).toBe(false)
  })
})

describe('saveCardPng', () => {
  it('uploads the PNG to S3 under the company-scoped key and returns the public URL', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    const url = await saveCardPng('company-emr', '2099-12', png)
    expect(url).toBe('https://cdn.test/highlights/company-emr/2099-12.png')
    expect(putS3Object).toHaveBeenCalledWith({ key: 'highlights/company-emr/2099-12.png', contentType: 'image/png', body: png })
  })

  it('refuses when S3 is not configured', async () => {
    s3ConfigReturn = null
    await expect(saveCardPng('company-emr', '2099-12', Buffer.from(''))).rejects.toThrow('S3 não configurado')
  })
})
