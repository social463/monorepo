import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { ProximityRadar } from './ProximityRadar'

/** Tile do mapa nos casos comuns; um caso usa 48 de propósito. */
const TILE = 32

/**
 * Recebe TILE e converte: é assim que se pensa o cenário ("ele está a oito
 * tiles"). O occupant fala PIXEL desde o movimento livre.
 */
function occupant(
  userId: string,
  tileX: number,
  tileY: number,
  name = userId,
  tile = TILE,
): OfficeOccupant {
  const x = tileX * tile + tile / 2
  const y = tileY * tile + tile / 2
  return { userId, name, x, y, dir: 'down', avatarSeed: null, avatarOptions: null } as OfficeOccupant
}

describe('ProximityRadar', () => {
  it('sem `you`, não renderiza nada', () => {
    const { container } = render(<ProximityRadar you={null} occupants={[]} micEnabled={false} tileSize={TILE} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra uma bolinha contrastante, sem letra, pra quem está dentro do raio no modo normal', () => {
    const you = occupant('you', 10, 10)
    const ana = occupant('ana', 11, 10, 'Ana Silva') // 1 tile de distância — dentro do raio (3)
    const { getByTestId, queryByTestId } = render(
      <ProximityRadar you={you} occupants={[you, ana]} micEnabled={false} tileSize={TILE} />,
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
      <ProximityRadar you={you} occupants={[you, longe]} micEnabled={false} tileSize={TILE} />,
    )
    expect(queryByTestId('radar-dot-longe')).toBeNull()
  })

  it('ponto central nunca mostra letra e fica neutro com o mic mudo, verde vibrante (contraste) com o mic aberto', () => {
    const you = occupant('you', 10, 10, 'Tiago')
    const { getByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you]} micEnabled={false} tileSize={TILE} />,
    )
    const dot = getByTestId('radar-you')
    expect(dot.textContent).toBe('')
    expect(dot.className).toContain('bg-on-surface-variant')

    rerender(<ProximityRadar you={you} occupants={[you]} micEnabled={true} tileSize={TILE} />)
    const dotOn = getByTestId('radar-you')
    expect(dotOn.className).toContain('bg-emerald-400')
    expect(dotOn.textContent).toBe('')
  })

  it('círculo ganha fundo verde com contraste quando o mic está ativo', () => {
    const you = occupant('you', 10, 10)
    const { getByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you]} micEnabled={false} tileSize={TILE} />,
    )
    expect(getByTestId('radar-circle').className).not.toContain('bg-green-500/30')

    rerender(<ProximityRadar you={you} occupants={[you]} micEnabled={true} tileSize={TILE} />)
    expect(getByTestId('radar-circle').className).toContain('bg-green-500/30')
  })

  it('tem tooltip explicando o radar', () => {
    const you = occupant('you', 10, 10)
    const { getByRole } = render(<ProximityRadar you={you} occupants={[you]} micEnabled={false} tileSize={TILE} />)
    expect(getByRole('tooltip')).toHaveTextContent('Pessoas ao alcance da voz')
  })

  it('clicar expande o painel inteiro e revela a inicial só nos pontos dos outros — o seu nunca mostra letra', () => {
    const you = occupant('you', 10, 10, 'Tiago')
    const ana = occupant('ana', 11, 10, 'Ana Silva')
    const { getByRole, getByTestId } = render(
      <ProximityRadar you={you} occupants={[you, ana]} micEnabled={false} tileSize={TILE} />,
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

describe('ProximityRadar em mapa que não é de 32', () => {
  it('mede o raio pela régua do mapa ATIVO, não pela do mapa legado', () => {
    // Cinco tiles de 48 = 240px. Com a régua certa (48) isso é 5 tiles, fora do
    // raio de 3; com a régua velha de 32 viravam 7 — também fora, mas por
    // acidente. O caso que separa as duas é o de DENTRO: dois tiles de 48
    // (96px) são 3 tiles pela régua de 32 — na borda —, e 2 pela régua certa.
    const you = occupant('you', 10, 10, 'you', 48)
    const perto = occupant('perto', 13, 10, 'Perto', 48) // 3 tiles de 48: dentro
    const { queryByTestId, rerender } = render(
      <ProximityRadar you={you} occupants={[you, perto]} micEnabled={false} tileSize={48} />,
    )
    expect(queryByTestId('radar-dot-perto')).toBeTruthy()

    // Com a régua errada (32), os mesmos pixels dão 4 tiles e a pessoa some do
    // radar apesar de estar ao alcance da voz.
    rerender(<ProximityRadar you={you} occupants={[you, perto]} micEnabled={false} tileSize={32} />)
    expect(queryByTestId('radar-dot-perto')).toBeNull()
  })
})
