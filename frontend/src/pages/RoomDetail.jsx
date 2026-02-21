import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rooms as roomsApi } from '../api'

const statusLabels = {
  open: 'Открыта',
  ready: 'Готова',
  started: 'Идёт',
  finished: 'Завершена',
  cancelled: 'Отменена',
}

const stateLabels = {
  invited: 'Приглашен',
  joined: 'Присоединился',
  ready: 'Готов',
  declined: 'Отклонил',
}

function formatDate(d) {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function RoomDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const load = () => {
    roomsApi
      .get(code)
      .then((res) => setRoom(res.data))
      .catch(() => setError('Комната не найдена.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [code])

  const doAction = (action) => {
    setActionLoading(true)
    setError('')
    roomsApi[action](code)
      .then((res) => setRoom(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось выполнить действие.'))
      .finally(() => setActionLoading(false))
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  if (error && !room) {
    return (
      <div className="panel">
        <div className="alert alert-error">{error}</div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/rooms')}>
          Назад к комнатам
        </button>
      </div>
    )
  }

  const me = currentUser && room?.memberships?.find((m) => m.user?.id === currentUser.id)
  const myState = me?.state

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/rooms')} style={{ marginBottom: '0.5rem' }}>
          Назад
        </button>
        <h1 className="page-title">{room?.title}</h1>
        <p className="card-meta">Код: {room?.code} | {formatDate(room?.scheduled_for)}</p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <span className={`badge badge-${room?.status === 'open' ? 'open' : room?.status === 'ready' ? 'ready' : ''}`}>
            {statusLabels[room?.status] || room?.status}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Хост: {room?.host?.nickname}
          </span>
        </div>

        {myState === 'invited' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => doAction('join')} disabled={actionLoading}>
              Войти в комнату
            </button>
            <button type="button" className="btn btn-danger" onClick={() => doAction('decline')} disabled={actionLoading}>
              Отклонить
            </button>
          </div>
        )}
        {myState === 'joined' && (
          <div style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={() => doAction('ready')} disabled={actionLoading}>
              Готов
            </button>
          </div>
        )}
        {myState === 'ready' && <p style={{ color: 'var(--accent)' }}>Вы отмечены как готовый.</p>}

        <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '1rem' }}>Игроки</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(room?.memberships || []).map((membership) => (
            <li
              key={membership.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <Link to={`/users/${membership.user?.id}`}>{membership.user?.nickname || '-'}</Link>
                {membership.user?.id !== currentUser?.id && (
                  <Link to={`/chat/${membership.user?.id}`} className="btn btn-ghost" style={{ padding: '0.15rem 0.4rem' }}>
                    Чат
                  </Link>
                )}
              </div>
              <span className={`badge badge-${membership.state === 'ready' ? 'joined' : membership.state === 'declined' ? 'declined' : membership.state === 'invited' ? 'invited' : 'joined'}`}>
                {stateLabels[membership.state] || membership.state}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
