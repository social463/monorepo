export interface SquadDTO {
  id: string
  name: string
  slug: string
  active: boolean
  leaderId: string | null
  sectorId: string
}

export interface SquadMemberDTO {
  id: string
  name: string
}

export interface SquadWithMembersDTO extends SquadDTO {
  leader: SquadMemberDTO | null
  members: SquadMemberDTO[]
}

export interface CreateSquadRequest {
  name: string
  sectorId?: string
}

export interface UpdateSquadRequest {
  name?: string
  active?: boolean
  leaderId?: string | null
  sectorId?: string
}

export interface AddSquadMemberRequest {
  userId: string
}
