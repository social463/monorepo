import { describe, expect, it, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateDevelopmentSettings } from '../services/development-settings-service'

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('rotas do INOVA', () => {
  it('qualquer colaborador cria projeto, e quem criou vira dono dele', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    const membro = await prisma.user.create({
      data: {
        email: `membro-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Membro',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const tokenMembro = app.jwt.sign({
      sub: membro.id,
      role: 'LEGEND',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })
    const tokenAdmin = app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })

    // Cadastrar deixou de ser de admin: a comunidade é da empresa inteira.
    const doMembro = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenMembro),
      payload: { title: 'Projeto do membro', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(doMembro.statusCode).toBe(200)

    // …e quem criou edita o próprio projeto, que antes era só do admin.
    const editado = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${doMembro.json().project.id}`,
      headers: auth(tokenMembro),
      payload: { title: 'Projeto renomeado' },
    })
    expect(editado.statusCode).toBe(200)
    expect(editado.json().project.title).toBe('Projeto renomeado')

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(criado.statusCode).toBe(200)
    const { project } = criado.json()

    const lista = await app.inject({
      method: 'GET',
      url: '/inova/projects',
      headers: auth(tokenMembro),
    })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().projects.map((p: { id: string }) => p.id)).toContain(project.id)

    const diario = await app.inject({
      method: 'POST',
      url: `/inova/projects/${project.id}/diary`,
      headers: auth(tokenMembro),
      payload: { title: 'Entrada' },
    })
    expect(diario.statusCode).toBe(200)

    await app.close()
  })

  it('aceita deadline/dueDate no formato AAAA-MM-DD que o próprio DTO devolve (round-trip)', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const tokenAdmin = app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição', deadline: '2026-09-04' },
    })
    expect(criado.statusCode).toBe(200)
    const { project } = criado.json()
    expect(project.deadline).toBe('2026-09-04')

    // Manda de volta exatamente o DTO que o servidor acabou de devolver — é o
    // caso do cliente que tipa o corpo como Partial<InovaProjectDTO>.
    const atualizado = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${project.id}`,
      headers: auth(tokenAdmin),
      payload: { deadline: project.deadline },
    })
    expect(atualizado.statusCode).toBe(200)
    expect(atualizado.json().project.deadline).toBe('2026-09-04')

    const tarefa = await app.inject({
      method: 'POST',
      url: `/inova/projects/${project.id}/tasks`,
      headers: auth(tokenAdmin),
      payload: { title: 'Tarefa', dueDate: '2026-09-10' },
    })
    expect(tarefa.statusCode).toBe(200)
    expect(tarefa.json().task.dueDate).toBe('2026-09-10')

    await app.close()
  })

  it('cria projeto com priority/leadershipChallenge booleanos e filtra arquivados por query', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin2-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const tokenAdmin = app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: {
        title: 'Projeto prioritário',
        category: 'IA',
        sector: 'Ensino',
        description: 'Descrição',
        priority: true,
        leadershipChallenge: true,
        estimatedDeadline: '3 meses',
      },
    })
    expect(criado.statusCode).toBe(200)
    expect(criado.json().project.priority).toBe(true)
    expect(criado.json().project.leadershipChallenge).toBe(true)
    expect(criado.json().project.estimatedDeadline).toBe('3 meses')

    await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${criado.json().project.id}`,
      headers: auth(tokenAdmin),
      payload: { archived: true },
    })

    const semArquivados = await app.inject({ method: 'GET', url: '/inova/projects', headers: auth(tokenAdmin) })
    expect(semArquivados.json().projects.map((p: { id: string }) => p.id)).not.toContain(criado.json().project.id)

    const comArquivados = await app.inject({ method: 'GET', url: '/inova/projects?archived=true', headers: auth(tokenAdmin) })
    expect(comArquivados.json().projects.map((p: { id: string }) => p.id)).toContain(criado.json().project.id)

    await app.close()
  })

  it('recusa deadline/dueDate com formato correto mas valores impossíveis (400, não 500)', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin3-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const tokenAdmin = app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })

    const deadlineInvalido = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição', deadline: '2026-13-45' },
    })
    expect(deadlineInvalido.statusCode).toBe(400)

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(tokenAdmin),
      payload: { title: 'Projeto válido', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(criado.statusCode).toBe(200)

    const dueDateInvalido = await app.inject({
      method: 'POST',
      url: `/inova/projects/${criado.json().project.id}/tasks`,
      headers: auth(tokenAdmin),
      payload: { title: 'Tarefa', dueDate: '2026-13-45' },
    })
    expect(dueDateInvalido.statusCode).toBe(400)

    await app.close()
  })
})

