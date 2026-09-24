import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CollaboratorsSection, filterCollaborators } from './CollaboratorsSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

const mockApiFetch = apiFetch as unknown as Mock

function setupFetch() {
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    const method = options?.method
    if (path === '/admin/users' && !method) {
      return Promise.resolve({
        users: [{ id: 'u9', name: 'Diego Reis', email: 'd@e.com', role: 'LEGEND', position: 'SRE', squad: 'Plataforma', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-1', leftAt: null, teamsWebhookUrl: null, birthDate: '1990-05-20' }],
      })
    }
    if (path === '/admin/sectors' && !method) {
      return Promise.resolve({ sectors: [{ id: 'sector-1', name: 'Plataforma', slug: 'plataforma', active: true, enabledFeatures: [], roles: [] }] })
    }
    if (path.startsWith('/admin/users/') && method === 'PATCH') {
      return Promise.resolve({ user: { id: 'u9', name: 'Diego Reis', email: 'novo@e.com', role: 'LEGEND', position: 'SRE', squad: 'Plataforma', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z' } })
    }
    if (path === '/admin/users' && method === 'POST') {
      return Promise.resolve({ user: { id: 'u10', name: 'Nova Lenda', email: 'nova@e.com', role: 'LEGEND', position: '', squad: '', photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-1', leftAt: null, teamsWebhookUrl: null } })
    }
    return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CollaboratorsSection />
    </QueryClientProvider>,
  )
}

describe('CollaboratorsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('edits a collaborator email and password (PATCH)', async () => {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    fireEvent.change(screen.getByLabelText(/e-mail do colaborador/i), { target: { value: 'novo@e.com' } })
    fireEvent.change(screen.getByLabelText(/nova senha do colaborador/i), { target: { value: 'segredo123' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/u9', expect.objectContaining({ method: 'PATCH' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/u9' && c[1]?.method === 'PATCH')![1] as RequestInit).body as string)
    expect(body.email).toBe('novo@e.com')
    expect(body.password).toBe('segredo123')
  })

  it('keeps the password unchanged when the field is left blank', async () => {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    fireEvent.change(screen.getByLabelText(/cargo do colaborador/i), { target: { value: 'Staff SRE' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/u9', expect.objectContaining({ method: 'PATCH' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/u9' && c[1]?.method === 'PATCH')![1] as RequestInit).body as string)
    expect(body.password).toBeUndefined()
  })

  it('pré-preenche a data de nascimento e envia a nova no PATCH', async () => {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    const input = screen.getByLabelText(/data de nascimento do colaborador/i)
    expect(input).toHaveValue('1990-05-20')
    fireEvent.change(input, { target: { value: '1991-08-03' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/u9', expect.objectContaining({ method: 'PATCH' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/u9' && c[1]?.method === 'PATCH')![1] as RequestInit).body as string)
    expect(body.birthDate).toBe('1991-08-03')
  })

  it('envia null ao limpar a data de nascimento', async () => {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }))
    fireEvent.change(screen.getByLabelText(/data de nascimento do colaborador/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/u9', expect.objectContaining({ method: 'PATCH' })),
    )
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/u9' && c[1]?.method === 'PATCH')![1] as RequestInit).body as string)
    expect(body.birthDate).toBeNull()
  })

  it('cria lenda com data de nascimento; omite o campo quando em branco', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    fireEvent.change(screen.getByLabelText(/^nome$/i), { target: { value: 'Nova Lenda' } })
    fireEvent.change(screen.getByLabelText(/^e-mail$/i), { target: { value: 'nova@e.com' } })
    fireEvent.change(screen.getByLabelText(/senha provisória/i), { target: { value: 'segredo123' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar lenda$/i }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ method: 'POST' })))
    let body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.birthDate).toBeUndefined()

    mockApiFetch.mockClear()
    setupFetch()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    fireEvent.change(screen.getByLabelText(/^nome$/i), { target: { value: 'Outra Lenda' } })
    fireEvent.change(screen.getByLabelText(/^e-mail$/i), { target: { value: 'outra@e.com' } })
    fireEvent.change(screen.getByLabelText(/senha provisória/i), { target: { value: 'segredo123' } })
    fireEvent.change(screen.getByLabelText(/^data de nascimento$/i), { target: { value: '1993-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar lenda$/i }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ method: 'POST' })))
    body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.birthDate).toBe('1993-12-01')
  })

  it('cria lenda sem selecionar setor (usa o padrão do servidor)', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    fireEvent.change(screen.getByLabelText(/^nome$/i), { target: { value: 'Nova Lenda' } })
    fireEvent.change(screen.getByLabelText(/^e-mail$/i), { target: { value: 'nova@e.com' } })
    fireEvent.change(screen.getByLabelText(/senha provisória/i), { target: { value: 'segredo123' } })
    fireEvent.click(screen.getByRole('button', { name: /^criar lenda$/i }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.sectorId).toBeUndefined()
  })

  it('cria lenda com o setor selecionado no formulário', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    fireEvent.change(screen.getByLabelText(/^nome$/i), { target: { value: 'Nova Lenda' } })
    fireEvent.change(screen.getByLabelText(/^e-mail$/i), { target: { value: 'nova@e.com' } })
    fireEvent.change(screen.getByLabelText(/senha provisória/i), { target: { value: 'segredo123' } })
    fireEvent.click(screen.getByLabelText(/^setor$/i))
    fireEvent.click(await screen.findByRole('option', { name: 'Plataforma' }))
    fireEvent.click(screen.getByRole('button', { name: /^criar lenda$/i }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/users', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users' && c[1]?.method === 'POST')![1] as RequestInit).body as string)
    expect(body.sectorId).toBe('sector-1')
  })

  it('abre o diálogo de férias pela linha do colaborador', async () => {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    await userEvent.click(await screen.findByRole('button', { name: /^férias$/i }))
    expect(screen.getByLabelText(/início/i)).toBeInTheDocument()
  })
})

