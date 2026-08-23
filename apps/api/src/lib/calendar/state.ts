import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CalendarProviderKey } from '@legends/shared'
import { resolveCalendarEncryptionKey } from '../config'

/**
 * `state` do fluxo OAuth: token curto assinado por HMAC, com quem iniciou o
 * fluxo. É deliberadamente **não** um JWT da app: reusar o segredo/formato do
 * access token criaria um caminho para confundir state com credencial de sessão.
 * Também dispensa tabela de estado — o callback só aceita o que nós assinamos.
 */
export interface CalendarStatePayload {
  userId: string
  companyId: string
  provider: CalendarProviderKey
}

interface SignedState extends CalendarStatePayload {
  nonce: string
  /** epoch ms. */
  iat: number
}

const TTL_MS = 10 * 60 * 1000

export class CalendarStateError extends Error {
  status = 400
  constructor(message = 'Autorização inválida ou expirada. Tente conectar novamente.') {
    super(message)
    this.name = 'CalendarStateError'
  }
}

function hmacKey(): Buffer {
  // Domínio separado da chave de cifra: mesma origem, uso diferente.
  return createHmac('sha256', resolveCalendarEncryptionKey(process.env)).update('calendar-oauth-state').digest()
}

function sign(body: string): string {
  return createHmac('sha256', hmacKey()).update(body).digest('base64url')
}

export function signCalendarState(payload: CalendarStatePayload): string {
  const state: SignedState = { ...payload, nonce: randomBytes(12).toString('base64url'), iat: Date.now() }
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyCalendarState(token: string): CalendarStatePayload {
  const [body, signature] = token.split('.')
  if (!body || !signature) throw new CalendarStateError()

  const expected = Buffer.from(sign(body))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new CalendarStateError()
  }

  let parsed: SignedState
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedState
  } catch {
    throw new CalendarStateError()
  }
  if (typeof parsed.iat !== 'number' || Date.now() - parsed.iat > TTL_MS) {
    throw new CalendarStateError()
  }
  return { userId: parsed.userId, companyId: parsed.companyId, provider: parsed.provider }
}
