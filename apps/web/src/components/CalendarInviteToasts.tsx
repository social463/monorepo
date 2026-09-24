import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUnreadNotificationsPoll } from '../lib/use-notifications'
import { Icon } from './Icon'

interface ToastItem {
  id: string
  title: string
  link: string
}

/**
 * Pop-up de convite a evento do calendário (Documento 3, seção 11).
 *
 * O documento pede "o mesmo padrão dos comunicados". O padrão do comunicado é um
 * hub WebSocket global mais um toast que busca o post e trata 404 como "não é
 * para você" — desenho que existe porque o feed precisa aparecer no mesmo
 * segundo em que alguém publica.
 *
 * Aqui a fonte é outra, e de propósito: a **consulta de notificações não-lidas
 * que já roda a cada 10 segundos**. O convite é por PESSOA, e notificação já é
 * por pessoa; o hub do mural é canal único e global, então replicá-lo faria toda
 * conexão da empresa buscar o evento a cada convite para a maioria descobrir que
 * não era dela. E dez segundos são invisíveis num convite de agenda — ao
 * contrário do feed, em que "acabou de sair" é a experiência.
 *
 * Só `CALENDAR_EVENT_INVITED` vira pop-up. Se qualquer notificação virasse, cada
 * feedback recebido abriria uma janelinha.
 */
export function CalendarInviteToasts() {
  const poll = useUnreadNotificationsPoll()
  // Só desta sessão: fechar o aviso NÃO marca a notificação como lida — ela
  // continua no sininho, que é onde o convite deve poder ser reencontrado.
  const [fechados, setFechados] = useState<string[]>([])

  const items: ToastItem[] = (poll.data?.items ?? [])
    .filter((n) => n.type === 'CALENDAR_EVENT_INVITED' && n.link && !fechados.includes(n.id))
    .map((n) => ({ id: n.id, title: n.title, link: n.link! }))

  if (items.length === 0) return null

  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className="pointer-events-auto flex max-w-sm items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-high px-md py-sm shadow-lg"
        >
          <Icon name="event_available" className="mt-0.5 text-[20px] text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-label text-label-md font-bold text-on-surface">Convite de evento</p>
            <p className="text-body-sm text-on-surface-variant">{item.title}</p>
            <Link
              to={item.link}
              onClick={() => setFechados((atuais) => [...atuais, item.id])}
              className="font-label text-label-sm text-primary hover:underline"
            >
              Ver no calendário
            </Link>
          </div>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setFechados((atuais) => [...atuais, item.id])}
            className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      ))}
    </>
  )
}
