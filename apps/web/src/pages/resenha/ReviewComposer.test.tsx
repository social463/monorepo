import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewComposer } from './ReviewComposer'

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Eu' } }) }))
vi.mock('../../lib/use-colleagues', () => ({ useColleagues: () => ({ data: [] }) }))
const { gifConfig } = vi.hoisted(() => ({ gifConfig: { enabled: true } }))
vi.mock('../../lib/use-gifs', () => ({
  useGifsEnabled: () => gifConfig.enabled,
  useGifSearch: () => ({
    results: [{ id: '1', url: 'https://media.giphy.com/a.gif', previewUrl: 'https://media.giphy.com/a-t.gif', width: 10, height: 8, description: 'gato' }],
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isLoading: false,
  }),
}))
vi.mock('../../lib/use-image-upload', () => ({ useImageUploadsEnabled: () => false }))

describe('ReviewComposer + GIF', () => {
  beforeEach(() => {
    gifConfig.enabled = true
  })

  it('oculta o botão de GIF quando a integração não está configurada', () => {
    gifConfig.enabled = false
    render(<ReviewComposer onSubmit={vi.fn()} pending={false} />)

    expect(screen.queryByRole('button', { name: 'Adicionar GIF' })).not.toBeInTheDocument()
  })

  it('anexar GIF permite publicar sem texto e envia o gif', () => {
    const onSubmit = vi.fn()
    render(<ReviewComposer onSubmit={onSubmit} pending={false} />)
    fireEvent.click(screen.getByRole('button', { name: /gif/i }))
    fireEvent.click(screen.getByAltText('gato'))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(onSubmit).toHaveBeenCalledWith('', [], { url: 'https://media.giphy.com/a.gif', width: 10, height: 8 }, null, null)
  })

  it('cria uma enquete e envia o payload sem misturar anexos', () => {
    const onSubmit = vi.fn()
    render(<ReviewComposer onSubmit={onSubmit} pending={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar enquete' }))
    expect(screen.queryByRole('button', { name: /adicionar gif/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Faça uma pergunta'), { target: { value: 'Qual tema?' } })
    fireEvent.change(screen.getByPlaceholderText('Opção 1'), { target: { value: 'TypeScript' } })
    fireEvent.change(screen.getByPlaceholderText('Opção 2'), { target: { value: 'React' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))

    expect(onSubmit).toHaveBeenCalledWith('', [], null, null, {
      question: 'Qual tema?',
      options: ['TypeScript', 'React'],
    })
  })

  it('só acusa opção repetida depois de o usuário preencher duas iguais', () => {
    render(<ReviewComposer onSubmit={vi.fn()} pending={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar enquete' }))
    expect(screen.queryByText('Use opções diferentes.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Opção 1'), { target: { value: 'React' } })
    expect(screen.queryByText('Use opções diferentes.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Opção 2'), { target: { value: ' react ' } })
    expect(screen.getByText('Use opções diferentes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })
})
