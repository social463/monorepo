import { describe, expect, it } from 'vitest'
import { conferImpulseUpPlan, crawlImpulseUp, planImpulseUpImport, type IuObjective } from './impulseup-okr'
import { CYCLE_ID, fixtureSnapshot } from './impulseup-okr.fixture'

describe('planImpulseUpImport', () => {
  const plan = planImpulseUpImport(fixtureSnapshot())

  it('mapeia o ciclo pela configuração', () => {
    expect(plan.cycle).toMatchObject({
      externalId: CYCLE_ID,
      status: 'OPEN',
      forceCommentOnCheckIn: true,
      updateWindowStart: '2026-09-08',
      updateWindowFinish: '2027-12-31',
      decimals: { percentage: 2, numeric: 0, currency: 2 },
    })
    expect(plan.cycle.progressRanges).toHaveLength(4)
  })

  it('mapeia objetivo, KR, direção e papéis; ignora REVIEWING/ENDORSEMENT', () => {
    const squad = plan.objectives.find((o) => o.externalId === 'obj-bugs-squad')
    expect(squad).toMatchObject({ code: 'PRD0027', name: '% de Bugs Squad', parentExternalId: 'obj-bugs-setor', aggregation: 'KR_ONLY' })
    expect(squad?.assignments.map((a) => a.role).sort()).toEqual(['ASSIGNED_TO', 'CREATOR', 'OWNER'])
    const receita = plan.keyResults.find((kr) => kr.externalId === 'kr-receita')
    expect(receita).toMatchObject({ metricType: 'CURRENCY', unit: 'R$', direction: 'HIGHER_IS_BETTER', target: 5793285.96 })
    expect(plan.keyResults.find((kr) => kr.externalId === 'kr-bugs-squad')?.direction).toBe('LOWER_IS_BETTER')
  })

  it('pai fora do snapshot vira raiz, com aviso', () => {
    expect(plan.objectives.find((o) => o.externalId === 'obj-receita')?.parentExternalId).toBeNull()
    expect(plan.warnings.some((w) => w.includes('obj-fora'))).toBe(true)
  })

  it('§7.4: um check-in por comentário; o que está a < 5 s da atualização leva o valor', () => {
    const squad = plan.checkIns.filter((c) => c.keyResultExternalId === 'kr-bugs-squad')
    expect(squad.map((c) => [c.externalId, c.value])).toEqual([
      ['c-antigo', null],
      ['c-valor', 8.3],
      // Apagado não casa, mesmo estando a 0,7 s.
      ['c-apagado', null],
    ])
    expect(squad.find((c) => c.externalId === 'c-apagado')?.deletedAt).toBe('2026-09-14T12:20:00.000000Z')
    expect(squad.find((c) => c.externalId === 'c-valor')).toMatchObject({ effectiveAt: '2026-09-14', authorEmail: 'lucca@emr.com' })
  })

  it('sem comentário casando, nasce check-in sintético; KR calculado não recebe valor', () => {
    const setor = plan.checkIns.filter((c) => c.keyResultExternalId === 'kr-bugs-setor')
    expect(setor).toEqual([
      expect.objectContaining({
        externalId: 'synthetic:kr-bugs-setor:2026-09-08T19:51:15.100000Z',
        value: 24.5,
        comment: null,
        effectiveAt: '2026-09-08',
        synthetic: true,
      }),
    ])
    const calc = plan.checkIns.filter((c) => c.keyResultExternalId === 'kr-iniciativas')
    expect(calc).toEqual([expect.objectContaining({ externalId: 'c-calc', value: null })])
  })

  it('conferência: progresso linear bate com a ImpulseUp e expõe a cor que muda com a direção', () => {
    const conference = conferImpulseUpPlan(plan, fixtureSnapshot().dashboard)
    expect(conference.keyResults).toMatchObject({ total: 3, matched: 3, mismatches: [] })
    expect(conference.calculatedSkipped).toEqual(['Iniciativas Estratégicas'])
    expect(conference.dashboard.mismatches).toEqual([])
    // Setor: 245% lá, estourou o teto aqui. Squad: 83% lá, dentro do teto aqui.
    expect(conference.divergentColors.map((d) => [d.name, d.goalMet])).toEqual([
      ['% de Bugs setor', false],
      ['% de Bugs Squad', true],
    ])
  })
})

