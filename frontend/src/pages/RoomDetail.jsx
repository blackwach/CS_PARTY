import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getWsBase, rooms as roomsApi } from '../api'
import { useAuth } from '../context/AuthContext'

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

const statusBadgeClass = {
  open: 'open',
  ready: 'ready',
  started: 'started',
  finished: 'finished',
  cancelled: 'cancelled',
}

const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6_PATTERN = /^[0-9a-f:]+$/i
const ROOM_WS_RECONNECT_BASE_MS = 1000
const ROOM_WS_RECONNECT_MAX_MS = 12000
const ROOM_FALLBACK_REFRESH_MS = 20000

const PUBLIC_IP_PROVIDERS = [
  'https://api.ipify.org?format=json',
  'https://api64.ipify.org?format=json',
  'https://ipwho.is/?fields=ip',
]

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

function normalizeIp(value) {
  return String(value || '').trim().replace(/\s+/g, '')
}

function isIpCandidate(value) {
  const normalized = normalizeIp(value)
  if (!normalized) return false
  return IPV4_PATTERN.test(normalized) || IPV6_PATTERN.test(normalized)
}

function isIpv4(value) {
  return IPV4_PATTERN.test(normalizeIp(value))
}

async function fetchJsonOrText(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4500)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error('ошибка запроса')
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return await response.json()
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function detectPublicIp() {
  let fallback = ''

  for (const provider of PUBLIC_IP_PROVIDERS) {
    try {
      const data = await fetchJsonOrText(provider)
      const candidate =
        typeof data === 'string'
          ? normalizeIp(data)
          : normalizeIp(data?.ip || data?.query || data?.address || '')

      if (!isIpCandidate(candidate)) continue
      if (isIpv4(candidate)) return candidate
      if (!fallback) fallback = candidate
    } catch {
      // try next provider
    }
  }

  if (fallback) return fallback
  throw new Error('не удалось определить IP')
}

