import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthResponse, PublicUser } from '@legends/shared'
import {
  apiFetch,
  setAccessToken,
  clearAccessToken,
  refreshAccessToken,
  onSessionExpired,
} from '../lib/api'
import { identifyAnalytics } from '../lib/analytics'

interface AuthContextValue {
  user: PublicUser | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => void
  setUser: (user: PublicUser) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Bootstrap: tenta restaurar a sessão via cookie de refresh.
    refreshAccessToken().then(async (ok) => {
      if (!ok) {
        setLoading(false)
        return
      }
      try {
        const res = await apiFetch<{ user: PublicUser }>('/auth/me')
        setUser(res.user)
      } catch {
        clearAccessToken()
      } finally {
        setLoading(false)
      }
    })
  }, [])

  // Sessão recusada pelo servidor em pleno uso (cookie de refresh expirado,
  // revogado por troca de papel, ou família derrubada por reuso): zerar o
  // `user` é o que faz o `ProtectedRoute` levar ao login. Sem isto a tela ficava
  // de pé respondendo "Não autorizado" a cada ação, sem caminho de volta.
  useEffect(() => onSessionExpired(() => setUser(null)), [])

  // Empresa e setor viram user properties no GA4 — é o que permite segmentar
  // qualquer relatório por tenant. Depende dos campos, não da identidade do
  // objeto `user`: um novo objeto com os mesmos dados não precisa reidentificar.
  useEffect(() => {
    identifyAnalytics(user)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.companyId, user?.sectorId, user?.role])

  async function login(email: string, password: string, remember = false) {
    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }

  function logout() {
    // Revoga a família no servidor em segundo plano; limpa o estado já.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
    clearAccessToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }
  return ctx
}
