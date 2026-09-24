import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { BadgeArtPicker, sugerirArte } from './BadgeArtPicker'
import { BADGE_ART } from '../lib/badge-art'

describe('BadgeArtPicker', () => {
  // Documento 4, seção 11.1: as 207 artes abriam todas de uma vez e a grade
  // ocupava mais tela que o resto do formulário.
  it('nasce recolhida, mostrando só a arte escolhida', () => {
    render(<BadgeArtPicker value="rocket" onChange={() => {}} />)

    expect(screen.queryByRole('group', { name: /ilustração/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Foguete/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('abre a grade completa no clique', async () => {
    render(<BadgeArtPicker value="rocket" onChange={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Foguete/ }))

    const grade = screen.getByRole('group', { name: /ilustração/i })
    expect(grade.querySelectorAll('button')).toHaveLength(BADGE_ART.length)
  })

  it('dispara onChange com a chave ao clicar', async () => {
    const onChange = vi.fn()
    render(<BadgeArtPicker value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /Escolher ilustração/ }))
    const grade = screen.getByRole('group', { name: /ilustração/i })
    await userEvent.click(within(grade).getByRole('button', { name: 'Troféu' }))

    expect(onChange).toHaveBeenCalledWith('trophy')
  })

  it('marca a ilustração selecionada com aria-pressed', async () => {
    render(<BadgeArtPicker value="rocket" onChange={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: /Foguete/ }))

    // Dentro da grade: o botão que a abre também se chama "Foguete".
    const grade = screen.getByRole('group', { name: /ilustração/i })
    expect(within(grade).getByRole('button', { name: 'Foguete' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Aleatório" sugere pelo título do selo', async () => {
    const onChange = vi.fn()
    render(<BadgeArtPicker value="" title="Lenda do Fogo" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: /Aleatório/ }))

    expect(onChange).toHaveBeenCalledWith('fire')
  })
})

describe('sugerirArte', () => {
  it('casa o rótulo do catálogo com uma palavra do título', () => {
    expect(sugerirArte('Mestre da Ideia')?.key).toBe('bulb')
    expect(sugerirArte('Troféu do mês')?.key).toBe('trophy')
  })

  it('ignora palavras curtas, que casariam com meio catálogo', () => {
    // "de"/"da"/"do" não entram; sem mais nada em comum, sobra o sorteio geral.
    const sugerida = sugerirArte('do de da')
    expect(sugerida).not.toBeNull()
  })

  it('sorteia entre todas quando o título não casa com nada', () => {
    const sugerida = sugerirArte('zzzzqqqq')
    expect(BADGE_ART.some((art) => art.key === sugerida?.key)).toBe(true)
  })
})
