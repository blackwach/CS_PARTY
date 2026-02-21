import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth as authApi, getWsBase, rooms as roomsApi } from '../api'

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)

  const loadNotifications = () => {
    authApi
      .notifications()
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => setItems([]))
  }

  useEffect(() => {
    loadNotifications()
    const pollId = setInterval(loadNotifications, 15000)
    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase) {
      return () => clearInterval(pollId)
    }

    let socket = null
    try {
      socket = new WebSocket(`${wsBase}/ws/notifications/?token=${encodeURIComponent(token)}`)
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'notification' && payload.data) {
            setItems((prev) => {
              const index = prev.findIndex((item) => item.id === payload.data.id)
              if (index >= 0) {
                const next = [...prev]
                next[index] = payload.data
                return next
              }
              return [payload.data, ...prev]
            })
          }
        } catch {
          // ignore malformed events
        }
      }
    } catch {
      // ignore ws creation errors
    }

    return () => {
      clearInterval(pollId)
      if (socket) socket.close()
    }
  }, [])

  const unreadCount = useMemo(() => items.filter((i) => !i.is_read).length, [items])

  const markAsRead = async (notificationId) => {
    await authApi.notificationRead(notificationId)
    loadNotifications()
  }

  const acceptFriend = async (notification) => {
    const requestId = notification.payload?.friend_request_id
    if (!requestId) return
    await authApi.friendRequestAccept(requestId)
    await authApi.notificationRead(notification.id)
    loadNotifications()
  }

  const declineFriend = async (notification) => {
    const requestId = notification.payload?.friend_request_id
    if (!requestId) return
    await authApi.friendRequestDecline(requestId)
    await authApi.notificationRead(notification.id)
    loadNotifications()
  }

  const acceptRoomInvite = async (notification) => {
    const roomCode = notification.payload?.room_code
    if (!roomCode) return
    await roomsApi.join(roomCode)
    await authApi.notificationRead(notification.id)
    loadNotifications()
  }

  const declineRoomInvite = async (notification) => {
    const roomCode = notification.payload?.room_code
    if (!roomCode) return
    await roomsApi.decline(roomCode)
    await authApi.notificationRead(notification.id)
    loadNotifications()
  }

  return (
    <div className="notification-wrap">
      <button type="button" className="notification-btn" onClick={() => setOpen((v) => !v)} aria-label="Уведомления">
        <span className="notification-icon">🔔</span>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="notification-popover-head">
            <strong>Уведомления</strong>
            <button type="button" className="btn btn-ghost" onClick={() => authApi.notificationsReadAll().then(loadNotifications)}>
              Прочитать все
            </button>
          </div>
          {items.length === 0 ? (
            <p className="notification-empty">Уведомлений нет.</p>
          ) : (
            <ul className="notification-list">
              {items.map((notification) => (
                <li key={notification.id} className={`notification-item ${notification.is_read ? 'is-read' : ''}`}>
                  <div className="notification-texts">
                    <strong>{notification.title}</strong>
                    {notification.message && <p>{notification.message}</p>}
                  </div>
                  {notification.type === 'friend_request' && !notification.is_read && (
                    <div className="notification-actions">
                      <button type="button" className="btn btn-primary" onClick={() => acceptFriend(notification)}>Принять</button>
                      <button type="button" className="btn btn-secondary" onClick={() => declineFriend(notification)}>Отклонить</button>
                    </div>
                  )}
                  {notification.type === 'room_invite' && (
                    <div className="notification-actions">
                      <button type="button" className="btn btn-primary" onClick={() => acceptRoomInvite(notification)}>Войти</button>
                      <button type="button" className="btn btn-secondary" onClick={() => declineRoomInvite(notification)}>Отклонить</button>
                      <Link to={`/rooms/${notification.payload?.room_code || ''}`}>Открыть</Link>
                    </div>
                  )}
                  {notification.type !== 'friend_request' && notification.type !== 'room_invite' && !notification.is_read && (
                    <div className="notification-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => markAsRead(notification.id)}>Прочитать</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
