import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MeetingSeal } from './MeetingSeal'
import { apprenticeSealFor } from './program-theme'

function seal(ui: React.ReactElement): HTMLElement {
  return render(ui).container.querySelector('[data-seal-state]') as HTMLElement
}

describe('MeetingSeal', () => {
  it('conquistado sai na arte oficial do encontro', () => {
    const el = seal(<MeetingSeal order={4} done />)
    expect(el.dataset.sealState).toBe('conquistado')
    expect(el.tagName).toBe('IMG')
    expect(el.getAttribute('src')).toBe('/eu-aprendiz/selo-encontro-4.png')
  })

  it('a arte cicla o catálogo quando a trilha passa de seis encontros', () => {
    expect(apprenticeSealFor(7)).toBe('/eu-aprendiz/selo-encontro-1.png')
    expect(apprenticeSealFor(12)).toBe('/eu-aprendiz/selo-encontro-6.png')
  })

  it('não conquistado fica em contorno, sem a arte do selo', () => {
    const bloqueado = seal(<MeetingSeal order={2} locked />)
    expect(bloqueado.dataset.sealState).toBe('bloqueado')
    expect(bloqueado.tagName).not.toBe('IMG')
    expect(bloqueado.className).toContain('border-outline-variant')

    const atual = seal(<MeetingSeal order={2} />)
    expect(atual.dataset.sealState).toBe('em-andamento')
    expect(atual.className).toContain('border-primary')
  })

  it('no tamanho pequeno mostra só o número', () => {
    expect(seal(<MeetingSeal order={3} size="sm" />).textContent).toBe('3')
  })
})