describe('CollaboratorsSection — listagem tabular (Documento 3, seção 4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/users' && !method) {
        return Promise.resolve({
          users: [
            { id: 'u1', name: 'Ana Comercial', email: 'ana@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-comercial', leftAt: null, teamsWebhookUrl: null },
            { id: 'u2', name: 'Bruno Dev', email: 'bruno@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-dev', leftAt: null, teamsWebhookUrl: null },
            { id: 'u3', name: 'Carla Dev', email: 'carla@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-dev', leftAt: null, teamsWebhookUrl: null },
          ],
        })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({
          sectors: [
            { id: 'sector-comercial', name: 'Comercial', slug: 'comercial', active: true, enabledFeatures: [], roles: [] },
            { id: 'sector-dev', name: 'Desenvolvimento', slug: 'desenvolvimento', active: true, enabledFeatures: [], roles: [] },
          ],
        })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
  })

  it('mostra todo mundo numa linha só, sem acordeão para abrir', async () => {
    renderSection()

    // Todas as pessoas visíveis de uma vez: era preciso adivinhar o setor certo
    // antes de achar alguém.
    expect(await screen.findByText('Ana Comercial')).toBeInTheDocument()
    expect(screen.getByText('Bruno Dev')).toBeInTheDocument()
    expect(screen.getByText('Carla Dev')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desenvolvimento \(2\)/i })).not.toBeInTheDocument()
  })

  it('traz as colunas que a G&G pediu, com o setor resolvido pelo nome', async () => {
    renderSection()
    await screen.findByText('Ana Comercial')

    for (const coluna of ['Nome', 'Setor', 'Cargo', 'Líder', 'Tags', 'Status']) {
      expect(screen.getByRole('columnheader', { name: coluna })).toBeInTheDocument()
    }
    const linha = screen.getByText('Bruno Dev').closest('tr')!
    expect(within(linha).getByRole('cell', { name: 'Desenvolvimento' })).toBeInTheDocument()
    expect(within(linha).getByText('Ativo')).toBeInTheDocument()
  })

  it('filtra por status sem tocar na busca', async () => {
    renderSection()
    await screen.findByText('Ana Comercial')

    await userEvent.click(screen.getByRole('combobox', { name: 'Filtrar por status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Desligado' }))

    expect(screen.queryByText('Ana Comercial')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma pessoa encontrada com esses filtros.')).toBeInTheDocument()
  })

  it('coloca usuário com setor desconhecido em "Sem setor"', async () => {
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method
      if (path === '/admin/users' && !method) {
        return Promise.resolve({
          users: [{ id: 'u4', name: 'Órfã Setor', email: 'orfa@e.com', role: 'LEGEND', position: null, squad: null, photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', area: null, sectorId: 'sector-removido', leftAt: null, teamsWebhookUrl: null }],
        })
      }
      if (path === '/admin/sectors' && !method) {
        return Promise.resolve({ sectors: [{ id: 'sector-dev', name: 'Desenvolvimento', slug: 'desenvolvimento', active: true, enabledFeatures: [], roles: [] }] })
      }
      return Promise.reject(new Error(`unexpected ${path} ${method ?? ''}`))
    })
    renderSection()
    // Setor apagado não some da listagem: a pessoa aparece com o setor em branco.
    expect(await screen.findByText('Órfã Setor')).toBeInTheDocument()
  })
})

