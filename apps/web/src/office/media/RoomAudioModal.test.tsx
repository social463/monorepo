import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoomAudioModal } from './RoomAudioModal'

describe('RoomAudioModal', () => {
  it('barra link que não é do YouTube sem chamar o servidor', () => {
    const onSubmit = vi.fn()
    render(<RoomAudioModal onSubmit={onSubmit} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Link do YouTube'), { target: { value: 'https://vimeo.com/123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tocar na sala' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Cole um link de vídeo do YouTube.')
  })

  it('envia o link cru — quem extrai o id é o hook', () => {
    const onSubmit = vi.fn()
    render(<RoomAudioModal onSubmit={onSubmit} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Link do YouTube'), {
      target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123456789' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tocar na sala' }))

    expect(onSubmit).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123456789')
  })

  it('mostra a recusa vinda do servidor', () => {
    render(<RoomAudioModal onSubmit={vi.fn()} onClose={vi.fn()} error="Esta sala já tem um áudio tocando." />)

    expect(screen.getByRole('alert')).toHaveTextContent('Esta sala já tem um áudio tocando.')
  })

  it('digitar de novo limpa o erro local, mas o do servidor continua até a próxima tentativa', () => {
    render(<RoomAudioModal onSubmit={vi.fn()} onClose={vi.fn()} error="Esta sala já tem um áudio tocando." />)

    fireEvent.change(screen.getByLabelText('Link do YouTube'), { target: { value: 'lixo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tocar na sala' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Cole um link de vídeo do YouTube.')

    fireEvent.change(screen.getByLabelText('Link do YouTube'), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Esta sala já tem um áudio tocando.')
  })

  it('fecha no Esc, no Cancelar e no clique fora — mas não no clique dentro', () => {
    const onClose = vi.fn()
    render(<RoomAudioModal onSubmit={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog', { name: 'Compartilhar áudio na sala' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
