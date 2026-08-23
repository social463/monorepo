import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  OFFICE_GUEST_CHARACTER_PRESETS,
  OFFICE_GUEST_INVITE_MAX_MINUTES,
  OFFICE_GUEST_INVITE_MIN_MINUTES,
  OFFICE_GUEST_NAME_MAX_LENGTH,
  type OfficeGuestSessionDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class OfficeGuestInviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'OfficeGuestInviteError'
  }
}

export interface OfficeGuestJwtPayload {
  sub: string
  role: 'GUEST'
  // Convidado é sector-agnostic (não é um User real) — sectorId é fixo só para
  // satisfazer a forma do payload do JWT, não é lido em lugar nenhum. companyId
  // JÁ É lido: é a empresa dona do convite (invite.companyId), usada pra resolver
  // o mapa/config certos sem round-trip extra ao banco (GET /office/guest-map,
  // branch de broadcast de POST /office/media-token).
  sectorId: ''
  companyId: string
  features: []
  guest: true
  name: string
  presetId: string
  inviteId: string
}

export function hashOfficeGuestToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url')
}

function clampDuration(minutes: number): number {
  return Math.min(OFFICE_GUEST_INVITE_MAX_MINUTES, Math.max(OFFICE_GUEST_INVITE_MIN_MINUTES, minutes))
}

export async function createOfficeGuestInvite(createdById: string, expiresInMinutes: number, companyId: string) {
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await scopedPrisma(companyId).officeGuestInvite.create({
    data: {
      tokenHash: hashOfficeGuestToken(rawToken),
      createdById,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'OfficeGuestInvite', entityId: invite.id, action: 'CREATE', after: invite, companyId })
  return { invite, rawToken }
}

// Sem `companyId`, de propósito: o convidado que chega aqui ainda não provou pertencer a
// nenhuma empresa (não tem sessão) — o único jeito de saber a que empresa o convite pertence
// é achando a linha pelo hash do token. `invite.companyId` (herdado do admin que criou o
// convite) é o que as sub-fatias seguintes usam pra resolver o mapa certo pro convidado.
export async function getValidOfficeGuestInvite(rawToken: string) {
  const invite = await prisma.officeGuestInvite.findUnique({
    where: { tokenHash: hashOfficeGuestToken(rawToken) },
  })
  if (!invite || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new OfficeGuestInviteError('Convite expirado ou inválido', 404)
  }
  return invite
}

export async function issueOfficeGuestSession(
  app: FastifyInstance,
  input: { token: string; name: string; presetId: string },
): Promise<OfficeGuestSessionDTO> {
  const invite = await getValidOfficeGuestInvite(input.token)
  const name = input.name.trim().slice(0, OFFICE_GUEST_NAME_MAX_LENGTH)
  if (!name) throw new OfficeGuestInviteError('Informe o nome do convidado')
  const preset = OFFICE_GUEST_CHARACTER_PRESETS.find((candidate) => candidate.id === input.presetId)
  if (!preset) throw new OfficeGuestInviteError('Personagem inválido')

  const expiresInSeconds = Math.max(1, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000))
  const guest = {
    id: `guest:${randomUUID()}`,
    name,
    presetId: preset.id,
    avatarSeed: preset.seed,
    avatarOptions: preset.options,
  }
  const payload: OfficeGuestJwtPayload = {
    sub: guest.id,
    role: 'GUEST',
    sectorId: '',
    companyId: invite.companyId,
    features: [],
    guest: true,
    name,
    presetId: preset.id,
    inviteId: invite.id,
  }

  return {
    token: app.jwt.sign(payload, { expiresIn: expiresInSeconds }),
    expiresAt: invite.expiresAt.toISOString(),
    guest,
  }
}

export function isOfficeGuestPayload(value: unknown): value is OfficeGuestJwtPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Partial<OfficeGuestJwtPayload>
  return payload.guest === true && payload.role === 'GUEST' && typeof payload.sub === 'string'
    && typeof payload.name === 'string' && typeof payload.presetId === 'string'
}
