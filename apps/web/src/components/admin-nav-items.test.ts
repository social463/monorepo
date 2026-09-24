import { describe, expect, it } from 'vitest'
import type { FeatureKey, UserRole } from '@legends/shared'
import { buildAdminNavGroups, type BuildAdminNavArgs } from './admin-nav-items'

/**
 * Regras de visibilidade do console de administração. Vieram do teste da antiga
 * `AdminSidebar` — a navegação virou dropdown na topbar, mas o que cada papel
 * enxerga é a mesma coisa e continua travado aqui.
 */

function admin(overrides: Partial<BuildAdminNavArgs> = {}) {
  return buildAdminNavGroups({ role: 'ADMIN' as UserRole, sectorFeatures: [], ...overrides })
}

function subadmin(sectorFeatures: FeatureKey[] = []) {
  return buildAdminNavGroups({ role: 'SUBADMIN' as UserRole, sectorFeatures })
}

const destinations = (groups: ReturnType<typeof buildAdminNavGroups>) =>
  groups.flatMap((group) => group.items).map((item) => item.to)

const labels = (groups: ReturnType<typeof buildAdminNavGroups>) =>
  groups.flatMap((group) => group.items).map((item) => item.label)

describe('Engajamento (leitura da economia de XP)', () => {
  it('NÃO tem item próprio — virou a aba Engajamento de People Analytics', () => {
    // Documento 3, seção 4.7. As REGRAS continuam com item próprio; o que saiu
    // do menu é a leitura do que elas produziram.
    expect(destinations(admin())).not.toContain('/admin/engajamento')
    const reconhecimento = admin().find((group) => group.label === 'Feedback e recompensas')!
    expect(reconhecimento.items.map((item) => item.to)).toContain('/admin/xp')
  })
})

describe('buildAdminNavGroups', () => {
  it('agrupa por categoria, na ordem do console', () => {
    expect(admin().map((group) => group.label)).toEqual([
      'Visão geral',
      'Organização',
      'Feedback e recompensas',
      'Comunidade',
      'Cultura',
      'Escritório',
      'Sistema',
    ])
  })

  // A barra reaproveita o `NavLeafLink` do produto, que sempre renderiza um
  // ícone: item sem `icon` sairia com um buraco no lugar.
  it('todo item tem ícone e destino', () => {
    // Áreas que se administram de dentro delas mesmas, fora de /admin.
    const saidasDoConsole = ['/eu-aprendiz/painel']
    for (const item of admin().flatMap((group) => group.items)) {
      expect(item.icon, item.label).toBeTruthy()
      if (!saidasDoConsole.includes(item.to)) expect(item.to, item.label).toMatch(/^\/admin/)
    }
  })

  it('o ADMIN vê o console inteiro', () => {
    const tos = destinations(admin())
    for (const to of ['/admin', '/admin/setores', '/admin/auditoria', '/admin/coins', '/admin/pessoas']) {
      expect(tos, to).toContain(to)
    }
  })

  it('o ADMIN global vê as áreas de G&G sem depender de feature de setor', () => {
    const found = labels(admin({ sectorFeatures: [] }))
    expect(found).toContain('People Analytics')
    expect(found).toContain('Benchmarking')
    // O termômetro NÃO tem item próprio: ele é a aba Clima de People Analytics.
    expect(found).not.toContain('Termômetro de humor')
  })
})

