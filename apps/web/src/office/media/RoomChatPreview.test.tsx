import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RoomChatPreview } from './RoomChatPreview'

const message = { userId: 'ana', name: 'Ana Silva', text: 'bora começar?', sentAt: '2026-01-01T10:00:00.000Z' }
const ana: OfficeOccupant = {
  userId: 'ana',
  name: 'Ana Silva',
  x: 1,
  y: 1,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
  photoUrl: 'https://cdn.exemplo/ana.png',
}

describe('RoomChatPreview', () => {
  it('mostra quem falou e o texto, com o personagem no lugar da foto', () => {
    render(<RoomChatPreview message={message} occupant={ana} onOpen={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByText('Ana Silva')).toBeInTheDocument()
    expect(screen.getByText('bora começar?')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Ana Silva' })).not.toBeInTheDocument()
  })

  it('é anunciada como status para leitor de tela', () => {
    render(<RoomChatPreview message={message} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('clicar na prévia abre o chat', () => {
    const onOpen = vi.fn()
    render(<RoomChatPreview message={message} occupant={ana} onOpen={onOpen} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala — nova mensagem de Ana Silva' }))

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('o X dispensa sem abrir o chat', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    render(<RoomChatPreview message={message} occupant={ana} onOpen={onOpen} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso de mensagem' }))

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })
})
