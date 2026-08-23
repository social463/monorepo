import { useState } from 'react'
import { officeRoomDeepLinkPath, type OfficeMeetingDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { downloadMeetingIcs } from './api'

/**
 * Levar a reunião para a agenda: Google num clique, `.ics` para Outlook/Teams e
 * o link da sala.
 *
 * Fica em **cada linha da agenda**, não só no painel pós-criação: quem foi
 * convidado nunca passa pela criação, e sem isto não teria caminho nenhum para
 * o `.ics`. São campos prontos do DTO, então não custa estado nenhum.
 *
 * Reunião cancelada continua oferecendo o `.ics` — é justamente o arquivo com
 * `METHOD:CANCEL` que apaga o compromisso do Outlook de quem já tinha importado.
 *
 * O `.ics` só aparece com `canDownloadIcs`: a rota `/office/meetings/:id/ics`
 * responde 403 para quem não é organizador nem convidado, e a agenda da sala
 * lista as reuniões de todo mundo. Botão que só sabe falhar não é oferecido.
 */
export function MeetingExportActions({
  meeting,
  canDownloadIcs,
  variant = 'compact',
}: {
  meeting: OfficeMeetingDTO
  /** Organizador ou convidado — só eles conseguem baixar o arquivo. */
  canDownloadIcs: boolean
  variant?: 'compact' | 'prominent'
}) {
  const [linkCopied, setLinkCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const style = variant === 'prominent' ? PROMINENT : COMPACT

  function copyRoomLink() {
    void navigator.clipboard
      .writeText(`${window.location.origin}${officeRoomDeepLinkPath(meeting.roomExternalKey)}`)
      .then(() => setLinkCopied(true))
  }

  /** Rede fora, 403 inesperado, sessão vencida: aparece, não some. */
  async function download() {
    setError(null)
    try {
      await downloadMeetingIcs(meeting)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível baixar o arquivo')
    }
  }

  // Reunião alheia já cancelada não sobra nada para oferecer.
  if (meeting.canceled && !canDownloadIcs) return null

  return (
    <div className="flex flex-wrap items-center gap-xs">
      {meeting.canceled ? (
        <button
          type="button"
          onClick={() => void download()}
          title="Arquivo de cancelamento: importar remove o compromisso do Outlook/Teams"
          className={style.secondary}
        >
          Baixar .ics do cancelamento
        </button>
      ) : (
        <>
          <a href={meeting.googleCalendarUrl} target="_blank" rel="noreferrer" className={style.primary}>
            Adicionar ao Google Calendar
          </a>
          {canDownloadIcs && (
            <button type="button" onClick={() => void download()} className={style.secondary}>
              Baixar .ics (Outlook/Teams)
            </button>
          )}
          <button type="button" onClick={copyRoomLink} className={style.ghost}>
            Copiar link da sala
          </button>
        </>
      )}
      {linkCopied && <span className="text-body-sm text-on-surface-variant">Link copiado.</span>}
      {error && <span className="text-body-sm text-error">{error}</span>}
    </div>
  )
}

const PROMINENT = {
  primary:
    'rounded-md bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary hover:bg-primary-container',
  secondary:
    'rounded-md bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface hover:bg-surface-container-high',
  ghost:
    'rounded-md border border-outline-variant/40 px-md py-xs font-label text-label-sm text-on-surface-variant hover:bg-surface-container-highest',
}

const COMPACT = {
  primary: 'font-label text-label-sm text-primary hover:underline',
  secondary: 'font-label text-label-sm text-primary hover:underline',
  ghost: 'font-label text-label-sm text-on-surface-variant hover:underline',
}
