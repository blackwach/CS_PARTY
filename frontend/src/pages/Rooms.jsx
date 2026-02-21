import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { rooms as roomsApi } from '../api'

const statusLabels = {
  open: 'Открыта',
  ready: 'Готова',
  started: 'Идёт',
  finished: 'Завершена',
  cancelled: 'Отменена',
}

function formatDate(d) {
  const date = new Date(d)
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Rooms() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    roomsApi
      .list()
      .then((res) => setList(Array.isArray(res.data) ? res.data : res.data?.results || []))
      .catch(() => setError('Не удалось загрузить комнаты.'))
      .finally(() => setLoading(false))
  }, [])

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

      {list.length === 0 ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>У вас пока нет комнат. Создайте новую или примите приглашение.</p>
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
                  {statusLabels[room.status] || room.status}
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
