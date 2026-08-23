import { beforeEach, describe, expect, it } from 'vitest'
import { AI_PROVIDER_CATALOG } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'
import { AI_SETTING_KEYS, resolveAiCredentials } from '../services/ai-settings-service'

const CHAVE = 'AIzaSy-chave-secreta-de-teste-123456'

async function criarUsuario(role: string, email: string, companyId?: string) {
  return prisma.user.create({
    data: {
      name: `Usuário ${role}`,
      email,
      passwordHash: 'x',
      role: role as never,
      ...(companyId ? { companyId } : {}),
    },
  })
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

describe('rotas de configuração de IA', () => {
  it('salva a chave e nunca a devolve na resposta', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const salvou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { apiKey: CHAVE, model: 'gemini-2.5-pro' },
    })
    expect(salvou.statusCode).toBe(200)
    expect(salvou.json()).toEqual({
      provider: 'gemini',
      configured: true,
      model: 'gemini-2.5-pro',
      baseUrl: null,
    })
    // A chave não pode aparecer em campo nenhum, nem mascarada.
    expect(salvou.body).not.toContain(CHAVE)

    const leu = await app.inject({ method: 'GET', url: '/admin/ai-settings', headers: auth })
    expect(leu.json().configured).toBe(true)
    expect(leu.body).not.toContain(CHAVE)
  })

  it('grava a chave cifrada, nunca em texto puro', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-cifra@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    const row = await prisma.appSetting.findFirst({ where: { key: AI_SETTING_KEYS.apiKey } })
    expect(row?.value).toBeTruthy()
    expect(row?.value).not.toContain(CHAVE)
    expect(row?.value?.startsWith('v1:')).toBe(true)

    // …e volta decifrada para quem tem escopo da empresa.
    const creds = await resolveAiCredentials(admin.companyId)
    expect(creds.apiKey).toBe(CHAVE)
    expect(creds.provider).toBe('gemini')
    expect(creds.model).toBe(AI_PROVIDER_CATALOG.gemini.defaultModel)
  })

  it('não deixa a chave vazar para a auditoria', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-auditoria-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'AiSettings' } })
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toContain(CHAVE)
  })

  it('string vazia remove a chave e desliga o agente da empresa', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-remove-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })
    const removeu = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { apiKey: '' },
    })

    expect(removeu.json().configured).toBe(false)
    await expect(resolveAiCredentials(admin.companyId)).rejects.toThrow(/não configurado/i)
  })

  it('campo ausente mantém a chave atual', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-mantem-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })
    const soModelo = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { model: 'gemini-2.5-flash-lite' },
    })

    expect(soModelo.json()).toEqual({
      provider: 'gemini',
      configured: true,
      model: 'gemini-2.5-flash-lite',
      baseUrl: null,
    })
    expect((await resolveAiCredentials(admin.companyId)).apiKey).toBe(CHAVE)
  })

  it('empresa sem provedor gravado continua no Gemini', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-legado-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    // Simula o estado anterior à escolha de provedor: só a chave, sem `ai_provider`.
    await prisma.appSetting.deleteMany({ where: { key: AI_SETTING_KEYS.provider, companyId: admin.companyId } })

    const leu = await app.inject({ method: 'GET', url: '/admin/ai-settings', headers: auth })
    expect(leu.json().provider).toBe('gemini')
    expect((await resolveAiCredentials(admin.companyId)).provider).toBe('gemini')
  })

  it('trocar de provedor apaga a chave antiga — a nova entra no mesmo salvamento', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-troca-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    const trocou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { provider: 'anthropic', apiKey: 'sk-ant-nova', model: 'claude-opus-5' },
    })

    expect(trocou.json()).toEqual({
      provider: 'anthropic',
      configured: true,
      model: 'claude-opus-5',
      baseUrl: null,
    })
    const creds = await resolveAiCredentials(admin.companyId)
    expect(creds.provider).toBe('anthropic')
    expect(creds.apiKey).toBe('sk-ant-nova')
  })

  it('trocar de provedor sem chave nova deixa a empresa sem agente', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-troca-seca-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    const trocou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { provider: 'openai' },
    })

    expect(trocou.json().configured).toBe(false)
    expect(trocou.json().model).toBe(AI_PROVIDER_CATALOG.openai.defaultModel)
    await expect(resolveAiCredentials(admin.companyId)).rejects.toThrow(/não configurado/i)
  })

  it('compatível com OpenAI guarda a URL e a devolve para o agente', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-compat-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const salvou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: {
        provider: 'openai-compatible',
        apiKey: 'gsk-teste',
        model: 'llama-3.3-70b',
        baseUrl: 'https://api.groq.com/openai/v1',
      },
    })

    expect(salvou.json().baseUrl).toBe('https://api.groq.com/openai/v1')
    const creds = await resolveAiCredentials(admin.companyId)
    expect(creds.baseUrl).toBe('https://api.groq.com/openai/v1')
  })

  it('compatível com OpenAI sem URL não liga o agente', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-compat-sem-url@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const salvou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { provider: 'openai-compatible', apiKey: 'gsk-teste' },
    })

    expect(salvou.json().configured).toBe(true)
    await expect(resolveAiCredentials(admin.companyId)).rejects.toThrow(/não configurado/i)
  })

  it('rejeita provedor desconhecido e URL que não é http', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-invalido-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const provedor = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { provider: 'llama-caseiro' },
    })
    const url = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { provider: 'openai-compatible', baseUrl: 'file:///etc/passwd' },
    })

    expect(provedor.statusCode).toBe(400)
    expect(url.statusCode).toBe(400)
  })

  it('a chave de uma empresa não é lida por outra', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-empresa-a@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    await app.inject({ method: 'PUT', url: '/admin/ai-settings', headers: auth, payload: { apiKey: CHAVE } })

    const outra = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const adminB = await criarUsuario('ADMIN', 'admin-empresa-b@outra.com', outra.id)
    const authB = { authorization: `Bearer ${signAccessToken(app, adminB)}` }

    const leuB = await app.inject({ method: 'GET', url: '/admin/ai-settings', headers: authB })
    expect(leuB.json().configured).toBe(false)
    await expect(resolveAiCredentials(outra.id)).rejects.toThrow(/não configurado/i)
  })

  it('SUBADMIN não vê nem edita a chave, mesmo com a feature do agente', async () => {
    const subadmin = await criarUsuario('SUBADMIN', 'subadmin-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, subadmin, ['gente-gestao'])}` }

    const leu = await app.inject({ method: 'GET', url: '/admin/ai-settings', headers: auth })
    const salvou = await app.inject({
      method: 'PUT',
      url: '/admin/ai-settings',
      headers: auth,
      payload: { apiKey: CHAVE },
    })

    expect(leu.statusCode).toBe(403)
    expect(salvou.statusCode).toBe(403)
  })

  it('colaborador comum recebe 403', async () => {
    const user = await criarUsuario('LEGEND', 'colab-ia@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, user)}` }

    expect((await app.inject({ method: 'GET', url: '/admin/ai-settings', headers: auth })).statusCode).toBe(403)
  })

  it('sem token, 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/ai-settings' })).statusCode).toBe(401)
  })
})
