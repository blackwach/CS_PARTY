import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rooms as roomsApi } from '../api'
import { auth as authApi } from '../api'

export default function CreateRoom() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [invitedUsers, setInvitedUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const searchUsers = () => {
    if (!search.trim()) return
    authApi
      .usersSearch(search.trim())
      .then((res) => setSearchResults(Array.isArray(res.data) ? res.data : (res.data?.results || [])))
      .catch(() => setSearchResults([]))
  }

  const addInvite = (user) => {
    if (invitedUsers.some((u) => u.id === user.id)) return
    if (invitedUsers.length >= 4) return
    setInvitedUsers((prev) => [...prev, { id: user.id, nickname: user.nickname }])
    setSearchResults((prev) => prev.filter((u) => u.id !== user.id))
  }

  const removeInvite = (id) => {
    setInvitedUsers((prev) => prev.filter((u) => u.id !== id))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Укажите название комнаты')
      return
    }
    const at = scheduledFor ? new Date(scheduledFor).toISOString() : null
    if (!at || new Date(at) <= new Date()) {
      setError('Укажите время в будущем')
      return
    }
    setLoading(true)
    try {
      const { data } = await roomsApi.create({
        title: title.trim(),
        scheduled_for: at,
        invited_user_ids: invitedUsers.map((u) => u.id),
      })
      navigate(`/rooms/${data.code}`)
    } catch (err) {
      const d = err.response?.data
      setError(d?.scheduled_for?.[0] || d?.title?.[0] || 'Ошибка создания комнаты')
    } finally {
      setLoading(false)
    }
  }

  const minDateTime = () => {
    const d = new Date()
    d.setMinutes(d.getMinutes() + 5)
    return d.toISOString().slice(0, 16)
  }

  return (
    <>
      <h1 className="page-title">Создать комнату</h1>
      <p className="page-subtitle">До 5 игроков. Укажите время сбора и пригласите участников.</p>
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="panel">
        <div className="form-group">
          <label htmlFor="title">Название</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: MM 21:00"
            maxLength={120}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="scheduled_for">Время сбора</label>
          <input
            id="scheduled_for"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            min={minDateTime()}
            required
          />
        </div>

        <div className="form-group">
          <label>Пригласить (поиск по никнейму)</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchUsers())}
              placeholder="Никнейм"
            />
            <button type="button" className="btn btn-secondary" onClick={searchUsers}>
              Искать
            </button>
          </div>
          {searchResults.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.5rem' }}>
              {searchResults.map((u) => (
                <li key={u.id} style={{ marginBottom: '0.25rem' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '0.35rem 0.5rem', fontSize: '0.9rem' }}
                    onClick={() => addInvite(u)}
                  >
                    + {u.nickname}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {invitedUsers.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }}>
              {invitedUsers.map((u) => (
                <li key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginRight: '0.5rem', marginBottom: '0.35rem' }}>
                  <span className="badge badge-joined">{u.nickname}</span>
                  <button type="button" className="btn btn-ghost" style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem' }} onClick={() => removeInvite(u.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Создание…' : 'Создать комнату'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: '0.5rem' }}
            onClick={() => navigate('/rooms')}
          >
            Отмена
          </button>
        </div>
      </form>
    </>
  )
}
