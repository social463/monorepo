import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { AppShellSkeleton } from '../components/Skeleton'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return <AppShellSkeleton />
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
