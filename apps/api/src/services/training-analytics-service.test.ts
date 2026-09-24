import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getTrainingOverview, listPositions } from './training-analytics-service'

/**
 * Documento 4, seção 9.5: a trilha de Desenvolvimento & IA. O fato contado é a
 * CONCLUSÃO, datada por `completedAt`.
 */

const COMPANY = DEFAULT_COMPANY_ID
/** Fixa o "hoje" das janelas: sem isso o teste depende do dia em que roda. */
const AGORA = new Date('2026-08-20T12:00:00.000Z')

const JANELA = { range: '30d' as const }

async function setor(name: string, slug: string) {
  return prisma.sector.create({ data: { name, slug, companyId: COMPANY } })
}

async function pessoa(input: { email: string; sectorId?: string; position?: string; active?: boolean }) {
  return prisma.user.create({
    data: {
      name: input.email,
      email: input.email,
      passwordHash: 'x',
      sectorId: input.sectorId ?? DEFAULT_SECTOR_ID,
      position: input.position ?? null,
      active: input.active ?? true,
      companyId: COMPANY,
    },
  })
}

async function curso(input: { slug: string; mandatory?: boolean; status?: 'DRAFT' | 'PUBLISHED' }) {
  return prisma.course.create({
    data: {
      slug: input.slug,
      title: `Curso ${input.slug}`,
      mandatory: input.mandatory ?? false,
      status: input.status ?? 'PUBLISHED',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      companyId: COMPANY,
    },
  })
}

async function conclusao(userId: string, courseId: string, completedAt: Date | null) {
  return prisma.courseEnrollment.create({
    data: {
      userId,
      courseId,
      status: completedAt ? 'COMPLETED' : 'IN_PROGRESS',
      completedAt,
      companyId: COMPANY,
    },
  })
}

function overview(over: Partial<Parameters<typeof getTrainingOverview>[0]> = {}) {
  return getTrainingOverview({
    companyId: COMPANY,
    sectorId: null,
    position: null,
    window: JANELA,
    now: AGORA,
    ...over,
  })
}

describe('conclusões na janela', () => {
  /**
   * Datar por `completedAt`, e não por `createdAt`: quem se inscreveu em
   * janeiro e concluiu em agosto conta em agosto, que é quando o treinamento
   * aconteceu.
   */
  it('conta pela data da CONCLUSÃO, não a da inscrição', async () => {
    const user = await pessoa({ email: 'a@empresa.com' })
    const c = await curso({ slug: 'c1' })
    // Inscrição antiga, conclusão dentro da janela de 30 dias.
    const inscricao = await conclusao(user.id, c.id, new Date('2026-08-10T12:00:00.000Z'))
    await prisma.courseEnrollment.update({
      where: { id: inscricao.id },
      data: { createdAt: new Date('2026-01-05T12:00:00.000Z') },
    })

    expect((await overview()).completions).toBe(1)
  })

  it('conclusão fora da janela fica de fora', async () => {
    const user = await pessoa({ email: 'b@empresa.com' })
    await conclusao(user.id, (await curso({ slug: 'c2' })).id, new Date('2026-01-10T12:00:00.000Z'))

    expect((await overview()).completions).toBe(0)
  })

  it('inscrição em andamento não conta', async () => {
    const user = await pessoa({ email: 'c@empresa.com' })
    await conclusao(user.id, (await curso({ slug: 'c3' })).id, null)

    expect((await overview()).completions).toBe(0)
  })
})

describe('recorte por setor e cargo', () => {
  it('recorta pelo setor de QUEM CONCLUIU', async () => {
    const comercial = await setor('Comercial', 'comercial')
    const daqui = await pessoa({ email: 'd@empresa.com', sectorId: comercial.id })
    const dali = await pessoa({ email: 'e@empresa.com' })
    const c = await curso({ slug: 'c4' })
    await conclusao(daqui.id, c.id, new Date('2026-08-10T12:00:00.000Z'))
    await conclusao(dali.id, c.id, new Date('2026-08-11T12:00:00.000Z'))

    expect((await overview()).completions).toBe(2)
    expect((await overview({ sectorId: comercial.id })).completions).toBe(1)
  })

  it('recorta por cargo', async () => {
    const sre = await pessoa({ email: 'f@empresa.com', position: 'SRE' })
    const dev = await pessoa({ email: 'g@empresa.com', position: 'Dev' })
    const c = await curso({ slug: 'c5' })
    await conclusao(sre.id, c.id, new Date('2026-08-10T12:00:00.000Z'))
    await conclusao(dev.id, c.id, new Date('2026-08-11T12:00:00.000Z'))

    expect((await overview({ position: 'SRE' })).completions).toBe(1)
  })
})

