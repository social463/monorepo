import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BALL_REACH_PX,
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
 * Gestos que CARREGAM força ao segurar. O toque (Z) fica de fora de propósito:
 * já era o gesto fraco e fixo, e carregar um toque não faria sentido.
 */
const CHARGEABLE_POWERS: readonly OfficeBallPower[] = ['kick', 'lob']

/** Tempo segurando a tecla até a força máxima. */
export const BALL_CHARGE_MS = 600

/** Carga em andamento — base para desenhar a barra de força. */
export interface OfficeBallCharge {
  power: OfficeBallPower
  /** `Date.now()` de quando a tecla desceu. */
  startedAt: number
}

/**
 * Alcance com que o CLIENTE libera as teclas e o aviso — um tile mais folgado
 * que o do servidor (`BALL_REACH_PX`), de propósito.
 *
 * Quem anda vê o próprio personagem na posição PREVISTA (`ArenaPredictor`),
 * mas `you` aqui é a posição AUTORITATIVA, que chega um eco depois. Ao conduzir
 * a bola, essa diferença de um tile apagava o aviso e desarmava a barra bem no
 * meio da corrida — e aí o Espaço voltava a ser push-to-talk, abrindo o
 * microfone em vez de chutar. Com a folga, a tecla continua armada e quem
 * decide se o chute vale continua sendo o servidor: fora do alcance de lá, a
 * mensagem simplesmente não faz nada.
 */
/**
 * Alcance que a TECLA considera, em pixel — um pouco maior que o do servidor
 * (`BALL_REACH_PX`), de propósito: o botão some antes de a bola sair do
 * alcance, e não depois.
 */
export const BALL_INPUT_REACH = BALL_REACH_PX + 8

export interface OfficeBallAction {
  /** Bola ao alcance do pé, ou `null` — o que acende o aviso na tela. */
  nearbyBall: OfficeBall | null
  canKick: boolean
  /** X ou C segurados, carregando força — ou `null`. Base da barra de força. */
  charging: OfficeBallCharge | null
  kick(power: OfficeBallPower, sprint?: boolean, charge?: number): void
}

/**
 * Toque (Z), chute rasteiro (X) e chute alto (C) na bola ao alcance. Shift
 * junto de qualquer chute é a corrida.
 *
 * X e C CARREGAM força: descem a tecla e o chute só sai ao SOLTAR (`keyup`),
 * do jeito do confete (`OfficeScene.handleConfettiDown/Up`) — eventos físicos
 * de tecla, não polling. Quanto mais tempo segurada, mais perto de
 * `BALL_CHARGE_MS` e mais forte o chute; toque rápido sai fraco. O toque (Z)
 * continua instantâneo no `keydown`, sem carregar nada.
 *
 * O cliente manda só o gesto e a carga: quem decide direção, força e
 * trajetória é o servidor (`kickBall`, `@legends/shared`), a partir de onde a
 * pessoa está e do que ela encara. Por isso aqui não há física nenhuma — só
 * alcance, para saber quando mostrar o aviso e quando as teclas valem.
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
    (power: OfficeBallPower, sprint = false, charge = 1) => {
      bridge.emitClientMessage({
        type: 'kick-ball',
        power,
        ...(sprint ? { sprint } : {}),
        ...(charge < 1 ? { charge } : {}),
      })
    },
    [bridge],
  )

  const [charging, setCharging] = useState<OfficeBallCharge | null>(null)
  const chargingRef = useRef<OfficeBallCharge | null>(null)

  const cancelCharge = useCallback(() => {
    chargingRef.current = null
    setCharging(null)
  }, [])

  useEffect(() => {
    if (!canKick) cancelCharge()
  }, [canKick, cancelCharge])

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
      if (!CHARGEABLE_POWERS.includes(power)) {
        kick(power)
        return
      }
      if (chargingRef.current?.power === power) return
      const next = { power, startedAt: Date.now() }
      chargingRef.current = next
      setCharging(next)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const current = chargingRef.current
      if (!current) return
      const key = event.key.toLowerCase()
      if (BALL_KEYS[current.power as keyof typeof BALL_KEYS] !== key) return
      const elapsed = Date.now() - current.startedAt
      const charge = Math.max(0, Math.min(1, elapsed / BALL_CHARGE_MS))
      cancelCharge()
      kick(current.power, event.shiftKey, charge)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    // Alt-tab com a tecla segurada não pode virar chute em segundo plano.
    window.addEventListener('blur', cancelCharge)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', cancelCharge)
    }
  }, [canKick, kick, cancelCharge])

  return { nearbyBall, canKick, charging, kick }
}
