import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateDevelopmentSettings } from './development-settings-service'
import {
  addInovaDiaryEntry,
  createInovaGuiaVideoCard,
  createInovaProject,
  createInovaProjectTask,
  deleteInovaGuiaVideo,
  getInovaProjectDetail,
  InovaError,
  listInovaGuiaVideos,
  listInovaProjects,
  updateInovaProject,
  updateInovaProjectTaskStatus,
  upsertInovaGuiaVideo,
} from './inova-service'

async function createAdmin(companyId: string) {
  return prisma.user.create({
    data: {
      email: `admin-${Math.random()}@teste.com`,
      passwordHash: 'x',
      name: 'Admin',
      role: 'ADMIN',
      companyId,
      sectorId: (await prisma.sector.findFirstOrThrow({ where: { companyId } })).id,
    },
  })
}

describe('gate de empresa do INOVA', () => {
  it('recusa empresa que não é EMR mesmo com o módulo ligado', async () => {
    const outraEmpresa = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    const setor = await prisma.sector.create({ data: { name: 'Setor', slug: 'setor', companyId: outraEmpresa.id } })
    const admin = await prisma.user.create({
      data: {
        email: 'admin@outra.com',
        passwordHash: 'x',
        name: 'Admin Outra',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
        sectorId: setor.id,
      },
    })
    await updateDevelopmentSettings({
      inovaModuleEnabled: true,
      actorId: admin.id,
      companyId: outraEmpresa.id,
    })

    await expect(
      createInovaProject({
        companyId: outraEmpresa.id,
        actorId: admin.id,
        title: 'Projeto',
        category: 'IA',
        sector: 'Ensino',
        description: 'Descrição',
      }),
    ).rejects.toThrow(InovaError)
  })

  it('recusa a EMR com o módulo desligado', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await expect(listInovaProjects(DEFAULT_COMPANY_ID)).resolves.toEqual([])
    await expect(
      createInovaProject({
        companyId: DEFAULT_COMPANY_ID,
        actorId: admin.id,
        title: 'Projeto',
        category: 'IA',
        sector: 'Ensino',
        description: 'Descrição',
      }),
    ).rejects.toThrow(InovaError)
  })

  it('permite a EMR com o módulo ligado', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })
    expect(project.phase).toBe('IDEA')
    const list = await listInovaProjects(DEFAULT_COMPANY_ID)
    expect(list.map((p) => p.id)).toContain(project.id)
  })
})

