import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rooms as roomsApi } from '../api'

const STATUS_LABELS = {
  open: 'Открыта',
  ready: 'Готова',
  started: 'Идёт',
  finished: 'Завершена',
  cancelled: 'Отменена',
}

const STATUS_ORDER = {
  started: 0,
  ready: 1,
  open: 2,
}

const ACTIVE_ROOM_STATUSES = new Set(['open', 'ready', 'started'])

function formatDate(value) {
  const parsed = value ? new Date(value) : null
  if (!parsed || Number.isNaN(parsed.getTime())) return 'Дата не указана'
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toTimestamp(value) {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

function normalizeRooms(payload) {
  const rawList = Array.isArray(payload) ? payload : payload?.results || []
  return rawList
    .filter((room) => ACTIVE_ROOM_STATUSES.has(String(room?.status || '')))
    .sort((left, right) => {
      const statusDelta = (STATUS_ORDER[left?.status] ?? 99) - (STATUS_ORDER[right?.status] ?? 99)
      if (statusDelta !== 0) return statusDelta

      const dateDelta = toTimestamp(left?.scheduled_for) - toTimestamp(right?.scheduled_for)
      if (dateDelta !== 0) return dateDelta

      return String(left?.code || '').localeCompare(String(right?.code || ''))
    })
}

export default function Rooms() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    roomsApi
      .list()
      .then((res) => setList(normalizeRooms(res.data)))
      .catch(() => setError('Не удалось загрузить комнаты.'))
      .finally(() => setLoading(false))
  }, [])

  const hasRooms = useMemo(() => list.length > 0, [list])

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Мои комнаты</h1>
        <Link to="/rooms/create" className="btn btn-primary">Создать комнату</Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!hasRooms ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>У вас пока нет активных комнат. Создайте новую или примите приглашение.</p>
          <Link to="/rooms/create" className="btn btn-primary">Создать комнату</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {list.map((room) => (
            <Link key={room.id} to={`/rooms/${room.code}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 className="card-title">{room.title}</h3>
                  <p className="card-meta">
                    Код: {room.code} | {formatDate(room.scheduled_for)} | Хост: {room.host?.nickname || '-'}
                  </p>
                </div>
                <span className={`badge badge-${room.status || 'open'}`}>
                  {STATUS_LABELS[room.status] || room.status}
                </span>
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Участников: {room.memberships?.length ?? 0} / {room.max_players}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
