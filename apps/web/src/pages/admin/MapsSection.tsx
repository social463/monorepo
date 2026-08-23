import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminUserDTO,
  MapTileSize,
  OfficeMapSummaryDTO,
  OfficeRoomDTO,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Select } from '../../components/Select'

const MAPS_KEY = ['admin', 'office-maps'] as const
const ROOMS_KEY = ['admin', 'office-rooms'] as const

export function MapsSection() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [mapTileSize, setMapTileSize] = useState('32')
  const [roomAccessPolicy, setRoomAccessPolicy] = useState<Record<string, string>>({})

  const mapsQuery = useQuery({
    queryKey: MAPS_KEY,
    queryFn: () => apiFetch<{ maps: OfficeMapSummaryDTO[] }>('/admin/office-maps'),
  })
  const roomsQuery = useQuery({
    queryKey: ROOMS_KEY,
    queryFn: () => apiFetch<{ rooms: OfficeRoomDTO[] }>('/admin/office-rooms'),
  })
  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/users'),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MAPS_KEY })
    void queryClient.invalidateQueries({ queryKey: ROOMS_KEY })
    void queryClient.invalidateQueries({ queryKey: ['office', 'active-map'] })
  }

  const createMap = useMutation({
    mutationFn: (body: { name: string; width: number; height: number; tileSize: MapTileSize }) =>
      apiFetch('/admin/office-maps', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setCreating(false)
      setError('')
      setMapTileSize('32')
      refresh()
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível criar o mapa'),
  })
  const activate = useMutation({
    mutationFn: (publicationId: string) =>
      apiFetch('/admin/office-map-active', {
        method: 'PATCH',
        body: JSON.stringify({ publicationId }),
      }),
    onSuccess: refresh,
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível ativar a versão'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/office-maps/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o mapa'),
  })
  const updateRoom = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/admin/office-rooms/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ROOMS_KEY }),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar a sala'),
  })

  const maps = mapsQuery.data?.maps ?? []
  const rooms = roomsQuery.data?.rooms ?? []
  const users = (usersQuery.data?.users ?? []).filter((user) => user.active && user.role !== 'ADMIN')

  function submitMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    createMap.mutate({
      name: String(data.get('name') ?? ''),
      width: Number(data.get('width')),
      height: Number(data.get('height')),
      tileSize: Number(mapTileSize) as MapTileSize,
    })
  }

  return (
    <div className="flex flex-col gap-lg">
      <section className="rounded-lg bg-surface-container p-lg">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Mapas do escritório</h3>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Crie rascunhos, publique versões e escolha qual mapa está ativo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary"
          >
            {creating ? 'Cancelar' : '+ Novo mapa'}
          </button>
        </div>

        {error && <p role="alert" className="mt-md rounded-md bg-error-container p-sm text-on-error-container">{error}</p>}

        {creating && (
          <form onSubmit={submitMap} className="mt-lg grid gap-md rounded-md bg-surface-container-high p-md md:grid-cols-4">
            <label className="md:col-span-2 text-label-md text-on-surface">
              Nome
              <input name="name" minLength={2} maxLength={120} required className="mt-1 w-full rounded-md border border-outline-variant bg-surface px-md py-sm" />
            </label>
            <label className="text-label-md text-on-surface">
              Largura
              <input name="width" type="number" min={10} max={200} defaultValue={40} required className="mt-1 w-full rounded-md border border-outline-variant bg-surface px-md py-sm" />
            </label>
            <label className="text-label-md text-on-surface">
              Altura
              <input name="height" type="number" min={10} max={200} defaultValue={30} required className="mt-1 w-full rounded-md border border-outline-variant bg-surface px-md py-sm" />
            </label>
            <label className="text-label-md text-on-surface">
              Tile
              <Select
                ariaLabel="Tile"
                className="mt-1"
                value={mapTileSize}
                onChange={setMapTileSize}
                options={[16, 32, 48, 64].map((size) => ({ value: String(size), label: `${size} × ${size} px` }))}
              />
            </label>
            <button disabled={createMap.isPending} className="self-end rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant">
              {createMap.isPending ? 'Criando…' : 'Criar mapa'}
            </button>
          </form>
        )}

        <div className="mt-lg grid gap-md">
          {maps.map((map) => (
            <article key={map.id} className="flex flex-col gap-md rounded-md border border-outline-variant/40 bg-surface-container-high p-md lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-md">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-primary-container text-2xl text-on-primary-container">▦</div>
                <div className="min-w-0">
                  <h4 className="truncate font-headline text-title-md text-on-surface">{map.name}</h4>
                  <p className="text-body-sm text-on-surface-variant">
                    {map.publications.length ? `${map.publications.length} versão(ões)` : 'Somente rascunho'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-sm">
                    {map.publications.map((publication) => (
                      <span key={publication.id} className="inline-flex items-center gap-1 rounded-full bg-surface-container-highest px-sm py-1 text-label-sm">
                        v{publication.version}
                        {publication.active ? (
                          <strong className="text-primary">ATIVA</strong>
                        ) : (
                          <button type="button" onClick={() => activate.mutate(publication.id)} className="text-primary underline">Ativar</button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-sm">
                <Link to={`/admin/mapas/${map.id}/editar`} className="rounded-md border border-outline-variant px-md py-sm font-label text-label-md text-on-surface">Editar</Link>
                <Link to={`/admin/mapas/${map.id}/editar#validation`} className="rounded-md border border-outline-variant px-md py-sm font-label text-label-md text-on-surface">Validar</Link>
                <Link to={`/admin/mapas/${map.id}/editar#publication`} className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary">Publicar</Link>
                <button
                  type="button"
                  aria-label={`Excluir ${map.name}`}
                  onClick={() => window.confirm('Excluir este mapa e todas as versões?') && remove.mutate(map.id)}
                  className="rounded-md border border-error/40 px-md py-sm text-error"
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
          {!mapsQuery.isLoading && maps.length === 0 && (
            <p className="rounded-md border border-dashed border-outline-variant p-xl text-center text-on-surface-variant">Nenhum mapa cadastrado.</p>
          )}
        </div>
      </section>

      <section className="rounded-lg bg-surface-container p-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">Salas do mapa ativo</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          As salas são materializadas ao publicar e mantêm suas permissões entre versões.
        </p>
        <div className="mt-lg grid gap-md lg:grid-cols-2">
          {rooms.map((room) => (
            <article key={room.id} className="rounded-md border border-outline-variant/40 bg-surface-container-high p-md">
              <div className="flex items-start justify-between gap-md">
                <div>
                  <h4 className="font-headline text-title-md">{room.name}</h4>
                  <code className="text-label-sm text-on-surface-variant">{room.externalKey}</code>
                </div>
                <button
                  type="button"
                  onClick={() => updateRoom.mutate({ id: room.id, body: { status: room.status === 'OPEN' ? 'LOCKED' : 'OPEN' } })}
                  className={`rounded-full px-sm py-1 text-label-sm font-bold ${room.status === 'OPEN' ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}
                >
                  {room.status === 'OPEN' ? 'ABERTA' : 'TRANCADA'}
                </button>
              </div>
              <form
                className="mt-md grid gap-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  const capacity = String(data.get('capacity') ?? '').trim()
                  const accessPolicy = roomAccessPolicy[room.id] ?? room.accessPolicy
                  updateRoom.mutate({
                    id: room.id,
                    body: {
                      capacity: capacity ? Number(capacity) : null,
                      voiceEnabled: data.get('voiceEnabled') === 'on',
                      accessPolicy,
                      allowedUserIds: data.getAll('allowedUserIds'),
                    },
                  })
                }}
              >
                <div className="grid grid-cols-2 gap-sm">
                  <label className="text-label-sm">Capacidade
                    <input name="capacity" type="number" min={1} defaultValue={room.capacity ?? ''} placeholder="Sem limite" className="mt-1 w-full rounded-md border border-outline-variant bg-surface px-sm py-1" />
                  </label>
                  <label className="text-label-sm">Acesso
                    <Select
                      ariaLabel={`Acesso da sala ${room.name}`}
                      className="mt-1"
                      value={roomAccessPolicy[room.id] ?? room.accessPolicy}
                      onChange={(value) => setRoomAccessPolicy((current) => ({ ...current, [room.id]: value }))}
                      options={[
                        { value: 'OPEN', label: 'Todos' },
                        { value: 'ALLOWLIST', label: 'Lista permitida' },
                      ]}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-sm text-body-sm">
                  <input name="voiceEnabled" type="checkbox" defaultChecked={room.voiceEnabled} /> Voz habilitada
                </label>
                <details>
                  <summary className="cursor-pointer text-label-sm text-primary">Usuários permitidos</summary>
                  <div className="mt-sm max-h-36 overflow-auto rounded-md bg-surface p-sm">
                    {users.map((user) => (
                      <label key={user.id} className="flex items-center gap-sm py-1 text-body-sm">
                        <input name="allowedUserIds" type="checkbox" value={user.id} defaultChecked={room.allowedUsers.some(({ id }) => id === user.id)} />
                        {user.name}
                      </label>
                    ))}
                  </div>
                </details>
                <button disabled={updateRoom.isPending} className="rounded-md bg-primary px-md py-sm font-label font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant">Salvar sala</button>
              </form>
            </article>
          ))}
          {!roomsQuery.isLoading && rooms.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">A publicação ativa ainda não possui salas de reunião.</p>
          )}
        </div>
      </section>
    </div>
  )
}