describe('quem pode mexer no projeto', () => {
  /**
   * A régua nova (specs/2026-09-15-inova-projeto-de-todos-design.md): cadastrar
   * é de qualquer colaborador, mexer é do DONO — quem criou e os dois
   * responsáveis — ou de quem administra. Curadoria (prioridade, arquivar)
   * continua só de quem administra.
   */
  it('dono edita, muda de fase e exclui; estranho leva 403; curadoria continua do admin', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const criar = async (name: string, role: 'ADMIN' | 'LEGEND') =>
      prisma.user.create({
        data: {
          email: `${name}-${Math.random()}@teste.com`,
          passwordHash: 'x',
          name,
          role,
          companyId: DEFAULT_COMPANY_ID,
          sectorId: sector.id,
        },
      })
    const admin = await criar('Admin', 'ADMIN')
    const dono = await criar('Dono', 'LEGEND')
    const estranho = await criar('Estranho', 'LEGEND')
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const token = (user: { id: string; role: string }) =>
      app.jwt.sign({
        sub: user.id,
        role: user.role,
        sectorId: sector.id,
        companyId: DEFAULT_COMPANY_ID,
        features: [],
      })

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(token(dono)),
      payload: { title: 'Projeto do dono', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    expect(criado.statusCode).toBe(200)
    const projectId = criado.json().project.id as string

    // Estranho não mexe no projeto dos outros.
    const editaEstranho = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}`,
      headers: auth(token(estranho)),
      payload: { title: 'Sequestrado' },
    })
    expect(editaEstranho.statusCode).toBe(403)

    const faseEstranho = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}/phase`,
      headers: auth(token(estranho)),
      payload: { phase: 'TESTING_SOLUTION' },
    })
    expect(faseEstranho.statusCode).toBe(403)

    // O dono move a própria fase.
    const faseDono = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}/phase`,
      headers: auth(token(dono)),
      payload: { phase: 'TESTING_SOLUTION' },
    })
    expect(faseDono.statusCode).toBe(200)
    expect(faseDono.json().project.phase).toBe('TESTING_SOLUTION')

    // Prioridade e arquivamento são curadoria: nem o dono passa.
    const prioridadeDono = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}`,
      headers: auth(token(dono)),
      payload: { priority: true },
    })
    expect(prioridadeDono.statusCode).toBe(403)

    const prioridadeAdmin = await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}`,
      headers: auth(token(admin)),
      payload: { priority: true },
    })
    expect(prioridadeAdmin.statusCode).toBe(200)
    expect(prioridadeAdmin.json().project.priority).toBe(true)

    // Diário: quem escreveu apaga o que escreveu; estranho não apaga o dos outros.
    const entrada = await app.inject({
      method: 'POST',
      url: `/inova/projects/${projectId}/diary`,
      headers: auth(token(estranho)),
      payload: { title: 'Entrada do estranho' },
    })
    expect(entrada.statusCode).toBe(200)
    const entryId = entrada.json().entry.id as string

    const entradaDoDono = await app.inject({
      method: 'POST',
      url: `/inova/projects/${projectId}/diary`,
      headers: auth(token(dono)),
      payload: { title: 'Entrada do dono' },
    })
    const entryIdDono = entradaDoDono.json().entry.id as string

    const apagaOutraEntrada = await app.inject({
      method: 'DELETE',
      url: `/inova/diary/${entryIdDono}`,
      headers: auth(token(estranho)),
    })
    expect(apagaOutraEntrada.statusCode).toBe(403)

    const apagaPropriaEntrada = await app.inject({
      method: 'DELETE',
      url: `/inova/diary/${entryId}`,
      headers: auth(token(estranho)),
    })
    expect(apagaPropriaEntrada.statusCode).toBe(204)

    // Tarefa não guarda autor: a régua é a do projeto.
    const tarefa = await app.inject({
      method: 'POST',
      url: `/inova/projects/${projectId}/tasks`,
      headers: auth(token(estranho)),
      payload: { title: 'Tarefa' },
    })
    const taskId = tarefa.json().task.id as string

    expect(
      (await app.inject({ method: 'DELETE', url: `/inova/tasks/${taskId}`, headers: auth(token(estranho)) })).statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ method: 'DELETE', url: `/inova/tasks/${taskId}`, headers: auth(token(dono)) })).statusCode,
    ).toBe(204)

    // Excluir projeto: estranho não; dono sim, e leva o diário junto.
    expect(
      (await app.inject({ method: 'DELETE', url: `/inova/projects/${projectId}`, headers: auth(token(estranho)) }))
        .statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ method: 'DELETE', url: `/inova/projects/${projectId}`, headers: auth(token(dono)) }))
        .statusCode,
    ).toBe(204)

    expect(await prisma.inovaProject.findUnique({ where: { id: projectId } })).toBeNull()
    expect(await prisma.inovaDiaryEntry.count({ where: { projectId } })).toBe(0)

    await app.close()
  })
})

describe('tarefas e fase do projeto', () => {
  it('edita tarefa, cria direto numa coluna, volta de fase e registra tudo no diário automático', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const dono = await prisma.user.create({
      data: {
        email: `dono-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Dono',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: dono.id, companyId: DEFAULT_COMPANY_ID })
    const headers = auth(
      app.jwt.sign({ sub: dono.id, role: 'LEGEND', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID, features: [] }),
    )

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers,
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    const projectId = criado.json().project.id as string

    // O "+" da coluna "Em andamento" cria a tarefa já nela.
    const tarefa = await app.inject({
      method: 'POST',
      url: `/inova/projects/${projectId}/tasks`,
      headers,
      payload: { title: 'Rascunho', status: 'IN_PROGRESS' },
    })
    expect(tarefa.statusCode).toBe(200)
    expect(tarefa.json().task.status).toBe('IN_PROGRESS')
    const taskId = tarefa.json().task.id as string

    const editada = await app.inject({
      method: 'PATCH',
      url: `/inova/tasks/${taskId}`,
      headers,
      payload: { title: 'Validar com o time', responsible: 'Ana', dueDate: '2026-10-01' },
    })
    expect(editada.statusCode).toBe(200)
    expect(editada.json().task).toMatchObject({ title: 'Validar com o time', responsible: 'Ana', dueDate: '2026-10-01' })

    const limpa = await app.inject({
      method: 'PATCH',
      url: `/inova/tasks/${taskId}`,
      headers,
      payload: { dueDate: null },
    })
    expect(limpa.json().task.dueDate).toBeNull()

    expect(
      (await app.inject({ method: 'PATCH', url: `/inova/tasks/${taskId}`, headers, payload: { title: '' } })).statusCode,
    ).toBe(400)

    // Fase anda e VOLTA — errar a fase não pode ser caminho sem volta.
    for (const phase of ['TESTING_SOLUTION', 'EXPLORING_SOLUTION']) {
      const res = await app.inject({ method: 'PATCH', url: `/inova/projects/${projectId}/phase`, headers, payload: { phase } })
      expect(res.json().project.phase).toBe(phase)
    }
    // Mesma fase de novo não vira histórico: o formulário de edição manda a fase sempre.
    await app.inject({
      method: 'PATCH',
      url: `/inova/projects/${projectId}/phase`,
      headers,
      payload: { phase: 'EXPLORING_SOLUTION' },
    })

    const detail = (await app.inject({ method: 'GET', url: `/inova/projects/${projectId}`, headers })).json()
    expect(detail.phaseHistory.map((h: { phase: string }) => h.phase)).toEqual([
      'IDEA',
      'TESTING_SOLUTION',
      'EXPLORING_SOLUTION',
    ])
    const automaticas = detail.diaryEntries
      .filter((e: { entryType: string }) => e.entryType === 'AUTOMATIC')
      .map((e: { title: string }) => e.title)
    expect(automaticas).toEqual(
      expect.arrayContaining([
        'Tarefa criada: Rascunho',
        'Fase alterada: Testando a Solução',
        'Fase alterada: Explorando a Solução',
      ]),
    )
    expect(automaticas).toHaveLength(3)

    await app.close()
  })
})

