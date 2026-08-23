import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHARACTER_FAVORITE_SLOTS,
  characterSignature,
  defaultCharacterFromSeed,
  type CharacterFavoriteDTO,
  type CharacterFavoriteSlot,
  type CharacterOptions,
  type PublicUser,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { resolveCharacterOptions } from '../hooks/useCharacterPortrait'
import { BackButton } from '../components/BackButton'
import { PreviewPane } from '../components/character-editor/PreviewPane'
import { WardrobePanel } from '../components/character-editor/WardrobePanel'
import { randomCharacter } from '../components/character-editor/catalogView'
import { CharacterSlotsPanel } from '../components/character-editor/CharacterSlotsPanel'
import {
  deleteCharacterFavoriteSlot,
  listCharacterFavorites,
  saveCharacterFavoriteSlot,
} from '../lib/characterFavorites'

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Tela de edição de personagem (substitui o antigo modal de escolha de avatar). */
export function CharacterEditorPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const initial = useMemo(
    () => (user ? resolveCharacterOptions(user) : null) ?? defaultCharacterFromSeed(user?.avatarSeed ?? 'preview'),
    [user],
  )
  const [options, setOptions] = useState<CharacterOptions>(initial)
  const [saving, setSaving] = useState(false)
  const [busySlot, setBusySlot] = useState<CharacterFavoriteSlot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = characterSignature(options) !== characterSignature(initial)
  const profilePath = `/perfil/${user?.id ?? ''}`
  const favoritesQuery = useQuery({
    queryKey: ['character-favorites'],
    queryFn: listCharacterFavorites,
  })
  const favorites = favoritesQuery.data?.favorites ?? []

  // Fechar/recarregar a aba com edição pendente: aviso nativo do navegador.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function leave() {
    if (dirty && !window.confirm('Descartar alterações?')) return
    navigate(profilePath)
  }

  async function save(nextOptions: CharacterOptions = options, nextSeed: string = user?.avatarSeed ?? randomSeed()) {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<{ user: PublicUser }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          avatarStyle: 'lpc' as const,
          avatarSeed: nextSeed,
          avatarOptions: nextOptions,
        }),
      })
      setUser(res.user)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      navigate(profilePath)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSlot(slot: CharacterFavoriteSlot) {
    setBusySlot(slot)
    setError(null)
    try {
      await saveCharacterFavoriteSlot(slot, {
        seed: user?.avatarSeed ?? randomSeed(),
        options,
      })
      await queryClient.invalidateQueries({ queryKey: ['character-favorites'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar seus favoritos.')
    } finally {
      setBusySlot(null)
    }
  }

  async function useSlot(favorite: CharacterFavoriteDTO) {
    setOptions(favorite.options)
  }

  async function deleteSlot(slot: CharacterFavoriteSlot) {
    if (!window.confirm('Limpar este slot?')) return
    setBusySlot(slot)
    setError(null)
    try {
      await deleteCharacterFavoriteSlot(slot)
      await queryClient.invalidateQueries({ queryKey: ['character-favorites'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar seus favoritos.')
    } finally {
      setBusySlot(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-lg p-lg md:p-xl">
      <div className="flex items-center gap-sm">
        <BackButton fallback="/" className="-ml-sm" />
        <h1 className="font-headline text-headline-xl text-on-surface">Editar personagem</h1>
      </div>

      {/*
        Mobile: preview compacto sticky no topo — personagem MENOR (128px) e o
        botão Salvar sempre visíveis, sem empurrar o guarda-roupa para fora da
        viewport. Créditos ficam fora do bloco fixo (ver abaixo).
      */}
      <div className="sticky top-0 z-10 -mx-lg bg-surface px-lg py-sm lg:hidden">
        <PreviewPane compact options={options} onRandom={() => setOptions(randomCharacter())} />
        {error && <p className="mt-sm font-label text-label-sm text-error">{error}</p>}
        <div className="mt-sm flex justify-end gap-sm">
          <button
            type="button"
            onClick={leave}
            className="rounded-md px-md py-xs font-label text-label-md text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={saving}
            className="rounded-md bg-primary px-md py-xs font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <CharacterSlotsPanel
        favorites={favorites.filter((favorite) => CHARACTER_FAVORITE_SLOTS.includes(favorite.slot))}
        currentOptions={options}
        busySlot={busySlot}
        onSave={saveSlot}
        onUse={useSlot}
        onDelete={deleteSlot}
      />

      <div className="flex flex-col gap-lg lg:grid lg:grid-cols-[320px,minmax(0,1fr)] lg:items-start">
        {/* Coluna do preview completo: só no desktop, sticky. */}
        <div className="hidden lg:sticky lg:top-lg lg:z-auto lg:block lg:rounded-xl lg:border lg:border-outline-variant/40 lg:bg-surface-container lg:p-lg">
          <PreviewPane options={options} onRandom={() => setOptions(randomCharacter())} />
          {error && <p className="mt-md font-label text-label-sm text-error">{error}</p>}
          <div className="mt-lg flex justify-end gap-sm">
            <button
              type="button"
              onClick={leave}
              className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Mobile: créditos como seção normal (não-sticky), antes do guarda-roupa. */}
        <a
          href="/lpc/CREDITS.txt"
          target="_blank"
          rel="noreferrer"
          className="self-center font-label text-label-sm text-on-surface-variant underline hover:text-primary lg:hidden"
        >
          Arte: Liberated Pixel Cup — créditos
        </a>

        {/* O painel desenha os próprios cards (guarda-roupa + coluna de cores). */}
        <WardrobePanel options={options} onChange={setOptions} />
      </div>
    </div>
  )
}
