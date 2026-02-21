import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { auth as authApi } from '../api'

export default function FriendsPanel({ isVisible, onClose }) {
  const [friends, setFriends] = useState([])
  const [loading, setLoading] = useState(true)
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

  return (
    <aside className={`friends-panel ${isVisible ? 'is-visible' : ''}`}>
      <div className="friends-panel-header">
        <h3>Друзья</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
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
