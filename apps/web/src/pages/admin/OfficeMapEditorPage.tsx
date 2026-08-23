import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { MapEditor } from '../../office/editor/MapEditor'

export function OfficeMapEditorPage() {
  const { user } = useAuth()
  const { mapId } = useParams<{ mapId: string }>()
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />
  if (!mapId) return <Navigate to="/admin" replace />
  return <MapEditor mapId={mapId} />
}

