import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth as authApi, rooms as roomsApi } from '../api'

const PRESET_PORTS = ['27015', '27016', '27017']

export default function CreateRoom() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [invitedUsers, setInvitedUsers] = useState([])
  const [useHostServer, setUseHostServer] = useState(false)
  const [hostServerPort, setHostServerPort] = useState('27015')
  const [portMode, setPortMode] = useState('27015')
  const [hostServerPassword, setHostServerPassword] = useState('')
  const [hostServerMap, setHostServerMap] = useState('de_dust2')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const searchUsers = async () => {
    const query = search.trim()
    setHasSearched(true)
    if (!query) {
      setSearchResults([])
      setSearchError('')
      return
    }
    setSearching(true)
    setSearchError('')
    authApi
      .usersSearch(query)
      .then((res) => {
        const allResults = Array.isArray(res.data) ? res.data : res.data?.results || []
        const invitedSet = new Set(invitedUsers.map((item) => item.id))
        setSearchResults(allResults.filter((item) => !invitedSet.has(item.id)))
      })
      .catch((err) => {
        setSearchError(err.response?.data?.detail || 'Не удалось выполнить поиск.')
        setSearchResults([])
      })
      .finally(() => setSearching(false))
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

  const handlePortModeChange = (value) => {
    setPortMode(value)
    if (value !== 'custom') {
      setHostServerPort(value)
      return
    }
    if (PRESET_PORTS.includes(hostServerPort)) {
      setHostServerPort('')
    }
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

    const resolvedHostServerPort = portMode === 'custom' ? hostServerPort.trim() : portMode
    if (useHostServer) {
      if (!resolvedHostServerPort) {
        setError('Укажите порт сервера хоста.')
        return
      }
      const parsedPort = Number(resolvedHostServerPort)
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
        payload.host_server_port = Number(resolvedHostServerPort)
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

      <form onSubmit={handleSubmit} className="panel room-create-form">
        <div className="room-create-grid">
          <div>
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

            <div className="room-host-settings">
              <label className="room-host-toggle" htmlFor="host-auto-toggle">
                <input
                  id="host-auto-toggle"
                  type="checkbox"
                  checked={useHostServer}
                  onChange={(event) => setUseHostServer(event.target.checked)}
                />
                <span>Хост автоматически поднимает CS2-сервер</span>
              </label>
              {useHostServer && (
                <div className="room-host-fields">
                  <div className="form-group">
                    <label htmlFor="host_port_mode">Порт сервера</label>
                    <select id="host_port_mode" value={portMode} onChange={(event) => handlePortModeChange(event.target.value)}>
                      {PRESET_PORTS.map((port) => (
                        <option key={port} value={port}>
                          {port} (рекомендуется)
                        </option>
                      ))}
                      <option value="custom">Свой порт...</option>
                    </select>
                    {portMode === 'custom' && (
                      <input
                        type="number"
                        value={hostServerPort}
                        min={1}
                        max={65535}
                        onChange={(event) => setHostServerPort(event.target.value)}
                        placeholder="Введите порт от 1 до 65535"
                      />
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="host_server_password">Пароль сервера</label>
                    <input
                      id="host_server_password"
                      type="text"
                      value={hostServerPassword}
                      onChange={(event) => setHostServerPassword(event.target.value)}
                      placeholder="Необязательно"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="host_server_map">Карта</label>
                    <input
                      id="host_server_map"
                      type="text"
                      value={hostServerMap}
                      onChange={(event) => setHostServerMap(event.target.value)}
                      placeholder="Например de_dust2"
                    />
                  </div>
                  <small className="form-hint">
                    Публичный IP хоста определяется при нажатии кнопки «Готов» в комнате.
                  </small>
                </div>
              )}
            </div>
          </div>

          <div className="room-invites-box">
            <h2>Приглашения</h2>
            <div className="room-search-bar">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), searchUsers())}
                placeholder="Ник игрока"
              />
              <button type="button" className="btn btn-secondary" onClick={searchUsers} disabled={searching}>
                {searching ? 'Поиск...' : 'Найти'}
              </button>
            </div>
            {searchError && <p className="form-error">{searchError}</p>}
            {searchResults.length > 0 && (
              <ul className="room-search-results">
                {searchResults.map((item) => (
                  <li key={item.id} className="room-search-result-item">
                    <span className="room-search-user">{item.nickname}</span>
                    <button type="button" className="btn btn-primary" onClick={() => addInvite(item)}>
                      Пригласить
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasSearched && !searching && !searchError && search.trim() && searchResults.length === 0 && (
              <p className="form-hint">Никого не найдено по этому запросу.</p>
            )}

            {invitedUsers.length > 0 ? (
              <ul className="room-invited-list">
                {invitedUsers.map((item) => (
                  <li key={item.id} className="room-invited-item">
                    <span className="badge badge-joined">{item.nickname}</span>
                    <button type="button" className="btn btn-ghost" onClick={() => removeInvite(item.id)} aria-label={`Удалить ${item.nickname}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="form-hint">Пока никого не пригласили.</p>
            )}
            <p className="form-hint">Можно пригласить до 4 друзей.</p>
          </div>
        </div>

        <div className="room-create-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Создание...' : 'Создать комнату'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/rooms')}>
            Отмена
          </button>
        </div>
      </form>
    </>
  )
}
