import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOfficeDeskReminder, getOfficeDeskReminder, markOfficeDeskReminderRead } from './office-desk-reminder-api'

describe('office-desk-reminder-api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({
        reminder: {
          id: 'r1',
          deskId: 'd1',
          deskExternalKey: 'mesa-1',
          giftPosition: { x: 0.5, y: 0.25 },
          sender: { id: 'ana', name: 'Ana' },
          recipientId: 'bruno',
          createdAt: new Date(0).toISOString(),
          message: 'Oi',
          canRead: true,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  })

  it('createOfficeDeskReminder chama POST /office/desks/:id/reminders', async () => {
    await createOfficeDeskReminder('d1', 'Oi', { x: 0.5, y: 0.25 })
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desks/d1/reminders')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ message: 'Oi', giftPosition: { x: 0.5, y: 0.25 } }))
  })

  it('getOfficeDeskReminder chama GET /office/desk-reminders/:id', async () => {
    await getOfficeDeskReminder('r1')
    const [url] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desk-reminders/r1')
  })

  it('markOfficeDeskReminderRead chama POST /office/desk-reminders/:id/read sem corpo', async () => {
    await markOfficeDeskReminderRead('r1')
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('/api/office/desk-reminders/r1/read')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })
})