describe('CollaboratorsSection — Subadmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
    mockAuth.role = 'SUBADMIN'
  })

  it('esconde o seletor de setor e as opções Admin/Subadmin quando logado como Subadmin', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    expect(screen.queryByLabelText('Setor')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Subadmin' })).not.toBeInTheDocument()
  })
})

// ----- Acesso administrativo delegado -----
// Spec: docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md

describe('CollaboratorsSection — acesso administrativo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
    mockAuth.role = 'ADMIN'
  })

  async function abrirEdicao() {
    renderSection()
    // Sem acordeão desde a seção 4.4: a linha já está na tela.
    await screen.findByRole('table')
    await screen.findAllByText('Diego Reis')
    fireEvent.click(screen.getByRole('button', { name: /^editar$/i }))
  }

  function patchBody() {
    const call = mockApiFetch.mock.calls.find((c) => c[0] === '/admin/users/u9' && c[1]?.method === 'PATCH')!
    return JSON.parse((call[1] as RequestInit).body as string)
  }

  it('liga o acesso e manda no PATCH, sem tocar no papel', async () => {
    await abrirEdicao()
    fireEvent.click(screen.getByRole('switch', { name: /acesso administrativo do colaborador/i }))
    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/u9', expect.objectContaining({ method: 'PATCH' })))
    expect(patchBody().adminAccess).toBe(true)
    expect(patchBody().role).toBe('LEGEND')
  })

  // Concessão é do ADMIN por papel: quem entrou pelo próprio acesso delegado
  // não distribui o poder adiante (a API responde 403 ao campo).
  it('o switch não existe para quem não é ADMIN por papel', async () => {
    mockAuth.role = 'SUBADMIN'
    await abrirEdicao()
    expect(screen.queryByRole('switch', { name: /acesso administrativo do colaborador/i })).not.toBeInTheDocument()
  })

  it('desabilita o switch quando o papel escolhido não pode receber o acesso', async () => {
    await abrirEdicao()
    // O `Select` do projeto é um combobox próprio: abre e clica na opção.
    await userEvent.click(screen.getByRole('combobox', { name: 'Papel do colaborador' }))
    await userEvent.click(screen.getByRole('option', { name: 'Terceirizado' }))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /acesso administrativo do colaborador/i })).toBeDisabled(),
    )
  })
})

// ----- Busca, filtros e exportação (PBI 22270, aba "Ficha & Perfil") -----