describe('recorte do SUBADMIN', () => {
  it('esconde os itens exclusivos do ADMIN', () => {
    const tos = destinations(subadmin())
    for (const to of ['/admin/setores', '/admin/auditoria', '/admin/escritorio', '/admin/mapas', '/admin/administradores']) {
      expect(tos, to).not.toContain(to)
    }
    // Regra de coins é da empresa toda, não do setor.
    expect(tos).not.toContain('/admin/coins')
    expect(tos).toContain('/admin')
    expect(tos).toContain('/admin/lendas')
  })

  it('mostra as áreas de G&G ao SUBADMIN do setor com a feature', () => {
    const found = labels(subadmin(['gente-gestao' as FeatureKey]))
    for (const label of ['People Analytics', 'Painéis de RH', 'Cursos', 'Manuais', 'Benchmarking']) {
      expect(found, label).toContain(label)
    }
    // …ao contrário de Setores, que é exclusivo do ADMIN global.
    expect(found).not.toContain('Setores')
  })

  it('esconde as áreas de G&G do SUBADMIN de outro setor', () => {
    const found = labels(subadmin(['cultura', 'aprendizado', 'resenha'] as FeatureKey[]))
    for (const label of ['People Analytics', 'Painéis de RH', 'Cursos', 'Manuais', 'Benchmarking']) {
      expect(found, label).not.toContain(label)
    }
    // Ter `cultura`/`aprendizado` não basta: são features do colaborador, não da
    // administração de G&G. Mas o que não é de G&G segue visível.
    expect(found).toContain('Resenha')
    expect(found).toContain('Moderação')
  })

  it('mostra Quinta de Dev e Retrospectivas ao SUBADMIN de Desenvolvimento de Produto', () => {
    const found = labels(subadmin(['desenvolvimento-produto' as FeatureKey]))
    expect(found).toContain('Quinta de Dev')
    expect(found).toContain('Retrospectivas')
    expect(found).not.toContain('Resenha')
    expect(found).not.toContain('People Analytics')
    // Moderação não depende de feature — sempre visível pro Subadmin.
    expect(found).toContain('Moderação')
  })

  it('só mostra Desafios se o setor tiver a feature habilitada', () => {
    expect(labels(subadmin())).not.toContain('Desafios')
    expect(labels(subadmin(['desafios' as FeatureKey]))).toContain('Desafios')
  })

  it('participar da dinâmica não dá direito de administrá-la', () => {
    // `quinta-desenvolvimento` e `retrospectivas` dizem quem PARTICIPA; a
    // administração é do bloco `desenvolvimento-produto`.
    const found = labels(subadmin(['quinta-desenvolvimento', 'retrospectivas'] as FeatureKey[]))
    expect(found).not.toContain('Quinta de Dev')
    expect(found).not.toContain('Retrospectivas')
  })

  it('Manifesto e Benefícios são geridos pelo SUBADMIN de G&G', () => {
    const tos = destinations(subadmin(['gente-gestao' as FeatureKey]))
    expect(tos).toContain('/admin/cultura/manifesto')
    expect(tos).toContain('/admin/cultura/beneficios')
  })

  // Modelos e fila viraram abas de uma página só (Documento 4, seção 9.8): o
  // menu tem UMA entrada, e ela não é `adminOnly` — quem é adminOnly agora é a
  // aba de modelos, dentro da página.
  //
  // Certificado é parte de Cursos, que mora no bloco de G&G — daí `gente-gestao`,
  // e não `aprendizado`, que é a feature de consumo do colaborador.
  it('só mostra Certificados com o bloco de Gente e Gestão, e o subadmin entra', () => {
    expect(labels(subadmin())).not.toContain('Certificados')
    expect(labels(subadmin(['aprendizado' as FeatureKey]))).not.toContain('Certificados')
    expect(labels(subadmin(['gente-gestao' as FeatureKey]))).toContain('Certificados')
    expect(destinations(subadmin(['gente-gestao' as FeatureKey]))).toContain('/admin/certificados')
  })

  it('não sobrou entrada separada de modelos nem de fila', () => {
    const tos = destinations(admin())
    expect(tos).not.toContain('/admin/certificados/modelos')
    expect(tos).not.toContain('/admin/certificados/fila')
  })

  it('grupo que ficou vazio não vira cabeçalho solto', () => {
    // Escritório só tem itens `adminOnly`: para o SUBADMIN o grupo inteiro some.
    expect(subadmin().map((group) => group.label)).not.toContain('Escritório')
    expect(subadmin().every((group) => group.items.length > 0)).toBe(true)
  })
})

