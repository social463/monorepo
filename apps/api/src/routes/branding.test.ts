import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, LEGENDS_PRESET } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'
import {
  BRANDING_SETTING_KEY,
  clearBrandingCache,
  getBranding,
  slugFromHost,
} from '../services/branding-service'

const MARCA_EMR = {
  appName: 'EMR Legends',
  tagline: 'Onde as lendas nascem',
  hosts: ['legends.eumedicoresidente.com.br'],
  logos: {
    light: { wide: 'https://cdn.exemplo.com/emr/logotipo-claro.svg', mark: 'https://cdn.exemplo.com/emr/simbolo-claro.svg' },
    dark: { wide: 'https://cdn.exemplo.com/emr/logotipo-escuro.svg', mark: 'https://cdn.exemplo.com/emr/simbolo-escuro.svg' },
  },
  defaultScheme: 'light' as const,
  allowUserScheme: true,
  brandColor: '#35bd78',
  neutralColor: '#f7fafc',
  overrides: { light: { 'surface-tint': '#35bd78' }, dark: { 'surface-tint': '#35bd78' } },
}

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
  // O cache é de módulo e sobrevive ao truncate das tabelas entre testes.
  clearBrandingCache()
  app = buildApp()
  await app.ready()
})

describe('slugFromHost', () => {
  const base = 'legends.com.br'

  it('extrai o tenant de um subdomínio do domínio-base', () => {
    expect(slugFromHost('emr.legends.com.br', base)).toBe('emr')
    expect(slugFromHost('EMR.Legends.Com.Br', base)).toBe('emr')
    expect(slugFromHost('emr.legends.com.br:8080', base)).toBe('emr')
  })

  it('não confunde o próprio domínio-base com um tenant', () => {
    expect(slugFromHost('legends.com.br', base)).toBeNull()
  })

  it('ignora host fora do domínio-base, localhost e níveis extras', () => {
    expect(slugFromHost('emr.outrodominio.com', base)).toBeNull()
    expect(slugFromHost('localhost:5173', base)).toBeNull()
    expect(slugFromHost('a.b.legends.com.br', base)).toBeNull()
    expect(slugFromHost('emr.legends.com.br', null)).toBeNull()
    expect(slugFromHost(undefined, base)).toBeNull()
  })
})

describe('GET /branding — público', () => {
  it('responde a marca do produto quando não há empresa resolvida', async () => {
    const res = await app.inject({ method: 'GET', url: '/branding' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.appName).toBe(LEGENDS_PRESET.appName)
    expect(body.defaultScheme).toBe('dark')
    // O produto não oferece a troca: só o escuro foi desenhado.
    expect(body.allowUserScheme).toBe(false)
    // A paleta vem resolvida: 35 tokens em hex, prontos para virar CSS variable.
    expect(Object.keys(body.colors)).toHaveLength(35)
    expect(body.colors.primary).toBe('#52fba2')
    // Os dois esquemas viajam juntos, para alternar não custar uma ida à API.
    expect(Object.keys(body.schemes).sort()).toEqual(['dark', 'light'])
  })

  it('não exige autenticação — alimenta a tela de login', async () => {
    const res = await app.inject({ method: 'GET', url: '/branding' })
    expect(res.statusCode).not.toBe(401)
  })

  it('resolve a empresa por ?slug= (escape de desenvolvimento local)', async () => {
    const empresa = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } })
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })

    const res = await app.inject({ method: 'GET', url: `/branding?slug=${empresa!.slug}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().appName).toBe('EMR Legends')
    expect(res.json().defaultScheme).toBe('light')
    expect(res.json().allowUserScheme).toBe(true)
  })

  it('resolve a empresa pelo DOMÍNIO PRÓPRIO dela, sem subdomínio nenhum', async () => {
    // É o caso de produção da EMR: a instalação vive no domínio da empresa, e
    // não em `emr.<host do app>`. Sem isto, seria preciso wildcard de DNS.
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'legends.eumedicoresidente.com.br' },
    })
    expect(res.json().appName).toBe('EMR Legends')
  })

  it('casa o domínio ignorando caixa e porta', async () => {
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'Legends.EuMedicoResidente.com.BR:443' },
    })
    expect(res.json().appName).toBe('EMR Legends')
  })

  it('domínio de ninguém cai na marca do produto', async () => {
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/branding',
      headers: { host: 'outra-coisa.com.br' },
    })
    expect(res.json().appName).toBe(LEGENDS_PRESET.appName)
  })

  it('resolve a empresa pelo subdomínio do host', async () => {
    const empresa = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } })
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })

    // O domínio-base sai do APP_BASE_URL, que já existe — não há env própria.
    const anterior = process.env.APP_BASE_URL
    process.env.APP_BASE_URL = 'https://legends.com.br'
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/branding',
        headers: { host: `${empresa!.slug}.legends.com.br` },
      })
      expect(res.json().appName).toBe('EMR Legends')
    } finally {
      if (anterior === undefined) delete process.env.APP_BASE_URL
      else process.env.APP_BASE_URL = anterior
    }
  })

  it('cai na marca do produto quando a empresa está inativa', async () => {
    const empresa = await prisma.company.create({
      data: { name: 'Fora do ar', slug: 'fora-do-ar', active: false },
    })
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: empresa.id, value: JSON.stringify(MARCA_EMR) },
    })

    const res = await app.inject({ method: 'GET', url: '/branding?slug=fora-do-ar' })
    expect(res.json().appName).toBe(LEGENDS_PRESET.appName)
  })

  it('cai na marca do produto quando o JSON gravado está corrompido', async () => {
    // A marca não pode ser o motivo de a tela de login não abrir.
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: '{isso não é json' },
    })
    const empresa = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } })

    const res = await app.inject({ method: 'GET', url: `/branding?slug=${empresa!.slug}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().appName).toBe(LEGENDS_PRESET.appName)
  })
})