describe('diário de bordo e tarefas', () => {
  it('qualquer usuário autenticado adiciona entrada de diário; task registra atividade', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto com diário',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })

    const membro = await prisma.user.create({
      data: {
        email: `membro-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Membro',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: (await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })).id,
      },
    })

    const entry = await addInovaDiaryEntry({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      projectId: project.id,
      title: 'Primeira entrada',
      description: 'Testamos a hipótese',
    })
    expect(entry.title).toBe('Primeira entrada')

    const task = await createInovaProjectTask({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      projectId: project.id,
      title: 'Validar com o time',
    })
    expect(task.status).toBe('PENDING')

    const updated = await updateInovaProjectTaskStatus({
      companyId: DEFAULT_COMPANY_ID,
      actorId: membro.id,
      taskId: task.id,
      status: 'DONE',
    })
    expect(updated.status).toBe('DONE')

    const detail = await getInovaProjectDetail(DEFAULT_COMPANY_ID, project.id)
    // A entrada manual + as automáticas de criar e mover a tarefa.
    expect(detail.diaryEntries).toHaveLength(3)
    expect(detail.diaryEntries.filter((e) => e.entryType === 'MANUAL')).toHaveLength(1)
    expect(detail.diaryEntries.filter((e) => e.entryType === 'AUTOMATIC').map((e) => e.title).sort()).toEqual([
      'Tarefa criada: Validar com o time',
      'Tarefa movida: Validar com o time',
    ])
    expect(detail.tasks).toHaveLength(1)
    // criação do projeto + diário + task + mudança de status = 4 entradas de atividade
    expect(detail.activity.length).toBeGreaterThanOrEqual(4)
    expect(detail.phaseHistory).toHaveLength(1)
  })
})

describe('listInovaProjects com arquivados', () => {
  it('lista só não-arquivados por padrão, e só arquivados quando pedido', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const project = await createInovaProject({
      companyId: DEFAULT_COMPANY_ID,
      actorId: admin.id,
      title: 'Projeto arquivável',
      category: 'IA',
      sector: 'Ensino',
      description: 'Descrição',
    })
    await updateInovaProject({
      id: project.id,
      companyId: DEFAULT_COMPANY_ID,
      actor: { id: admin.id, role: 'ADMIN' },
      archived: true,
    })

    const ativos = await listInovaProjects(DEFAULT_COMPANY_ID)
    expect(ativos.map((p) => p.id)).not.toContain(project.id)

    const arquivados = await listInovaProjects(DEFAULT_COMPANY_ID, { archived: true })
    expect(arquivados.map((p) => p.id)).toContain(project.id)
  })
})

describe('biblioteca de vídeos do Guia', () => {
  it('sobrescreve um vídeo do catálogo por link, depois edita só o título sem perder o link', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const criado = await upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-tutorial-guia', admin.id, {
      videoUrl: 'https://youtube.com/watch?v=abc',
    })
    expect(criado.videoId).toBe('vid-tutorial-guia')
    expect(criado.videoUrl).toBe('https://youtube.com/watch?v=abc')
    expect(criado.title).toBeNull()

    const editado = await upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-tutorial-guia', admin.id, {
      title: 'Tutorial revisado',
    })
    expect(editado.title).toBe('Tutorial revisado')
    // Editar só o título não apaga o link já salvo.
    expect(editado.videoUrl).toBe('https://youtube.com/watch?v=abc')

    const lista = await listInovaGuiaVideos(DEFAULT_COMPANY_ID)
    expect(lista.map((v) => v.videoId)).toContain('vid-tutorial-guia')
  })

  it('definir um link limpa o arquivo enviado antes, e vice-versa', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const comArquivo = await upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-x', admin.id, {
      storagePath: `inova-guia-videos/${DEFAULT_COMPANY_ID}/algum-arquivo.mp4`,
    })
    expect(comArquivo.videoUrl).toContain('algum-arquivo.mp4')

    const comLink = await upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-x', admin.id, {
      videoUrl: 'https://vimeo.com/123',
    })
    expect(comLink.videoUrl).toBe('https://vimeo.com/123')
  })

  it('recusa uma storagePath que não nasceu do presign desta empresa', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    await expect(
      upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-x', admin.id, {
        storagePath: 'inova-guia-videos/empresa-de-outro-tenant/arquivo.mp4',
      }),
    ).rejects.toThrow(InovaError)
  })

  it('cria um card custom com videoId gerado pelo servidor', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const card = await createInovaGuiaVideoCard(DEFAULT_COMPANY_ID, admin.id)
    expect(card.title).toBe('Novo vídeo')
    expect(card.videoId).toMatch(/^custom-/)

    const lista = await listInovaGuiaVideos(DEFAULT_COMPANY_ID)
    expect(lista.map((v) => v.videoId)).toContain(card.videoId)
  })

  it('excluir um card custom o remove da lista; excluir a sobrescrita de um card do catálogo só a apaga (idempotente)', async () => {
    const admin = await createAdmin(DEFAULT_COMPANY_ID)
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const card = await createInovaGuiaVideoCard(DEFAULT_COMPANY_ID, admin.id)
    await deleteInovaGuiaVideo(DEFAULT_COMPANY_ID, card.videoId)
    expect((await listInovaGuiaVideos(DEFAULT_COMPANY_ID)).map((v) => v.videoId)).not.toContain(card.videoId)

    await upsertInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-tutorial-guia', admin.id, { title: 'Override' })
    await deleteInovaGuiaVideo(DEFAULT_COMPANY_ID, 'vid-tutorial-guia')
    expect((await listInovaGuiaVideos(DEFAULT_COMPANY_ID)).map((v) => v.videoId)).not.toContain('vid-tutorial-guia')

    // videoId sem linha nenhuma: apagar não é erro.
    await expect(deleteInovaGuiaVideo(DEFAULT_COMPANY_ID, 'nunca-existiu')).resolves.toBeUndefined()
  })
})
