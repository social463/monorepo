import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom'
import { BackButton } from './BackButton'

function Setup({ initialEntries }: { initialEntries: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<Link to="/detalhe">ir para detalhe</Link>} />
        <Route
          path="/detalhe"
          element={
            <>
              <BackButton fallback="/" />
              <p>detalhe</p>
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('BackButton', () => {
  it('volta para a tela anterior quando há histórico', async () => {
    const user = userEvent.setup()
    render(<Setup initialEntries={['/']} />)

    await user.click(screen.getByText('ir para detalhe'))
    expect(screen.getByText('detalhe')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByText('ir para detalhe')).toBeInTheDocument()
  })

  it('cai no fallback quando a tela foi aberta direto pela URL', async () => {
    const user = userEvent.setup()
    render(<Setup initialEntries={['/detalhe']} />)

    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByText('ir para detalhe')).toBeInTheDocument()
  })
})
