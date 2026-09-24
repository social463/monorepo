import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isLeaderRole,
  mapZoneAtTile,
  claimedDeskInMeetingRoom,
  type ActiveOfficeMapDTO,
  type OfficeConfigDTO,
  type OfficeBall,
  type OfficeKart,
  type OfficeOccupant,
  type OfficeUserStatus,
  TILE_SIZE,
  tileOfPixel,
} from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { clearOfficeGuestSession, readOfficeGuestSession } from '../../lib/officeGuestSession'
import { setOfficeSilenced } from '../../lib/office-silence'
import { OfficeBridge } from '../OfficeBridge'
import { useOfficeSocket } from '../useOfficeSocket'
import { useOfficeMedia, type OfficeMediaState } from '../media/useOfficeMedia'
import { useOfficeBroadcast, type OfficeBroadcastState } from '../media/useOfficeBroadcast'
import { useCameraBackground, type CameraBackgroundState } from '../media/useCameraBackground'
import { useMediaDevices, type MediaDevicesState } from '../media/useMediaDevices'
import { readDevicePreference, writeDevicePreference } from '../media/devicePreferences'
import { RemoteAudio } from '../media/RemoteAudio'
import { SpatialRemoteAudio } from '../media/SpatialRemoteAudio'
import { mapMessageEffect } from './mapMessage'
import { useRoomChat, type RoomChatState } from '../media/useRoomChat'
import { useRaisedHands, type RaisedHandsState } from '../media/useRaisedHands'
import { useRoomLock, type RoomLockState } from '../media/useRoomLock'
import { useRoomModeration, type RoomModerationState } from '../media/useRoomModeration'
import { useRoomAudio, type RoomAudioState } from '../media/useRoomAudio'
import { RoomAudioPlayer } from '../media/RoomAudioPlayer'
import {
  useRemoteUserVolumePreferences,
  type RemoteUserVolumeControls,
} from '../media/remoteUserVolumePreferences'

const OFFICE_CONFIG_REFETCH_MS = 5000

export type OfficeSessionStatus = 'idle' | 'active'

export interface OfficeSessionValue {
  status: OfficeSessionStatus
  enterOffice(): void
  leaveOffice(): void
  exitOffice(): void
  bridge: OfficeBridge
  activeMap: ActiveOfficeMapDTO | null
  activeMapLoading: boolean
  occupants: OfficeOccupant[]
  karts: OfficeKart[]
  balls: OfficeBall[]
  youId: string | null
  connected: boolean
  /** Quem mais está com o modo de edição do mapa ligado agora (espelho do bridge, Task 8). */
  editorUserIds: string[]
  isGuest: boolean
  media: OfficeMediaState
  broadcast: OfficeBroadcastState
  canBroadcast: boolean
  cameraBackground: CameraBackgroundState
  devices: MediaDevicesState
  audioOutputDeviceId: string | null
  setAudioOutputDevice(deviceId: string | null): void
  remoteUserVolumes: RemoteUserVolumeControls
  roomChat: RoomChatState
  raisedHands: RaisedHandsState
  roomLock: RoomLockState
  /** Quem manda em cada sala e a remoção de participante da chamada. */
  roomModeration: RoomModerationState
  roomAudio: RoomAudioState
  /** Troca manual do próprio status de presença (online/away/brb) — só da sessão. */
  setUserStatus(status: OfficeUserStatus): void
  /** Troca o alias exibido acima do próprio personagem no mapa. */
  setCharacterName(name: string): void
  leaveGuestSession(): void
}

const OfficeSessionContext = createContext<OfficeSessionValue | null>(null)

export function useOfficeSession(): OfficeSessionValue {
  const value = useContext(OfficeSessionContext)
  if (!value) throw new Error('useOfficeSession precisa estar dentro de <OfficeSessionProvider>')
  return value
}

/**
 * Dono da SESSÃO do escritório — bridge, WebSocket, mídia (LiveKit) e os
 * elementos de áudio. Vive acima das rotas para o escritório sobreviver à
 * navegação: sair da página minimiza (PiP); só `leaveOffice` desconecta.
 * O Phaser NÃO mora aqui — canvas é criado/destruído pela OfficePage.
 */
