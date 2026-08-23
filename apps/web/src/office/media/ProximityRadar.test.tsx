import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { ProximityRadar } from './ProximityRadar'

function occupant(userId: string, x: number, y: number, name = userId): OfficeOccupant {
  return { userId, name, x, y, dir: 'down', avatarSeed: null, avatarOptions: null } as OfficeOccupant
}

describe('ProximityRadar', () => {
  it('sem `you`, não renderiza nada', () => {
    const { container } = render(<ProximityRadar you={null} occupants={[]} micEnabled={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra uma bolinha contrastante, sem letra, pra quem está dentro do raio no modo normal', () => {
    const you = occupant('you', 10, 10)
    const ana = occupant('ana', 11, 10, 'Ana Silva') // 1 tile de distância — dentro do raio (3)
    const { getByTestId, queryByTestId } = render(
      <ProximityRadar you={you} occupants={[you, ana]} micEnabled={false} />,
    )
    const dot = getByTestId('radar-dot-ana')
    expect(dot).toBeTruthy()
    // Par invertido, e não branco cravado: o painel do radar segue a superfície
    // da empresa, então num tenant claro a bolinha branca sumia dentro dele.
    expect(dot.className).toContain('bg-on-surface')
    expect(dot.textContent).toBe('')
    expect(queryByTestId('radar-dot-you')).toBeNull() // você não aparece como "outro"
  })

  it('não mostra quem está fora do raio de proximidade', () => {
    const you = occupant('you', 10, 10)
    const longe = occupant('longe', 20, 20) // bem fora do raio (3)
    const { queryByTestId } = render(
      <ProximityRadar you={you} occupants={[you, longe]} micEnabled={false} />,
    )
    expect(queryByTestId('radar-dot-longe')).toBeNull()
  })

  it('ponto central nunca mostra letra e fica neutro com o mic mudo, verde vibrante (contraste) com o mic aberto', () => {
    const you = occupant('you', 10, 10, 'Tiago')
    const { getByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you]} micEnabled={false} />,
    )
    const dot = getByTestId('radar-you')
    expect(dot.textContent).toBe('')
    expect(dot.className).toContain('bg-on-surface-variant')

    rerender(<ProximityRadar you={you} occupants={[you]} micEnabled={true} />)
    const dotOn = getByTestId('radar-you')
    expect(dotOn.className).toContain('bg-emerald-400')
    expect(dotOn.textContent).toBe('')
  })

  it('círculo ganha fundo verde com contraste quando o mic está ativo', () => {
    const you = occupant('you', 10, 10)
    const { getByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you]} micEnabled={false} />,
    )
    expect(getByTestId('radar-circle').className).not.toContain('bg-green-500/30')

    rerender(<ProximityRadar you={you} occupants={[you]} micEnabled={true} />)
    expect(getByTestId('radar-circle').className).toContain('bg-green-500/30')
  })

  it('tem tooltip explicando o radar', () => {
    const you = occupant('you', 10, 10)
    const { getByRole } = render(<ProximityRadar you={you} occupants={[you]} micEnabled={false} />)
    expect(getByRole('tooltip')).toHaveTextContent('Pessoas ao alcance da voz')
  })

  it('clicar expande o painel inteiro e revela a inicial só nos pontos dos outros — o seu nunca mostra letra', () => {
    const you = occupant('you', 10, 10, 'Tiago')
    const ana = occupant('ana', 11, 10, 'Ana Silva')
    const { getByRole, getByTestId } = render(
      <ProximityRadar you={you} occupants={[you, ana]} micEnabled={false} />,
    )
    const button = getByRole('button', { name: 'Radar de proximidade — pessoas por perto' })
    const circle = getByTestId('radar-circle')
    expect(circle.style.width).toBe('96px')
    expect(getByTestId('radar-dot-ana').textContent).toBe('')

    fireEvent.click(button)
    expect(circle.style.width).toBe('160px')
    expect(getByTestId('radar-dot-ana').textContent).toBe('A')
    expect(getByTestId('radar-you').textContent).toBe('') // centro nunca mostra letra
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(circle.style.width).toBe('96px')
    expect(getByTestId('radar-dot-ana').textContent).toBe('')
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })
})
