import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'
import { Icon } from './Icon'

const inputCls =
  'rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 font-body text-body-md text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30'

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<void>('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setSuccess('Senha alterada com sucesso.')
      setError(null)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: (err) => {
      setSuccess(null)
      setError(err instanceof ApiError ? err.message : 'Erro ao alterar a senha.')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (newPassword.length < 8) {
      setError('A nova senha deve ter ao menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação não corresponde à nova senha.')
      return
    }
    mutation.mutate({ currentPassword, newPassword })
  }

  const inputType = show ? 'text' : 'password'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Senha atual
        <input
          type={inputType}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          className={`${inputCls} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Nova senha
        <input
          type={inputType}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          className={`${inputCls} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Confirmar nova senha
        <input
          type={inputType}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className={`${inputCls} w-full`}
        />
      </label>

      <label className="flex cursor-pointer items-center gap-sm font-label text-label-sm text-on-surface-variant">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="h-4 w-4 rounded border-outline-variant/60 bg-surface-container-highest text-primary accent-primary focus:ring-2 focus:ring-primary/30"
        />
        Mostrar senhas
      </label>

      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      {success && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-primary">
          <Icon name="check_circle" className="text-[16px]" />
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="mt-sm self-start rounded-md bg-primary px-lg py-2.5 font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container hover:text-on-primary-container active:scale-[0.98] disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        {mutation.isPending ? 'Alterando…' : 'Alterar senha'}
      </button>
    </form>
  )
}