describe('filterCollaborators', () => {
  const base = {
    photoUrl: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null,
    teamsWebhookUrl: null, birthDate: null, area: null, avatarStyle: null, avatarSeed: null,
    avatarOptions: null, companyId: 'c1', companyName: null,
  }
  const ana = { ...base, id: '1', name: 'Ana Lúcia', email: 'ana@e.com', role: 'LEGEND', position: 'Dev', squad: 'Alpha', sectorId: 's1' } as never
  const bruno = { ...base, id: '2', name: 'Bruno', email: 'bruno@e.com', role: 'LEAD', position: 'Tech Lead', squad: 'Beta', sectorId: 's2' } as never
  const carla = { ...base, id: '3', name: 'Carla', email: 'carla@e.com', role: 'LEGEND', position: null, squad: null, sectorId: 's1' } as never
  const todos = [ana, bruno, carla]
  const vazio = {
    search: '',
    sectorId: '',
    squad: '',
    role: '',
    position: '',
    managerId: '',
    tag: '',
    status: '',
  }

  it('sem filtro devolve todo mundo', () => {
    expect(filterCollaborators(todos, vazio)).toHaveLength(3)
  })

  it('busca por nome ignorando acento e caixa', () => {
    expect(filterCollaborators(todos, { ...vazio, search: 'LUCIA' })).toEqual([ana])
    expect(filterCollaborators(todos, { ...vazio, search: 'lúcia' })).toEqual([ana])
  })

  it('busca também por e-mail, cargo e squad', () => {
    expect(filterCollaborators(todos, { ...vazio, search: 'bruno@e.com' })).toEqual([bruno])
    expect(filterCollaborators(todos, { ...vazio, search: 'tech lead' })).toEqual([bruno])
    expect(filterCollaborators(todos, { ...vazio, search: 'alpha' })).toEqual([ana])
  })

  it('filtra por setor, squad e papel, e combina os filtros', () => {
    expect(filterCollaborators(todos, { ...vazio, sectorId: 's1' })).toEqual([ana, carla])
    expect(filterCollaborators(todos, { ...vazio, squad: 'Beta' })).toEqual([bruno])
    expect(filterCollaborators(todos, { ...vazio, role: 'LEGEND' })).toEqual([ana, carla])
    expect(filterCollaborators(todos, { ...vazio, role: 'LEGEND', sectorId: 's1', search: 'ana' })).toEqual([ana])
  })

  it('não encontra nada devolve lista vazia, sem quebrar em campo nulo', () => {
    expect(filterCollaborators(todos, { ...vazio, search: 'zzz' })).toEqual([])
  })

  it('filtra por cargo, líder e tag — as colunas novas da seção 4.4', () => {
    const comLider = { ...(ana as object), managerId: '2' } as never
    const lista = [comLider, bruno, carla]
    const nomes = new Map([['2', 'Bruno']])
    const tags = new Map([
      ['1', ['Todos', 'Produto']],
      ['2', ['Todos', 'Líder']],
      ['3', ['Todos']],
    ])

    expect(filterCollaborators(lista, { ...vazio, position: 'Tech Lead' }, nomes, tags)).toEqual([bruno])
    expect(filterCollaborators(lista, { ...vazio, managerId: '2' }, nomes, tags)).toEqual([comLider])
    expect(filterCollaborators(lista, { ...vazio, tag: 'Líder' }, nomes, tags)).toEqual([bruno])
    // Busca global cobre o LÍDER pelo nome, não pelo id — é o que se digita.
    expect(filterCollaborators(lista, { ...vazio, search: 'bruno' }, nomes, tags)).toEqual([comLider, bruno])
  })

  it('filtra por status: ativo, inativo e desligado são coisas distintas', () => {
    const inativo = { ...(bruno as object), active: false, leftAt: null } as never
    const desligado = { ...(carla as object), active: false, leftAt: '2026-06-01T00:00:00.000Z' } as never
    const lista = [ana, inativo, desligado]

    expect(filterCollaborators(lista, { ...vazio, status: 'ativo' })).toEqual([ana])
    expect(filterCollaborators(lista, { ...vazio, status: 'inativo' })).toEqual([inativo])
    expect(filterCollaborators(lista, { ...vazio, status: 'desligado' })).toEqual([desligado])
  })
})

describe('CollaboratorsSection — busca, filtro e CSV', () => {
  beforeEach(() => {
    mockAuth.role = 'ADMIN'
    mockApiFetch.mockReset()
    setupFetch()
  })

  it('filtra a lista pela busca e mostra a contagem', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Buscar pessoa'), { target: { value: 'zzz' } })

    await waitFor(() => expect(screen.getByText(/0 de 1 pessoa/i)).toBeInTheDocument())
    expect(screen.getByText(/nenhuma pessoa encontrada/i)).toBeInTheDocument()
  })

  it('o resultado da busca continua na tela — não há mais grupo para esconder', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    // Sem acordeão, a pessoa já está visível antes e depois do filtro.
    expect(screen.getByText(/Diego Reis/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar pessoa'), { target: { value: 'diego' } })

    await waitFor(() => expect(screen.getByText(/Diego Reis/)).toBeInTheDocument())
  })

  it('limpar filtros volta a lista inteira', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Buscar pessoa'), { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.getByText(/0 de 1/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /limpar filtros/i }))

    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
  })

  it('exporta CSV do que está filtrado, com cabeçalho em português', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /exportar csv/i }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0]
    // O Blob do jsdom não tem .text(); FileReader é o caminho suportado.
    const captured = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(captured).toContain('"Nome","E-mail","Papel"')
    expect(captured).toContain('"Diego Reis"')
    expect(captured).toContain('"Plataforma"')
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('desabilita a exportação quando o filtro não deixa ninguém', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Buscar pessoa'), { target: { value: 'zzz' } })

    await waitFor(() => expect(screen.getByRole('button', { name: /exportar csv/i })).toBeDisabled())
  })

  it('SUBADMIN não vê o filtro de setor', async () => {
    mockAuth.role = 'SUBADMIN'
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    expect(screen.queryByRole('combobox', { name: 'Filtrar por setor' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filtrar por papel' })).toBeInTheDocument()
  })

  it('abre a importação por planilha ao lado da exportação', async () => {
    renderSection()
    await waitFor(() => expect(screen.getByText(/1 de 1 pessoa/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /importar planilha/i }))

    expect(screen.getByRole('dialog', { name: 'Importar planilha de lendas' })).toBeInTheDocument()
  })
})
