import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { auth as authApi, getWsBase, rooms as roomsApi } from '../api'

const CHAT_NOTIFICATION_KINDS = new Set(['chat_message', 'chat_unread_hour_alert'])
const TOAST_TTL_MS = 9000
const MAX_TOASTS = 3

function getChatPeerId(notification) {
  const fromPayload =
    Number(notification?.payload?.chat_user_id || 0) ||
    Number(notification?.payload?.sender_id || 0) ||
    Number(notification?.actor?.id || 0)
  return Number.isFinite(fromPayload) && fromPayload > 0 ? fromPayload : null
}

function getChatLink(notification) {
  const peerId = getChatPeerId(notification)
  return peerId ? `/chat/${peerId}` : '/chats'
}

function isChatNotification(notification) {
  return CHAT_NOTIFICATION_KINDS.has(notification?.payload?.kind)
}

export default function NotificationBell() {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [toasts, setToasts] = useState([])
  const wrapRef = useRef(null)
  const toastTimersRef = useRef(new Map())
  const { pathname } = useLocation()

  const activeChatPeerId = useMemo(() => {
    const match = pathname.match(/^\/chat\/(\d+)\/*$/)
    if (!match) return null
    const parsed = Number(match[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [pathname])

  const clearToastTimer = useCallback((toastId) => {
    const timer = toastTimersRef.current.get(toastId)
    if (timer) {
      clearTimeout(timer)
      toastTimersRef.current.delete(toastId)
    }
  }, [])

  const dismissToast = useCallback((toastId) => {
    clearToastTimer(toastId)
    setToasts((prev) => prev.filter((item) => item.id !== toastId))
  }, [clearToastTimer])

  const enqueueToast = useCallback(
    (notification) => {
      if (!isChatNotification(notification) || notification.is_read) return
      const peerId = getChatPeerId(notification)
      if (activeChatPeerId && peerId && peerId === activeChatPeerId) return

      const toast = {
        id: Number(notification.id),
        notificationId: Number(notification.id),
        title: notification.title || 'Новое сообщение',
        message: notification.message || '',
        link: getChatLink(notification),
      }

      setToasts((prev) => [toast, ...prev.filter((item) => item.id !== toast.id)].slice(0, MAX_TOASTS))
      clearToastTimer(toast.id)
      toastTimersRef.current.set(
        toast.id,
        setTimeout(() => {
          dismissToast(toast.id)
        }, TOAST_TTL_MS)
      )
    },
    [activeChatPeerId, clearToastTimer, dismissToast]
  )

  const loadNotifications = useCallback(() => {
    authApi
      .notifications()
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch(() => setItems([]))
  }, [])

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
              const previousItem = index >= 0 ? prev[index] : null
              const shouldToast = !payload.data.is_read && isChatNotification(payload.data) && (!previousItem || previousItem.is_read)

              if (shouldToast) enqueueToast(payload.data)
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
  }, [enqueueToast, loadNotifications])

  useEffect(() => {
    return () => {
      for (const timer of toastTimersRef.current.values()) {
        clearTimeout(timer)
      }
      toastTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined

    const handlePointer = (event) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(event.target)) setOpen(false)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer)
    window.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    if (window.innerWidth > 700) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const unreadCount = useMemo(() => items.filter((i) => !i.is_read).length, [items])

  const handleAction = async (fn) => {
    setActionError('')
    try {
      await fn()
    } catch (err) {
      setActionError(err.response?.data?.detail || 'Не удалось выполнить действие.')
    }
  }

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
    <div className={`notification-wrap ${open ? 'is-open' : ''}`} ref={wrapRef}>
      {open && <button type="button" className="notification-backdrop" aria-label="Закрыть уведомления" onClick={() => setOpen(false)} />}
      <button
        type="button"
        className="notification-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        aria-expanded={open}
      >
        <span className="notification-icon" aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-popover" role="dialog" aria-label="Уведомления">
          <div className="notification-popover-head">
            <strong>Уведомления</strong>
            <div className="notification-popover-controls">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleAction(async () => authApi.notificationsReadAll().then(loadNotifications))}
              >
                Прочитать все
              </button>
              <button type="button" className="btn btn-ghost notification-close-btn" onClick={() => setOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>

          {actionError && <div className="alert alert-error notification-error">{actionError}</div>}

          {items.length === 0 ? (
            <p className="notification-empty">Уведомлений нет.</p>
          ) : (
            <ul className="notification-list">
              {items.map((notification) => {
                const chatNotification = isChatNotification(notification)
                const chatLink = getChatLink(notification)

                return (
                  <li key={notification.id} className={`notification-item ${notification.is_read ? 'is-read' : ''}`}>
                    <div className="notification-texts">
                      <strong>{notification.title}</strong>
                      {notification.message && <p>{notification.message}</p>}
                    </div>
                    {notification.type === 'friend_request' && !notification.is_read && (
                      <div className="notification-actions">
                        <button type="button" className="btn btn-primary" onClick={() => handleAction(() => acceptFriend(notification))}>
                          Принять
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => declineFriend(notification))}>
                          Отклонить
                        </button>
                      </div>
                    )}
                    {notification.type === 'room_invite' && (
                      <div className="notification-actions">
                        <button type="button" className="btn btn-primary" onClick={() => handleAction(() => acceptRoomInvite(notification))}>
                          Войти
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => declineRoomInvite(notification))}>
                          Отклонить
                        </button>
                        <Link to={`/rooms/${notification.payload?.room_code || ''}`} onClick={() => setOpen(false)}>
                          Открыть
                        </Link>
                      </div>
                    )}
                    {chatNotification && (
                      <div className="notification-actions">
                        <Link
                          to={chatLink}
                          onClick={() => {
                            setOpen(false)
                            dismissToast(notification.id)
                            if (!notification.is_read) {
                              markAsRead(notification.id).catch(() => {})
                            }
                          }}
                        >
                          Открыть чат
                        </Link>
                        {!notification.is_read && (
                          <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => markAsRead(notification.id))}>
                            Прочитано
                          </button>
                        )}
                      </div>
                    )}
                    {notification.type !== 'friend_request' && notification.type !== 'room_invite' && !chatNotification && !notification.is_read && (
                      <div className="notification-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => handleAction(() => markAsRead(notification.id))}>
                          Прочитать
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {toasts.length > 0 && (
        <div className="notification-toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className="notification-toast">
              <div className="notification-toast-texts">
                <strong>{toast.title}</strong>
                {toast.message && <p>{toast.message}</p>}
              </div>
              <div className="notification-toast-actions">
                <Link
                  to={toast.link}
                  onClick={() => {
                    dismissToast(toast.id)
                    markAsRead(toast.notificationId).catch(() => {})
                  }}
                >
                  Открыть чат
                </Link>
                <button type="button" className="btn btn-ghost" onClick={() => dismissToast(toast.id)}>
                  Закрыть
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
