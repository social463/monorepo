import { describe, it, expect } from 'vitest'
import { s3Config, imageUploadsEnabled, buildImageKey, buildEventPhotoKey, publicUrlFor } from './s3-client'

const fullEnv = {
  S3_BUCKET: 'meu-bucket',
  S3_REGION: 'us-east-1',
  S3_PUBLIC_BASE_URL: 'https://cdn.exemplo.com/',
} as NodeJS.ProcessEnv

describe('s3-client config', () => {
  it('retorna null quando falta qualquer variável', () => {
    expect(s3Config({} as NodeJS.ProcessEnv)).toBeNull()
    expect(s3Config({ S3_BUCKET: 'b', S3_REGION: 'r' } as NodeJS.ProcessEnv)).toBeNull()
    expect(imageUploadsEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('monta a config e remove a barra final da base pública', () => {
    const cfg = s3Config(fullEnv)
    expect(cfg).toEqual({ bucket: 'meu-bucket', region: 'us-east-1', publicBaseUrl: 'https://cdn.exemplo.com' })
    expect(imageUploadsEnabled(fullEnv)).toBe(true)
  })
})

describe('s3-client key + url', () => {
  it('gera chave por usuário com extensão pelo content-type', () => {
    expect(buildImageKey('user1', 'image/jpeg', 'fixed-id')).toBe('reviews/user1/fixed-id.jpg')
    expect(buildImageKey('user1', 'image/png', 'fixed-id')).toBe('reviews/user1/fixed-id.png')
    expect(buildImageKey('user1', 'image/webp', 'fixed-id')).toBe('reviews/user1/fixed-id.webp')
    expect(buildImageKey('user1', 'image/gif', 'fixed-id')).toBe('reviews/user1/fixed-id.gif')
  })

  it('monta a URL pública a partir da chave', () => {
    const cfg = s3Config(fullEnv)!
    expect(publicUrlFor('reviews/user1/abc.jpg', cfg)).toBe('https://cdn.exemplo.com/reviews/user1/abc.jpg')
  })
})

describe('buildEventPhotoKey', () => {
  it('namespaceia a foto por empresa, com a extensão do content-type', () => {
    expect(buildEventPhotoKey('company-emr', 'image/jpeg', 'abc')).toBe('event-photos/company-emr/abc.jpg')
    expect(buildEventPhotoKey('company-emr', 'image/webp', 'abc')).toBe('event-photos/company-emr/abc.webp')
  })
})
