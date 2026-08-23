import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { characterSignature, defaultCharacterFromSeed, type CharacterFavoriteDTO } from '@legends/shared'
import { CharacterEditorPage } from './CharacterEditorPage'

const characterFavoritesApi = vi.hoisted(() => ({
  listCharacterFavorites: vi.fn(),
  saveCharacterFavoriteSlot: vi.fn(),
  deleteCharacterFavoriteSlot: vi.fn(),
}))
const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))
const apiFetch = vi.fn()
vi.mock('../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}))
vi.mock('../lib/characterFavorites', () => characterFavoritesApi)
const setUser = vi.fn()
const user = { id: 'u1', name: 'Erika', avatarStyle: 'lpc', avatarSeed: 'erika', avatarOptions: defaultCharacterFromSeed('erika') }
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user, setUser }) }))
vi.mock('../components/character-editor/LayerThumb', () => ({ LayerThumb: () => <div /> }))
vi.mock('../components/CharacterPreview', () => ({
  CharacterPreview: ({ size }: { size?: number }) => <div data-testid="preview" data-size={size} />,
}))
vi.mock('../hooks/useCharacterPortrait', async (orig) => ({
  ...(await orig()),
  useCharacterPortrait: () => 'data:image/png;base64,x',
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/personagem']}>
        <Routes>
          <Route path="/personagem" element={<CharacterEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function favorite(slot: 1 | 2 | 3 | 4 | 5, seed = `slot-${slot}`): CharacterFavoriteDTO {
  const options = defaultCharacterFromSeed(seed)
  return {
    id: `fav-${slot}`,
    slot,
    seed,
    options,
    signature: characterSignature(options),
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  }
}

afterEach(() => {
  vi.clearAllMocks()
  characterFavoritesApi.listCharacterFavorites.mockResolvedValue({ favorites: [] })
  characterFavoritesApi.saveCharacterFavoriteSlot.mockResolvedValue({ favorite: favorite(1) })
  characterFavoritesApi.deleteCharacterFavoriteSlot.mockResolvedValue(undefined)
})

describe('CharacterEditorPage', () => {
  beforeEach(() => {
    characterFavoritesApi.listCharacterFavorites.mockResolvedValue({ favorites: [] })
    characterFavoritesApi.saveCharacterFavoriteSlot.mockResolvedValue({ favorite: favorite(1) })
    characterFavoritesApi.deleteCharacterFavoriteSlot.mockResolvedValue(undefined)
  })

  it('renderiza preview e guarda-roupa', () => {
    renderPage()
    expect(screen.getAllByTestId('preview').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Salvar' })[0]).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Meus visuais' })).toBeInTheDocument()
  })

  it('mobile usa preview compacto (128) e desktop usa o completo (224)', () => {
    renderPage()
    const sizes = screen.getAllByTestId('preview').map((el) => el.dataset.size)
    expect(sizes).toContain('128')
    expect(sizes).toContain('224')
  })

  it('sem mudanças, Cancelar navega direto sem confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar' })[0])
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/perfil/u1')
  })

  it('com mudanças, Cancelar pede confirmação e só navega no ok', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Aleatório' })[0]) // marca dirty
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar' })[0])
    expect(confirmSpy).toHaveBeenCalledWith('Descartar alterações?')
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar' })[0])
    expect(navigate).toHaveBeenCalledWith('/perfil/u1')
  })

  it('salvar faz PATCH v2, atualiza o usuário e navega ao perfil', async () => {
    apiFetch.mockResolvedValueOnce({ user: { ...user, name: 'Erika!' } })
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar' })[0])
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/perfil/u1'))
    const [path, init] = apiFetch.mock.calls[0]
    expect(path).toBe('/auth/me')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.avatarStyle).toBe('lpc')
    expect(body.avatarOptions.items.body).toBeTruthy()
    expect(setUser).toHaveBeenCalled()
  })

  it('após salvar, sair não pede confirmação (dirty resetado pela navegação)', async () => {
    apiFetch.mockResolvedValueOnce({ user })
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Aleatório' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar' })[0])
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('salva visual atual em slot vazio sem confirmação', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    const saveButtons = await screen.findAllByRole('button', { name: 'Salvar aqui' })
    fireEvent.click(saveButtons[0])
    await waitFor(() => expect(characterFavoritesApi.saveCharacterFavoriteSlot).toHaveBeenCalled())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(characterFavoritesApi.saveCharacterFavoriteSlot).toHaveBeenCalledWith(1, {
      seed: 'erika',
      options: user.avatarOptions,
    })
  })

  it('substitui slot preenchido direto', async () => {
    characterFavoritesApi.listCharacterFavorites.mockResolvedValueOnce({ favorites: [favorite(1)] })
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Substituir' }))
    await waitFor(() => expect(characterFavoritesApi.saveCharacterFavoriteSlot).toHaveBeenCalledWith(1, {
      seed: 'erika',
      options: user.avatarOptions,
    }))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('usar slot carrega o visual salvo no editor sem salvar nem navegar', async () => {
    const slot = favorite(1, 'visual-salvo')
    characterFavoritesApi.listCharacterFavorites.mockResolvedValueOnce({ favorites: [slot] })
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Usar' }))

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Salvar' })[0]).toBeEnabled())
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalledWith('/auth/me', expect.any(Object))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('após usar slot, Salvar persiste o visual e navega ao perfil', async () => {
    const slot = favorite(1, 'visual-salvo')
    characterFavoritesApi.listCharacterFavorites.mockResolvedValueOnce({ favorites: [slot] })
    apiFetch.mockResolvedValueOnce({ user: { ...user, avatarSeed: 'erika', avatarOptions: slot.options } })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Usar' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar' })[0])

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/auth/me', expect.any(Object)))
    const [, init] = apiFetch.mock.calls[0]
    const body = JSON.parse((init as { body: string }).body)
    expect(body.avatarSeed).toBe('erika')
    expect(body.avatarOptions).toEqual(slot.options)
    expect(navigate).toHaveBeenCalledWith('/perfil/u1')
  })

  it('limpa slot preenchido após confirmação', async () => {
    characterFavoritesApi.listCharacterFavorites.mockResolvedValueOnce({ favorites: [favorite(1)] })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Limpar slot 1' }))
    await waitFor(() => expect(characterFavoritesApi.deleteCharacterFavoriteSlot).toHaveBeenCalledWith(1))
  })
})