export function OfficeSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OfficeSessionStatus>('idle')
  const [bridge, setBridge] = useState(() => new OfficeBridge())
  const [guestSession, setGuestSession] = useState(readOfficeGuestSession)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const active = status === 'active'
  const guestToken = user ? null : (guestSession?.token ?? null)
  const isGuest = guestToken !== null

  const enterOffice = useCallback(() => setStatus('active'), [])
  const leaveOffice = useCallback(() => {
    setStatus('idle')
    // Bridge novo por sessão: o snapshot (ocupantes, youId) da sessão
    // encerrada não pode vazar para a próxima.
    setBridge(new OfficeBridge())
  }, [])
  const exitOffice = useCallback(() => {
    bridge.emitClientMessage({ type: 'leave-office' })
    leaveOffice()
  }, [bridge, leaveOffice])

  const activeMapQuery = useQuery({
    queryKey: ['office', 'active-map', isGuest ? 'guest' : 'member'],
    queryFn: () =>
      isGuest
        ? apiFetch<ActiveOfficeMapDTO>('/office/guest-map', { headers: { Authorization: `Bearer ${guestToken}` } })
        : apiFetch<ActiveOfficeMapDTO>('/office/map'),
    enabled: active,
  })
  const activeMap = (active ? activeMapQuery.data : null) ?? null

  const { occupants, youId, connected, editorUserIds, karts, balls } = useOfficeSocket(
    bridge,
    active ? (activeMap?.map.id ?? null) : null,
    guestToken,
  )
  const media = useOfficeMedia(
    occupants,
    youId,
    connected,
    activeMap?.document ?? null,
    active ? (activeMap?.map.id ?? null) : null,
    bridge,
    guestToken,
  )

  // Fundo virtual mora na SESSÃO (não na página): no PiP a câmera pode ser
  // religada com a OfficePage desmontada, e o track novo precisa receber o
  // processor de volta — o effect declarativo do hook cuida disso daqui.
  const cameraBackground = useCameraBackground(media.localCameraTrack)

  const devices = useMediaDevices()
  const [audioOutputDeviceId, setAudioOutputDeviceIdState] = useState<string | null>(() =>
    readDevicePreference('audioOutput'),
  )
  const setAudioOutputDevice = useCallback((deviceId: string | null) => {
    writeDevicePreference('audioOutput', deviceId)
    setAudioOutputDeviceIdState(deviceId)
  }, [])
  const remoteUserVolumes = useRemoteUserVolumePreferences()

  // Interruptor de custo do admin: fail-closed — sem config, sem broadcast.
  const { data: officeConfig } = useQuery({
    queryKey: ['office', 'config'],
    queryFn: () => apiFetch<OfficeConfigDTO>('/office/config'),
    refetchInterval: OFFICE_CONFIG_REFETCH_MS,
    refetchIntervalInBackground: true,
    enabled: active && !isGuest,
  })
  const you = occupants.find((o) => o.userId === youId) ?? null
  // Áudio espacial só no espaço aberto — em zonas a sala já é isolada
  // (autoSubscribe) e o pan por posição não se aplica.
  const isOpenRoom = media.roomName !== null && media.roomName === media.openRoom
  // `mapZoneAtTile` recebe TILE; o occupant fala pixel desde o movimento livre.
  // Passar pixel aqui não dá erro — dá zona nenhuma, e a sala de reunião deixa
  // de existir para quem está dentro dela (some a tranca, o chat, o áudio e a
  // moderação de uma vez).
  const tileSize = activeMap?.document.map.tileWidth ?? TILE_SIZE
  const youTile = you ? tileOfPixel(you, tileSize) : null
  const currentZone =
    youTile && activeMap ? mapZoneAtTile(activeMap.document, youTile.x, youTile.y) : null
  // Portão de som: liga assim que você pisa na sala de silêncio, desliga ao
  // sair. Fica aqui porque é a camada que sabe a sua zona; quem consome são os
  // emissores de som, inclusive a cena Phaser (ver `lib/office-silence`).
  const inSilenceZone = currentZone?.type === 'private-zone'
  useEffect(() => {
    setOfficeSilenced(inSilenceZone)
    // Sair do escritório (desmontar) tem que devolver o som — senão a
    // preferência de uma sessão vaza para a próxima tela que bipar.
    return () => setOfficeSilenced(false)
  }, [inSilenceZone])
  const currentRoom =
    currentZone?.type === 'meeting-room'
      ? activeMap?.rooms.find((room) => room.externalKey === currentZone.properties.externalKey) ?? null
      : null
  const claimedDeskInCurrentRoom =
    currentZone?.type === 'meeting-room' && activeMap
      ? claimedDeskInMeetingRoom(activeMap.document, activeMap.desks, currentZone.properties.externalKey)
      : null
  const canControlRoomLock = !claimedDeskInCurrentRoom || claimedDeskInCurrentRoom.claimedBy?.id === youId
  // Sala de reunião OU zona privada ("espaço de conversa") — mesma dupla que
  // o servidor aceita pra levantar a mão (ver `raiseHandZoneIdAtTile` no
  // OfficeHub). Zona privada não tem Room no banco, então usa o mesmo id
  // ad-hoc da sala de áudio por proximidade: externalKey, ou o id do objeto
  // se ela não tiver externalKey.
  const raiseHandZoneIdAtTile =
    currentZone?.type === 'meeting-room'
      ? (currentRoom?.id ?? null)
      : currentZone?.type === 'private-zone'
        ? (currentZone.properties.externalKey ?? currentZone.id)
        : null
  const roomChat = useRoomChat(
    bridge,
    currentRoom?.id ?? null,
    you ? { userId: you.userId, name: you.name } : null,
    connected,
  )
  const raisedHands = useRaisedHands(bridge, raiseHandZoneIdAtTile, youId, connected, media.localSpeaking)
  // Só sala de reunião (não zona privada): a tranca depende de um `Room` de
  // verdade, que é o que o servidor usa pra decidir quem entra.
  const roomLock = useRoomLock(bridge, currentRoom?.id ?? null, youId, connected, canControlRoomLock)
  // Só sala de reunião, como a tranca: a faixa é da sala, e zona privada não tem `Room`.
  const roomAudio = useRoomAudio(bridge, currentRoom?.id ?? null, youId, connected, isGuest)
  // Convidado nunca modera: a sala é da empresa, não de quem entrou por link.
  const roomModeration = useRoomModeration(
    bridge,
    currentRoom?.id ?? null,
    youId,
    connected,
    !isGuest && user?.role === 'ADMIN',
  )
  const setUserStatus = useCallback(
    (status: OfficeUserStatus) => bridge.emitClientMessage({ type: 'set-status', status }),
    [bridge],
  )
  const setCharacterName = useCallback(
    (name: string) => bridge.emitClientMessage({ type: 'set-character-name', name }),
    [bridge],
  )
  const canBroadcast = !isGuest && isLeaderRole(user?.role)
  const broadcast = useOfficeBroadcast({
    enabled: active && (officeConfig?.broadcastEnabled ?? false) && connected && you !== null,
    micEnabled: media.micEnabled,
    setMicEnabled: media.applyMicEnabled,
    youName: user?.name ?? null,
  })

  // map-changed: na página, recarrega (comportamento original da OfficePage);
  // minimizado, encerra a sessão — voltar reconecta já no mapa novo.
  // map-decor-updated: evento leve — só refaz o fetch do mapa ativo, sem
  // derrubar LiveKit nem reposicionar (decisão em mapMessageEffect, pura/testável).
  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type === 'desk-reminder-created' || message.type === 'desk-reminder-read') {
          queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })
        }
        const onOfficePage = window.location.pathname === '/escritorio'
        switch (mapMessageEffect(message, onOfficePage, bridge.isEditingDirty())) {
          case 'reload':
            window.location.reload()
            break
          case 'leave':
            leaveOffice()
            break
          case 'refetch':
            queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })
            break
          case 'defer':
            // Chegou um `map-decor-updated` com `editingDirty` ainda `true` —
            // provavelmente o broadcast do PRÓPRIO Salvar, correndo à frente
            // do React propagar `dirty: false`. `bridge` dispara o refetch
            // pendente assim que a edição deixar de estar suja (ver o efeito
            // logo abaixo e `OfficeBridge.setEditingDirty`).
            bridge.deferDecorRefetch()
            break
          case 'ignore':
            break
        }
      }),
    [bridge, leaveOffice, queryClient],
  )

  // Refetch que ficou pendente de um `map-decor-updated` recebido durante uma
  // edição suja (ver o `case 'defer'` acima) — dispara assim que
  // `setEditingDirty(false)` roda (OfficePage, ao salvar/fechar a edição).
  useEffect(
    () => bridge.onDecorRefetchAvailable(() => queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })),
    [bridge, queryClient],
  )

  useEffect(() => {
    const sync = () => setGuestSession(readOfficeGuestSession())
    window.addEventListener('office-guest-session-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('office-guest-session-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const leaveGuestSession = useCallback(() => {
    clearOfficeGuestSession()
    setGuestSession(null)
    leaveOffice()
  }, [leaveOffice])

  // Vencimento do convite: sem isso, o token só para de funcionar no
  // servidor (401 na próxima reconexão) — a aba fica presa "desconectada",
  // sem explicação. Agenda a saída pro exato instante de expiresAt e manda
  // pra tela que já sabe explicar "seu acesso temporário expirou".
  useEffect(() => {
    if (!guestSession) return
    const msLeft = new Date(guestSession.expiresAt).getTime() - Date.now()
    const expire = () => {
      leaveGuestSession()
      navigate('/convidado/obrigado', { replace: true })
    }
    if (msLeft <= 0) {
      expire()
      return
    }
    const timer = setTimeout(expire, msLeft)
    return () => clearTimeout(timer)
  }, [guestSession, leaveGuestSession, navigate])

  // Logout derruba a sessão normal; convidado sem usuário continua enquanto o token existir.
  useEffect(() => {
    if (active && !user && !guestToken) leaveOffice()
  }, [active, user, guestToken, leaveOffice])

  const value = useMemo<OfficeSessionValue>(
    () => ({
      status,
      enterOffice,
      leaveOffice,
      exitOffice,
      bridge,
      activeMap,
      activeMapLoading: active && activeMapQuery.isLoading,
      occupants,
      karts,
      balls,
      youId,
      connected,
      editorUserIds,
      isGuest,
      media,
      broadcast,
      canBroadcast,
      cameraBackground,
      devices,
      audioOutputDeviceId,
      setAudioOutputDevice,
      remoteUserVolumes,
      roomChat,
      raisedHands,
      roomLock,
      roomModeration,
      roomAudio,
      setUserStatus,
      setCharacterName,
      leaveGuestSession,
    }),
    [
      status,
      enterOffice,
      leaveOffice,
      exitOffice,
      bridge,
      activeMap,
      active,
      activeMapQuery.isLoading,
      occupants,
      karts,
      balls,
      youId,
      connected,
      editorUserIds,
      isGuest,
      media,
      broadcast,
      canBroadcast,
      cameraBackground,
      devices,
      audioOutputDeviceId,
      setAudioOutputDevice,
      remoteUserVolumes,
      roomChat,
      raisedHands,
      roomLock,
      roomModeration,
      roomAudio,
      setUserStatus,
      setCharacterName,
      leaveGuestSession,
    ],
  )

  return (
    <OfficeSessionContext.Provider value={value}>
      {/* Áudio vive no provider (não na página): continua tocando no PiP e
          nunca duplica — MediaTiles/BroadcastBanner só cuidam do visual. */}
      {media.remotes.map((r) => {
        if (!r.audioTrack) return null
        const remoteOccupant = isOpenRoom ? occupants.find((o) => o.userId === r.userId) : undefined
        const volume = remoteUserVolumes.getUserVolume(r.userId) / 100
        if (isOpenRoom && you && remoteOccupant) {
          return (
            <SpatialRemoteAudio
              key={`a-${r.userId}`}
              track={r.audioTrack}
              you={you}
              occupant={remoteOccupant}
              // A régua do ganho e do pan é a MESMA que resolve a sua zona logo
              // acima: o grafo raciocina em tile e o occupant fala pixel.
              tileWidth={tileSize}
              tileHeight={activeMap?.document.map.tileHeight ?? TILE_SIZE}
              outputDeviceId={audioOutputDeviceId}
              volume={volume}
            />
          )
        }
        return <RemoteAudio key={`a-${r.userId}`} track={r.audioTrack} outputDeviceId={audioOutputDeviceId} volume={volume} />
      })}
      {media.remotes.map(
        (r) =>
          r.screenAudioTrack && (
            <RemoteAudio
              key={`sa-${r.userId}`}
              track={r.screenAudioTrack}
              outputDeviceId={audioOutputDeviceId}
              volume={remoteUserVolumes.getUserVolume(r.userId) / 100}
            />
          ),
      )}
      {broadcast.broadcastTracks.map((track, index) => (
        <RemoteAudio key={track.sid ?? `b-${index}`} track={track} outputDeviceId={audioOutputDeviceId} />
      ))}
      {/* Mesma razão dos áudios acima: no provider ele sobrevive ao PiP. O
          volume é local de quem ouve, então o `audioOutputDeviceId` não se
          aplica — iframe de terceiro não aceita `setSinkId`. */}
      {roomAudio.track && (
        <RoomAudioPlayer
          track={roomAudio.track}
          onStop={roomAudio.stop}
          onSetPaused={roomAudio.setPaused}
          onAdvanceItem={roomAudio.advanceItem}
          // Fora do escritório o `OfficePipWindow` aparece e briga pela mesma
          // quina; a rota é sabida aqui, não dentro do player.
          outsideOffice={location.pathname !== '/escritorio'}
        />
      )}
      {children}
    </OfficeSessionContext.Provider>
  )
}
