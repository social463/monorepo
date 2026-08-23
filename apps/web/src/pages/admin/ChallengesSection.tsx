import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isFullAdmin } from '@legends/shared'
import type {
  ChallengeDTO,
  ChallengeListResponse,
  CreateChallengeRequest,
  PresignImageUploadResponse,
  SectorDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { UploadError, validateImageFile } from '../../lib/upload'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { Panel } from './shared'
import { ChallengeForm, EMPTY_CHALLENGE_FORM, EMPRESA_INTEIRA_VALUE, type ChallengeFormState } from './ChallengeForm'

const ADMIN_CHALLENGES_KEY = ['admin-challenges']

/** Monta o corpo da requisição.
 *
 * `imageKey` só entra quando o form realmente subiu um arquivo novo nesta
 * sessão — omitido, o PATCH preserva a capa atual (o DTO nunca expõe a chave
 * de volta, então não há como reenviar a antiga).
 *
 * `sectorId` só entra explícito na CRIAÇÃO — `undefined` no PATCH, sempre: a
 * chave fica omitida e o service preserva o setor atual do desafio. Mandar
 * `null` incondicionalmente no PATCH zeraria o `sectorId` de um desafio de
 * setor só por abrir e salvar o formulário de edição (o DTO não expõe uma
 * forma de "reenviar o setor atual"). Na criação, quem resolve é
 * `handleSubmit`: ADMIN manda a escolha do form (ou `null` = empresa
 * inteira); SUBADMIN manda sempre o próprio setor.
 */
function toRequest(
  form: ChallengeFormState,
  newImageKey: string | null,
  sectorId: string | null | undefined,
): CreateChallengeRequest {
  const body: CreateChallengeRequest = {
    title: form.title.trim(),
    description: form.description.trim(),
    category: form.category,
    detailsMarkdown: form.detailsMarkdown.trim() === '' ? null : form.detailsMarkdown.trim(),
    rewardCoins: Number(form.rewardCoins),
    requiresReview: form.requiresReview,
    isPrivate: form.isPrivate,
    isFeatured: form.isFeatured,
  }
  if (newImageKey !== null) body.imageKey = newImageKey
  if (sectorId !== undefined) body.sectorId = sectorId
  return body
}

/**
 * Administração de desafios: catálogo (categoria, detalhe, capa, flags),
 * criação/edição, reordenação e ativar/desativar/apagar.
 * `assertCanManageChallenge` (challenge-service.ts) barra qualquer não-ADMIN
 * de criar desafio com sectorId null (empresa inteira) — por isso ADMIN
 * escolhe "Empresa inteira" ou um setor na criação, e SUBADMIN fica preso ao
 * próprio.
 */
export function ChallengesSection() {
  const queryClient = useQueryClient()
  const uploadsEnabled = useImageUploadsEnabled()
  const { user } = useAuth()
  const isAdmin = isFullAdmin(user)

  const [form, setForm] = useState<ChallengeFormState>(EMPTY_CHALLENGE_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newImageKey, setNewImageKey] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ADMIN_CHALLENGES_KEY,
    queryFn: () => apiFetch<ChallengeListResponse>('/admin/challenges'),
  })

  const challenges = [...(data?.challenges ?? [])].sort((a, b) => a.position - b.position)

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const mySector = sectors.find((s) => s.id === user?.sectorId)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ADMIN_CHALLENGES_KEY })

  function resetForm() {
    setForm(EMPTY_CHALLENGE_FORM)
    setEditingId(null)
    setNewImageKey(null)
    setImagePreviewUrl(null)
  }

  const save = useMutation({
    mutationFn: (payload: { id: string | null; body: CreateChallengeRequest }) =>
      apiFetch<{ challenge: ChallengeDTO }>(
        payload.id ? `/admin/challenges/${payload.id}` : '/admin/challenges',
        { method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload.body) },
      ),
    onSuccess: () => {
      resetForm()
      setError(null)
      void invalidate()
    },
    onError: (err: Error) => setError(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: (challenge: ChallengeDTO) =>
      apiFetch(`/admin/challenges/${challenge.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !challenge.isActive }),
      }),
    onSuccess: () => void invalidate(),
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/challenges/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (err: Error) => setError(err.message),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>('/admin/challenges/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => void invalidate(),
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    // Setor só entra explícito na criação — ver o comentário de `toRequest`.
    // ADMIN manda a escolha do form (ou `null` = empresa inteira); SUBADMIN
    // manda sempre o próprio setor, nunca o que estiver em `form.sectorId`.
    const sectorId = editingId !== null ? undefined : isAdmin ? form.sectorId || null : (user?.sectorId ?? null)
    save.mutate({ id: editingId, body: toRequest(form, newImageKey, sectorId) })
  }

  function startEdit(challenge: ChallengeDTO) {
    setError(null)
    save.reset()
    setEditingId(challenge.id)
    setForm({
      title: challenge.title,
      description: challenge.description,
      category: challenge.category,
      detailsMarkdown: challenge.detailsMarkdown ?? '',
      rewardCoins: String(challenge.rewardCoins),
      requiresReview: challenge.requiresReview,
      isPrivate: challenge.isPrivate,
      isFeatured: challenge.isFeatured,
      sectorId: EMPRESA_INTEIRA_VALUE,
    })
    setNewImageKey(null)
    setImagePreviewUrl(challenge.imageUrl)
  }

  function cancelEdit() {
    resetForm()
    setError(null)
    save.reset()
  }

  function handleDelete(challenge: ChallengeDTO) {
    if (!window.confirm(`Apagar o desafio "${challenge.title}"? Esta ação não pode ser desfeita.`)) return
    remove.mutate(challenge.id)
  }

  function moveChallenge(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= challenges.length) return
    const reordered = [...challenges]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    reorder.mutate(reordered.map((c) => c.id))
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file) return
    setError(null)
    setUploadBusy(true)
    try {
      validateImageFile(file)
      const presign = await apiFetch<PresignImageUploadResponse>('/uploads/images/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      })
      // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization, Content-Type do arquivo.
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
      setNewImageKey(presign.key)
      setImagePreviewUrl(presign.publicUrl)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar a imagem.')
    } finally {
      setUploadBusy(false)
    }
  }

  return (
    <Panel title="Desafios">
      {error && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {error}
        </p>
      )}

      <ChallengeForm
        form={form}
        onChange={setForm}
        editingId={editingId}
        uploadsEnabled={uploadsEnabled}
        uploadBusy={uploadBusy}
        imagePreviewUrl={imagePreviewUrl}
        onImageChange={handleImageChange}
        onSubmit={handleSubmit}
        onCancel={cancelEdit}
        isPending={save.isPending}
        isAdmin={isAdmin}
        sectors={sectors}
        userSectorId={user?.sectorId}
        mySector={mySector}
      />

      {isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
      {!isLoading && challenges.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum desafio cadastrado.</p>
      )}

      {challenges.length > 0 && (
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-outline-variant/30 text-on-surface-variant">
            <tr>
              <th className="py-2 font-label text-label-sm font-normal">Desafio</th>
              <th className="py-2 font-label text-label-sm font-normal">Categoria</th>
              <th className="py-2 font-label text-label-sm font-normal">Recompensa</th>
              <th className="py-2 font-label text-label-sm font-normal">Participações</th>
              <th className="py-2 font-label text-label-sm font-normal">Situação</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {challenges.map((challenge, index) => (
              <tr key={challenge.id} className="border-b border-outline-variant/10">
                <td className="py-2 text-on-surface">{challenge.title}</td>
                <td className="py-2 text-on-surface">{challenge.category}</td>
                <td className="py-2 text-on-surface">{challenge.rewardCoins}</td>
                <td className="py-2 text-on-surface">{challenge.submissionCount}</td>
                <td className="py-2 text-on-surface">{challenge.isActive ? 'Ativo' : 'Inativo'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => moveChallenge(index, -1)}
                    disabled={index === 0 || reorder.isPending}
                    aria-label={`Mover "${challenge.title}" para cima`}
                    className="mr-1 font-label text-label-sm text-on-surface-variant hover:text-primary disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveChallenge(index, 1)}
                    disabled={index === challenges.length - 1 || reorder.isPending}
                    aria-label={`Mover "${challenge.title}" para baixo`}
                    className="mr-3 font-label text-label-sm text-on-surface-variant hover:text-primary disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(challenge)}
                    className="mr-3 font-label text-label-sm text-on-surface-variant underline hover:text-primary"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive.mutate(challenge)}
                    className="mr-3 font-label text-label-sm text-on-surface-variant underline hover:text-primary"
                  >
                    {challenge.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(challenge)}
                    className="font-label text-label-sm text-error underline"
                  >
                    Apagar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