describe('chat de IA do painel administrativo', () => {
  it('recusa quem não é admin/subadmin, e permite perguntar e listar/reabrir conversa pra quem administra', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: { email: `admin-${Math.random()}@teste.com`, passwordHash: 'x', name: 'Admin', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: sector.id },
    })
    const membro = await prisma.user.create({
      data: { email: `membro-${Math.random()}@teste.com`, passwordHash: 'x', name: 'Membro', role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, sectorId: sector.id },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const tokenMembro = app.jwt.sign({ sub: membro.id, role: 'LEGEND', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID, features: [] })
    const tokenAdmin = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID, features: [] })

    const negado = await app.inject({
      method: 'POST',
      url: '/inova/admin/chat/ask',
      headers: auth(tokenMembro),
      payload: { message: 'oi' },
    })
    expect(negado.statusCode).toBe(403)

    // Sem chave de IA cadastrada: 503, não 500.
    const semChave = await app.inject({
      method: 'POST',
      url: '/inova/admin/chat/ask',
      headers: auth(tokenAdmin),
      payload: { message: 'oi' },
    })
    expect(semChave.statusCode).toBe(503)

    const conversas = await app.inject({ method: 'GET', url: '/inova/admin/chat/conversations', headers: auth(tokenAdmin) })
    expect(conversas.statusCode).toBe(200)
    expect(conversas.json().conversations).toEqual([])

    // Cria uma conversa do INOVA direto no banco pra checar a serialização real
    // (AGENT_KIND_TO_KEY precisa mapear AgentKind.INOVA -> 'inova' em toAgentConversationDTO).
    const conversaCriada = await prisma.agentConversation.create({
      data: {
        userId: admin.id,
        companyId: DEFAULT_COMPANY_ID,
        agent: 'INOVA',
        title: 'Conversa de teste',
        messages: { create: [{ companyId: DEFAULT_COMPANY_ID, role: 'USER', content: 'oi' }] },
      },
    })

    const detalhe = await app.inject({
      method: 'GET',
      url: `/inova/admin/chat/conversations/${conversaCriada.id}`,
      headers: auth(tokenAdmin),
    })
    expect(detalhe.statusCode).toBe(200)
    expect(detalhe.json().conversation.agent).toBe('inova')
    expect(detalhe.json().conversation.messages).toHaveLength(1)

    // Módulo desativado: as três rotas recusam com o InovaError (403), não 200/500.
    await updateDevelopmentSettings({ inovaModuleEnabled: false, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const askDesativado = await app.inject({
      method: 'POST',
      url: '/inova/admin/chat/ask',
      headers: auth(tokenAdmin),
      payload: { message: 'oi' },
    })
    expect(askDesativado.statusCode).toBe(403)

    const listaDesativada = await app.inject({
      method: 'GET',
      url: '/inova/admin/chat/conversations',
      headers: auth(tokenAdmin),
    })
    expect(listaDesativada.statusCode).toBe(403)

    const detalheDesativado = await app.inject({
      method: 'GET',
      url: `/inova/admin/chat/conversations/${conversaCriada.id}`,
      headers: auth(tokenAdmin),
    })
    expect(detalheDesativado.statusCode).toBe(403)

    await app.close()
  })
})

