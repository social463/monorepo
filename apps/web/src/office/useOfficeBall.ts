import { useCallback, useEffect, useMemo } from 'react'
import {
  BALL_REACH,
  ballDistanceFrom,
  type OfficeBall,
  type OfficeBallPower,
  type OfficeOccupant,
} from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * A bola tem fileira própria no teclado, em ordem de força: Z toca, X chuta,
 * C levanta. Uma tecla por gesto, todas instantâneas.
 *
 * A barra de espaço foi tentada e abandonada: ela já é o push-to-talk, e
 * dividi-la com a bola custava caro dos dois lados. Enquanto o chute morava
 * lá, o Espaço perto da bola deixava de abrir o microfone; e como o gesto
 * dependia de qual das duas coisas estava armada naquele instante, bastava a
 * posição autoritativa atrasar um tile — o que acontece justamente ao CONDUZIR
 * — para a tecla não fazer nada. Aqui, em teclas próprias, cada gesto é
 * inequívoco e o microfone volta a ser só da barra.
 */
export const BALL_KEYS = { touch: 'z', kick: 'x', lob: 'c' } as const

/**
 * Alcance com que o CLIENTE libera as teclas e o aviso — um tile mais folgado
 * que o do servidor (`BALL_REACH`), de propósito.
 *
 * Quem anda vê o próprio personagem na posição PREVISTA (`MovementPredictor`),
 * mas `you` aqui é a posição AUTORITATIVA, que chega um eco depois. Ao conduzir
 * a bola, essa diferença de um tile apagava o aviso e desarmava a barra bem no
 * meio da corrida — e aí o Espaço voltava a ser push-to-talk, abrindo o
 * microfone em vez de chutar. Com a folga, a tecla continua armada e quem
 * decide se o chute vale continua sendo o servidor: fora do alcance de lá, a
 * mensagem simplesmente não faz nada.
 */
export const BALL_INPUT_REACH = BALL_REACH + 1

export interface OfficeBallAction {
  /** Bola ao alcance do pé, ou `null` — o que acende o aviso na tela. */
  nearbyBall: OfficeBall | null
  canKick: boolean
  kick(power: OfficeBallPower, sprint?: boolean): void
}

/**
 * Toque (Z), chute rasteiro (X) e chute alto (C) na bola ao alcance. Shift
 * junto de qualquer chute é a corrida.
 *
 * O cliente manda só o gesto: quem decide direção, força e trajetória é o
 * servidor (`kickBall`, `@legends/shared`), a partir de onde a pessoa está e
 * do que ela encara. Por isso aqui não há física nenhuma — só alcance, para
 * saber quando mostrar o aviso e quando as teclas valem.
 *
 * Estar EM CIMA da bola conta como alcance: o chute sai na direção encarada.
 * O alcance é medido até a PEGADA da peça (`ballDistanceFrom`), então a bola de
 * pilates, que ocupa 2×2, é alcançável pelos quatro lados dela.
 */
export function useOfficeBall(
  bridge: OfficeBridge,
  you: OfficeOccupant | null,
  balls: readonly OfficeBall[],
  enabled = true,
): OfficeBallAction {
  const nearbyBall = useMemo(() => {
    if (!enabled || !you) return null
    return (
      balls
        .filter((ball) => ballDistanceFrom(ball, you) <= BALL_INPUT_REACH)
        .sort(
          (a, b) => ballDistanceFrom(a, you) - ballDistanceFrom(b, you) || a.id.localeCompare(b.id),
        )[0] ?? null
    )
  }, [balls, enabled, you])
  const canKick = nearbyBall !== null

  const kick = useCallback(
    (power: OfficeBallPower, sprint = false) => {
      bridge.emitClientMessage({ type: 'kick-ball', power, ...(sprint ? { sprint } : {}) })
    },
    [bridge],
  )

  useEffect(() => {
    if (!canKick) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return
      if (isTextInput(event.target)) return
      const key = event.key.toLowerCase()
      const power = (Object.keys(BALL_KEYS) as OfficeBallPower[]).find(
        (candidate) => BALL_KEYS[candidate as keyof typeof BALL_KEYS] === key,
      )
      if (!power) return
      event.preventDefault()
      kick(power, event.shiftKey)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canKick, kick])

  return { nearbyBall, canKick, kick }
}
