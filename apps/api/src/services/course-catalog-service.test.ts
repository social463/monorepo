import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import type { CourseActor } from './course-admin-service'
import {
  CourseCatalogError,
  createCompetency,
  createCourseCategory,
  createInstructor,
  deleteCompetency,
  deleteCourseCategory,
  deleteInstructor,
  listCourseCategories,
  listInstructors,
  updateCourseCategory,
  updateInstructor,
} from './course-catalog-service'

/** `recordAuditLog` exige um `actorId` que exista de verdade (FK). */
async function makeActor(): Promise<CourseActor> {
  const user = await prisma.user.create({
    data: {
      name: 'Admin',
      email: `admin-catalogo-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  return { id: user.id, role: 'ADMIN', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
}

async function makeCourse(): Promise<string> {
  const course = await prisma.course.create({
    data: {
      slug: `curso-${Math.random().toString(36).slice(2)}`,
      title: 'Curso',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  return course.id
}

let actor: CourseActor
beforeEach(async () => {
  actor = await makeActor()
})

describe('catálogo de cursos — categorias', () => {
  it('gera slug a partir do nome, sem acento', async () => {
    const criada = await createCourseCategory(actor, { name: 'Gestão & Liderança' })
    expect(criada.slug).toBe('gestao-lideranca')
  })

  // Quem cadastra não deveria precisar inventar um nome diferente porque o slug
  // bateu com o de outra categoria.
  it('sufixa o slug quando ele já existe na empresa', async () => {
    await createCourseCategory(actor, { name: 'Liderança' })
    const segunda = await createCourseCategory(actor, { name: 'Lideranca' })
    expect(segunda.slug).toBe('lideranca-2')
  })

  /**
   * O slug é o identificador estável — é ele que a importação casa e o que
   * referências externas guardam. Acompanhar a renomeação o quebraria.
   */
  it('o slug NÃO acompanha a renomeação', async () => {
    const criada = await createCourseCategory(actor, { name: 'Liderança' })
    const renomeada = await updateCourseCategory(actor, criada.id, { name: 'Liderança e Gestão' })
    expect(renomeada.name).toBe('Liderança e Gestão')
    expect(renomeada.slug).toBe('lideranca')
  })

  it('a subcategoria aponta para a raiz e a lista traz o nome dela', async () => {
    const raiz = await createCourseCategory(actor, { name: 'Onboarding' })
    await createCourseCategory(actor, { name: 'Primeiros 30 dias', parentId: raiz.id })

    const lista = await listCourseCategories(actor)
    const filha = lista.find((c) => c.name === 'Primeiros 30 dias')
    expect(filha?.parentId).toBe(raiz.id)
    expect(filha?.parentName).toBe('Onboarding')
  })

  // A seção 9.6 pede categoria e subcategoria — dois níveis. Uma neta obrigaria
  // a decidir como exibir uma hierarquia que ninguém pediu.
  it('recusa subcategoria de subcategoria e categoria que é a própria raiz', async () => {
    const raiz = await createCourseCategory(actor, { name: 'Onboarding' })
    const filha = await createCourseCategory(actor, { name: 'Primeiros 30 dias', parentId: raiz.id })

    await expect(createCourseCategory(actor, { name: 'Neta', parentId: filha.id })).rejects.toThrow(
      /não pode ser raiz de outra/i,
    )
    await expect(updateCourseCategory(actor, raiz.id, { parentId: raiz.id })).rejects.toThrow(
      /própria raiz/i,
    )
  })

  /**
   * Desativa-se, não se apaga: a FK do curso é `SetNull`, então apagar tiraria a
   * categoria do curso sem que ninguém tivesse pedido isso.
   */
  it('recusa excluir categoria com curso atrás, e conta quantos são', async () => {
    const categoria = await createCourseCategory(actor, { name: 'Liderança' })
    const courseId = await makeCourse()
    await prisma.course.update({ where: { id: courseId }, data: { categoryId: categoria.id } })

    await expect(deleteCourseCategory(actor, categoria.id)).rejects.toMatchObject({ status: 409 })
    const lista = await listCourseCategories(actor)
    expect(lista.find((c) => c.id === categoria.id)?.courseCount).toBe(1)

    // Desativar é o caminho, e o curso continua ligado a ela.
    const desativada = await updateCourseCategory(actor, categoria.id, { active: false })
    expect(desativada.active).toBe(false)
    const curso = await prisma.course.findUnique({ where: { id: courseId } })
    expect(curso?.categoryId).toBe(categoria.id)
  })

  it('recusa excluir categoria que tem subcategoria', async () => {
    const raiz = await createCourseCategory(actor, { name: 'Onboarding' })
    await createCourseCategory(actor, { name: 'Filha', parentId: raiz.id })
    await expect(deleteCourseCategory(actor, raiz.id)).rejects.toMatchObject({ status: 409 })
  })

  it('exclui categoria vazia', async () => {
    const categoria = await createCourseCategory(actor, { name: 'Temporária' })
    await deleteCourseCategory(actor, categoria.id)
    expect(await listCourseCategories(actor)).toHaveLength(0)
  })

  it('não alcança categoria de outra empresa', async () => {
    await prisma.company.upsert({
      where: { id: 'company-outra' },
      create: { id: 'company-outra', name: 'Outra', slug: 'outra' },
      update: {},
    })
    const deOutra = await prisma.courseCategory.create({
      data: { name: 'De outra', slug: 'de-outra', companyId: 'company-outra' },
    })
    await expect(updateCourseCategory(actor, deOutra.id, { name: 'Invadida' })).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('catálogo de cursos — competências', () => {
  it('recusa excluir competência em uso e aceita a vazia', async () => {
    const emUso = await createCompetency(actor, { name: 'Comunicação', icon: '💬' })
    const courseId = await makeCourse()
    await prisma.courseCompetency.create({ data: { courseId, competencyId: emUso.id } })

    await expect(deleteCompetency(actor, emUso.id)).rejects.toMatchObject({ status: 409 })

    const livre = await createCompetency(actor, { name: 'Negociação' })
    await deleteCompetency(actor, livre.id)
  })

  it('guarda ícone e descrição', async () => {
    const criada = await createCompetency(actor, {
      name: 'Inteligência Artificial',
      icon: '🤖',
      description: 'Usar IA como alavanca no dia a dia.',
    })
    expect(criada.icon).toBe('🤖')
    expect(criada.description).toBe('Usar IA como alavanca no dia a dia.')
  })
})

describe('catálogo de cursos — instrutores (seção 9.7)', () => {
  async function makeColaborador(nome = 'Mariana Venancio') {
    return prisma.user.create({
      data: {
        name: nome,
        email: `instrutor-${Math.random().toString(36).slice(2)}@empresa.com`,
        passwordHash: 'x',
        sectorId: DEFAULT_SECTOR_ID,
        photoUrl: 'https://cdn.exemplo.com/mari.png',
        companyId: DEFAULT_COMPANY_ID,
      },
    })
  }

  /**
   * O ponto da 9.7: quando o instrutor é colaborador, nome e área vêm da base de
   * pessoas. Uma cópia editável aqui criaria duas verdades sobre a mesma pessoa.
   */
  it('instrutor interno deriva nome, foto e área do colaborador', async () => {
    const user = await makeColaborador()
    const criado = await createInstructor(actor, { userId: user.id, bio: 'Facilita há 5 anos.' })

    expect(criado.userId).toBe(user.id)
    expect(criado.name).toBe('Mariana Venancio')
    // A área do instrutor interno é o SETOR do colaborador.
    expect(criado.area).toBeTruthy()
    expect(criado.photoUrl).toBe('https://cdn.exemplo.com/mari.png')
    expect(criado.bio).toBe('Facilita há 5 anos.')
  })

  it('renomear o colaborador muda o instrutor, porque o nome é derivado', async () => {
    const user = await makeColaborador()
    const criado = await createInstructor(actor, { userId: user.id })
    await prisma.user.update({ where: { id: user.id }, data: { name: 'Mariana V. Souza' } })

    const lista = await listInstructors(actor)
    expect(lista.find((i) => i.id === criado.id)?.name).toBe('Mariana V. Souza')
  })

  it('o nome do instrutor interno não é editável aqui', async () => {
    const user = await makeColaborador()
    const criado = await createInstructor(actor, { userId: user.id })
    const depois = await updateInstructor(actor, criado.id, { name: 'Nome Inventado' })
    expect(depois.name).toBe('Mariana Venancio')
  })

  it('o mesmo colaborador não vira dois instrutores', async () => {
    const user = await makeColaborador()
    await createInstructor(actor, { userId: user.id })
    await expect(createInstructor(actor, { userId: user.id })).rejects.toMatchObject({ status: 409 })
  })

  it('instrutor externo preenche na mão e exige nome', async () => {
    const externo = await createInstructor(actor, {
      name: 'Consultor de Fora',
      email: 'consultor@fora.com',
      expertise: ['Vendas', 'Negociação'],
    })
    expect(externo.userId).toBeNull()
    expect(externo.area).toBeNull()
    expect(externo.expertise).toEqual(['Vendas', 'Negociação'])

    await expect(createInstructor(actor, { name: '   ' })).rejects.toThrow(/informe o nome/i)
  })

  it('recusa excluir instrutor com curso atrás', async () => {
    const instrutor = await createInstructor(actor, { name: 'Consultor' })
    const courseId = await makeCourse()
    await prisma.courseInstructor.create({ data: { courseId, instructorId: instrutor.id } })
    await expect(deleteInstructor(actor, instrutor.id)).rejects.toMatchObject({ status: 409 })
  })
})
