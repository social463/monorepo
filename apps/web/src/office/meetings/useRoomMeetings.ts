import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateOfficeMeetingRequest, UpdateOfficeMeetingRequest } from '@legends/shared'
import { cancelMeeting, createMeeting, fetchRoomMeetings, updateMeeting } from './api'

const roomMeetingsKey = (roomExternalKey: string) => ['office-meetings', roomExternalKey] as const

export function useRoomMeetings(roomExternalKey: string | null) {
  return useQuery({
    queryKey: roomMeetingsKey(roomExternalKey ?? ''),
    queryFn: () => fetchRoomMeetings(roomExternalKey!),
    enabled: roomExternalKey !== null,
  })
}

export function useCreateMeeting(roomExternalKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateOfficeMeetingRequest) => createMeeting(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomMeetingsKey(roomExternalKey) }),
  })
}

export function useUpdateMeeting(roomExternalKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOfficeMeetingRequest }) => updateMeeting(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomMeetingsKey(roomExternalKey) }),
  })
}

export function useCancelMeeting(roomExternalKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelMeeting(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roomMeetingsKey(roomExternalKey) }),
  })
}
