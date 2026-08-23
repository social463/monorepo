import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { toChallengeDTO } from './serialize'

// s3Config() só resolve com bucket+region+publicBaseUrl definidos (ver lib/s3-client.ts).
// Forçado (não `??`) para o teste ser hermético mesmo quando o .env local tem S3 real.
const S3_BUCKET_BACKUP = process.env.S3_BUCKET
const S3_REGION_BACKUP = process.env.S3_REGION
const S3_PUBLIC_BASE_URL_BACKUP = process.env.S3_PUBLIC_BASE_URL

beforeAll(() => {
  process.env.S3_BUCKET = 'bucket-teste'
  process.env.S3_REGION = 'us-east-1'
  process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
})

afterAll(() => {
  process.env.S3_BUCKET = S3_BUCKET_BACKUP
  process.env.S3_REGION = S3_REGION_BACKUP
  process.env.S3_PUBLIC_BASE_URL = S3_PUBLIC_BASE_URL_BACKUP
})

const base = {
  id: 'c1',
  title: 'Semana do bem-estar',
  description: 'Mexa o corpo',
  category: 'Bem-estar',
  detailsMarkdown: '## Como participar',
  imageKey: null,
  rewardCoins: 50,
  isActive: true,
  position: 3,
  requiresReview: true,
  isPrivate: false,
  isFeatured: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  companyId: 'company-emr',
  createdById: 'u1',
  createdAt: new Date('2026-08-01T12:00:00Z'),
  updatedAt: new Date('2026-08-01T12:00:00Z'),
  sector: null,
}

describe('toChallengeDTO', () => {
  it('mapeia os campos de catálogo e resolve o nome do setor', () => {
    const dto = toChallengeDTO({
      ...base,
      sector: { id: 's1', name: 'Gente e Gestão' },
      sectorId: 's1',
    })
    expect(dto.category).toBe('Bem-estar')
    expect(dto.position).toBe(3)
    expect(dto.isFeatured).toBe(true)
    expect(dto.sectorName).toBe('Gente e Gestão')
  })

  it('sem imageKey a URL é null — nunca a chave crua', () => {
    const dto = toChallengeDTO(base)
    expect(dto.imageUrl).toBeNull()
    expect(JSON.stringify(dto)).not.toContain('imageKey')
  })

  it('submissionCount cai para zero quando o _count não vem no include', () => {
    expect(toChallengeDTO(base).submissionCount).toBe(0)
    expect(toChallengeDTO({ ...base, _count: { submissions: 7 } }).submissionCount).toBe(7)
  })

  it('imageKey presente + S3 configurado → imageUrl é URL pública derivada (campo imageKey nunca exposto)', () => {
    const imageKey = 'challenges/c1/avatar.png'
    const dto = toChallengeDTO({ ...base, imageKey })
    expect(dto.imageUrl).toBe('https://cdn.exemplo.com/challenges/c1/avatar.png')
    expect(dto.imageUrl).not.toBe(imageKey)
    expect(JSON.stringify(dto)).not.toContain('"imageKey"')
  })

  it('imageKey presente + S3 não configurado → imageUrl é null (nunca expõe a chave)', () => {
    const imageKey = 'challenges/c1/avatar.png'
    // Temporariamente desabilita S3 para este teste
    delete process.env.S3_BUCKET
    try {
      const dto = toChallengeDTO({ ...base, imageKey })
      expect(dto.imageUrl).toBeNull()
      expect(JSON.stringify(dto)).not.toContain('"imageKey"')
    } finally {
      // Restaura S3 para próximos testes
      process.env.S3_BUCKET = 'bucket-teste'
    }
  })
})
