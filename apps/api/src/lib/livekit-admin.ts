import { RoomServiceClient } from 'livekit-server-sdk'
import { resolveLivekitConfig } from './config'

/**
 * A URL configurada é a que os NAVEGADORES usam (`ws://`/`wss://`), mas a API
 * de administração do LiveKit é HTTP — mesma origem, outro esquema.
 */
function httpUrlFrom(url: string): string {
  return url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:')
}

let client: RoomServiceClient | null = null

function adminClient(): RoomServiceClient {
  if (!client) {
    const { apiKey, apiSecret, url } = resolveLivekitConfig(process.env)
    client = new RoomServiceClient(httpUrlFrom(url), apiKey, apiSecret)
  }
  return client
}

/**
 * Derruba a mídia de alguém numa sala do LiveKit. Usado pela remoção de
 * participante: sem isto, tirar a pessoa só do estado do servidor não cortaria
 * áudio nem vídeo — quem já está conectado continua publicando até o token
 * expirar.
 *
 * **Best-effort, como a avaliação de selos pós-voto:** falha aqui é logada e
 * não derruba a operação. Quem garante que a pessoa não volta é o gate do
 * token (`isRemovedFromRoom`), que não depende do LiveKit responder.
 */
export async function removeLivekitParticipant(room: string, identity: string): Promise<void> {
  try {
    await adminClient().removeParticipant(room, identity)
  } catch (error) {
    console.error('[livekit] falha ao remover participante', { room, identity, error })
  }
}
