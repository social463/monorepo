import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OfficeEditDrawer from './OfficeEditDrawer'

const editing = {
  state: { active: true, tool: 'brush', selectedTile: null, dirty: true, saving: false, canUndo: true },
  enter: vi.fn(), cancel: vi.fn(), save: vi.fn(), undo: vi.fn(), setTool: vi.fn(), selectTile: vi.fn(),
} as any

// Nomes ACESSÍVEIS exatos, não substring: o `Icon` é `aria-hidden`, então o
// nome de cada botão é só o texto visível (ou o aria-label). Âncoras importam —
// o botão de fechar se chama "Fechar sem salvar" e casaria com um /salvar/i solto.
describe('OfficeEditDrawer', () => {
  it('mostra ferramentas e dispara salvar', () => {
    render(<OfficeEditDrawer editing={editing} mapTilesets={[]} mapTileWidth={32} />)
    fireEvent.click(screen.getByRole('button', { name: 'Silêncio' }))
    expect(editing.setTool).toHaveBeenCalledWith('silence-zone')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(editing.save).toHaveBeenCalled()
  })
  it('desabilita salvar quando não há alterações', () => {
    const clean = { ...editing, state: { ...editing.state, dirty: false } }
    render(<OfficeEditDrawer editing={clean} mapTilesets={[]} mapTileWidth={32} />)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })
  it('dispara desfazer e o desabilita quando não há o que desfazer', () => {
    const { unmount } = render(<OfficeEditDrawer editing={editing} mapTilesets={[]} mapTileWidth={32} />)
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(editing.undo).toHaveBeenCalled()
    // Desmonta antes do segundo render: o cleanup automático só roda entre testes.
    unmount()

    const fresh = { ...editing, state: { ...editing.state, canUndo: false } }
    render(<OfficeEditDrawer editing={fresh} mapTilesets={[]} mapTileWidth={32} />)
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeDisabled()
  })
  it('desabilita os botões action-point e door (stub v1)', () => {
    render(<OfficeEditDrawer editing={editing} mapTilesets={[]} mapTileWidth={32} />)
    expect(screen.getByRole('button', { name: 'Ação' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Porta' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Ação' }))
    fireEvent.click(screen.getByRole('button', { name: 'Porta' }))
    expect(editing.setTool).not.toHaveBeenCalledWith('action-point')
    expect(editing.setTool).not.toHaveBeenCalledWith('door')
  })
  // Task 11b: `save()` não relança mais (o único chamador dispara com `void
  // save()`) — a falha vira `state.saveError`, e o drawer precisa exibi-la,
  // senão o usuário nunca sabe que o salvamento falhou.
  it('mostra o aviso de erro ao salvar quando state.saveError está definido', () => {
    const failed = { ...editing, state: { ...editing.state, saveError: 'Não foi possível salvar o mapa. Tente novamente.' } }
    render(<OfficeEditDrawer editing={failed} mapTilesets={[]} mapTileWidth={32} />)
    expect(screen.getByText('Não foi possível salvar o mapa. Tente novamente.')).toBeInTheDocument()
  })
  it('não mostra o aviso de erro ao salvar quando state.saveError é null', () => {
    render(<OfficeEditDrawer editing={editing} mapTilesets={[]} mapTileWidth={32} />)
    expect(screen.queryByText(/não foi possível salvar/i)).not.toBeInTheDocument()
  })
})
