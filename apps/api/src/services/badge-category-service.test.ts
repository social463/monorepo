import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, INTERNAL_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  BadgeCategoryError,
  createBadgeCategory,
  findBadgeCategoryByName,
  listBadgeCategories,
  updateBadgeCategory,
} from './badge-category-service'

/**
 * Documento 4, seções 11.3 e 11.4: o tema é a prateleira do catálogo.
 * **Não é `RecognitionCategory`**, que é a categoria do feedback.
 */

const COMPANY = DEFAULT_COMPANY_ID
// A segunda empresa semeada pela migration — o truncate dos testes preserva as
// duas, e é ela que prova o isolamento por empresa.
const OUTRA = INTERNAL_COMPANY_ID

describe('createBadgeCategory', () => {
  it('cria com slug derivado do nome e entra no fim da ordem', async () => {
    const primeiro = await createBadgeCategory(COMPANY, 'Cultura')
    const segundo = await createBadgeCategory(COMPANY, 'Clima e Bem-estar')

    expect(primeiro.slug).toBe('cultura')
    expect(segundo.slug).toBe('clima-e-bem-estar')
    expect(segundo.order).toBe(primeiro.order + 1)
  })

  it('recusa nome repetido na mesma empresa', async () => {
    await createBadgeCategory(COMPANY, 'Cultura')
    await expect(createBadgeCategory(COMPANY, 'cultura')).rejects.toThrow(/Já existe um tema/)
  })

  /** Único por EMPRESA, como `Badge.slug` e `Sector.slug` — regra do repo. */
  it('o mesmo nome em outra empresa é outro tema', async () => {
    await createBadgeCategory(COMPANY, 'Cultura')
    const daOutra = await createBadgeCategory(OUTRA, 'Cultura')

    expect(daOutra.slug).toBe('cultura')
    expect(await listBadgeCategories(COMPANY)).toHaveLength(1)
    expect(await listBadgeCategories(OUTRA)).toHaveLength(1)
  })

  it('recusa nome vazio ou só com pontuação', async () => {
    await expect(createBadgeCategory(COMPANY, '   ')).rejects.toThrow(BadgeCategoryError)
    await expect(createBadgeCategory(COMPANY, '!!!')).rejects.toThrow(/letras ou números/)
  })
})

describe('updateBadgeCategory', () => {
  /**
   * O slug NÃO acompanha a renomeação, e é ele que a planilha de importação
   * casa — mudá-lo faria a próxima importação criar um tema duplicado.
   */
  it('renomear não muda o slug', async () => {
    const criado = await createBadgeCategory(COMPANY, 'Cultura')

    const renomeado = await updateBadgeCategory(COMPANY, criado.id, { name: 'Cultura e Valores' })

    expect(renomeado.name).toBe('Cultura e Valores')
    expect(renomeado.slug).toBe('cultura')
  })

  it('desativar não apaga — some da lista padrão, fica na do admin', async () => {
    const criado = await createBadgeCategory(COMPANY, 'Cultura')

    await updateBadgeCategory(COMPANY, criado.id, { active: false })

    expect(await listBadgeCategories(COMPANY)).toHaveLength(0)
    expect(await listBadgeCategories(COMPANY, { includeInactive: true })).toHaveLength(1)
  })

  it('tema de outra empresa é 404', async () => {
    const daOutra = await createBadgeCategory(OUTRA, 'Cultura')
    await expect(updateBadgeCategory(COMPANY, daOutra.id, { name: 'X' })).rejects.toThrow(/não encontrado/)
  })
})

describe('listBadgeCategories', () => {
  it('traz o contador de selos que o painel mostra', async () => {
    const cultura = await createBadgeCategory(COMPANY, 'Cultura')
    await prisma.badge.create({
      data: {
        slug: 'do-tema',
        name: 'Do tema',
        description: 'd',
        kind: 'IMPACT',
        iconKey: 'star',
        badgeCategoryId: cultura.id,
        companyId: COMPANY,
      },
    })
    await prisma.badge.create({
      data: { slug: 'sem-tema', name: 'Sem tema', description: 'd', kind: 'IMPACT', iconKey: 'star', companyId: COMPANY },
    })

    const [tema] = await listBadgeCategories(COMPANY)
    expect(tema.badgeCount).toBe(1)
  })
})

describe('findBadgeCategoryByName', () => {
  it('casa pelo slug, então acento e caixa não importam', async () => {
    const criado = await createBadgeCategory(COMPANY, 'Desenvolvimento')

    expect((await findBadgeCategoryByName(COMPANY, 'DESENVOLVIMENTO'))?.id).toBe(criado.id)
    expect(await findBadgeCategoryByName(COMPANY, 'Inexistente')).toBeNull()
  })
})
