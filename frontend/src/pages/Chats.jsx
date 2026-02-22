import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { auth as authApi, getWsBase } from '../api'
import { useAuth } from '../context/AuthContext'

const WS_RECONNECT_BASE_MS = 900
const WS_RECONNECT_MAX_MS = 12000
const FALLBACK_REFRESH_MS = 30000

function formatDialogTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return sameDay ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('ru-RU')
}

function extractPreview(dialog) {
  const msg = dialog?.last_message
  if (!msg) return 'Сообщений пока нет'
  const text = String(msg.text || '').trim()
  if (!text) return 'Сообщение без текста'
  return text.length > 100 ? `${text.slice(0, 100)}...` : text
}

export default function Chats() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [dialogs, setDialogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const socketRef = useRef(null)

  const loadDialogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await authApi.chats()
      setDialogs(Array.isArray(data) ? data : [])
      if (!silent) setError('')
    } catch {
      if (!silent) setError('Не удалось загрузить список диалогов.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDialogs(false)
    const timer = setInterval(() => loadDialogs(true), FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadDialogs])

  useEffect(() => {
    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase) {
      setWsConnected(false)
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
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, WS_RECONNECT_MAX_MS)
      reconnectAttemptsRef.current += 1
      reconnectTimerRef.current = setTimeout(() => {
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      if (disposed) return

      try {
        const ws = new WebSocket(`${wsBase}/ws/chats/?token=${encodeURIComponent(token)}`)
        socketRef.current = ws

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0
          setWsConnected(true)
          ws.send(JSON.stringify({ type: 'dialogs.sync' }))
        }

        ws.onerror = () => {
          setWsConnected(false)
          try {
            ws.close()
          } catch {
            // ignore close errors
          }
        }

        ws.onclose = () => {
          setWsConnected(false)
          if (socketRef.current === ws) socketRef.current = null
          scheduleReconnect()
        }

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload.type === 'dialogs.refresh') {
              loadDialogs(true)
            }
          } catch {
            // ignore malformed events
          }
        }
      } catch {
        setWsConnected(false)
        scheduleReconnect()
      }
    }

    connectSocket()

    return () => {
      disposed = true
      clearReconnect()
      const ws = socketRef.current
      if (ws) {
        try {
          ws.close()
        } catch {
          // ignore close errors
        }
      }
      socketRef.current = null
      setWsConnected(false)
    }
  }, [loadDialogs])

  const sortedDialogs = useMemo(() => {
    return [...dialogs].sort((left, right) => {
      const leftUnread = Number(left?.unread_count || 0)
      const rightUnread = Number(right?.unread_count || 0)
      if (leftUnread !== rightUnread) return rightUnread - leftUnread

      const leftTs = Date.parse(left?.last_message?.created_at || '') || 0
      const rightTs = Date.parse(right?.last_message?.created_at || '') || 0
      return rightTs - leftTs
    })
  }, [dialogs])

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <>
      <div className="chats-head">
        <div>
          <h1 className="page-title">Диалоги</h1>
          <p className="chats-subtitle">{wsConnected ? 'Обновление: realtime' : 'Обновление: fallback-режим'}</p>
        </div>
        <div className="chats-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => loadDialogs(false)}>
            Обновить
          </button>
          <Link to="/rooms" className="btn btn-secondary">
            К комнатам
          </Link>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {sortedDialogs.length === 0 ? (
        <div className="panel">
          <p className="chats-empty">У вас пока нет активных диалогов с друзьями.</p>
        </div>
      ) : (
        <div className="chats-list">
          {sortedDialogs.map((dialog) => {
            const friend = dialog.friend || {}
            const lastMessage = dialog.last_message
            const lastIsMine = user?.id && lastMessage?.sender?.id === user.id
            const unread = Number(dialog.unread_count || 0)

            return (
              <button
                key={String(friend.id || dialog.conversation_id)}
                type="button"
                className="chats-item"
                onClick={() => navigate(`/chat/${friend.id}`)}
              >
                <div className="chats-item-top">
                  <div className="chats-friend">
                    <span className={`friend-status-dot ${friend.is_online ? 'is-online' : ''}`} />
                    <strong>{friend.nickname || 'Пользователь'}</strong>
                  </div>
                  <span className="chats-time">{formatDialogTime(lastMessage?.created_at)}</span>
                </div>
                <div className="chats-item-bottom">
                  <span className="chats-preview">{lastIsMine ? `Вы: ${extractPreview(dialog)}` : extractPreview(dialog)}</span>
                  {unread > 0 && <span className="chats-unread">{unread}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
