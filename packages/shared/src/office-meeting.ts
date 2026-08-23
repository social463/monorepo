/** Durações oferecidas ao marcar (minutos). `endsAt` é derivado disto. */
export const MEETING_DURATION_MINUTES = [15, 30, 45, 60, 90] as const;
export type MeetingDurationMinutes = (typeof MEETING_DURATION_MINUTES)[number];

/** Antecedência do lembrete in-app/Teams, em minutos. */
export const MEETING_REMINDER_MINUTES = 10;

export const MEETING_TITLE_MAX_LENGTH = 120;
export const MEETING_AGENDA_MAX_LENGTH = 1000;

/**
 * Teto de convidados numa reunião. Não é regra de negócio, é freio de payload:
 * existe para a rota não virar dump. Precisa caber a empresa inteira, que é um
 * clique só no seletor de participantes.
 */
export const MEETING_MAX_PARTICIPANTS = 500;

/** Janela padrão da agenda mostrada na sala, em dias. */
export const MEETING_AGENDA_DAYS_AHEAD = 7;

export interface MeetingPersonDTO {
  id: string;
  name: string;
}

export interface OfficeMeetingDTO {
  id: string;
  roomExternalKey: string;
  /** Nome congelado na criação — o .ics já enviado não muda se renomearem a sala. */
  roomName: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  organizer: MeetingPersonDTO;
  participants: MeetingPersonDTO[];
  /** URLs prontas: o front não monta link de calendário. */
  googleCalendarUrl: string;
  outlookCalendarUrl: string;
  /** Caminho relativo do .ics (baixado por apiFetchBlob, não por navegação). */
  icsPath: string;
}

export interface CreateOfficeMeetingRequest {
  roomExternalKey: string;
  title: string;
  agenda?: string;
  /** ISO 8601. */
  startsAt: string;
  durationMinutes: MeetingDurationMinutes;
  participantIds: string[];
  /** true = criar mesmo com conflito de horário na sala. */
  force?: boolean;
}

export interface UpdateOfficeMeetingRequest {
  title?: string;
  agenda?: string | null;
  startsAt?: string;
  durationMinutes?: MeetingDurationMinutes;
  participantIds?: string[];
  force?: boolean;
}

/** Corpo do 409: as reuniões que colidem com a janela pedida. */
export interface OfficeMeetingConflictResponse {
  message: string;
  conflicts: OfficeMeetingDTO[];
}

/**
 * Deep link da sala: abre o escritório e leva o personagem até ela.
 * Usado no .ics, no CTA do card do Teams e no botão "copiar link".
 */
export function officeRoomDeepLinkPath(externalKey: string): string {
  return `/escritorio?sala=${encodeURIComponent(externalKey)}`;
}
