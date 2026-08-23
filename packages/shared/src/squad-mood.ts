import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { MoodLevel } from './mood'

// `day` em YYYY-MM-DD (data civil em America/Sao_Paulo).
export interface MoodSnapshotDTO {
  day: string
  mood: MoodLevel
  note: string | null
}

export interface SquadMemberMoodDTO {
  id: string
  name: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  // Humor mais recente registrado pela pessoa (null se nunca registrou).
  currentMood: MoodSnapshotDTO | null
}

export interface LedSquadMoodsDTO {
  squadId: string
  squadName: string
  members: SquadMemberMoodDTO[]
}

export interface MoodHistoryEntryDTO {
  day: string
  mood: MoodLevel
  note: string | null
}

export interface MoodHistoryPageDTO {
  entries: MoodHistoryEntryDTO[]
  nextCursor: string | null
}