describe('listagem para o painel e recorte do chat', () => {
  it('a listagem traz as datas de mudança de fase e do diário; o chat recusa recorte grande demais', async () => {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: { email: `admin-${Math.random()}@teste.com`, passwordHash: 'x', name: 'Admin', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: sector.id },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: sector.id, companyId: DEFAULT_COMPANY_ID, features: [] })

    const criado = await app.inject({
      method: 'POST',
      url: '/inova/projects',
      headers: auth(token),
      payload: { title: 'Projeto', category: 'IA', sector: 'Ensino', description: 'Descrição' },
    })
    const { id } = criado.json().project
    await app.inject({ method: 'PATCH', url: `/inova/projects/${id}/phase`, headers: auth(token), payload: { phase: 'TESTING_SOLUTION' } })
    await app.inject({ method: 'POST', url: `/inova/projects/${id}/diary`, headers: auth(token), payload: { title: 'Entrada' } })

    const lista = await app.inject({ method: 'GET', url: '/inova/projects', headers: auth(token) })
    const [projeto] = lista.json().projects
    // A criação grava a fase inicial; a mudança grava a segunda.
    expect(projeto.phaseHistory.map((h: { phase: string }) => h.phase)).toEqual(['IDEA', 'TESTING_SOLUTION'])
    expect(projeto.diaryDates.length).toBeGreaterThanOrEqual(1)
    expect(typeof projeto.diaryDates[0]).toBe('string')

    const grandeDemais = await app.inject({
      method: 'POST',
      url: '/inova/admin/chat/ask',
      headers: auth(token),
      payload: { message: 'oi', projectIds: Array.from({ length: 501 }, (_, i) => `p${i}`) },
    })
    expect(grandeDemais.statusCode).toBe(400)

    await app.close()
  })
})

