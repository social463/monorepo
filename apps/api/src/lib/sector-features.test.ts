import { describe, it, expect } from 'vitest'
import { prisma } from './prisma'
import { sectorFeaturesFor, sectorNamesFor } from './sector-features'

describe('sectorFeaturesFor', () => {
  it('retorna as features habilitadas do setor', async () => {
    const features = await sectorFeaturesFor('sector-dev-produto')
    expect(features).toContain('votar')
    expect(features).toContain('resenha')
  })

  it('retorna [] para setor inexistente', async () => {
    const features = await sectorFeaturesFor('setor-que-nao-existe')
    expect(features).toEqual([])
  })
})

describe('sectorNamesFor', () => {
  it('resolve o nome de vários setores em uma query', async () => {
    const names = await sectorNamesFor(['sector-dev-produto'])
    expect(names.get('sector-dev-produto')).toBe('Desenvolvimento de Produto')
  })

  it('retorna Map vazio pra lista vazia, sem consultar o banco', async () => {
    const names = await sectorNamesFor([])
    expect(names.size).toBe(0)
  })

  it('ignora setor inexistente (não entra no Map)', async () => {
    const names = await sectorNamesFor(['sector-dev-produto', 'setor-que-nao-existe'])
    expect(names.has('sector-dev-produto')).toBe(true)
    expect(names.has('setor-que-nao-existe')).toBe(false)
  })
})
