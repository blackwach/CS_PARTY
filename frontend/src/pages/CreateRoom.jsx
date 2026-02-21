import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth as authApi, rooms as roomsApi } from '../api'

export default function CreateRoom() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [invitedUsers, setInvitedUsers] = useState([])
  const [useHostServer, setUseHostServer] = useState(false)
  const [hostServerPort, setHostServerPort] = useState('27015')
  const [hostServerPassword, setHostServerPassword] = useState('')
  const [hostServerMap, setHostServerMap] = useState('de_dust2')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const searchUsers = () => {
    if (!search.trim()) return
    authApi
      .usersSearch(search.trim())
      .then((res) => setSearchResults(Array.isArray(res.data) ? res.data : res.data?.results || []))
      .catch(() => setSearchResults([]))
  }

  const addInvite = (user) => {
    if (invitedUsers.some((item) => item.id === user.id)) return
    if (invitedUsers.length >= 4) return
    setInvitedUsers((prev) => [...prev, { id: user.id, nickname: user.nickname }])
    setSearchResults((prev) => prev.filter((item) => item.id !== user.id))
  }

  const removeInvite = (id) => {
    setInvitedUsers((prev) => prev.filter((item) => item.id !== id))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!title.trim()) {
      setError('Укажите название комнаты.')
      return
    }

    const plannedAt = scheduledFor ? new Date(scheduledFor).toISOString() : null
    if (!plannedAt || new Date(plannedAt) <= new Date()) {
      setError('Выберите дату и время в будущем.')
      return
    }

    if (useHostServer) {
      if (!hostServerPort.trim()) {
        setError('Укажите порт сервера хоста.')
        return
      }
      const parsedPort = Number(hostServerPort)
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        setError('Порт сервера должен быть в диапазоне 1-65535.')
        return
      }
    }

    setLoading(true)
    try {
      const payload = {
        title: title.trim(),
        scheduled_for: plannedAt,
        invited_user_ids: invitedUsers.map((item) => item.id),
      }
      if (useHostServer) {
        payload.host_auto_server = true
        payload.host_server_port = Number(hostServerPort)
        payload.host_server_password = hostServerPassword.trim()
        payload.host_server_map = hostServerMap.trim() || 'de_dust2'
      }
      const { data } = await roomsApi.create(payload)
      navigate(`/rooms/${data.code}`)
    } catch (err) {
      const data = err.response?.data
      setError(data?.host_server_port?.[0] || data?.scheduled_for?.[0] || data?.title?.[0] || data?.detail || 'Не удалось создать комнату.')
    } finally {
      setLoading(false)
    }
  }

  const minDateTime = () => {
    const value = new Date()
    value.setMinutes(value.getMinutes() + 5)
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 16)
  }

  return (
    <>
      <h1 className="page-title">Создать комнату</h1>
      <p className="page-subtitle">До 5 игроков. Выберите дату/время и пригласите друзей.</p>
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="panel">
        <div className="form-group">
          <label htmlFor="title">Название</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например: Premier 21:00"
            maxLength={120}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="scheduled_for">Когда играем</label>
          <input
            id="scheduled_for"
            type="datetime-local"
            value={scheduledFor}
            onChange={(event) => setScheduledFor(event.target.value)}
            min={minDateTime()}
            required
          />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={useHostServer} onChange={(event) => setUseHostServer(event.target.checked)} />
            Хост автоматически поднимает CS2-сервер
          </label>
          {useHostServer && (
            <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input
                type="number"
                value={hostServerPort}
                min={1}
                max={65535}
                onChange={(event) => setHostServerPort(event.target.value)}
                placeholder="Порт сервера (например 27015)"
              />
              <input
                type="text"
                value={hostServerPassword}
                onChange={(event) => setHostServerPassword(event.target.value)}
                placeholder="Пароль сервера (необязательно)"
              />
              <input
                type="text"
                value={hostServerMap}
                onChange={(event) => setHostServerMap(event.target.value)}
                placeholder="Карта (например de_dust2)"
              />
              <small style={{ color: 'var(--text-muted)' }}>
                Публичный IP хоста определяется при нажатии кнопки "Готов" в комнате.
              </small>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Пригласить по нику</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), searchUsers())}
              placeholder="Ник игрока"
            />
            <button type="button" className="btn btn-secondary" onClick={searchUsers}>
              Найти
            </button>
          </div>

          {searchResults.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
              {searchResults.map((item) => (
                <li key={item.id} style={{ marginBottom: '0.25rem' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.35rem 0.5rem', fontSize: '0.9rem' }}
                    onClick={() => addInvite(item)}
                  >
                    + {item.nickname}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {invitedUsers.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }}>
              {invitedUsers.map((item) => (
                <li
                  key={item.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginRight: '0.5rem', marginBottom: '0.35rem' }}
                >
                  <span className="badge badge-joined">{item.nickname}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                    onClick={() => removeInvite(item.id)}
                  >
                    x
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Создание...' : 'Создать комнату'}
          </button>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: '0.5rem' }} onClick={() => navigate('/rooms')}>
            Отмена
          </button>
        </div>
      </form>
    </>
  )
}
