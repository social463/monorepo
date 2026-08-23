import type { FeedbackDTO } from './feedback'

export interface DevelopmentThursdayEventDTO {
  id: string
  title: string
  description: string
  sprintStart: string
  sprintEnd: string
  eventDate: string
  startTime: string | null
  endTime: string | null
  presenter: {
    id: string
    name: string
    photoUrl: string | null
  }
  createdAt: string
}

export interface DevelopmentThursdaySettingsDTO {
  teamsWebhookUrl: string | null
}

export interface CreateDevelopmentThursdayEventRequest {
  title: string
  description: string
  eventDate?: string
  startTime?: string | null
  endTime?: string | null
  sprintStart?: string
}

export interface UpdateDevelopmentThursdayEventRequest {
  title?: string
  description?: string
  eventDate?: string
  startTime?: string | null
  endTime?: string | null
}

export interface DevelopmentThursdayEventsResponse {
  events: DevelopmentThursdayEventDTO[]
}

export interface DevelopmentThursdayFeedbacksResponse {
  feedbacks: FeedbackDTO[]
  hasMore: boolean
}