describe('cards', () => {
  it('treinamentos cadastrados é ESTOQUE: não é recortado pela janela', async () => {
    await curso({ slug: 'publicado-1' })
    await curso({ slug: 'publicado-2' })
    await curso({ slug: 'rascunho', status: 'DRAFT' })

    // Janela curtíssima, sem nenhuma conclusão: o catálogo não muda.
    const hoje = await overview({ window: { range: 'hoje' } })
    expect(hoje.coursesPublished).toBe(2)
    expect(hoje.completions).toBe(0)
  })

  it('média por colaborador com zero colaboradores é 0, não NaN', async () => {
    const resultado = await overview({ sectorId: (await setor('Vazio', 'vazio')).id })

    expect(resultado.completionsPerCollaborator).toBe(0)
    expect(Number.isNaN(resultado.completionsPerCollaborator)).toBe(false)
  })

  it('média por colaborador sai com uma casa decimal', async () => {
    const a = await pessoa({ email: 'h@empresa.com' })
    const b = await pessoa({ email: 'i@empresa.com' })
    await conclusao(a.id, (await curso({ slug: 'c6' })).id, new Date('2026-08-10T12:00:00.000Z'))
    await conclusao(a.id, (await curso({ slug: 'c7' })).id, new Date('2026-08-11T12:00:00.000Z'))
    await conclusao(b.id, (await curso({ slug: 'c8' })).id, new Date('2026-08-12T12:00:00.000Z'))

    // 3 conclusões ÷ 2 pessoas.
    expect((await overview()).completionsPerCollaborator).toBe(1.5)
  })

  /**
   * É sobre INSCRIÇÃO, não sobre pessoa, e IGNORA a janela: é estado, não
   * fluxo. Ver o comentário de `mandatoryCompletedPct` no contrato.
   */
  it('obrigatórios finalizados é razão sobre inscrições e ignora a janela', async () => {
    const user = await pessoa({ email: 'j@empresa.com' })
    const obrigatorio = await curso({ slug: 'obr-1', mandatory: true })
    const outro = await curso({ slug: 'obr-2', mandatory: true })
    const opcional = await curso({ slug: 'opc', mandatory: false })
    // Conclusão bem fora da janela de 30 dias — ainda assim conta.
    await conclusao(user.id, obrigatorio.id, new Date('2026-01-05T12:00:00.000Z'))
    await conclusao(user.id, outro.id, null)
    await conclusao(user.id, opcional.id, new Date('2026-08-10T12:00:00.000Z'))

    const resultado = await overview()
    expect(resultado.mandatoryEnrollments).toBe(2)
    expect(resultado.mandatoryCompletedPct).toBe(50)
  })

  it('sem inscrição obrigatória nenhuma, o percentual é 0', async () => {
    expect((await overview()).mandatoryCompletedPct).toBe(0)
  })
})

describe('blocos', () => {
  it('distribui as conclusões por setor, do maior para o menor', async () => {
    const comercial = await setor('Comercial', 'comercial')
    const a = await pessoa({ email: 'k@empresa.com', sectorId: comercial.id })
    const b = await pessoa({ email: 'l@empresa.com', sectorId: comercial.id })
    const c = await pessoa({ email: 'm@empresa.com' })
    const curso1 = await curso({ slug: 'c9' })
    await conclusao(a.id, curso1.id, new Date('2026-08-10T12:00:00.000Z'))
    await conclusao(b.id, curso1.id, new Date('2026-08-11T12:00:00.000Z'))
    await conclusao(c.id, curso1.id, new Date('2026-08-12T12:00:00.000Z'))

    const slices = (await overview()).completionsBySector
    expect(slices[0]).toMatchObject({ sectorName: 'Comercial', completions: 2 })
    expect(slices[1].completions).toBe(1)
  })

  it('ordena os cursos por conclusões e marca o obrigatório', async () => {
    const a = await pessoa({ email: 'n@empresa.com' })
    const b = await pessoa({ email: 'o@empresa.com' })
    const popular = await curso({ slug: 'popular', mandatory: true })
    const raro = await curso({ slug: 'raro' })
    await conclusao(a.id, popular.id, new Date('2026-08-10T12:00:00.000Z'))
    await conclusao(b.id, popular.id, new Date('2026-08-11T12:00:00.000Z'))
    await conclusao(a.id, raro.id, new Date('2026-08-12T12:00:00.000Z'))

    const top = (await overview()).topCourses
    expect(top[0]).toMatchObject({ title: 'Curso popular', mandatory: true, completions: 2 })
    expect(top[1]).toMatchObject({ title: 'Curso raro', mandatory: false, completions: 1 })
  })
})

describe('listPositions', () => {
  it('devolve os cargos EM USO, sem repetir e sem os de quem saiu', async () => {
    await pessoa({ email: 'p@empresa.com', position: 'SRE' })
    await pessoa({ email: 'q@empresa.com', position: 'SRE' })
    await pessoa({ email: 'r@empresa.com', position: 'Designer' })
    await pessoa({ email: 's@empresa.com', position: 'Fantasma', active: false })
    await pessoa({ email: 't@empresa.com' })

    expect(await listPositions(COMPANY)).toEqual(['Designer', 'SRE'])
  })
})