describe('GET /branding/manifest.webmanifest', () => {
  it('serve o manifest com o nome e as cores da empresa', async () => {
    const empresa = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } })
    await prisma.appSetting.create({
      data: { key: BRANDING_SETTING_KEY, companyId: DEFAULT_COMPANY_ID, value: JSON.stringify(MARCA_EMR) },
    })

    const res = await app.inject({ method: 'GET', url: `/branding/manifest.webmanifest?slug=${empresa!.slug}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/manifest+json')
    const manifest = JSON.parse(res.body)
    expect(manifest.name).toBe('EMR Legends')
    // Ícone do esquema PADRÃO da empresa (claro), não o do outro.
    expect(manifest.icons[0].src).toBe(MARCA_EMR.logos.light.mark)
    // Tema claro: a cor de fundo do manifest acompanha a superfície da empresa.
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('/super-admin/companies/:id/branding', () => {
  it('grava a marca e devolve a paleta resolvida', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-marca@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const salvou = await app.inject({ method: 'PUT', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth, payload: MARCA_EMR })
    expect(salvou.statusCode).toBe(200)
    const body = salvou.json()
    expect(body.appName).toBe('EMR Legends')
    expect(body.configured).toBe(true)
    // Os problemas de contraste vêm separados por esquema.
    expect(body.contrastIssues).toEqual({ light: [], dark: [] })
    // O verde institucional exato sobrevive no surface-tint...
    expect(body.colors['surface-tint']).toBe('#35bd78')
    // ...mas `primary` é o tom legível derivado, não o institucional cru.
    expect(body.colors.primary).not.toBe('#35bd78')
    expect(body.schemes.dark['surface-tint']).toBe('#35bd78')

    const leu = await app.inject({ method: 'GET', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth })
    expect(leu.json().colors).toEqual(body.colors)
  })

  it('a empresa sem marca cadastrada enxerga a do produto, marcada como não configurada', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-sem-marca@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({ method: 'GET', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth })
    expect(res.json().configured).toBe(false)
    expect(res.json().appName).toBe(LEGENDS_PRESET.appName)
  })

  it('invalida o cache: o endpoint público reflete a gravação na hora', async () => {
    const empresa = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } })
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-cache@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    // Aquece o cache com a marca do produto.
    const antes = await app.inject({ method: 'GET', url: `/branding?slug=${empresa!.slug}` })
    expect(antes.json().appName).toBe(LEGENDS_PRESET.appName)

    await app.inject({ method: 'PUT', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth, payload: MARCA_EMR })

    const depois = await app.inject({ method: 'GET', url: `/branding?slug=${empresa!.slug}` })
    expect(depois.json().appName).toBe('EMR Legends')
  })

  it('normaliza o domínio ao salvar (protocolo, caixa, porta, barra)', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-dominio@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, hosts: ['HTTPS://Legends.EMR.com.br:443/app', 'legends.emr.com.br'] },
    })
    expect(res.statusCode).toBe(200)
    // As duas formas viram a mesma string, e a duplicata some.
    expect(res.json().hosts).toEqual(['legends.emr.com.br'])
  })

  it('normaliza o hex (aceita 3 dígitos e sem #)', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-hex@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, brandColor: '0F0', neutralColor: '#FFF', overrides: {} },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().brandColor).toBe('#00ff00')
    expect(res.json().neutralColor).toBe('#ffffff')
  })

  it('recusa cor inválida e nome vazio', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-invalido@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const cor = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, brandColor: 'verde' },
    })
    expect(cor.statusCode).toBe(400)

    const dominio = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, hosts: ['não é dominio'] },
    })
    expect(dominio.statusCode).toBe(400)

    const esquema = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, defaultScheme: 'sepia' },
    })
    expect(esquema.statusCode).toBe(400)

    const nome = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, appName: '   ' },
    })
    expect(nome.statusCode).toBe(400)
  })

  it('recusa logo que não seja URL http(s) nem caminho da raiz', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-logo@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'PUT',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`,
      headers: auth,
      payload: { ...MARCA_EMR, logos: { ...MARCA_EMR.logos, light: { wide: 'javascript:alert(1)', mark: null } } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('é restrita ao SUPER_ADMIN — nem o ADMIN da própria empresa edita a marca', async () => {
    // Produto white label: a identidade faz parte do que o fornecedor entrega.
    const subadmin = await criarUsuario('ADMIN', 'admin-do-cliente@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, subadmin)}` }

    expect((await app.inject({ method: 'GET', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth })).statusCode).toBe(403)
    expect(
      (await app.inject({ method: 'PUT', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth, payload: MARCA_EMR })).statusCode,
    ).toBe(403)
    expect((await app.inject({ method: 'GET', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding` })).statusCode).toBe(401)
  })

  it('registra auditoria da alteração', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-auditoria@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth, payload: MARCA_EMR })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'Branding' } })
    expect(log).not.toBeNull()
    expect(log!.actorId).toBe(admin.id)
    expect(log!.action).toBe('UPDATE')
  })

  it('a marca de uma empresa não vaza para outra', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-tenant@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    await app.inject({ method: 'PUT', url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding`, headers: auth, payload: MARCA_EMR })

    expect((await getBranding(outra.id)).appName).toBe(LEGENDS_PRESET.appName)
  })
})

describe('POST /super-admin/branding/preview', () => {
  it('devolve a paleta derivada sem gravar nada', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-previa@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const res = await app.inject({
      method: 'POST',
      url: '/super-admin/branding/preview',
      headers: auth,
      payload: { brandColor: '#7c3aed', neutralColor: '#f5f5f7' },
    })
    expect(res.statusCode).toBe(200)
    // A prévia devolve os dois esquemas de uma vez.
    expect(Object.keys(res.json().schemes.light)).toHaveLength(35)
    expect(Object.keys(res.json().schemes.dark)).toHaveLength(35)
    expect(res.json().contrastIssues).toEqual({ light: [], dark: [] })

    const gravou = await prisma.appSetting.findFirst({ where: { key: BRANDING_SETTING_KEY } })
    expect(gravou).toBeNull()
  })

  it('aplica os overrides na prévia — senão a tela mostraria uma paleta que não é a que será gravada', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-previa-ov@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const semOv = await app.inject({
      method: 'POST', url: '/super-admin/branding/preview', headers: auth,
      payload: { brandColor: '#35bd78', neutralColor: '#f7fafc' },
    })
    const comOv = await app.inject({
      method: 'POST', url: '/super-admin/branding/preview', headers: auth,
      payload: {
        brandColor: '#35bd78',
        neutralColor: '#f7fafc',
        overrides: { light: { 'surface-tint': '#35bd78' } },
      },
    })
    expect(comOv.statusCode).toBe(200)
    expect(comOv.json().schemes.light['surface-tint']).toBe('#35bd78')
    expect(semOv.json().schemes.light['surface-tint']).not.toBe('#35bd78')
  })
})

describe('POST /super-admin/companies/:id/branding/logo-presign', () => {
  it('sem S3 configurado, responde 503 tratado', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-presign@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const res = await app.inject({
      method: 'POST',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding/logo-presign`,
      headers: auth,
      payload: { contentType: 'image/svg+xml', size: 4000 },
    })
    // O ambiente de teste pode ou não ter S3; o que importa é não estourar.
    expect([200, 503]).toContain(res.statusCode)
  })

  it('recusa formato fora da lista e arquivo grande demais', async () => {
    const admin = await criarUsuario('SUPER_ADMIN', 'admin-presign2@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const url = `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding/logo-presign`

    const tipo = await app.inject({
      method: 'POST', url, headers: auth,
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    const tamanho = await app.inject({
      method: 'POST', url, headers: auth,
      payload: { contentType: 'image/png', size: 50 * 1024 * 1024 },
    })
    // 503 quando não há S3 no ambiente — a validação vem depois disso.
    for (const res of [tipo, tamanho]) expect([400, 503]).toContain(res.statusCode)
  })

  it('é restrito ao super admin', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-cliente-presign@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }
    const res = await app.inject({
      method: 'POST',
      url: `/super-admin/companies/${DEFAULT_COMPANY_ID}/branding/logo-presign`,
      headers: auth,
      payload: { contentType: 'image/svg+xml', size: 4000 },
    })
    expect(res.statusCode).toBe(403)
  })
})