describe('rotas da biblioteca de vídeos do Guia', () => {
  async function setupInovaGuia() {
    const app = await buildApp()
    const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Admin',
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    const membro = await prisma.user.create({
      data: {
        email: `membro-${Math.random()}@teste.com`,
        passwordHash: 'x',
        name: 'Membro',
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        sectorId: sector.id,
      },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    const tokenAdmin = app.jwt.sign({
      sub: admin.id,
      role: 'ADMIN',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })
    const tokenMembro = app.jwt.sign({
      sub: membro.id,
      role: 'LEGEND',
      sectorId: sector.id,
      companyId: DEFAULT_COMPANY_ID,
      features: [],
    })
    return { app, tokenAdmin, tokenMembro }
  }

  it('qualquer autenticado lista; só admin/subadmin cria, edita e apaga', async () => {
    const { app, tokenAdmin, tokenMembro } = await setupInovaGuia()

    const listaVazia = await app.inject({ method: 'GET', url: '/inova/guia/videos', headers: auth(tokenMembro) })
    expect(listaVazia.statusCode).toBe(200)
    expect(listaVazia.json().videos).toEqual([])

    const negado = await app.inject({ method: 'POST', url: '/inova/guia/videos', headers: auth(tokenMembro) })
    expect(negado.statusCode).toBe(403)

    const criado = await app.inject({ method: 'POST', url: '/inova/guia/videos', headers: auth(tokenAdmin) })
    expect(criado.statusCode).toBe(200)
    const { video } = criado.json()
    expect(video.title).toBe('Novo vídeo')
    expect(video.videoId).toMatch(/^custom-/)

    const negadoPatch = await app.inject({
      method: 'PATCH',
      url: `/inova/guia/videos/${video.videoId}`,
      headers: auth(tokenMembro),
      payload: { title: 'Tentativa' },
    })
    expect(negadoPatch.statusCode).toBe(403)

    const editado = await app.inject({
      method: 'PATCH',
      url: `/inova/guia/videos/${video.videoId}`,
      headers: auth(tokenAdmin),
      payload: { title: 'Editado', videoUrl: 'https://youtube.com/watch?v=abc' },
    })
    expect(editado.statusCode).toBe(200)
    expect(editado.json().video).toMatchObject({ title: 'Editado', videoUrl: 'https://youtube.com/watch?v=abc' })

    const lista = await app.inject({ method: 'GET', url: '/inova/guia/videos', headers: auth(tokenMembro) })
    expect(lista.json().videos.map((v: { videoId: string }) => v.videoId)).toContain(video.videoId)

    const negadoDelete = await app.inject({
      method: 'DELETE',
      url: `/inova/guia/videos/${video.videoId}`,
      headers: auth(tokenMembro),
    })
    expect(negadoDelete.statusCode).toBe(403)

    const apagado = await app.inject({
      method: 'DELETE',
      url: `/inova/guia/videos/${video.videoId}`,
      headers: auth(tokenAdmin),
    })
    expect(apagado.statusCode).toBe(204)

    const listaFinal = await app.inject({ method: 'GET', url: '/inova/guia/videos', headers: auth(tokenMembro) })
    expect(listaFinal.json().videos.map((v: { videoId: string }) => v.videoId)).not.toContain(video.videoId)

    await app.close()
  })

  it('rejeita corpo inválido no PATCH com 400 + issues', async () => {
    const { app, tokenAdmin } = await setupInovaGuia()

    const res = await app.inject({
      method: 'PATCH',
      url: '/inova/guia/videos/vid-tutorial-guia',
      headers: auth(tokenAdmin),
      payload: { videoUrl: 'não é uma url' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()

    await app.close()
  })
})
