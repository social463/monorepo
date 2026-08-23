import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OfficeSettingsPanel } from './OfficeSettingsPanel'
import { playApplauseSound, setApplauseMuted } from '../media/applause-sound'

afterEach(() => {
  setApplauseMuted(false)
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Fake de HTMLAudioElement só para saber se o aplauso chegou a tocar. */
function installFakeAudio() {
  const play = vi.fn(() => Promise.resolve())
  class FakeAudio {
    volume = 1
    currentTime = 0
    play = play
    constructor(public src = '') {}
  }
  vi.stubGlobal('Audio', FakeAudio)
  return { play }
}

describe('OfficeSettingsPanel', () => {
  it('abre nos atalhos e alterna para as preferências', () => {
    render(<OfficeSettingsPanel onClose={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'Atalhos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('switch', { name: 'Som da comemoração' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Preferências' }))

    expect(screen.getByRole('tab', { name: 'Preferências' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Atalhos' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('switch', { name: 'Som da comemoração' })).toBeInTheDocument()
  })

  it('o toggle silencia o aplauso de verdade e persiste a escolha', () => {
    const fake = installFakeAudio()
    render(<OfficeSettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Preferências' }))

    const toggle = screen.getByRole('switch', { name: 'Som da comemoração' })
    expect(toggle).toHaveAttribute('aria-checked', 'true') // som ligado por padrão

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem('office:applause-muted')).toBe('1')
    playApplauseSound()
    expect(fake.play).not.toHaveBeenCalled()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    playApplauseSound()
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('reflete a preferência salva ao abrir o painel', () => {
    setApplauseMuted(true)
    render(<OfficeSettingsPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Preferências' }))

    expect(screen.getByRole('switch', { name: 'Som da comemoração' })).toHaveAttribute('aria-checked', 'false')
  })

  it('fecha o painel pelo botão', () => {
    const onClose = vi.fn()
    render(<OfficeSettingsPanel onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fechar configurações' }))
    expect(onClose).toHaveBeenCalled()
  })
})
