import type { ChangeEvent, FormEvent } from 'react'
import { CHALLENGE_CATEGORIES, CHALLENGE_DETAILS_MAX_LENGTH, type ChallengeCategory, type SectorDTO } from '@legends/shared'
import { Select } from '../../components/Select'
import { inputCls } from './shared'

/** '' representa "empresa inteira" na escolha do ADMIN. */
export const EMPRESA_INTEIRA_VALUE = ''

export interface ChallengeFormState {
  title: string
  description: string
  category: ChallengeCategory
  detailsMarkdown: string
  rewardCoins: string
  requiresReview: boolean
  isPrivate: boolean
  isFeatured: boolean
  /** Só usado pelo ADMIN na criação: '' = empresa inteira, senão o id do setor.
   *  SUBADMIN ignora este campo — o setor enviado é sempre o dele
   *  (assertCanManageChallenge no service barra qualquer outra coisa). */
  sectorId: string
}

export const EMPTY_CHALLENGE_FORM: ChallengeFormState = {
  title: '',
  description: '',
  category: CHALLENGE_CATEGORIES[0],
  detailsMarkdown: '',
  rewardCoins: '0',
  requiresReview: true,
  isPrivate: false,
  isFeatured: false,
  sectorId: EMPRESA_INTEIRA_VALUE,
}

/**
 * Formulário puro de criação/edição de desafio: título, categoria, recompensa,
 * descrição, detalhe em Markdown, capa (upload) e flags. Toda a lógica de
 * estado/mutação fica em `ChallengesSection`; aqui só renderiza e repassa eventos.
 */
export function ChallengeForm({
  form,
  onChange,
  editingId,
  uploadsEnabled,
  uploadBusy,
  imagePreviewUrl,
  onImageChange,
  onSubmit,
  onCancel,
  isPending,
  isAdmin,
  sectors,
  userSectorId,
  mySector,
}: {
  form: ChallengeFormState
  onChange: (updater: (f: ChallengeFormState) => ChallengeFormState) => void
  editingId: string | null
  uploadsEnabled: boolean
  uploadBusy: boolean
  imagePreviewUrl: string | null
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  isPending: boolean
  /** Só ADMIN escolhe o setor do desafio; SUBADMIN fica preso ao próprio
   *  (assertCanManageChallenge no service barra qualquer outra coisa). */
  isAdmin: boolean
  sectors: SectorDTO[]
  /** Setor da pessoa logada — usado para travar o campo do SUBADMIN mesmo
   *  antes de `/admin/sectors` responder. */
  userSectorId: string | undefined
  mySector: SectorDTO | undefined
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-lg grid gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md sm:grid-cols-2"
    >
      <label className="font-label text-label-sm text-on-surface-variant" htmlFor="challenge-title">
        Título
        <input
          id="challenge-title"
          value={form.title}
          onChange={(event) => onChange((f) => ({ ...f, title: event.target.value }))}
          className={`${inputCls} mt-1`}
        />
      </label>
      <label className="font-label text-label-sm text-on-surface-variant" htmlFor="challenge-category">
        Categoria
        <select
          id="challenge-category"
          value={form.category}
          onChange={(event) => onChange((f) => ({ ...f, category: event.target.value as ChallengeCategory }))}
          className={`${inputCls} mt-1`}
        >
          {CHALLENGE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className="font-label text-label-sm text-on-surface-variant" htmlFor="challenge-reward">
        Recompensa (coins)
        <input
          id="challenge-reward"
          type="number"
          min={0}
          value={form.rewardCoins}
          onChange={(event) => onChange((f) => ({ ...f, rewardCoins: event.target.value }))}
          className={`${inputCls} mt-1`}
        />
      </label>
      <label className="font-label text-label-sm text-on-surface-variant sm:col-span-2" htmlFor="challenge-description">
        Descrição
        <textarea
          id="challenge-description"
          rows={3}
          value={form.description}
          onChange={(event) => onChange((f) => ({ ...f, description: event.target.value }))}
          className={`${inputCls} mt-1`}
        />
      </label>
      {/* O setor só é escolhido na criação: o PATCH nunca manda `sectorId`
       *  (ver `toRequest` em ChallengesSection), então mudar aqui durante a
       *  edição não teria efeito algum — melhor nem mostrar o campo. */}
      {editingId === null && (
        <div className="font-label text-label-sm text-on-surface-variant sm:col-span-2">
          Setor
          {isAdmin ? (
            <Select
              ariaLabel="Setor do desafio"
              value={form.sectorId}
              onChange={(value) => onChange((f) => ({ ...f, sectorId: value }))}
              options={[
                { value: EMPRESA_INTEIRA_VALUE, label: 'Empresa inteira' },
                ...sectors.map((sector) => ({ value: sector.id, label: sector.name })),
              ]}
              searchable
              className="mt-1"
            />
          ) : (
            <Select
              ariaLabel="Setor do desafio"
              value={userSectorId ?? ''}
              onChange={() => {}}
              options={[{ value: userSectorId ?? '', label: mySector?.name ?? 'Meu setor' }]}
              disabled
              className="mt-1"
            />
          )}
        </div>
      )}
      <label className="font-label text-label-sm text-on-surface-variant sm:col-span-2" htmlFor="challenge-details">
        Detalhe (Markdown)
        <textarea
          id="challenge-details"
          rows={5}
          maxLength={CHALLENGE_DETAILS_MAX_LENGTH}
          value={form.detailsMarkdown}
          onChange={(event) => onChange((f) => ({ ...f, detailsMarkdown: event.target.value }))}
          className={`${inputCls} mt-1 font-mono`}
        />
      </label>
      {uploadsEnabled && (
        <div className="sm:col-span-2">
          <label className="font-label text-label-sm text-on-surface-variant" htmlFor="challenge-image">
            Capa
          </label>
          <input
            id="challenge-image"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onImageChange}
            disabled={uploadBusy}
            className="mt-1 block font-body text-body-sm text-on-surface"
          />
          {uploadBusy && <p className="mt-1 text-body-sm text-on-surface-variant">Enviando…</p>}
          {imagePreviewUrl && (
            <img
              src={imagePreviewUrl}
              alt="Pré-visualização da capa do desafio"
              className="mt-2 h-24 w-24 rounded-md object-cover"
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-md sm:col-span-2">
        <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            checked={form.requiresReview}
            onChange={(event) => onChange((f) => ({ ...f, requiresReview: event.target.checked }))}
          />
          Exige moderação
        </label>
        <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            checked={form.isPrivate}
            onChange={(event) => onChange((f) => ({ ...f, isPrivate: event.target.checked }))}
          />
          Privado — não aparece na vitrine
        </label>
        <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={(event) => onChange((f) => ({ ...f, isFeatured: event.target.checked }))}
          />
          Em destaque
        </label>
      </div>
      <div className="flex gap-sm sm:col-span-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {editingId ? 'Salvar' : 'Criar desafio'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-primary"
          >
            Cancelar edição
          </button>
        )}
      </div>
    </form>
  )
}
