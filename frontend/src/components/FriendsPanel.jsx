import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { auth as authApi } from '../api'

function formatLastSeen(value) {
  if (!value) return ''
  return `Был(а) ${new Date(value).toLocaleString()}`
}

export default function FriendsPanel({ isVisible, onClose }) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
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
    setHasSearched(true)
    if (!query) {
      setSearchResults([])
      setSearchError('')
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

      <div className="friends-search-box">
        <div className="friends-search-bar">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), searchUsers())}
            placeholder="Найти по нику"
          />
          <button type="button" className="btn btn-secondary" onClick={searchUsers} disabled={searching}>
            {searching ? 'Поиск...' : 'Найти'}
          </button>
        </div>
        {searchError && <p className="form-error">{searchError}</p>}
        {searchResults.length > 0 && (
          <ul className="friends-search-results">
            {searchResults.map((user) => (
              <li key={user.id} className="friends-search-item">
                <button type="button" className="btn btn-ghost" onClick={() => navigate(`/users/${user.id}`)}>
                  {user.nickname}
                </button>
                <div className="friends-search-actions">
                  {requestState[user.id] === 'sent' ? (
                    <span className="badge badge-invited">Отправлено</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={requestState[user.id] === 'loading'}
                      onClick={() => sendFriendRequest(user.id)}
                    >
                      {requestState[user.id] === 'loading' ? '...' : 'Добавить'}
                    </button>
                  )}
                  {requestState[user.id] && !['loading', 'sent'].includes(requestState[user.id]) && (
                    <small className="form-error">
                      {requestState[user.id] === 'error' ? 'Ошибка отправки' : requestState[user.id]}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {hasSearched && !searching && !searchError && search.trim() && searchResults.length === 0 && (
          <p className="form-hint">Никого не найдено.</p>
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
                <span className={`friend-status-dot ${item.friend.is_online ? 'is-online' : ''}`} />
                <span>{item.friend.nickname}</span>
                {!item.friend.is_online && item.friend.last_seen_at && (
                  <small className="friend-last-seen">{formatLastSeen(item.friend.last_seen_at)}</small>
                )}
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
