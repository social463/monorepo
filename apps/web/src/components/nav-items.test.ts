import { describe, expect, it } from 'vitest'
import type { FeatureKey } from '@legends/shared'
import { buildNavGroups, buildNavItems, isNavItemActive } from './nav-items'

const ALL_FEATURES = [
  'votar',
  'time',
  'lendas',
  'destaques',
  'selos',
  'coins',
  'desafios',
  'cultura',
  'galeria',
  'calendario',
  'resenha',
  'aprendizado',
  'pdi',
  'um-a-um',
  'quinta-desenvolvimento',
  'retrospectivas',
  'escritorio',
] as FeatureKey[]

function collaborator(overrides: Partial<Parameters<typeof buildNavGroups>[0]> = {}) {
  return buildNavGroups({
    isAdmin: false,
    role: 'LEGEND',
    sectorFeatures: ALL_FEATURES,
    ...overrides,
  })
}

describe('buildNavGroups', () => {
  it('agrupa por assunto, na ordem do portal', () => {
    const labels = collaborator()
      .map((group) => group.label)
      .filter(Boolean)
    expect(labels).toEqual(['Cultura', 'Comunicação', 'Engajamento', 'Desenvolvimento'])
  })

  it('Home e Escritório ficam soltos no topo, sem cabeçalho', () => {
    const first = collaborator()[0]!
    expect(first.label).toBeUndefined()
    expect(first.items.map((item) => item.to)).toEqual(['/', '/escritorio'])
  })

  it('feature desligada tira o item do menu', () => {
    const semDesafios = collaborator({
      sectorFeatures: ALL_FEATURES.filter((feature) => feature !== 'desafios'),
    })
    expect(buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES }).map((i) => i.to)).toContain(
      '/desafios',
    )
    expect(semDesafios.flatMap((group) => group.items).map((item) => item.to)).not.toContain('/desafios')
  })

  it('grupo que ficou vazio não vira cabeçalho solto', () => {
    const groups = collaborator({ sectorFeatures: [] })
    expect(groups.every((group) => group.items.length > 0)).toBe(true)
  })
})

describe('Ranking', () => {
  it('fica no grupo de Engajamento, ao lado do que distribui os pontos', () => {
    const engajamento = collaborator().find((group) => group.label === 'Engajamento')!
    expect(engajamento.items.map((item) => item.to)).toContain('/ranking')
  })

  it('não depende de feature nenhuma — é a leitura pública do XP, que também não depende', () => {
    const semFeatures = buildNavGroups({ isAdmin: false, role: 'LEGEND', sectorFeatures: [] })
    const destinos = semFeatures.flatMap((group) => group.items).map((item) => item.to)
    expect(destinos).toContain('/ranking')
  })

  it('também aparece para conta de administração', () => {
    const admin = buildNavGroups({ isAdmin: true, role: 'ADMIN', sectorFeatures: ALL_FEATURES })
    const destinos = admin.flatMap((group) => group.items).map((item) => item.to)
    expect(destinos).toContain('/ranking')
  })
})

describe('aba de Liderança', () => {
  const leadershipIn = (groups: ReturnType<typeof buildNavGroups>) =>
    groups.flatMap((group) => group.items).some((item) => item.to === '/lideranca')

  it('some para quem não é liderança', () => {
    expect(leadershipIn(collaborator())).toBe(false)
  })

  it('aparece para papéis de liderança', () => {
    for (const role of ['LEAD', 'MANAGER', 'HEAD'] as const) {
      expect(leadershipIn(collaborator({ role }))).toBe(true)
    }
  })

  // Gente e Gestão administra pessoas mesmo sem liderar ninguém diretamente.
  it('aparece para quem tem o bloco de Gente e Gestão', () => {
    expect(
      leadershipIn(collaborator({ sectorFeatures: [...ALL_FEATURES, 'gente-gestao' as FeatureKey] })),
    ).toBe(true)
  })

  it('vem marcada para receber cor própria', () => {
    const item = collaborator({ role: 'LEAD' })
      .flatMap((group) => group.items)
      .find((entry) => entry.to === '/lideranca')
    expect(item?.accent).toBe(true)
  })
})

