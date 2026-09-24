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
  'metas',
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

  // A calculadora saiu do menu: o acesso mora no card do manual vinculado, em
  // Cultura › Manuais. Item de menu junto seria um segundo caminho para a mesma
  // tela, e o grupo Cultura já tem sete linhas.
  it('a calculadora do Todos Pelos 9 não fica no menu — entra-se por Manuais', () => {
    for (const groups of [collaborator({ sectorFeatures: [] }), collaborator({ isAdmin: true, role: 'ADMIN' })]) {
      const cultura = groups.find((group) => group.label === 'Cultura')!
      expect(cultura.items.map((item) => item.to)).not.toContain('/cultura/calculadora-todos-pelos-9')
    }
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
  it('aparece para o SUBADMIN com o bloco de Gente e Gestão e para o ADMIN pleno', () => {
    expect(
      leadershipIn(
        collaborator({ isAdmin: true, role: 'SUBADMIN', sectorFeatures: [...ALL_FEATURES, 'gente-gestao' as FeatureKey] }),
      ),
    ).toBe(true)
    expect(leadershipIn(collaborator({ isAdmin: true, role: 'ADMIN' }))).toBe(true)
  })

  // O bloco de G&G é feature do SETOR: todo mundo lotado lá a recebe no JWT. Quem
  // não administra — um Jovem Aprendiz de G&G, por exemplo — não lidera por isso,
  // e a API dos painéis também não o deixa entrar.
  it('some para colaborador lotado num setor com Gente e Gestão', () => {
    expect(
      leadershipIn(
        collaborator({
          positionCategory: 'Jovem Aprendiz',
          sectorFeatures: [...ALL_FEATURES, 'gente-gestao' as FeatureKey],
        }),
      ),
    ).toBe(false)
  })

  it('some para SUBADMIN de outro setor', () => {
    expect(leadershipIn(collaborator({ isAdmin: true, role: 'SUBADMIN' }))).toBe(false)
  })

  // Acesso administrativo delegado é poder de ADMIN pleno: vale aqui como vale
  // em `LeadershipOnly`, sem depender de papel nem de ter liderados.
  it('aparece para o acesso administrativo delegado', () => {
    expect(leadershipIn(collaborator({ adminAccess: true }))).toBe(true)
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

  // O delegado tem poder de ADMIN pleno, então facilita o Eu Aprendiz — a rota
  // (`ApprenticeOnly`) já o deixava entrar; faltava o menu oferecer.
  it('fica ao lado da Liderança e do Eu Aprendiz, no mesmo grupo solto', () => {
    const grupo = collaborator({ adminAccess: true, role: 'LEAD' }).at(-1)!
    expect(grupo.label).toBeUndefined()
    expect(grupo.items.map((item) => item.to)).toEqual(['/admin', '/lideranca', '/eu-aprendiz'])
  })

  // Poder de ADMIN pleno abre a Liderança mesmo sem liderado: `LeadershipOnly`
  // já deixava entrar pela URL, e a API devolve o time vazio em vez de recusar.
  it('mantém a Liderança para quem não lidera ninguém', () => {
    const grupo = collaborator({ adminAccess: true }).at(-1)!
    expect(grupo.items.map((item) => item.to)).toEqual(['/admin', '/lideranca', '/eu-aprendiz'])
  })

  it('vem destacado, como a Liderança', () => {
    const item = itemsOf(collaborator({ adminAccess: true })).find((entry) => entry.to === '/admin')
    expect(item?.accent).toBe(true)
  })
})

describe('Metas', () => {
  const metasIn = (groups: ReturnType<typeof buildNavGroups>) =>
    groups.flatMap((group) => group.items).some((item) => item.to === '/metas')

  it('aparece para quem tem a feature `metas` e para admin', () => {
    expect(metasIn(collaborator())).toBe(true)
    expect(metasIn(collaborator({ isAdmin: true, role: 'ADMIN' }))).toBe(true)
  })

  it('some quando a feature `metas` está desligada no setor', () => {
    expect(metasIn(collaborator({ sectorFeatures: ALL_FEATURES.filter((feature) => feature !== 'metas') }))).toBe(false)
  })

  it('some para terceirizado — a API também recusa', () => {
    expect(metasIn(collaborator({ role: 'THIRD_PARTY' }))).toBe(false)
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

// Configurada por empresa — a comunidade é de um cliente, e o produto é white
// label: sem URL cadastrada, o item não existe para ninguém.
//
// Documento 4, seção 8: deixou de ser link externo dentro de Desenvolvimento e
// virou grupo próprio, apontando para a página que apresenta a comunidade.
describe('Comunidade INOVA', () => {
  it('só entra quando a empresa ativou o módulo', () => {
    const desativado = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: ALL_FEATURES })
    expect(desativado.some((item) => item.label === 'Comunidade INOVA')).toBe(false)

    const ativado = buildNavItems({
      isAdmin: false,
      role: 'LEGEND',
      sectorFeatures: ALL_FEATURES,
      inovaModuleEnabled: true,
    })
    const item = ativado.find((entry) => entry.label === 'Comunidade INOVA')
    // Interno: o link de fora virou o botão "Começar agora" da página.
    expect(item?.to).toBe('/comunidade-inova')
    expect(item?.external).toBeUndefined()
  })

  it('é grupo próprio, logo depois de Desenvolvimento, para colaborador e para admin', () => {
    const posicoes = (args: Parameters<typeof buildNavGroups>[0]) => {
      const groups = buildNavGroups(args)
      return {
        desenvolvimento: groups.findIndex((group) => group.label === 'Desenvolvimento'),
        inova: groups.findIndex((group) =>
          group.items.some((item) => item.label === 'Comunidade INOVA'),
        ),
        label: groups.find((group) =>
          group.items.some((item) => item.label === 'Comunidade INOVA'),
        )?.label,
      }
    }

    for (const args of [
      { isAdmin: false, role: 'LEGEND' as const, sectorFeatures: ALL_FEATURES, inovaModuleEnabled: true },
      { isAdmin: true, inovaModuleEnabled: true },
    ]) {
      const { desenvolvimento, inova, label } = posicoes(args)
      expect(inova).toBe(desenvolvimento + 1)
      // Grupo sem cabeçalho: um item só, como Liderança.
      expect(label).toBeUndefined()
    }
  })

  it('não depende de feature de setor — é a comunidade da empresa toda', () => {
    const items = buildNavItems({ isAdmin: false, role: 'LEGEND', sectorFeatures: [], inovaModuleEnabled: true })
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

describe('Eu Aprendiz no menu', () => {
  const tos = (args: Parameters<typeof buildNavItems>[0]) =>
    buildNavItems(args).map((item) => item.to)

  it('o cargo de Jovem Aprendiz abre o item, e outro cargo não', () => {
    expect(
      tos({ isAdmin: false, role: 'LEGEND', positionCategory: 'Jovem Aprendiz' }),
    ).toContain('/eu-aprendiz')
    expect(tos({ isAdmin: false, role: 'LEGEND', positionCategory: 'Analista' })).not.toContain(
      '/eu-aprendiz',
    )
    expect(tos({ isAdmin: false, role: 'LEGEND' })).not.toContain('/eu-aprendiz')
  })

  // O AppLayout passa `isAdmin` verdadeiro para todo SUBADMIN — é por isso que
  // os casos abaixo usam `isAdmin: true`: é o que chega de verdade.
  it('quem facilita também vê: ADMIN, acesso delegado e o bloco de Gente e Gestão', () => {
    expect(tos({ isAdmin: true, role: 'ADMIN' })).toContain('/eu-aprendiz')
    expect(tos({ isAdmin: false, role: 'LEAD', adminAccess: true })).toContain('/eu-aprendiz')
    expect(
      tos({ isAdmin: true, role: 'SUBADMIN', sectorFeatures: ['gente-gestao'] }),
    ).toContain('/eu-aprendiz')
  })

  it('não oferece o item a quem a rota mandaria de volta', () => {
    // SUBADMIN de outro setor: via o item e caía em /admin ao clicar.
    expect(
      tos({ isAdmin: true, role: 'SUBADMIN', sectorFeatures: ['desenvolvimento-produto'] }),
    ).not.toContain('/eu-aprendiz')
    expect(tos({ isAdmin: true, role: 'SUBADMIN' })).not.toContain('/eu-aprendiz')
    // O bloco de G&G é de administração: colaborador do setor não facilita.
    expect(
      tos({ isAdmin: false, role: 'LEGEND', sectorFeatures: ['gente-gestao'] }),
    ).not.toContain('/eu-aprendiz')
  })
})
