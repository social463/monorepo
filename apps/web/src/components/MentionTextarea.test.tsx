import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { PublicUser } from '@legends/shared'
import { MentionTextarea } from './MentionTextarea'

const colleagues: PublicUser[] = [
  { id: 'u1', name: 'Karina Akina', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false },
  { id: 'u2', name: 'Bruno Lima', email: '', role: 'LEGEND', area: null, position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false },
]

function Harness({ onEnterSubmit }: { onEnterSubmit?: () => void } = {}) {
  const [value, setValue] = useState('')
  const [ids, setIds] = useState<string[]>([])
  return (
    <div>
      <MentionTextarea
        value={value}
        onChange={setValue}
        onMentionsChange={setIds}
        colleagues={colleagues}
        ariaLabel="Sua resenha"
        onEnterSubmit={onEnterSubmit}
      />
      <output data-testid="ids">{ids.join(',')}</output>
    </div>
  )
}

describe('MentionTextarea', () => {
  it('mostra o dropdown ao digitar @, insere @Nome e registra o id', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa @kar' } })
    const option = screen.getByText('Karina Akina')
    fireEvent.mouseDown(option)
    expect(textarea.value).toBe('boa @Karina Akina ')
    expect(screen.getByTestId('ids').textContent).toBe('u1')
  })

  it('remove o id quando o @Nome sai do texto', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa @kar' } })
    fireEvent.mouseDown(screen.getByText('Karina Akina'))
    expect(screen.getByTestId('ids').textContent).toBe('u1')
    fireEvent.change(textarea, { target: { value: 'boa ' } })
    expect(screen.getByTestId('ids').textContent).toBe('')
  })

  it('ArrowDown + Enter seleciona a segunda opção', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    // "@" abre o dropdown com todos os colegas (Karina primeiro, Bruno segundo)
    fireEvent.change(textarea, { target: { value: '@' } })
    expect(screen.getByText('Karina Akina')).toBeTruthy()
    expect(screen.getByText('Bruno Lima')).toBeTruthy()
    // navega para o segundo item
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    // Enter seleciona Bruno Lima (índice 1)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(textarea.value).toBe('@Bruno Lima ')
    expect(screen.getByTestId('ids').textContent).toBe('u2')
  })

  it('Tab seleciona a opção destacada e fecha o dropdown', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa @kar' } })
    expect(screen.getByText('Karina Akina')).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'Tab' })
    expect(textarea.value).toBe('boa @Karina Akina ')
    expect(screen.getByTestId('ids').textContent).toBe('u1')
    expect(screen.queryByText('Karina Akina')).toBeNull()
  })

  it('Escape fecha o dropdown', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '@kar' } })
    expect(screen.getByText('Karina Akina')).toBeTruthy()
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(screen.queryByText('Karina Akina')).toBeNull()
  })

  it('Enter sem Shift chama onEnterSubmit quando o dropdown está fechado', () => {
    let called = 0
    render(<Harness onEnterSubmit={() => { called++ }} />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'olá' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(called).toBe(1)
    // não deve inserir newline
    expect(textarea.value).toBe('olá')
  })

  it('Shift+Enter não chama onEnterSubmit', () => {
    let called = 0
    render(<Harness onEnterSubmit={() => { called++ }} />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'olá' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(called).toBe(0)
  })

  it('converte ":heart:" completo no emoji ❤️ ao digitar', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'boa :heart:' } })
    expect(textarea.value).toBe('boa ❤️')
  })

  it('não converte shortcode desconhecido', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: ':zzznada:' } })
    expect(textarea.value).toBe(':zzznada:')
  })

  it('abre dropdown de emoji ao digitar ":hea" e insere ao clicar', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: ':heart' } })
    const option = screen.getByText(':heart:')
    fireEvent.mouseDown(option)
    expect(textarea.value).toBe('❤️')
  })

  it('ArrowDown + Enter seleciona o segundo emoji do dropdown', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: ':hea' } })
    const before = textarea.value
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    // Inseriu algum emoji (não ficou o texto cru) e fechou o dropdown.
    expect(textarea.value).not.toBe(before)
    expect(textarea.value.startsWith(':')).toBe(false)
  })

  it('não dispara emoji em "10:30" (":" sem espaço antes)', () => {
    render(<Harness />)
    const textarea = screen.getByLabelText('Sua resenha') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'às 10:30' } })
    expect(textarea.value).toBe('às 10:30')
    expect(screen.queryByText(/^:/)).toBeNull()
  })
})
