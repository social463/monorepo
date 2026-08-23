import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setAccessToken, getAccessToken } from './api'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response
}

describe('apiFetch', () => {
  beforeEach(() => {
    setAccessToken(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function callAt(i: number): [string, RequestInit] {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    return fetchMock.mock.calls[i] as [string, RequestInit]
  }
  function headersAt(i: number): Record<string, string> {
    return callAt(i)[1].headers as Record<string, string>
  }

  it('retorna undefined em respostas 204 sem corpo (ex: DELETE)', async () => {
    const noContent = {
      ok: true,
      status: 204,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(noContent))
    const result = await apiFetch('/feedbacks/f1', { method: 'DELETE' })
    expect(result).toBeUndefined()
  })

  it('omits Content-Type on bodyless requests', async () => {
    await apiFetch('/admin/periods/p1/close', { method: 'POST' })
    expect(headersAt(0)['Content-Type']).toBeUndefined()
  })

  it('sets Content-Type: application/json when a body is sent', async () => {
    await apiFetch('/admin/periods', { method: 'POST', body: JSON.stringify({}) })
    expect(headersAt(0)['Content-Type']).toBe('application/json')
  })

  it('anexa o access token em memória como Bearer', async () => {
    setAccessToken('abc123')
    await apiFetch('/auth/me')
    expect(headersAt(0)['Authorization']).toBe('Bearer abc123')
  })

  it('em 401 faz refresh único e re-tenta a requisição original', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expirado' }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'novo' }))
      .mockResolvedValueOnce(jsonResponse({ data: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ data: number }>('/profile')
    expect(result).toEqual({ data: 1 })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(getAccessToken()).toBe('novo')
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer novo',
    })
  })

  it('chamadas concorrentes em 401 disparam um único refresh', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/refresh') return Promise.resolve(jsonResponse({ accessToken: 'x' }))
      return Promise.resolve(
        getAccessToken()
          ? jsonResponse({ ok: true })
          : jsonResponse({}, { ok: false, status: 401 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])
    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh')
    expect(refreshCalls).toHaveLength(1)
  })

  it('não leva mensagem de 5xx para a tela', async () => {
    // Já aconteceu de o stack do Prisma (com caminho de arquivo e schema)
    // aparecer inteiro na tela de login.
    const vazamento =
      'Invalid `prisma.user.findUnique()` invocation in /home/app/src/services/auth-service.ts:33\nerror: Environment variable not found: DATABASE_URL.'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: vazamento }, { ok: false, status: 500 })))

    await expect(apiFetch('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 500,
      message: 'Erro inesperado no servidor. Tente de novo em instantes.',
    })
  })

  it('preserva o corpo original do 500 em payload, para depuração', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'detalhe interno' }, { ok: false, status: 500 })))

    await expect(apiFetch('/x')).rejects.toMatchObject({
      payload: { message: 'detalhe interno' },
      message: 'Erro inesperado no servidor. Tente de novo em instantes.',
    })
  })

  it('mantém a mensagem de 503, que é resposta deliberada de rota', async () => {
    // `AgentError` sem chave de IA cadastrada, upload sem S3, timeout do
    // provedor: tudo isso sai por `reply.code(50x).send({ message })`, com texto
    // em português escrito para a tela. Trocar por genérico apagaria a única
    // pista que o admin tem do que precisa configurar.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Agente de IA não configurado.' }, { ok: false, status: 503 })),
    )

    await expect(apiFetch('/agents/benchmarking')).rejects.toMatchObject({
      status: 503,
      message: 'Agente de IA não configurado.',
    })
  })

  it('mantém a mensagem de 4xx, que é escrita para o usuário ler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'E-mail já cadastrado.' }, { ok: false, status: 409 })))

    await expect(apiFetch('/admin/users', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409,
      message: 'E-mail já cadastrado.',
    })
  })
})