describe('Metas e OKRs no console', () => {
  // A escrita de ciclo na API é da administração de metas: ADMIN pleno ou
  // SUBADMIN de G&G. O menu segue exatamente o mesmo recorte.
  it('aparece para o ADMIN e para o SUBADMIN de Gente e Gestão', () => {
    expect(destinations(admin())).toContain('/admin/metas')
    expect(labels(subadmin(['gente-gestao' as FeatureKey]))).toContain('Metas e OKRs')
  })

  it('some para o SUBADMIN de outro setor', () => {
    expect(destinations(subadmin())).not.toContain('/admin/metas')
    expect(destinations(subadmin(['desenvolvimento-produto' as FeatureKey]))).not.toContain('/admin/metas')
  })
})

describe('acesso administrativo delegado', () => {
  // O poder delegado é PLENO: quem o tem não sofre o recorte de setor, mesmo
  // que o papel na empresa seja de colaborador.
  it('vê o console inteiro, como o ADMIN', () => {
    const delegado = buildAdminNavGroups({ role: 'LEAD' as UserRole, sectorFeatures: [], adminAccess: true })
    expect(destinations(delegado)).toEqual(destinations(admin()))
  })

  it('sem o flag, um colaborador não é recortado como subadmin — ele nem chega aqui', () => {
    // `buildAdminNavGroups` não é o guarda de acesso (isso é `AdminOnly`, na
    // rota): só o SUBADMIN tem recorte, e LEAD sem flag não é SUBADMIN.
    const semFlag = buildAdminNavGroups({ role: 'LEAD' as UserRole, sectorFeatures: [] })
    expect(destinations(semFlag)).toEqual(destinations(admin()))
  })
})

describe('Comunidade INOVA no console', () => {
  // Sem o link aqui, quem é ADMIN puro nunca sai de /admin (a raiz redireciona
  // pra lá) e não tinha como chegar em /comunidade-inova pelo menu.
  it('sem o módulo ligado, o item não aparece', () => {
    expect(destinations(buildAdminNavGroups({ role: 'ADMIN' as UserRole, sectorFeatures: [] }))).not.toContain(
      '/comunidade-inova',
    )
  })

  it('com o módulo ligado, aparece pro ADMIN e pro SUBADMIN de qualquer setor', () => {
    expect(
      destinations(buildAdminNavGroups({ role: 'ADMIN' as UserRole, sectorFeatures: [] }, true)),
    ).toContain('/comunidade-inova')
    expect(destinations(buildAdminNavGroups({ role: 'SUBADMIN' as UserRole, sectorFeatures: [] }, true))).toContain(
      '/comunidade-inova',
    )
  })
})

describe('Jovem Aprendiz no console', () => {
  // O painel da trilha mora em /eu-aprendiz/painel. Sem o link aqui, o ADMIN puro
  // nunca saía de /admin e não tinha como chegar lá pelo menu.
  it('aparece para o ADMIN e para o acesso delegado', () => {
    expect(destinations(admin())).toContain('/eu-aprendiz/painel')
    expect(
      destinations(buildAdminNavGroups({ role: 'LEAD' as UserRole, sectorFeatures: [], adminAccess: true })),
    ).toContain('/eu-aprendiz/painel')
  })

  it('para o SUBADMIN, só com o bloco de Gente e Gestão', () => {
    expect(destinations(subadmin(['gente-gestao' as FeatureKey]))).toContain('/eu-aprendiz/painel')
    expect(destinations(subadmin())).not.toContain('/eu-aprendiz/painel')
    expect(destinations(subadmin(['desenvolvimento-produto' as FeatureKey]))).not.toContain('/eu-aprendiz/painel')
  })
})