export default function RoomDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [hostPublicIp, setHostPublicIp] = useState('')
  const [detectingIp, setDetectingIp] = useState(false)
  const [diagnostics, setDiagnostics] = useState(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [roomWsConnected, setRoomWsConnected] = useState(false)

  const roomSocketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await roomsApi.get(code)
      setRoom(res.data)
      if (!silent) setError('')
    } catch (err) {
      if (!silent) setError(err.response?.data?.detail || 'Комната не найдена.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
  }, [code])

  useEffect(() => {
    const timer = setInterval(() => load(true), ROOM_FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [code])

  useEffect(() => {
    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase || !code) {
      setRoomWsConnected(false)
      return undefined
    }

    let disposed = false

    const clearReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed) return
      clearReconnect()
      const delay = Math.min(ROOM_WS_RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, ROOM_WS_RECONNECT_MAX_MS)
      reconnectAttemptsRef.current += 1
      reconnectTimerRef.current = setTimeout(() => {
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      if (disposed) return

      try {
        const ws = new WebSocket(`${wsBase}/ws/rooms/${encodeURIComponent(String(code).toUpperCase())}/?token=${encodeURIComponent(token)}`)
        roomSocketRef.current = ws

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0
          setRoomWsConnected(true)
          ws.send(JSON.stringify({ type: 'room.sync' }))
        }

        ws.onerror = () => {
          setRoomWsConnected(false)
          try {
            ws.close()
          } catch {
            // ignore close errors
          }
        }

        ws.onclose = () => {
          setRoomWsConnected(false)
          if (roomSocketRef.current === ws) roomSocketRef.current = null
          scheduleReconnect()
        }

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload.type === 'room.state' && payload.data) {
              setRoom(payload.data)
            }
          } catch {
            // ignore malformed events
          }
        }
      } catch {
        setRoomWsConnected(false)
        scheduleReconnect()
      }
    }

    connectSocket()

    return () => {
      disposed = true
      clearReconnect()
      const ws = roomSocketRef.current
      if (ws) {
        try {
          ws.close()
        } catch {
          // ignore close errors
        }
      }
      roomSocketRef.current = null
      setRoomWsConnected(false)
    }
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
    if (!isHostAuto) return
    if (!room?.server_host) return
    setHostPublicIp((prev) => (prev ? prev : String(room.server_host)))
  }, [isHostAuto, room?.server_host])

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

  const doAction = async (action, payload = {}) => {
    setActionLoading(true)
    setError('')
    try {
      const res = await roomsApi[action](code, payload)
      setRoom(res.data)
      return res.data
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось выполнить действие.')
      return null
    } finally {
      setActionLoading(false)
    }
  }

  const runDiagnostics = async (overrideIp = '') => {
    if (!isHost || !isHostAuto) return null
    setDiagnosticsLoading(true)
    try {
      const payload = {}
      const candidate = normalizeIp(overrideIp || hostPublicIp)
      if (candidate) payload.host_public_ip = candidate
      const { data } = await roomsApi.diagnostics(code, payload)
      setDiagnostics(data)
      return data
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось выполнить диагностику авто-хоста.')
      return null
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  const handleReady = async () => {
    if (!isHost || !isHostAuto) {
      await doAction('ready')
      return
    }

    let resolvedIp = normalizeIp(hostPublicIp)
    if (resolvedIp && !isIpCandidate(resolvedIp)) {
      setError('Введите корректный публичный IP адрес хоста (IPv4 или IPv6).')
      return
    }

    if (!resolvedIp) {
      setDetectingIp(true)
      try {
        resolvedIp = await detectPublicIp()
        setHostPublicIp(resolvedIp)
      } catch {
        setError('Не удалось определить публичный IP автоматически. Укажите IP вручную и нажмите "Готов".')
        setDetectingIp(false)
        return
      } finally {
        setDetectingIp(false)
      }
    }

    const diag = await runDiagnostics(resolvedIp)
    if (diag?.errors?.length) {
      setError(diag.errors[0] || 'Диагностика авто-хоста не пройдена.')
      return
    }

    await doAction('ready', { host_public_ip: resolvedIp })
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
      <div className="room-detail-head">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/rooms')}>
          Назад
        </button>
        <h1 className="page-title">{room?.title}</h1>
        <p className="card-meta">
          Код: {room?.code} | {formatDate(room?.scheduled_for)}
        </p>
        <p className="room-realtime-status">{roomWsConnected ? 'Комната: обновление в реальном времени' : 'Комната: резервное обновление'}</p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="panel room-detail-panel">
        <div className="room-detail-meta">
          <span className={`badge badge-${statusBadgeClass[room?.status] || 'open'}`}>
            {statusLabels[room?.status] || room?.status}
          </span>
          <span className="room-detail-host">Хост: {room?.host?.nickname}</span>
        </div>

        {isHost && room?.status !== 'cancelled' && room?.status !== 'finished' && (
          <div className="room-detail-actions">
            <button type="button" className="btn btn-danger" onClick={() => doAction('close')} disabled={actionLoading || detectingIp}>
              Закрыть комнату
            </button>
          </div>
        )}

        {myState === 'invited' && (
          <div className="room-detail-actions">
            <button type="button" className="btn btn-primary" onClick={() => doAction('join')} disabled={actionLoading || detectingIp}>
              Войти в комнату
            </button>
            <button type="button" className="btn btn-danger" onClick={() => doAction('decline')} disabled={actionLoading || detectingIp}>
              Отклонить
            </button>
          </div>
        )}

        {myState === 'joined' && room?.status !== 'cancelled' && (
          <div className="room-detail-actions">
            <button type="button" className="btn btn-primary" onClick={handleReady} disabled={actionLoading || detectingIp}>
              {detectingIp ? 'Определяем IP...' : 'Готов'}
            </button>
          </div>
        )}

        {isHost && isHostAuto && myState !== 'declined' && room?.status !== 'cancelled' && room?.status !== 'finished' && (
          <div className="room-host-ip-box">
            <label htmlFor="host_public_ip">Публичный IP хоста</label>
            <input
              id="host_public_ip"
              type="text"
              value={hostPublicIp}
              onChange={(event) => setHostPublicIp(event.target.value)}
              placeholder="Например 203.0.113.25"
              disabled={actionLoading || detectingIp}
            />
            <div className="room-detail-actions room-diagnostics-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => runDiagnostics()}
                disabled={diagnosticsLoading || actionLoading}
              >
                {diagnosticsLoading ? 'Проверяем...' : 'Проверить авто-хост'}
              </button>
            </div>
            <p className="form-hint">
              Нужен для подключения остальных игроков к вашему серверу. Если поле пустое, IP будет определён автоматически.
            </p>
          </div>
        )}

        {diagnostics && (
          <div className="room-diagnostics-box">
            <h3>Диагностика авто-хоста</h3>
            {diagnostics.errors?.length > 0 && (
              <div className="alert alert-error room-diagnostics-alert">{diagnostics.errors.join(' ')}</div>
            )}
            {diagnostics.warnings?.length > 0 && (
              <div className="alert alert-warning room-diagnostics-alert">{diagnostics.warnings.join(' ')}</div>
            )}
            <ul className="room-diagnostics-list">
              {(diagnostics.checks || []).map((item, index) => (
                <li key={`${item.name || index}-${index}`} className={`room-diagnostics-item is-${item.status || 'warning'}`}>
                  <strong>{item.name || 'Проверка'}:</strong> {item.detail || '-'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {myState === 'ready' && room?.status !== 'cancelled' && (
          <div className="room-detail-actions">
            {room?.status !== 'started' && (
              <button type="button" className="btn btn-secondary" onClick={() => doAction('unready')} disabled={actionLoading || detectingIp}>
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
          <p className="room-server-meta">
            Сервер: {room.server_host}:{room.server_port}
          </p>
        )}

        <h3 className="room-players-title">Игроки</h3>
        <ul className="room-player-list">
          {(room?.memberships || []).map((membership) => (
            <li key={membership.id} className="room-player-row">
              <div className="room-player-main">
                <Link to={`/users/${membership.user?.id}`}>{membership.user?.nickname || '-'}</Link>
                {membership.user?.id !== currentUser?.id && (
                  <Link to={`/chat/${membership.user?.id}`} className="btn btn-ghost room-player-chat">
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
