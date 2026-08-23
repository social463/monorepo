import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { OfficeOccupant } from '@legends/shared'
import { RoomChatPanel } from './RoomChatPanel'

function occupant(overrides: Partial<OfficeOccupant> = {}): OfficeOccupant {
  return {
    userId: 'ana',
    name: 'Ana Silva',
    x: 1,
    y: 1,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    ...overrides,
  }
}

describe('RoomChatPanel', () => {
  it('mostra o personagem de quem falou antes do nome, e não a foto', () => {
    render(
      <RoomChatPanel
        messages={[{ userId: 'ana', name: 'Ana Silva', text: 'oi', sentAt: '2026-01-01T10:00:00.000Z' }]}
        occupants={[occupant({ photoUrl: 'https://cdn.exemplo/ana.png' })]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    // Dentro do escritório vale o boneco; a foto só no card de resumo.
    expect(screen.queryByRole('img', { name: 'Ana Silva' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Ana Silva').length).toBeGreaterThan(0)
  })

  it('cai nas iniciais quando quem falou já saiu da sala', () => {
    render(
      <RoomChatPanel
        messages={[{ userId: 'ana', name: 'Ana Silva', text: 'oi', sentAt: '2026-01-01T10:00:00.000Z' }]}
        occupants={[]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('agrupa mensagens seguidas da mesma pessoa sem repetir o nome', () => {
    render(
      <RoomChatPanel
        messages={[
          { userId: 'ana', name: 'Ana Silva', text: 'oi', sentAt: '2026-01-01T10:00:00.000Z' },
          { userId: 'ana', name: 'Ana Silva', text: 'bora?', sentAt: '2026-01-01T10:00:04.000Z' },
          { userId: 'bruno', name: 'Bruno Costa', text: 'bora', sentAt: '2026-01-01T10:00:09.000Z' },
        ]}
        occupants={[occupant(), occupant({ userId: 'bruno', name: 'Bruno Costa' })]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(screen.getAllByText('Ana Silva')).toHaveLength(1)
    expect(items[0]).toHaveTextContent('oi')
    expect(items[0]).toHaveTextContent('bora?')
    expect(items[1]).toHaveTextContent('Bruno Costa')
  })

  it('mostra aviso de "sem mensagens" quando a lista está vazia', () => {
    render(<RoomChatPanel messages={[]} canSend onSendMessage={vi.fn(() => true)} onClose={vi.fn()} />)
    expect(screen.getByText('Sem mensagens na sala ainda.')).toBeInTheDocument()
  })

  it('lista as mensagens com remetente e texto, na ordem recebida', () => {
    render(
      <RoomChatPanel
        messages={[
          { userId: 'ana', name: 'Ana', text: 'oi', sentAt: '2026-01-01T00:00:00.000Z' },
          { userId: 'bruno', name: 'Bruno', text: 'e aí', sentAt: '2026-01-01T00:00:01.000Z' },
        ]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Ana')
    expect(items[0]).toHaveTextContent('oi')
    expect(items[1]).toHaveTextContent('Bruno')
    expect(items[1]).toHaveTextContent('e aí')
  })

  it('envia a mensagem digitada e limpa o campo', () => {
    const onSendMessage = vi.fn(() => true)
    render(<RoomChatPanel messages={[]} canSend onSendMessage={onSendMessage} onClose={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: '  opa  ' } })
    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)

    expect(onSendMessage).toHaveBeenCalledWith('opa')
    expect(screen.getByPlaceholderText('Mensagem...')).toHaveValue('')
  })

  it('não envia texto vazio', () => {
    const onSendMessage = vi.fn(() => true)
    render(<RoomChatPanel messages={[]} canSend onSendMessage={onSendMessage} onClose={vi.fn()} />)

    fireEvent.submit(screen.getByPlaceholderText('Mensagem...').closest('form')!)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('botão fechar chama onClose', () => {
    const onClose = vi.fn()
    render(<RoomChatPanel messages={[]} canSend onSendMessage={vi.fn(() => true)} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de chat da sala' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('mantém o texto quando o envio é recusado', () => {
    const onSendMessage = vi.fn(() => false)
    render(<RoomChatPanel messages={[]} canSend onSendMessage={onSendMessage} onClose={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mensagem...'), { target: { value: 'tentar de novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))

    expect(screen.getByPlaceholderText('Mensagem...')).toHaveValue('tentar de novo')
  })

  it('desabilita campo e envio quando o chat está indisponível', () => {
    const onSendMessage = vi.fn(() => true)
    render(<RoomChatPanel messages={[]} canSend={false} onSendMessage={onSendMessage} onClose={vi.fn()} />)

    expect(screen.getByPlaceholderText('Chat indisponível')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled()
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it('quebra a linha de mensagens longas em vez de estourar o painel', () => {
    const longText = 'a'.repeat(80)
    render(
      <RoomChatPanel
        messages={[{ userId: 'ana', name: 'Ana', text: longText, sentAt: '2026-01-01T00:00:00.000Z' }]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(longText)).toHaveClass('break-words', 'whitespace-pre-wrap')
  })

  it('transforma um link em <a> clicável que abre em nova aba', () => {
    render(
      <RoomChatPanel
        messages={[
          {
            userId: 'ana',
            name: 'Ana',
            text: 'olha isso: https://exemplo.com/pagina depois me fala',
            sentAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: 'https://exemplo.com/pagina' })
    expect(link).toHaveAttribute('href', 'https://exemplo.com/pagina')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText(/olha isso:/)).toBeInTheDocument()
    expect(screen.getByText(/depois me fala/)).toBeInTheDocument()
  })

  it('foca o campo de mensagem ao abrir', () => {
    render(<RoomChatPanel messages={[]} canSend onSendMessage={vi.fn(() => true)} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('Mensagem...')).toHaveFocus()
  })

  it('não força foco no campo quando o chat está indisponível', () => {
    render(<RoomChatPanel messages={[]} canSend={false} onSendMessage={vi.fn(() => true)} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('Chat indisponível')).not.toHaveFocus()
  })

  it('Enter envia a mensagem e Shift+Enter só quebra a linha', () => {
    const onSendMessage = vi.fn(() => true)
    render(<RoomChatPanel messages={[]} canSend onSendMessage={onSendMessage} onClose={vi.fn()} />)
    const field = screen.getByPlaceholderText('Mensagem...')

    fireEvent.change(field, { target: { value: 'primeira linha' } })
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(onSendMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSendMessage).toHaveBeenCalledWith('primeira linha')
    expect(field).toHaveValue('')
  })

  it('usa textarea que cresce em altura em vez de rolar na horizontal', () => {
    render(<RoomChatPanel messages={[]} canSend onSendMessage={vi.fn(() => true)} onClose={vi.fn()} />)
    const field = screen.getByPlaceholderText('Mensagem...')

    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveClass('max-h-32', 'resize-none')
  })

  it('não cria link quando não há URL na mensagem', () => {
    render(
      <RoomChatPanel
        messages={[{ userId: 'ana', name: 'Ana', text: 'sem link aqui', sentAt: '2026-01-01T00:00:00.000Z' }]}
        canSend
        onSendMessage={vi.fn(() => true)}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
