import { describe, expect, it } from 'vitest'
import { buildGoogleCalendarUrl, buildMeetingIcs, buildOutlookCalendarUrl, type CalendarMeeting } from './calendar-export'

const meeting: CalendarMeeting = {
  id: 'mtg1',
  title: 'Planning do time',
  agenda: 'Fechar escopo; revisar riscos',
  roomName: 'Aurora',
  roomExternalKey: 'aurora',
  startsAt: new Date('2026-07-30T17:00:00.000Z'),
  endsAt: new Date('2026-07-30T18:00:00.000Z'),
  sequence: 0,
  canceled: false,
  organizer: { name: 'Ana', email: 'ana@x.com' },
  participants: [{ name: 'Bruno', email: 'bruno@x.com' }],
}

describe('buildGoogleCalendarUrl', () => {
  it('usa o template do Google com a janela em UTC compacto', () => {
    const url = new URL(buildGoogleCalendarUrl(meeting))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Planning do time')
    expect(url.searchParams.get('dates')).toBe('20260730T170000Z/20260730T180000Z')
    expect(url.searchParams.get('location')).toBe('Sala Aurora — Legends')
    expect(url.searchParams.get('details')).toContain('/escritorio?sala=aurora')
  })
})

describe('buildOutlookCalendarUrl', () => {
  it('usa o deeplink de compose do Outlook com datas ISO', () => {
    const url = new URL(buildOutlookCalendarUrl(meeting))
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/calendar/0/deeplink/compose')
    expect(url.searchParams.get('rru')).toBe('addevent')
    expect(url.searchParams.get('subject')).toBe('Planning do time')
    expect(url.searchParams.get('startdt')).toBe('2026-07-30T17:00:00.000Z')
    expect(url.searchParams.get('enddt')).toBe('2026-07-30T18:00:00.000Z')
  })
})

describe('buildMeetingIcs', () => {
  const ics = buildMeetingIcs(meeting, new Date('2026-07-29T12:00:00.000Z'))

  it('emite um VEVENT completo com UID estável e METHOD:REQUEST', () => {
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('UID:mtg1@legends.eumedicoresidente.com.br')
    expect(ics).toContain('SEQUENCE:0')
    expect(ics).toContain('DTSTAMP:20260729T120000Z')
    expect(ics).toContain('DTSTART:20260730T170000Z')
    expect(ics).toContain('DTEND:20260730T180000Z')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('ORGANIZER;CN=Ana:mailto:ana@x.com')
    expect(ics).toContain('ATTENDEE;CN=Bruno;RSVP=TRUE:mailto:bruno@x.com')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapa ponto-e-vírgula e vírgula do texto livre', () => {
    expect(ics).toContain('Fechar escopo\\; revisar riscos')
  })

  it('separa linhas com CRLF e dobra as maiores que 75 octetos', () => {
    const lines = ics.split('\r\n')
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75)
    }
    // Continuação de linha dobrada começa com um espaço.
    expect(ics).toMatch(/\r\n /)
  })

  it('cancelada vira METHOD:CANCEL com STATUS:CANCELLED', () => {
    const canceled = buildMeetingIcs({ ...meeting, canceled: true, sequence: 1 }, new Date('2026-07-29T12:00:00.000Z'))
    expect(canceled).toContain('METHOD:CANCEL')
    expect(canceled).toContain('STATUS:CANCELLED')
    expect(canceled).toContain('SEQUENCE:1')
  })

  it('nomes com vírgula e ponto-e-vírgula usam quoted-string no CN', () => {
    const withSpecialNames = buildMeetingIcs(
      {
        ...meeting,
        organizer: { name: 'Silva, João', email: 'silva@x.com' },
        participants: [{ name: 'Souza; Maria', email: 'souza@x.com' }],
      },
      new Date('2026-07-29T12:00:00.000Z'),
    )
    expect(withSpecialNames).toContain('ORGANIZER;CN="Silva, João":mailto:silva@x.com')
    expect(withSpecialNames).toContain('ATTENDEE;CN="Souza; Maria";RSVP=TRUE:mailto:souza@x.com')
    // Não deve conter barra invertida nas linhas de CN
    const lines = withSpecialNames.split('\r\n')
    for (const line of lines) {
      if (line.startsWith('ORGANIZER;CN=') || line.startsWith('ATTENDEE;CN=')) {
        expect(line).not.toContain('\\')
      }
    }
  })
})