describe('acesso administrativo delegado', () => {
  const itemsOf = (groups: ReturnType<typeof buildNavGroups>) => groups.flatMap((group) => group.items)
  const hasAdmin = (groups: ReturnType<typeof buildNavGroups>) =>
    itemsOf(groups).some((item) => item.to === '/admin')

  it('não aparece para colaborador comum', () => {
    expect(hasAdmin(collaborator())).toBe(false)
  })

  it('aparece para quem tem o acesso delegado', () => {
    expect(hasAdmin(collaborator({ adminAccess: true }))).toBe(true)
  })

  // O ponto do mecanismo: a pessoa continua com o produto inteiro. Trocar para a
  // árvore de admin (que não tem Home, Escritório nem Votar) apagaria isso.
  it('mantém a navegação de colaborador inteira', () => {
    const destinos = itemsOf(collaborator({ adminAccess: true })).map((item) => item.to)
    expect(destinos).toContain('/')
    expect(destinos).toContain('/escritorio')
    expect(destinos).toContain('/votar')
    const labels = collaborator({ adminAccess: true })
      .map((group) => group.label)
      .filter(Boolean)
    expect(labels).toEqual(['Cultura', 'Comunicação', 'Engajamento', 'Desenvolvimento'])
  })

  it('fica ao lado da Liderança, no mesmo grupo solto', () => {
    const grupo = collaborator({ adminAccess: true, role: 'LEAD' }).at(-1)!
    expect(grupo.label).toBeUndefined()
    expect(grupo.items.map((item) => item.to)).toEqual(['/admin', '/lideranca'])
  })

  it('aparece sozinho para quem não lidera', () => {
    const grupo = collaborator({ adminAccess: true }).at(-1)!
    expect(grupo.items.map((item) => item.to)).toEqual(['/admin'])
  })

  it('vem destacado, como a Liderança', () => {
    const item = itemsOf(collaborator({ adminAccess: true })).find((entry) => entry.to === '/admin')
    expect(item?.accent).toBe(true)
  })
})

describe('ImpulseUP', () => {
  it('só entra quando a empresa configurou a URL', () => {
    const semUrl = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES })
    expect(semUrl.some((item) => item.external)).toBe(false)

    const comUrl = buildNavItems({
      isAdmin: false,
      role: 'LEGEND',
      sectorFeatures: ALL_FEATURES,
      impulseUpUrl: 'https://exemplo.impulseup.com',
    })
    expect(comUrl.find((item) => item.external)?.to).toBe('https://exemplo.impulseup.com')
  })
})

// Link de fora, configurado por empresa — a comunidade é de um cliente, e o
// produto é white label: sem URL cadastrada, o item não existe para ninguém.
describe('Comunidade INOVA', () => {
  const url = 'https://inovacomunidadeemr.lovable.app/auth'

  it('só entra quando a empresa configurou a URL', () => {
    const semUrl = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES })
    expect(semUrl.some((item) => item.label === 'Comunidade INOVA')).toBe(false)

    const comUrl = buildNavItems({
      isAdmin: false,
      role: 'LEGEND',
      sectorFeatures: ALL_FEATURES,
      inovaCommunityUrl: url,
    })
    const item = comUrl.find((entry) => entry.label === 'Comunidade INOVA')
    expect(item?.to).toBe(url)
    expect(item?.external).toBe(true)
  })

  it('fica no grupo Desenvolvimento, para colaborador e para admin', () => {
    const groupOf = (args: Parameters<typeof buildNavGroups>[0]) =>
      buildNavGroups(args).find((group) =>
        group.items.some((item) => item.label === 'Comunidade INOVA'),
      )?.label

    expect(groupOf({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES, inovaCommunityUrl: url })).toBe(
      'Desenvolvimento',
    )
    expect(groupOf({ isAdmin: true, inovaCommunityUrl: url })).toBe('Desenvolvimento')
  })

  it('não depende de feature de setor — é link externo, não tela do produto', () => {
    const items = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: [], inovaCommunityUrl: url })
    expect(items.some((item) => item.label === 'Comunidade INOVA')).toBe(true)
  })
})

// As telas de Cultura são abas da MESMA rota: comparar só o pathname acenderia
// os quatro itens de uma vez.
describe('isNavItemActive', () => {
  const item = (to: string) => ({ to, label: 'x', icon: 'x' })

  it('casa pelo caminho quando o item não tem query', () => {
    expect(isNavItemActive(item('/ferias'), '/ferias')).toBe(true)
    expect(isNavItemActive(item('/ferias'), '/calendario')).toBe(false)
  })

  it('distingue as abas de Cultura pela query', () => {
    expect(isNavItemActive(item('/cultura?aba=manuais'), '/cultura', '?aba=manuais')).toBe(true)
    expect(isNavItemActive(item('/cultura?aba=manuais'), '/cultura', '?aba=beneficios')).toBe(false)
    expect(isNavItemActive(item('/cultura?aba=kit-visual'), '/cultura', '?aba=kit-visual')).toBe(true)
  })

  it('sem aba na URL vale Manuais, que é o que a página abre', () => {
    expect(isNavItemActive(item('/cultura?aba=manuais'), '/cultura')).toBe(true)
    expect(isNavItemActive(item('/cultura?aba=beneficios'), '/cultura')).toBe(false)
  })

  it('o Manifesto virou rota própria e não passa mais pela query', () => {
    expect(isNavItemActive(item('/manifesto'), '/manifesto')).toBe(true)
    expect(isNavItemActive(item('/manifesto'), '/cultura', '?aba=manuais')).toBe(false)
  })
})

describe('busca global', () => {
  it('todo destino leva palavras-chave ou rótulo próprio para ser encontrável', () => {
    const items = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES })
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0)
    }
    // Sinônimo que ninguém adivinharia pelo rótulo.
    const ferias = items.find((item) => item.to === '/ferias')
    expect(ferias?.keywords).toContain('descanso')
  })
})
