import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rooms as roomsApi } from '../api'

const statusLabels = {
  open: 'Открыта',
  ready: 'Все готовы',
  started: 'Сервер запущен',
  finished: 'Завершена',
  cancelled: 'Закрыта',
}

const stateLabels = {
  invited: 'Приглашен',
  joined: 'В комнате',
  ready: 'Готов',
  declined: 'Отклонил',
}

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toSteamUrl(command) {
  if (!command) return ''
  return `steam://run/730//${encodeURIComponent(command)}/`
}

async function detectPublicIp() {
  const response = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
  if (!response.ok) throw new Error('ip lookup failed')
  const data = await response.json()
  return String(data?.ip || '').trim()
}

export default function RoomDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    roomsApi
      .get(code)
      .then((res) => {
        setRoom(res.data)
        if (!silent) setError('')
      })
      .catch((err) => {
        if (!silent) setError(err.response?.data?.detail || 'Комната не найдена.')
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(true), 5000)
    return () => clearInterval(timer)
  }, [code])

  const me = useMemo(
    () => currentUser && room?.memberships?.find((membership) => membership.user?.id === currentUser.id),
    [currentUser, room]
  )
  const myState = me?.state
  const isHost = room?.host?.id === currentUser?.id
  const isHostAuto = room?.server_source === 'host-auto'
  const hostLaunchUrl = useMemo(() => toSteamUrl(room?.server_launch_command || ''), [room?.server_launch_command])
  const launchUrl = isHost && isHostAuto ? hostLaunchUrl || room?.server_connect_url : room?.server_connect_url

  useEffect(() => {
    if (room?.status !== 'started') return
    if (myState !== 'ready') return
    if (!launchUrl) return
    if (!currentUser?.id || !room?.code) return

    const key = `cs2:auto-launch:${room.code}:${currentUser.id}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    window.location.assign(launchUrl)
  }, [room?.status, room?.code, myState, currentUser?.id, launchUrl])

  const doAction = (action, payload = {}) => {
    setActionLoading(true)
    setError('')
    roomsApi[action](code, payload)
      .then((res) => setRoom(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось выполнить действие.'))
      .finally(() => setActionLoading(false))
  }

  const handleReady = async () => {
    if (isHost && isHostAuto) {
      try {
        const hostPublicIp = await detectPublicIp()
        if (!hostPublicIp) {
          setError('Не удалось определить публичный IP хоста.')
          return
        }
        doAction('ready', { host_public_ip: hostPublicIp })
        return
      } catch {
        setError('Не удалось определить публичный IP хоста. Проверьте интернет и попробуйте снова.')
        return
      }
    }
    doAction('ready')
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

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/rooms')} style={{ marginBottom: '0.5rem' }}>
          Назад
        </button>
        <h1 className="page-title">{room?.title}</h1>
        <p className="card-meta">
          Код: {room?.code} | {formatDate(room?.scheduled_for)}
        </p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <span className={`badge badge-${room?.status === 'open' ? 'open' : room?.status === 'ready' ? 'ready' : room?.status === 'cancelled' ? 'cancelled' : 'joined'}`}>
            {statusLabels[room?.status] || room?.status}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Хост: {room?.host?.nickname}
          </span>
        </div>

        {isHost && room?.status !== 'cancelled' && room?.status !== 'finished' && (
          <div style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-danger" onClick={() => doAction('close')} disabled={actionLoading}>
              Закрыть комнату
            </button>
          </div>
        )}

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

        {myState === 'joined' && room?.status !== 'cancelled' && (
          <div style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleReady} disabled={actionLoading}>
              Готов
            </button>
          </div>
        )}

        {myState === 'ready' && room?.status !== 'cancelled' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {room?.status !== 'started' && (
              <button type="button" className="btn btn-secondary" onClick={() => doAction('unready')} disabled={actionLoading}>
                Отменить готовность
              </button>
            )}
            {launchUrl && (
              <button type="button" className="btn btn-primary" onClick={() => window.location.assign(launchUrl)}>
                Запустить CS2
              </button>
            )}
          </div>
        )}

        {room?.server_error && (
          <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
            {room.server_error}
          </div>
        )}

        {room?.server_host && room?.server_port && (
          <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Сервер: {room.server_host}:{room.server_port}
          </p>
        )}

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
              <span className={`badge badge-${membership.state === 'ready' ? 'ready' : membership.state === 'declined' ? 'declined' : membership.state === 'invited' ? 'invited' : 'joined'}`}>
                {stateLabels[membership.state] || membership.state}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