describe('crawlImpulseUp', () => {
  function fakeApi(snapshot = fixtureSnapshot()) {
    const calls: string[] = []
    const byId = new Map(snapshot.objectives.map((o) => [o.id, o]))
    const visibleTo: Record<string, string[]> = {
      'dev@emr.com': ['obj-bugs-squad'],
      'lider@emr.com': ['obj-bugs-squad', 'obj-receita'],
      'criadora@emr.com': ['obj-iniciativas'],
    }
    const get = async (path: string) => {
      calls.push(path)
      if (path === `/okr/api/cycles/${CYCLE_ID}`) return snapshot.cycle
      const person = path.match(/individual-result\/[^/]+\/(.+)$/)
      if (person) {
        const email = decodeURIComponent(person[1])
        if (email === 'saiu@emr.com') throw new Error('404')
        return { objectives: (visibleTo[email] ?? []).map((id) => byId.get(id)) }
      }
      const detail = path.match(/\/okr\/api\/objectives\/([^/?]+)(\/no-admin)?$/)
      if (detail) {
        if (detail[1] === 'obj-outro-ciclo') return { ...byId.get('obj-bugs-setor'), id: 'obj-outro-ciclo', cycleId: 'x' }
        // Detalhe "admin" recusa; a variante no-admin responde.
        if (!detail[2]) throw new Error('403')
        const found = byId.get(detail[1])
        if (!found) throw new Error('404')
        return found
      }
      const comments = path.match(/comments\?keyResultId=(.+)$/)
      if (comments) return snapshot.comments[comments[1]] ?? []
      if (path.startsWith('/okr/api/dashboard/objectives')) return snapshot.dashboard
      throw new Error(`rota inesperada ${path}`)
    }
    return { get, calls }
  }

  it('segue os e-mails dos papéis e busca o pai que faltou', async () => {
    const { get, calls } = fakeApi()
    const snapshot = await crawlImpulseUp(get, { cycleId: CYCLE_ID, seedEmails: ['DEV@emr.com', 'saiu@emr.com'] })
    expect(snapshot.objectives.map((o) => o.id).sort()).toEqual([
      'obj-bugs-setor',
      'obj-bugs-squad',
      'obj-iniciativas',
      'obj-receita',
    ])
    expect(calls).toContain('/okr/api/objectives/obj-bugs-setor/no-admin')
    expect(snapshot.unreachable.objectives).toEqual(['obj-fora'])
    expect(snapshot.unreachable.keyResults).toEqual(['kr-inalcancavel'])
    expect(Object.keys(snapshot.comments).sort()).toEqual(['kr-bugs-setor', 'kr-bugs-squad', 'kr-iniciativas', 'kr-receita'])
  })

  it('pai de outro ciclo não prende o rastreio em laço', async () => {
    const snapshot = fixtureSnapshot()
    const orphan: IuObjective = { ...snapshot.objectives[0], id: 'obj-filho', parentId: 'obj-outro-ciclo' }
    const { get } = fakeApi({ ...snapshot, objectives: [...snapshot.objectives, orphan] })
    const wrapped = async (path: string) =>
      path.includes('individual-result') ? { objectives: [orphan] } : get(path)
    const result = await crawlImpulseUp(wrapped, { cycleId: CYCLE_ID, seedEmails: ['x@emr.com'], maxPeople: 3 })
    expect(result.unreachable.objectives).toContain('obj-outro-ciclo')
  })

  it('sessão expirada sobe, não é engolida como pessoa que falhou', async () => {
    class SessionExpired extends Error {}
    const get = async (path: string) => {
      if (path.includes('individual-result')) throw new SessionExpired('401')
      return fixtureSnapshot().cycle
    }
    await expect(crawlImpulseUp(get, { cycleId: CYCLE_ID, seedEmails: ['dev@emr.com'] })).rejects.toBeInstanceOf(SessionExpired)
  })
})
