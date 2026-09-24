import { describe, expect, it } from 'vitest'
import {
  ARENA_FLAG_REACH,
  flagCarrier,
  flagInteraction,
  initialFlags,
  rivalTeam,
  type ArenaFlags,
  type FlagActor,
} from './index'

const bases = { oeste: { x: 100, y: 500 }, leste: { x: 900, y: 500 } }

const ator = (over: Partial<FlagActor> = {}): FlagActor => ({
  userId: 'ana',
  team: 'oeste',
  x: 100,
  y: 500,
  downed: false,
  ...over,
})

const inter = (flags: ArenaFlags, actor: FlagActor) => flagInteraction({ flags, actor, bases })

describe('rivalTeam', () => {
  it('devolve o outro time, dos dois lados', () => {
    expect(rivalTeam('oeste')).toBe('leste')
    expect(rivalTeam('leste')).toBe('oeste')
  })
})

describe('pegar', () => {
  it('encostando na bandeira adversária na base dela', () => {
    expect(inter(initialFlags(), ator({ x: 900, y: 500 }))).toEqual({
      kind: 'pegou',
      team: 'leste',
      userId: 'ana',
    })
  })

  it('longe da base, nada acontece', () => {
    expect(inter(initialFlags(), ator({ x: 900 - ARENA_FLAG_REACH - 5, y: 500 }))).toBeNull()
  })

  it('a própria bandeira em casa não se pega', () => {
    expect(inter(initialFlags(), ator({ x: 100, y: 500 }))).toBeNull()
  })

  it('bandeira adversária caída no campo também se pega', () => {
    const flags: ArenaFlags = { oeste: { at: 'base' }, leste: { at: 'caida', x: 400, y: 400, returnsInMs: 5_000 } }
    expect(inter(flags, ator({ x: 400, y: 400 }))).toMatchObject({ kind: 'pegou', team: 'leste' })
  })

  it('abatido não interage com bandeira nenhuma', () => {
    expect(inter(initialFlags(), ator({ x: 900, y: 500, downed: true }))).toBeNull()
  })
})

describe('devolver', () => {
  it('encostar na própria bandeira caída a manda para casa', () => {
    const flags: ArenaFlags = { oeste: { at: 'caida', x: 300, y: 300, returnsInMs: 9_000 }, leste: { at: 'base' } }
    expect(inter(flags, ator({ x: 300, y: 300 }))).toEqual({
      kind: 'devolveu',
      team: 'oeste',
      userId: 'ana',
    })
  })

  it('o adversário encostando na mesma bandeira caída PEGA, não devolve', () => {
    const flags: ArenaFlags = { oeste: { at: 'caida', x: 300, y: 300, returnsInMs: 9_000 }, leste: { at: 'base' } }
    expect(inter(flags, ator({ userId: 'bruno', team: 'leste', x: 300, y: 300 }))).toMatchObject({
      kind: 'pegou',
      team: 'oeste',
    })
  })
})

describe('capturar', () => {
  const carregando: ArenaFlags = { oeste: { at: 'base' }, leste: { at: 'carregada', byUserId: 'ana' } }

  it('chegando na própria base com a bandeira dele: ponto', () => {
    expect(inter(carregando, ator({ x: 100, y: 500 }))).toEqual({
      kind: 'capturou',
      team: 'oeste',
      userId: 'ana',
    })
  })

  it('no meio do caminho não pontua', () => {
    expect(inter(carregando, ator({ x: 500, y: 500 }))).toBeNull()
  })

  /**
   * Regra clássica, e é ela que faz a defesa existir: sem isso o jogo vira
   * corrida de ida e volta e ninguém tem motivo para ficar atrás. O retorno
   * automático da bandeira caída impede que isso trave a partida.
   */
  it('com a própria bandeira fora de casa, não pontua', () => {
    const ambas: ArenaFlags = {
      oeste: { at: 'carregada', byUserId: 'bruno' },
      leste: { at: 'carregada', byUserId: 'ana' },
    }
    expect(inter(ambas, ator({ x: 100, y: 500 }))).toBeNull()
  })

  it('quem não carrega nada não captura', () => {
    expect(inter(carregando, ator({ userId: 'carla', x: 100, y: 500 }))).toBeNull()
  })

  // Encadear esconderia estado do cliente: o placar mudaria sem que ninguém
  // visse a bandeira sair do lugar.
  it('devolve no máximo um evento por chamada', () => {
    const evento = inter(carregando, ator({ x: 100, y: 500 }))
    expect(evento).not.toBeNull()
    expect(Array.isArray(evento)).toBe(false)
  })
})

describe('flagCarrier', () => {
  it('diz quem carrega, ou ninguém', () => {
    expect(flagCarrier({ oeste: { at: 'base' }, leste: { at: 'carregada', byUserId: 'ana' } }, 'leste')).toBe('ana')
    expect(flagCarrier(initialFlags(), 'leste')).toBeNull()
  })
})
