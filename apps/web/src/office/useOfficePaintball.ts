import { useCallback, useEffect, useRef, useState } from 'react'
import { PAINTBALL_COOLDOWN_MS, type OfficeOccupant } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * `Q` equipa e guarda o marcador; `V` atira.
 *
 * `Q` está livre desde que o toque na bola mudou para `Z`, e é a tecla mais
 * perto do WASD; `V` fica sob o indicador da mesma mão. O `V` do editor de
 * mapa (espelhar vertical) não conflita: o gesto inteiro é desarmado em modo
 * de edição, como o da bola.
 */
export const PAINTBALL_KEYS = { marker: 'q', fire: 'v' } as const

export interface OfficePaintballAction {
  /** Marcador equipado — o que acende o aviso e libera o `V`. */
  armed: boolean
  /** `false` durante a cadência, só para apagar o botão (quem decide é o servidor). */
  canFire: boolean
  toggleMarker(): void
  fire(): void
}

/**
 * Marcador de paintball: equipar, guardar e atirar.
 *
 * O cliente manda só o gesto. Direção (o facing autoritativo), alcance e alvo
 * são resolvidos pelo servidor (`firePaintball`, `@legends/shared`) — por isso
 * aqui não há mira, trajetória nem detecção de acerto.
 *
 * `armed` vem do occupant AUTORITATIVO, e não de um estado local otimista: é o
 * mesmo bit que decide se o servidor aceita o tiro, e mostrar a arma antes de
 * ele confirmar deixaria o aviso na tela mentindo por um round-trip.
 *
 * A cadência espelhada aqui serve só ao botão. O servidor tem a dele
 * (`PAINTBALL_COOLDOWN_MS` no hub) e é ela que vale — sem isso, um teclado com
 * auto-repeat viraria metralhadora de broadcast.
 */
export function useOfficePaintball(
  bridge: OfficeBridge,
  you: OfficeOccupant | null,
  enabled = true,
): OfficePaintballAction {
  const armed = enabled && (you?.paintMarker ?? false)

  const [canFire, setCanFire] = useState(true)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggleMarker = useCallback(() => {
    bridge.emitClientMessage({ type: 'set-paint-marker', active: !(you?.paintMarker ?? false) })
  }, [bridge, you?.paintMarker])

  const fire = useCallback(() => {
    if (cooldownRef.current !== null) return
    bridge.emitClientMessage({ type: 'fire-paintball' })
    setCanFire(false)
    cooldownRef.current = setTimeout(() => {
      cooldownRef.current = null
      setCanFire(true)
    }, PAINTBALL_COOLDOWN_MS)
  }, [bridge])

  // Guardar a arma (ou sair do escritório) zera a cadência pendente: o timer
  // é do gesto, não da sessão, e deixá-lo correndo faria o botão nascer
  // apagado ao equipar de novo.
  useEffect(() => {
    return () => {
      if (cooldownRef.current !== null) clearTimeout(cooldownRef.current)
      cooldownRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      // `repeat` fora: segurar o `V` não dispara em rajada — a cadência do
      // servidor barraria de qualquer jeito, mas o botão local piscaria.
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
      if (isTextInput(event.target)) return
      const key = event.key.toLowerCase()
      if (key === PAINTBALL_KEYS.marker) {
        event.preventDefault()
        toggleMarker()
        return
      }
      // Desarmado, o `V` não faz nada: pegar a arma é o primeiro gesto.
      if (key === PAINTBALL_KEYS.fire && armed) {
        event.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [armed, enabled, fire, toggleMarker])

  return { armed, canFire, toggleMarker, fire }
}
