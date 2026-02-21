import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { auth as authApi, getWsBase } from '../api'
import { useAuth } from '../context/AuthContext'

const POLL_FAST_MS = 2000
const POLL_SLOW_MS = 8000
const POLL_PRESENCE_MS = 10000
const PENDING_MATCH_WINDOW_MS = 30_000

function toEpoch(value) {
  const parsed = Date.parse(value || '')
  return Number.isNaN(parsed) ? 0 : parsed
}

function sortMessages(items) {
  return [...items].sort((left, right) => {
    const byTime = toEpoch(left?.created_at) - toEpoch(right?.created_at)
    if (byTime !== 0) return byTime
    return String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}

function isLikelySameMessage(left, right) {
  if (!left || !right) return false
  if (left.sender?.id !== right.sender?.id) return false
  if (left.text !== right.text) return false
  return Math.abs(toEpoch(left.created_at) - toEpoch(right.created_at)) <= PENDING_MATCH_WINDOW_MS
}

function upsertServerMessage(prev, incoming, preferredTempId = '') {
  if (!incoming || incoming.id === undefined || incoming.id === null) return prev
  const serverId = String(incoming.id)
  const normalized = { ...incoming, pending: false }

  let replaced = false
  const replacedById = prev.map((item) => {
    if (String(item.id) === serverId) {
      replaced = true
      return normalized
    }
    if (preferredTempId && String(item.id) === preferredTempId) {
      replaced = true
      return normalized
    }
    return item
  })
  if (replaced) return sortMessages(replacedById)

  const similarPendingIndex = replacedById.findIndex((item) => item.pending && isLikelySameMessage(item, incoming))
  if (similarPendingIndex >= 0) {
    const next = [...replacedById]
    next[similarPendingIndex] = normalized
    return sortMessages(next)
  }

  return sortMessages([...replacedById, normalized])
}

function mergeWithServerState(prev, serverItems) {
  const serverList = Array.isArray(serverItems) ? serverItems : []
  const merged = serverList.reduce((acc, item) => upsertServerMessage(acc, item), prev.filter((item) => item.pending))
  return sortMessages(merged)
}

function formatLastSeen(value) {
  if (!value) return 'Был(а) давно'
  return `Был(а) ${new Date(value).toLocaleString()}`
}

export default function Chat() {
  const { userId } = useParams()
  const { user } = useAuth()

  const [peer, setPeer] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [wsConnected, setWsConnected] = useState(false)

  const socketRef = useRef(null)
  const messagesWrapRef = useRef(null)

  const canChat = peer?.can_chat === true
  const peerId = Number(userId)

  const loadPeerPresence = useCallback(async () => {
    try {
      const { data } = await authApi.getUserProfile(userId)
      setPeer((prev) => {
        if (!prev) return data
        return {
          ...prev,
          is_online: data?.is_online,
          last_seen_at: data?.last_seen_at,
          can_chat: data?.can_chat,
        }
      })
    } catch {
      // ignore presence refresh errors
    }
  }, [userId])

  const loadMessages = useCallback(async (silent = false) => {
    if (!canChat) return
    try {
      const { data } = await authApi.chatMessages(userId)
      setMessages((prev) => mergeWithServerState(prev, data))
    } catch (err) {
      if (err.response?.status === 403) {
        setPeer((prev) => (prev ? { ...prev, can_chat: false } : prev))
      }
      if (!silent) {
        setError(err.response?.data?.detail || 'Не удалось загрузить сообщения.')
      }
    }
  }, [canChat, userId])

  useEffect(() => {
    let active = true

    setLoading(true)
    setError('')
    setMessages([])
    setPeer(null)

    ;(async () => {
      try {
        const profileRes = await authApi.getUserProfile(userId)
        if (!active) return

        const profile = profileRes.data
        setPeer(profile)

        if (profile?.can_chat) {
          const messagesRes = await authApi.chatMessages(userId)
          if (!active) return
          setMessages(mergeWithServerState([], messagesRes.data))
        } else {
          setError('Чат доступен только между друзьями.')
        }
      } catch (err) {
        if (!active) return
        setError(err.response?.data?.detail || 'Не удалось загрузить чат.')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    if (!canChat) {
      setWsConnected(false)
      return undefined
    }

    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase) return undefined

    let ws = null
    try {
      ws = new WebSocket(`${wsBase}/ws/chat/${userId}/?token=${encodeURIComponent(token)}`)
      socketRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        ws.send(JSON.stringify({ type: 'messages.read' }))
      }
      ws.onerror = () => setWsConnected(false)
      ws.onclose = () => setWsConnected(false)
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'message.new' && payload.data) {
            setMessages((prev) => upsertServerMessage(prev, payload.data))
          }
          if (payload.type === 'message.read' && payload.data) {
            const readAt = payload.data.read_at || null
            const messageIds = new Set((payload.data.message_ids || []).map((item) => String(item)))
            setMessages((prev) =>
              prev.map((item) => (messageIds.has(String(item.id)) ? { ...item, read_at: readAt } : item))
            )
          }
          if (payload.type === 'presence.update' && payload.data) {
            if (Number(payload.data.user_id) === peerId) {
              setPeer((prev) => (prev ? { ...prev, is_online: payload.data.is_online, last_seen_at: payload.data.last_seen_at } : prev))
            }
          }
          if (payload.type === 'error' && payload.detail) {
            setError(payload.detail)
          }
        } catch {
          // ignore malformed events
        }
      }
    } catch {
      socketRef.current = null
      setWsConnected(false)
    }

    return () => {
      if (ws) ws.close()
      if (socketRef.current === ws) socketRef.current = null
      setWsConnected(false)
    }
  }, [canChat, userId, peerId])

  useEffect(() => {
    if (!canChat) return undefined
    const intervalMs = wsConnected ? POLL_SLOW_MS : POLL_FAST_MS
    const timer = setInterval(() => loadMessages(true), intervalMs)
    return () => clearInterval(timer)
  }, [canChat, wsConnected, loadMessages])

  useEffect(() => {
    if (!canChat) return undefined
    const timer = setInterval(() => loadPeerPresence(), POLL_PRESENCE_MS)
    return () => clearInterval(timer)
  }, [canChat, loadPeerPresence])

  useEffect(() => {
    const container = messagesWrapRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [messages])

  const send = async (e) => {
    e.preventDefault()
    if (!canChat || sending) return

    const trimmed = text.trim()
    if (!trimmed) return

    setError('')
    setSending(true)
    setText('')

    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const optimisticMessage = {
      id: tempId,
      text: trimmed,
      created_at: new Date().toISOString(),
      read_at: null,
      sender: user
        ? {
            id: user.id,
            nickname: user.nickname,
            avatar: user.avatar || null,
          }
        : null,
      pending: true,
    }
    setMessages((prev) => sortMessages([...prev, optimisticMessage]))

    try {
      const { data } = await authApi.chatSend(userId, trimmed)
      setMessages((prev) => upsertServerMessage(prev, data, tempId))
    } catch (err) {
      setMessages((prev) => prev.filter((item) => String(item.id) !== tempId))
      setText(trimmed)
      if (err.response?.status === 403) {
        setPeer((prev) => (prev ? { ...prev, can_chat: false } : prev))
      }
      setError(err.response?.data?.detail || 'Не удалось отправить сообщение.')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <>
      <h1 className="page-title">Чат {peer ? `с ${peer.nickname}` : ''}</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {peer && (
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <Link to={`/users/${peer.id}`}>Открыть профиль</Link>
          <span className={`chat-presence ${peer.is_online ? 'is-online' : ''}`}>
            {peer.is_online ? 'В сети' : formatLastSeen(peer.last_seen_at)}
          </span>
          {canChat && (
            <span className="chat-transport-status">
              {wsConnected ? 'Синхронизация: онлайн' : 'Синхронизация: резервный режим'}
            </span>
          )}
        </div>
      )}
      <div className="panel chat-panel">
        <div className="chat-messages" ref={messagesWrapRef}>
          {messages.map((message) => {
            const mine = user && message.sender?.id === user.id
            return (
              <div
                key={String(message.id)}
                className={`chat-bubble ${mine ? 'is-mine' : ''} ${message.pending ? 'is-pending' : ''}`}
              >
                <div className="chat-bubble-head">
                  <strong>{mine ? 'Вы' : message.sender?.nickname}</strong>
                  <span>{new Date(message.created_at).toLocaleString()}</span>
                </div>
                <div>
                  {message.text}
                  {message.pending && <span className="chat-pending-label"> отправка...</span>}
                </div>
                {mine && !message.pending && (
                  <div className="chat-read-state">
                    {message.read_at ? `Прочитано ${new Date(message.read_at).toLocaleTimeString()}` : 'Не прочитано'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <form onSubmit={send} className="chat-form">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={canChat ? 'Введите сообщение...' : 'Чат недоступен'}
            maxLength={4000}
            disabled={!canChat || sending}
          />
          <button type="submit" className="btn btn-primary" disabled={!canChat || sending || !text.trim()}>
            {sending ? 'Отправка...' : 'Отправить'}
          </button>
        </form>
      </div>
    </>
  )
}
