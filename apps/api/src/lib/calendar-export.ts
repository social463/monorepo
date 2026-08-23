/**
 * Exportação de uma reunião para as agendas externas. Três destinos, um
 * formato cada, todos puros (sem I/O, sem Prisma) — é o único lugar do repo
 * que conhece o formato do iCalendar e das URLs de template.
 */
import { officeRoomDeepLinkPath } from '@legends/shared'
import { absoluteUrl } from './app-url'

export interface CalendarMeeting {
  id: string
  title: string
  agenda: string | null
  roomName: string
  roomExternalKey: string
  startsAt: Date
  endsAt: Date
  sequence: number
  canceled: boolean
  organizer: { name: string; email: string }
  participants: Array<{ name: string; email: string }>
}

const CRLF = '\r\n'
const UID_DOMAIN = 'legends.eumedicoresidente.com.br'

/** `2026-07-30T17:00:00.000Z` → `20260730T170000Z`. */
function icsUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
}

/** Escaping de texto livre do RFC 5545: `\`, `;`, `,` e quebra de linha. */
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/**
 * Escaping de valor de parâmetro do RFC 5545 (§3.2). Diferente do texto
 * livre: se o valor contém `,`, `;`, `:` ou `"`, precisa ser quoted-string
 * (envolvido em aspas duplas). Barra invertida não é caractere válido em
 * paramtext. Aspas duplas dentro do valor são removidas (ou substituídas por
 * aspas simples) porque não há escape possível — é requisito da RFC.
 */
function icsParameterValue(value: string): string {
  if (/[,;:"]/.test(value)) {
    return `"${value.replace(/"/g, "'")}"` // remove " e substitui por '
  }
  return value
}

/**
 * Folding do RFC 5545: nenhuma linha passa de 75 octetos; a continuação
 * começa com um espaço. Corta em fronteira de code point pra não partir
 * caractere multibyte (acento, emoji) no meio.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // as seguintes perdem 1 octeto para o espaço inicial
  }
  return parts.join(`${CRLF} `)
}

/** Endereço público da sala — o que o convite abre. */
function meetingUrl(meeting: CalendarMeeting): string {
  return absoluteUrl(officeRoomDeepLinkPath(meeting.roomExternalKey))
}

function meetingLocation(meeting: CalendarMeeting): string {
  return `Sala ${meeting.roomName} — Legends`
}

/** Corpo em texto: pauta (se houver) + link da sala. */
function meetingDescription(meeting: CalendarMeeting): string {
  const url = meetingUrl(meeting)
  return meeting.agenda ? `${meeting.agenda}\n\nEntrar na sala: ${url}` : `Entrar na sala: ${url}`
}

export function buildGoogleCalendarUrl(meeting: CalendarMeeting): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${icsUtc(meeting.startsAt)}/${icsUtc(meeting.endsAt)}`,
    details: meetingDescription(meeting),
    location: meetingLocation(meeting),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function buildOutlookCalendarUrl(meeting: CalendarMeeting): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: meeting.title,
    startdt: meeting.startsAt.toISOString(),
    enddt: meeting.endsAt.toISOString(),
    body: meetingDescription(meeting),
    location: meetingLocation(meeting),
  })
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`
}

/**
 * Arquivo iCalendar da reunião. É o que coloca o evento no Outlook/Teams.
 * O UID é estável por reunião e o SEQUENCE sobe a cada edição — sem isso o
 * cliente de calendário ignora a atualização e o convidado fica com o
 * horário velho.
 */
export function buildMeetingIcs(meeting: CalendarMeeting, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Legends//Escritorio//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${meeting.canceled ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${meeting.id}@${UID_DOMAIN}`,
    `SEQUENCE:${meeting.sequence}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(meeting.startsAt)}`,
    `DTEND:${icsUtc(meeting.endsAt)}`,
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(meetingDescription(meeting))}`,
    `LOCATION:${icsEscape(meetingLocation(meeting))}`,
    `URL:${meetingUrl(meeting)}`,
    `STATUS:${meeting.canceled ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${icsParameterValue(meeting.organizer.name)}:mailto:${meeting.organizer.email}`,
    ...meeting.participants.map(
      (p) => `ATTENDEE;CN=${icsParameterValue(p.name)};RSVP=TRUE:mailto:${p.email}`,
    ),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}
