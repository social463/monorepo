import type { RefreshResponse } from '@legends/shared'

// Access token vive apenas em memória (não em storage) — some no reload e é
// restaurado por refresh silencioso. Refresh token viaja em cookie httpOnly.
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken(): void {
  accessToken = null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload: Record<string, unknown> | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Sessão que morreu de verdade (refresh recusado), avisada para quem cuida do
 * estado de autenticação — hoje o `AuthProvider`, que zera o `user` e deixa o
 * `ProtectedRoute` levar ao login.
 *
 * Sem esse aviso, o token sumia da memória e mais nada acontecia: a tela
 * continuava de pé com os dados que já tinham carregado, e toda ação a partir
 * dali devolvia "Não autorizado" inline, para sempre. Quem estava usando não
 * tinha como saber que precisava entrar de novo.
 */
type SessionExpiredListener = () => void
const sessionExpiredListeners = new Set<SessionExpiredListener>()

/** Assina o aviso de sessão expirada. Devolve a função que cancela a assinatura. */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener)
  return () => {
    sessionExpiredListeners.delete(listener)
  }
}

// Single-flight: refreshes concorrentes compartilham a mesma Promise.
let refreshPromise: Promise<boolean> | null = null

/**
 * `recusado` é o cookie não valer mais (401): a sessão morreu de verdade.
 * `falhou` é tropeço de rede ou do servidor — o cookie continua valendo, e
 * provavelmente o access token em memória também.
 *
 * A distinção não é preciosismo. `/auth/refresh` é a única chamada que bate no
 * banco em fluxos que de resto só verificam o JWT (o presign de upload, por
 * exemplo, é só assinatura local), então é ela que cai sozinha num blip de
 * banco ou de conexão. Zerar o token nesse caso transformava um tropeço de
 * segundos numa sequência de "Não autorizado": a requisição seguinte saía sem
 * `Authorization`, tomava 401 na hora e tentava outro refresh — e assim por
 * diante até a rede voltar. Num envio de álbum, que é sequencial e longo, isso
 * queimava uma foto atrás da outra.
 */
type RefreshOutcome = 'ok' | 'recusado' | 'falhou'

/** Espera curta entre a primeira e a segunda tentativa de refresh. */
const REFRESH_RETRY_DELAY_MS = 600

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runRefresh(): Promise<RefreshOutcome> {
  let res: Response
  try {
    res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
  } catch {
    // Nem chegou a haver resposta: rede caiu. Mantém o token.
    return 'falhou'
  }

  if (res.status === 401 || res.status === 403) {
    // Só avisa quem TINHA sessão nesta aba. Sem token em memória, ou é o
    // bootstrap de quem nunca entrou (o `AuthProvider` já trata, e o aviso
    // seria ruído), ou é uma recusa que já avisou — repetir só faria o
    // `setUser(null)` de novo.
    const tinhaSessao = accessToken !== null
    accessToken = null
    if (tinhaSessao) {
      for (const listener of [...sessionExpiredListeners]) listener()
    }
    return 'recusado'
  }
  if (!res.ok) return 'falhou'

  try {
    const body = (await res.json()) as RefreshResponse
    accessToken = body.accessToken
    return 'ok'
  } catch {
    return 'falhou'
  }
}

async function runRefreshWithRetry(): Promise<boolean> {
  const first = await runRefresh()
  if (first !== 'falhou') return first === 'ok'
  // Só o `falhou` merece segunda tentativa: `recusado` é resposta do servidor
  // dizendo que este cookie acabou, e insistir só atrasaria a ida para o login.
  await delay(REFRESH_RETRY_DELAY_MS)
  return (await runRefresh()) === 'ok'
}

export function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = runRefreshWithRetry().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      // Só declara JSON quando há corpo. Um POST/DELETE sem corpo com
      // Content-Type: application/json é rejeitado pelo Fastify
      // (FST_ERR_CTP_EMPTY_JSON_BODY, 400).
      ...(options.body != null && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  })

  if (
    res.status === 401 &&
    retryOn401 &&
    path !== '/auth/refresh' &&
    path !== '/auth/login'
  ) {
    const ok = await refreshAccessToken()
    if (ok) {
      return apiFetch<T>(path, options, false)
    }
  }

  if (!res.ok) {
    let message = 'Erro inesperado'
    let payload: Record<string, unknown> | null = null
    try {
      const body = (await res.json()) as Record<string, unknown> & { message?: string }
      payload = body
      // Só o 500 tem a mensagem trocada: é o único status que sai de erro não
      // tratado, e o que vinha nele era detalhe de servidor — o stack do Prisma
      // com caminho de arquivo e schema já vazou assim uma vez. O corpo original
      // continua em `payload` para depuração.
      //
      // 502, 503 e 504 continuam passando: são resposta deliberada de rota
      // (`AgentError` sem chave de IA cadastrada, upload sem S3, timeout do
      // provedor), com mensagem em português escrita justamente para a tela.
      if (res.status === 500) message = 'Erro inesperado no servidor. Tente de novo em instantes.'
      else if (body.message) message = body.message
    } catch {
      // resposta sem corpo JSON
    }
    throw new ApiError(res.status, message, payload)
  }

  // 204 No Content (ex: DELETE) não tem corpo — res.json() lançaria SyntaxError.
  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}

/**
 * Baixa um recurso binário/texto puro (ex.: .ics) com o mesmo esquema de auth
 * do `apiFetch`. Existe porque o access token só vive em memória: navegar
 * direto para a URL não mandaria o Authorization e cairia em 401.
 */
export async function apiFetchBlob(
  path: string,
  retryOn401 = true,
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  })

  if (res.status === 401 && retryOn401 && (await refreshAccessToken())) {
    return apiFetchBlob(path, false)
  }
  if (!res.ok) {
    throw new ApiError(res.status, 'Não foi possível baixar o arquivo')
  }

  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  return { blob: await res.blob(), filename: match?.[1] ?? null }
}
