import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { auth as authApi } from '../api'

export default function FriendsPanel({ isVisible, onClose }) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [requestState, setRequestState] = useState({})
  const navigate = useNavigate()

  const loadFriends = () => {
    authApi
      .friends()
      .then((res) => setFriends(Array.isArray(res.data) ? res.data : []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadFriends()
    const intervalId = setInterval(loadFriends, 10000)
    return () => clearInterval(intervalId)
  }, [])

  const searchUsers = async () => {
    const query = search.trim()
    if (!query) {
      setSearchResults([])
      return
    }

    setSearching(true)
    setSearchError('')
    try {
      const { data } = await authApi.usersSearch(query)
      const allResults = Array.isArray(data) ? data : data?.results || []
      const existingFriendIds = new Set(friends.map((item) => item.friend?.id))
      setSearchResults(allResults.filter((item) => !existingFriendIds.has(item.id)))
    } catch (err) {
      setSearchError(err.response?.data?.detail || 'Не удалось выполнить поиск.')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const sendFriendRequest = async (userId) => {
    setRequestState((prev) => ({ ...prev, [userId]: 'loading' }))
    try {
      await authApi.friendRequestCreate(userId)
      setRequestState((prev) => ({ ...prev, [userId]: 'sent' }))
    } catch (err) {
      setRequestState((prev) => ({ ...prev, [userId]: err.response?.data?.detail || 'error' }))
    }
  }

  return (
    <aside className={`friends-panel ${isVisible ? 'is-visible' : ''}`}>
      <div className="friends-panel-header">
        <h3>Друзья</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), searchUsers())}
            placeholder="Найти по нику"
          />
          <button type="button" className="btn btn-secondary" onClick={searchUsers} disabled={searching}>
            {searching ? '...' : 'Найти'}
          </button>
        </div>
        {searchError && <p style={{ color: 'var(--danger)', margin: '0.35rem 0 0' }}>{searchError}</p>}
        {searchResults.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
            {searchResults.map((user) => (
              <li key={user.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '0.2rem 0.4rem' }}
                  onClick={() => navigate(`/users/${user.id}`)}
                >
                  {user.nickname}
                </button>
                {requestState[user.id] === 'sent' ? (
                  <span className="badge badge-invited">Отправлено</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '0.2rem 0.45rem' }}
                    disabled={requestState[user.id] === 'loading'}
                    onClick={() => sendFriendRequest(user.id)}
                  >
                    +
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading ? (
        <div className="loading-wrap"><div className="loading-spinner" /></div>
      ) : friends.length === 0 ? (
        <p className="friends-empty">Пока нет друзей.</p>
      ) : (
        <ul className="friends-list">
          {friends.map((item) => (
            <li key={item.id} className="friends-list-item">
              <button
                type="button"
                className="friend-avatar-btn"
                onClick={() => {
                  navigate(`/users/${item.friend.id}`)
                  onClose()
                }}
                title="Открыть профиль"
              >
                {item.friend.avatar ? (
                  <img src={item.friend.avatar} alt={item.friend.nickname} className="friend-avatar" />
                ) : (
                  <span className="friend-avatar-fallback">{item.friend.nickname.slice(0, 1).toUpperCase()}</span>
                )}
              </button>
              <button
                type="button"
                className="friend-chat-btn"
                onClick={() => {
                  navigate(`/chat/${item.friend.id}`)
                  onClose()
                }}
                title="Открыть чат"
              >
                {item.friend.nickname}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="friends-panel-footer">
        <Link to="/rooms/create" onClick={onClose}>Создать комнату</Link>
      </div>
    </aside>
  )
}
