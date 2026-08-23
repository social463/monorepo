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

// Single-flight: refreshes concorrentes compartilham a mesma Promise.
let refreshPromise: Promise<boolean> | null = null

async function runRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      accessToken = null
      return false
    }
    const body = (await res.json()) as RefreshResponse
    accessToken = body.accessToken
    return true
  } catch {
    accessToken = null
    return false
  }
}

export function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = runRefresh().finally(() => {
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
