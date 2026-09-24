import { StrictMode, useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InovaRichTextField, inovaPlainText } from './InovaRichText'

/** O pai carrega o valor DEPOIS de montar, como o formulário de edição faz com o projeto da API. */
function Carrega({ depois }: { depois: string }) {
  const [valor, setValor] = useState('')
  useEffect(() => setValor(depois), [depois])
  return <InovaRichTextField ariaLabel="Descrição" value={valor} onChange={setValor} />
}

describe('InovaRichTextField', () => {
  it('mostra o valor que chega depois de montar, inclusive no StrictMode', async () => {
    render(
      <StrictMode>
        <Carrega depois="Automatiza o **relatório**" />
      </StrictMode>,
    )
    const editor = screen.getByRole('textbox', { name: 'Descrição' })
    await screen.findByText('relatório')
    expect(editor.textContent).toContain('Automatiza o relatório')
  })
})

describe('inovaPlainText', () => {
  it('tira a marcação Markdown para o resumo do card', () => {
    expect(inovaPlainText('- **Menos** retrabalho\n- [link](https://x.y)')).toBe('Menos retrabalho link')
  })
})
