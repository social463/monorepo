import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, RECOGNITION_CATEGORY_SEED } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createCategory, updateCategory, listCategories, getCategory, provisionCategories } from './category-service'

async function createActor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

describe('category-service', () => {
  it('cria categoria com slug derivado do nome e rejeita nome duplicado', async () => {
    const actorId = await createActor()
    const c = await createCategory({ name: 'Colaboração', actorId, companyId: DEFAULT_COMPANY_ID })
    expect(c.slug).toBe('colaboracao')
    await expect(
      createCategory({ name: 'Colaboração', actorId, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 409 })
  })

  /**
   * O slug é o que `Badge.categorySlug` referencia — se ele acompanhasse a
   * renomeação, o selo de categoria pararia de contar sem ninguém encostar nele.
   */
  it('renomear não mexe no slug', async () => {
    const actorId = await createActor()
    const c = await createCategory({ name: 'Inovação', actorId, companyId: DEFAULT_COMPANY_ID })
    const updated = await updateCategory({ id: c.id, name: 'Inovação e experimentação', actorId, companyId: DEFAULT_COMPANY_ID })
    expect(updated.name).toBe('Inovação e experimentação')
    expect(updated.slug).toBe('inovacao')
  })

  it('desativa e reativa em vez de apagar', async () => {
    const actorId = await createActor()
    const c = await createCategory({ name: 'Mentoria', actorId, companyId: DEFAULT_COMPANY_ID })
    const off = await updateCategory({ id: c.id, active: false, actorId, companyId: DEFAULT_COMPANY_ID })
    expect(off.active).toBe(false)
    // A inativa some do que o composer oferece, mas continua no catálogo do admin.
    expect((await listCategories(DEFAULT_COMPANY_ID, { activeOnly: true })).some((x) => x.id === c.id)).toBe(false)
    expect((await listCategories(DEFAULT_COMPANY_ID)).some((x) => x.id === c.id)).toBe(true)
  })

  it('rejeita update de categoria inexistente (404)', async () => {
    const actorId = await createActor()
    await expect(
      updateCategory({ id: 'nao-existe', name: 'X', actorId, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('isola por empresa: categoria de outra empresa não aparece na listagem nem é editável', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Cat', slug: 'outra-empresa-cat-test' } })
    const otherCategory = await createCategory({ name: 'Cat Outra Empresa', actorId, companyId: otherCompany.id })

    const listed = await listCategories(DEFAULT_COMPANY_ID)
    expect(listed.some((c) => c.id === otherCategory.id)).toBe(false)
    expect(await getCategory(otherCategory.id, DEFAULT_COMPANY_ID)).toBeNull()
    await expect(
      updateCategory({ id: otherCategory.id, name: 'Invasão', actorId, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  /** Empresa sem catálogo trava o feedback (exige categoria) e a votação junto. */
  it('provisiona o catálogo inicial com slug, e é idempotente', async () => {
    const company = await prisma.company.create({ data: { name: 'Empresa Nova Cat', slug: 'empresa-nova-cat-test' } })
    await provisionCategories(prisma, company.id)
    await provisionCategories(prisma, company.id)

    const categories = await listCategories(company.id)
    expect(categories).toHaveLength(RECOGNITION_CATEGORY_SEED.length)
    expect(categories.every((c) => c.slug.length > 0)).toBe(true)
    expect(categories.find((c) => c.name === 'Liderança')?.slug).toBe('lideranca')
  })
})
