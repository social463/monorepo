// apps/api/src/lib/serialize-retro.test.ts
import { describe, it, expect } from 'vitest'
import { toRetroCardDTO, toRetroRoomDTO, toRetroActionItemDTO, toRetroEditDTO, toRetroCarryoverItemDTO, toRetroTimerDTO, squadLabel } from './serialize'
import type { RetroRoomWithRelations } from '../services/retro-service'

const baseUser = {
  id: 'u1', name: 'Ana', email: 'a@x.com', role: 'LEGEND', position: null, squad: null,
  photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null, active: true,
  passwordHash: 'x', joinedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
} as any

function card(over: Partial<any> = {}) {
  return {
    id: 'c1', roomId: 'r1', authorId: 'u1', text: 'oi', x: 0, y: 0, color: 'yellow',
    createdAt: new Date(), updatedAt: new Date(),
    author: { ...baseUser }, votes: [], reactions: [], ...over,
  } as any
}

describe('serialize retro', () => {
  it('inclui x/y/color; em sala anônima, autor do próprio card não fica mascarado', () => {
    const dto = toRetroCardDTO(card({ x: 10, y: 20, color: 'pink' }), { viewerId: 'u1', anonymous: true })
    // card de u1 visto por u1 → mine=true, masked=false, autor sempre presente
    expect(dto).toMatchObject({ x: 10, y: 20, color: 'pink', kind: 'note', author: { id: 'u1', name: 'Ana' }, mine: true, masked: false })
  })

  it('serializa forma com dimensões e estilo', () => {
    const dto = toRetroCardDTO(card({ kind: 'shape', shape: 'diamond', shapeStyle: 'outline', width: 160, height: 104, color: 'blue' }), { viewerId: 'u1', anonymous: false })
    expect(dto).toMatchObject({ kind: 'shape', shape: 'diamond', shapeStyle: 'outline', width: 160, height: 104, color: 'blue' })
  })

  it('mostra autor em sala identificada', () => {
    const dto = toRetroCardDTO(card(), { viewerId: 'u2', anonymous: false })
    expect(dto.author).toEqual({
      id: 'u1', name: 'Ana', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
    })
    expect(dto.mine).toBe(false)
  })

  it('conta votos totais e os do viewer', () => {
    const dto = toRetroCardDTO(
      card({ votes: [{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }] }),
      { viewerId: 'u1', anonymous: false },
    )
    expect(dto.voteCount).toBe(3)
    expect(dto.myVotes).toBe(2)
  })

  it('room DTO traz TODOS os cards (sem filtro de fase) e sem columnCounts', () => {
    const room = {
      id: 'r1', sprint: 1, squads: [{ squad: { id: 'sq1', name: 'Squad' } }], status: 'OPEN', anonymous: false, votesPerParticipant: 3,
      createdAt: new Date(), concludedAt: null, createdById: 'lead',
      timerMode: 'ELAPSED', timerStatus: 'IDLE', timerDurationSeconds: null, timerStartedAt: null, timerAccumulatedSeconds: 0,
      timerUpdatedAt: new Date('2026-08-04T10:00:00Z'), timerUpdatedBy: null,
      creator: { ...baseUser, id: 'lead', name: 'Lia' },
      participants: [{ userId: 'lead', user: { ...baseUser, id: 'lead', name: 'Lia' } }, { userId: 'u1', user: { ...baseUser } }],
      cards: [card({ id: 'c1', authorId: 'u1' }), card({ id: 'c2', authorId: 'lead' })],
    } as unknown as RetroRoomWithRelations
    const dto = toRetroRoomDTO(room, { id: 'u1' }, 'PARTICIPANT')
    expect(dto.cards.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect((dto as any).columnCounts).toBeUndefined()
    expect(dto.myRemainingVotes).toBe(3)
    expect(dto.timer).toMatchObject({ mode: 'elapsed', status: 'idle', accumulatedSeconds: 0 })
  })

  it('toRetroTimerDTO serializa cronômetro regressivo rodando', () => {
    const dto = toRetroTimerDTO({
      timerMode: 'COUNTDOWN',
      timerStatus: 'RUNNING',
      timerDurationSeconds: 600,
      timerStartedAt: new Date('2026-08-04T10:00:00Z'),
      timerAccumulatedSeconds: 20,
      timerUpdatedAt: new Date('2026-08-04T10:00:00Z'),
      timerUpdatedBy: { id: 'lead', name: 'Lia' },
    } as any, new Date('2026-08-04T10:00:05Z'))
    expect(dto).toEqual({
      mode: 'countdown',
      status: 'running',
      durationSeconds: 600,
      startedAt: '2026-08-04T10:00:00.000Z',
      accumulatedSeconds: 20,
      updatedAt: '2026-08-04T10:00:00.000Z',
      updatedBy: { id: 'lead', name: 'Lia' },
      serverNow: '2026-08-04T10:00:05.000Z',
    })
  })
})

describe('serialize ações', () => {
  const actionCard = {
    id: 'c1', roomId: 'r1', text: 'Daily foi cancelada sem aviso',
    actionPlan: 'Documentar deploy', actionNote: 'Falei com o time', actionDueDate: '2026-07-01',
    actionDone: true, actionDoneAt: new Date('2026-06-25T12:00:00Z'),
    actionArchivedAt: null,
    auditStatus: null,
  } as any

  it('toRetroActionItemDTO monta plano/problema/nota/squad/prazo/done/sprint', () => {
    const dto = toRetroActionItemDTO(actionCard, 23, 'Alpha, Beta')
    expect(dto).toEqual({
      id: 'c1', plan: 'Documentar deploy', problem: 'Daily foi cancelada sem aviso',
      note: 'Falei com o time', dueDate: '2026-07-01', done: true,
      doneAt: '2026-06-25T12:00:00.000Z', archivedAt: null, sprint: 23, squad: 'Alpha, Beta',
      roomId: 'r1', auditStatus: null,
    })
  })

  it('leva a data de arquivamento para o DTO', () => {
    const dto = toRetroActionItemDTO(
      { ...actionCard, actionArchivedAt: new Date('2026-08-14T09:00:00Z') },
      23,
      'Alpha',
    )
    expect(dto.archivedAt).toBe('2026-08-14T09:00:00.000Z')
  })

  it('squadLabel ordena pt-BR e junta com vírgula', () => {
    expect(squadLabel([{ squad: { name: 'Beta' } }, { squad: { name: 'Alpha' } }])).toBe('Alpha, Beta')
    expect(squadLabel([])).toBe('')
  })
})

describe('serialize edição/rastro', () => {
  it('toRetroCardDTO inclui editedBy/editedAt quando presentes', () => {
    const dto = toRetroCardDTO(card({ editedBy: { id: 'u2', name: 'Bia' }, editedById: 'u2', editedAt: new Date('2026-06-26T10:00:00Z') }) as any, { viewerId: 'u1', anonymous: false })
    expect(dto.editedBy).toEqual({ id: 'u2', name: 'Bia' })
    expect(dto.editedAt).toBe('2026-06-26T10:00:00.000Z')
  })

  it('toRetroCardDTO sem edição → editedBy/editedAt nulos', () => {
    const dto = toRetroCardDTO(card() as any, { viewerId: 'u1', anonymous: false })
    expect(dto.editedBy).toBeNull()
    expect(dto.editedAt).toBeNull()
  })

  it('toRetroEditDTO mapeia editor/action/detail/createdAt', () => {
    const edit = { id: 'e1', action: 'action.updated', detail: 'Deploy', createdAt: new Date('2026-06-26T10:00:00Z'), editor: { id: 'u2', name: 'Bia' } } as any
    expect(toRetroEditDTO(edit)).toEqual({ id: 'e1', editor: { id: 'u2', name: 'Bia' }, action: 'action.updated', detail: 'Deploy', createdAt: '2026-06-26T10:00:00.000Z' })
  })
})

describe('serialize carryover', () => {
  const c = { id: 'c1', actionPlan: 'Doc deploy', actionNote: 'Feito parcialmente', actionDueDate: '2026-07-01', auditStatus: null } as any
  const resp = { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null } as any
  it('monta item de validação com responsável, sprint e nota', () => {
    expect(toRetroCarryoverItemDTO(c, resp, 'validate', 5)).toEqual({
      id: 'c1', plan: 'Doc deploy', note: 'Feito parcialmente', dueDate: '2026-07-01',
      responsible: { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
      sprint: 5, type: 'validate', auditStatus: null,
    })
  })
})
