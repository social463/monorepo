import { describe, it, expect } from 'vitest'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_IMPORT_COLUMNS,
  CALENDAR_IMPORT_FALLBACK_CATEGORY,
  CALENDAR_IMPORT_REQUIRED_COLUMNS,
  CALENDAR_IMPORT_TAG_CATEGORIES,
  calendarImportRowKey,
} from './index'

const SLUGS = new Set<string>(CALENDAR_EVENT_CATEGORIES.map((categoria) => categoria.slug))

describe('CALENDAR_IMPORT_TAG_CATEGORIES', () => {
  it('só aponta para categorias que existem no catálogo', () => {
    for (const [tag, categoria] of Object.entries(CALENDAR_IMPORT_TAG_CATEGORIES)) {
      expect(SLUGS.has(categoria), `tag "${tag}" aponta para "${categoria}", que não é categoria`).toBe(true)
    }
    expect(SLUGS.has(CALENDAR_IMPORT_FALLBACK_CATEGORY)).toBe(true)
  })

  it('não repete uma tag que o catálogo já resolve sozinho', () => {
    // "Reunião" casa por slug com a categoria `reuniao`; ter a mesma chave aqui
    // seria uma segunda verdade sobre o mesmo mapeamento.
    for (const tag of Object.keys(CALENDAR_IMPORT_TAG_CATEGORIES)) {
      expect(SLUGS.has(tag), `"${tag}" já é slug de categoria e não precisa do mapa`).toBe(false)
    }
  })

  it('cobre as 25 tags do Calendário Endomarketing 2026', () => {
    const daPlanilha = [
      'autoral',
      'avaliacao',
      'b2b',
      'b2c',
      'cafe-tematico',
      'campanha-mensal',
      'circuito',
      'comite',
      'cultura',
      'data-comemorativa',
      'desenvolvimento-humano-organizacional',
      'enamed',
      'feriado-municipal',
      'feriado-nacional',
      'festa',
      'games',
      'palestra',
      'ponto-facultativo',
      'porta-de-prova',
      'profecia',
      'profissao',
      'reuniao',
      'ritual-de-comites',
      'simulado',
      'start-na-aprovacao',
    ]
    for (const tag of daPlanilha) {
      const resolvida = SLUGS.has(tag) ? tag : CALENDAR_IMPORT_TAG_CATEGORIES[tag]
      expect(resolvida, `tag "${tag}" da planilha cairia no fallback`).toBeDefined()
    }
  })
})

describe('calendarImportRowKey', () => {
  it('ignora caixa e espaço sobrando — é a mesma linha revisada', () => {
    expect(calendarImportRowKey('  Dia dos  Pais ', '2026-08-09')).toBe(
      calendarImportRowKey('dia dos pais', '2026-08-09'),
    )
  })

  it('separa eventos de mesmo nome em datas diferentes', () => {
    expect(calendarImportRowKey('PodFalaRH', '2026-08-14')).not.toBe(calendarImportRowKey('PodFalaRH', '2026-09-19'))
  })
})

describe('CALENDAR_IMPORT_COLUMNS', () => {
  it('tem as obrigatórias dentro do modelo', () => {
    for (const column of CALENDAR_IMPORT_REQUIRED_COLUMNS) {
      expect(CALENDAR_IMPORT_COLUMNS).toContain(column)
    }
  })
})
