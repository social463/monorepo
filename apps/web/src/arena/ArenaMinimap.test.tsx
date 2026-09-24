import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArenaMinimap } from './ArenaMinimap'
import type { ArenaMinimapInfo } from './ArenaScene'

const base: ArenaMinimapInfo = {
  width: 4000,
  height: 2000,
  you: { x: 1000, y: 1000 },
  team: 'oeste',
  aliados: [],
  inimigos: [],
  bandeiras: [],
}

const pontos = (container: HTMLElement) => container.querySelectorAll('span[style]')

describe('ArenaMinimap', () => {
  it('desenha você mesmo', () => {
    const { container } = render(<ArenaMinimap info={base} />)
    expect(pontos(container).length).toBe(1)
  })

  // No futebol a bola é o jogo: sem ela no mapa, o minimapa não diz onde ele
  // está acontecendo.
  it('mostra a bola quando ela existe', () => {
    const semBola = render(<ArenaMinimap info={base} />)
    const antes = pontos(semBola.container).length
    semBola.unmount()

    const comBola = render(<ArenaMinimap info={{ ...base, bola: { x: 500, y: 500 } }} />)
    expect(pontos(comBola.container).length).toBe(antes + 1)
  })

  // Sem ver o próprio time, um modo por times vira jogo solo.
  it('mostra os companheiros sempre', () => {
    const { container } = render(
      <ArenaMinimap info={{ ...base, aliados: [{ x: 100, y: 100 }, { x: 200, y: 200 }] }} />,
    )
    expect(pontos(container).length).toBe(3)
  })

  /**
   * Atirar entrega a posição; ficar quieto não. É o que dá peso à decisão de
   * puxar o gatilho num mapa onde duas pessoas podem não se encontrar durante
   * a partida inteira.
   */
  it('só mostra adversário que foi revelado', () => {
    const semTiro = render(<ArenaMinimap info={base} />)
    const antes = pontos(semTiro.container).length
    semTiro.unmount()

    const comTiro = render(
      <ArenaMinimap info={{ ...base, inimigos: [{ x: 3000, y: 500, restanteMs: 4000 }] }} />,
    )
    expect(pontos(comTiro.container).length).toBe(antes + 1)
  })

  // A marca envelhecendo diz "ele estava aqui", não "está aqui agora".
  it('a marca do adversário desbota conforme a revelação expira', () => {
    const nova = render(
      <ArenaMinimap info={{ ...base, inimigos: [{ x: 3000, y: 500, restanteMs: 4000 }] }} />,
    )
    const opaca = [...pontos(nova.container)].map((n) => (n as HTMLElement).style.opacity).filter(Boolean)[0]
    nova.unmount()

    const velha = render(
      <ArenaMinimap info={{ ...base, inimigos: [{ x: 3000, y: 500, restanteMs: 400 }] }} />,
    )
    const fraca = [...pontos(velha.container)].map((n) => (n as HTMLElement).style.opacity).filter(Boolean)[0]

    expect(Number(fraca)).toBeLessThan(Number(opaca))
  })

  // Num mapa de quase 4.000px o ponto no minimapa não diz para onde correr.
  it('bandeira fora da base vira seta com direção', () => {
    render(
      <ArenaMinimap
        info={{ ...base, bandeiras: [{ team: 'leste', x: 3000, y: 1000, roubada: true }] }}
      />,
    )
    expect(screen.getByText(/bandeira leste/i)).toBeInTheDocument()
  })

  it('bandeira em casa não vira seta', () => {
    render(
      <ArenaMinimap
        info={{ ...base, bandeiras: [{ team: 'leste', x: 3900, y: 1000, roubada: false }] }}
      />,
    )
    expect(screen.queryByText(/bandeira leste/i)).not.toBeInTheDocument()
  })
})
