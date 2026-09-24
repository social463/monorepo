import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { InovaProjectDTO, PublicUser } from '@legends/shared'
import { InovaSectorOverview } from './InovaSectorOverview'

const fulano: PublicUser = {
  id: 'u1',
  name: 'Fulano',
  email: null,
  role: 'LEGEND',
  area: null,
  position: null,
  positionCategory: null,
  squad: null,
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  active: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null,
  sectorId: 's1',
  companyId: 'company-emr',
  companyName: null,
  enabledFeatures: [],
  sectorFeatures: [],
  adminAccess: false,
}

const base: InovaProjectDTO = {
  id: '1',
  title: 'Projeto A',
  category: 'Automação de processos',
  sector: 'Ensino',
  description: 'desc',
  problemDescription: null,
  results: null,
  hoursSaved: null,
  costReduction: null,
  otherMetrics: null,
  projectCosts: null,
  toolsUsed: null,
  deadline: null,
  estimatedDeadline: null,
  priority: false,
  leadershipChallenge: false,
  sectorRepresentative: null,
  responsible1: fulano,
  responsible2: null,
  phase: 'TESTING_SOLUTION',
  archived: false,
  createdById: 'u1',
  createdByName: 'Fulano',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-05T00:00:00.000Z',
}

describe('InovaSectorOverview', () => {
  it('só considera projetos em fase avançada', () => {
    render(<InovaSectorOverview projects={[{ ...base, phase: 'IDEA' }]} />)
    expect(screen.getByText(/Nenhum setor encontrado/)).toBeInTheDocument()
  })

  it('mostra o card do setor com fase avançada', () => {
    render(<InovaSectorOverview projects={[base]} />)
    expect(screen.getByText('Ensino')).toBeInTheDocument()
    expect(screen.getByText('1 projeto')).toBeInTheDocument()
  })

  it('busca filtra por nome de setor', async () => {
    render(
      <InovaSectorOverview
        projects={[base, { ...base, id: '2', sector: 'CX', phase: 'ROUTINE_USE' }]}
      />,
    )
    await userEvent.type(screen.getByPlaceholderText('Buscar setor...'), 'CX')
    expect(screen.getByText('CX')).toBeInTheDocument()
    expect(screen.queryByText('Ensino')).not.toBeInTheDocument()
  })

  it('concluído não entra: o overview é do que está em curso', () => {
    render(<InovaSectorOverview projects={[{ ...base, phase: 'COMPLETED' }]} />)
    expect(screen.getByText(/Nenhum setor encontrado/)).toBeInTheDocument()
  })

  it('usa ícone e resumo curados do setor, casando "Gente e Gestão" com "Gente & Gestão"', () => {
    render(
      <InovaSectorOverview
        projects={[
          { ...base, sector: 'Gente e Gestão' },
          { ...base, id: '2', sector: 'Jurídico' },
        ]}
      />,
    )
    expect(screen.getByText(/Desenvolvimento humano, comunicação interna/)).toBeInTheDocument()
    // Setor fora da lista curada cai no texto genérico.
    expect(screen.getByText('Iniciativas conduzidas pela área de Jurídico.')).toBeInTheDocument()
  })

  it('"Mistos" mostra só setores com dois ou mais tipos de projeto', async () => {
    render(
      <InovaSectorOverview
        projects={[
          base,
          { ...base, id: '2', category: 'Análise de dados' },
          { ...base, id: '3', sector: 'CX' },
        ]}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'Mistos')
    expect(screen.getByText('Ensino')).toBeInTheDocument()
    expect(screen.queryByText('CX')).not.toBeInTheDocument()
  })
})
