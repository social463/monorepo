import { describe, expect, it } from 'vitest'
import {
  GLASS_ALERT_LABELS,
  GLASS_ALERT_RULES,
  GLASS_BREAKDOWN_DIMENSIONS,
  GLASS_COMMANDS,
  GLASS_CRITICAL_KEYWORDS,
  GLASS_REQUIRED_FIELDS,
  GLASS_SENTIMENTS,
  GLASS_SENTIMENT_LABELS,
  GLASS_TENURE_BUCKETS,
  GLASS_TENURE_LABELS,
  GLASS_THEMES_NEGATIVE,
  GLASS_THEMES_POSITIVE,
  isGlassCommand,
  type GlassAlertKey,
} from './glass'

describe('contrato do GlassAgent', () => {
  it('tem vocabulários fechados sem repetição', () => {
    for (const list of [GLASS_THEMES_POSITIVE, GLASS_THEMES_NEGATIVE]) {
      expect(new Set(list).size).toBe(list.length)
      expect(list.length).toBeGreaterThan(0)
    }
  })

  it('nomeia todo alerta em português', () => {
    const keys: GlassAlertKey[] = [
      'NOTA_BAIXA_ATIVO',
      'PALAVRA_CRITICA_BURNOUT',
      'PALAVRA_CRITICA_ASSEDIO',
      'PALAVRA_CRITICA_TOXICO',
      'PALAVRA_CRITICA_DEMISSAO',
      'QUEDA_CONSECUTIVA',
      'SETOR_CRITICO',
    ]
    for (const key of keys) {
      expect(GLASS_ALERT_LABELS[key]).toBeTruthy()
    }
  })

  it('mantém as palavras-chave normalizadas (minúsculas, sem acento)', () => {
    for (const group of Object.values(GLASS_CRITICAL_KEYWORDS)) {
      for (const word of group) {
        expect(word).toBe(word.toLowerCase())
        expect(word.normalize('NFD')).toBe(word)
      }
    }
  })

  it('não reconhece "demissão" isolada como palavra crítica', () => {
    expect(GLASS_CRITICAL_KEYWORDS.demissao).not.toContain('demissao')
  })

  it('tem limiares coerentes', () => {
    expect(GLASS_ALERT_RULES.lowRatingMax).toBeLessThan(GLASS_ALERT_RULES.sectorLowRatingCutoff)
    expect(GLASS_ALERT_RULES.consecutiveBelowAverage).toBeGreaterThan(1)
    expect(GLASS_ALERT_RULES.sectorMinLowReviews).toBeGreaterThan(1)
  })

  it('reconhece comando de relatório', () => {
    expect(isGlassCommand('/relatorio')).toBe(true)
    expect(isGlassCommand('/cruzamento setor cargo')).toBe(true)
    expect(isGlassCommand('  /TENDENCIA  ')).toBe(true)
    expect(isGlassCommand('qual a média do setor de suporte?')).toBe(false)
    expect(isGlassCommand('/inexistente')).toBe(false)
  })

  it('exige setor, cargo e tempo de casa na gravação', () => {
    expect([...GLASS_REQUIRED_FIELDS].sort()).toEqual(['role', 'sector', 'tenure'])
  })

  it('cobre as quatro dimensões de recorte', () => {
    expect([...GLASS_BREAKDOWN_DIMENSIONS]).toEqual(['setor', 'cargo', 'tempo', 'status'])
  })

  it('lista os quatro comandos', () => {
    expect([...GLASS_COMMANDS]).toEqual(['/relatorio', '/tendencia', '/criticos', '/cruzamento'])
  })

  it('cobre o tempo de casa sem buraco entre as faixas', () => {
    // Cada bucket declara o ano em que começa e em que termina no próprio nome;
    // o fim de uma faixa tem de ser o começo da seguinte, senão existe tempo de
    // casa que não cabe em bucket nenhum ("2 anos e meio" na versão antiga).
    const limites = [...GLASS_TENURE_BUCKETS].map((bucket) => bucket.match(/\d+/g)?.map(Number) ?? [])
    expect(limites).toEqual([[1], [1, 3], [3, 5], [5]])
    for (const bucket of GLASS_TENURE_BUCKETS) {
      expect(GLASS_TENURE_LABELS[bucket]).toBeTruthy()
    }
  })

  it('nomeia todo sentimento em português', () => {
    for (const sentiment of GLASS_SENTIMENTS) {
      expect(GLASS_SENTIMENT_LABELS[sentiment]).toBeTruthy()
    }
  })
})
