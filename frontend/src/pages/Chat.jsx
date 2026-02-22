import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { auth as authApi, getWsBase } from '../api'
import { useAuth } from '../context/AuthContext'

const WS_RECONNECT_BASE_MS = 750
const WS_RECONNECT_MAX_MS = 12000
const PRESENCE_REFRESH_MS = 15000
const PENDING_MATCH_WINDOW_MS = 30_000
const SCROLL_BOTTOM_EPSILON = 72
const TYPING_STOP_DEBOUNCE_MS = 1800
const TYPING_REMOTE_TTL_MS = 2600

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
  const normalized = { ...incoming, pending: false, failed: false, error_detail: '' }

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

  const similarPendingIndex = replacedById.findIndex(
    (item) => (item.pending || item.failed) && isLikelySameMessage(item, incoming)
  )
  if (similarPendingIndex >= 0) {
    const next = [...replacedById]
    next[similarPendingIndex] = normalized
    return sortMessages(next)
  }

  return sortMessages([...replacedById, normalized])
}

function mergeWithServerState(prev, serverItems) {
  const serverList = Array.isArray(serverItems) ? serverItems : []
  const localRetained = prev.filter((item) => item.pending || item.failed)
  const merged = serverList.reduce((acc, item) => upsertServerMessage(acc, item), localRetained)
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
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)

  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const messagesWrapRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const forceScrollRef = useRef(true)
  const prevMessageCountRef = useRef(0)
  const typingSentRef = useRef(false)
  const typingStopTimerRef = useRef(null)
  const remoteTypingTimerRef = useRef(null)

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

  const loadMessages = useCallback(
    async (silent = false) => {
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
    },
    [canChat, userId]
  )

  const emitTyping = useCallback(
    (isTyping) => {
      const ws = socketRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: isTyping ? 'typing.start' : 'typing.stop' }))
    },
    []
  )

  const stopTypingSignal = useCallback(() => {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
    }
    if (typingSentRef.current) {
      emitTyping(false)
      typingSentRef.current = false
    }
  }, [emitTyping])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setMessages([])
    setPeer(null)
    setHasUnreadBelow(false)
    setPeerTyping(false)
    forceScrollRef.current = true
    prevMessageCountRef.current = 0
    typingSentRef.current = false

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
      stopTypingSignal()
      if (remoteTypingTimerRef.current) {
        clearTimeout(remoteTypingTimerRef.current)
        remoteTypingTimerRef.current = null
      }
    }
  }, [userId, stopTypingSignal])

  useEffect(() => {
    if (!canChat) {
      setWsConnected(false)
      return undefined
    }

    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase) return undefined

    let isDisposed = false

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (isDisposed) return
      clearReconnectTimer()
      const delay = Math.min(WS_RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, WS_RECONNECT_MAX_MS)
      reconnectAttemptsRef.current += 1
      reconnectTimerRef.current = setTimeout(() => {
        connectSocket()
      }, delay)
    }

    const connectSocket = () => {
      if (isDisposed) return

      try {
        const ws = new WebSocket(`${wsBase}/ws/chat/${userId}/?token=${encodeURIComponent(token)}`)
        socketRef.current = ws

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0
          setWsConnected(true)
          ws.send(JSON.stringify({ type: 'messages.read' }))
          loadMessages(true)
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
          stopTypingSignal()
          if (socketRef.current === ws) socketRef.current = null
          scheduleReconnect()
        }

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload.type === 'message.new' && payload.data) {
              if (Number(payload.data.sender?.id) === Number(user?.id)) {
                forceScrollRef.current = true
              }
              setMessages((prev) => upsertServerMessage(prev, payload.data))
            }
            if (payload.type === 'message.read' && payload.data) {
              const readAt = payload.data.read_at || null
              const messageIds = new Set((payload.data.message_ids || []).map((item) => String(item)))
              setMessages((prev) =>
                prev.map((item) => (messageIds.has(String(item.id)) ? { ...item, read_at: readAt } : item))
              )
            }
            if (payload.type === 'typing.state' && payload.data) {
              if (Number(payload.data.user_id) === peerId) {
                const isTyping = Boolean(payload.data.is_typing)
                setPeerTyping(isTyping)
                if (remoteTypingTimerRef.current) clearTimeout(remoteTypingTimerRef.current)
                if (isTyping) {
                  remoteTypingTimerRef.current = setTimeout(() => {
                    setPeerTyping(false)
                  }, TYPING_REMOTE_TTL_MS)
                }
              }
            }
            if (payload.type === 'presence.update' && payload.data) {
              if (Number(payload.data.user_id) === peerId) {
                setPeer((prev) =>
                  prev ? { ...prev, is_online: payload.data.is_online, last_seen_at: payload.data.last_seen_at } : prev
                )
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
        setWsConnected(false)
        scheduleReconnect()
      }
    }

    connectSocket()

    return () => {
      isDisposed = true
      clearReconnectTimer()
      stopTypingSignal()
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
  }, [canChat, userId, peerId, user?.id, loadMessages, stopTypingSignal])

  useEffect(() => {
    if (!canChat) return undefined
    const timer = setInterval(() => loadPeerPresence(), PRESENCE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [canChat, loadPeerPresence])

  useEffect(() => {
    if (loading) return undefined
    const container = messagesWrapRef.current
    if (!container) return undefined

    const updateStickyState = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const isAtBottom = distanceToBottom <= SCROLL_BOTTOM_EPSILON
      stickToBottomRef.current = isAtBottom
      if (isAtBottom) setHasUnreadBelow(false)
    }

    updateStickyState()
    container.addEventListener('scroll', updateStickyState, { passive: true })
    return () => container.removeEventListener('scroll', updateStickyState)
  }, [loading])

  useEffect(() => {
    const container = messagesWrapRef.current
    if (!container) return

    const hadNewMessages = messages.length > prevMessageCountRef.current
    const newestMessage = messages[messages.length - 1]
    const newestFromPeer = newestMessage && Number(newestMessage.sender?.id) !== Number(user?.id)

    if (forceScrollRef.current || stickToBottomRef.current) {
      container.scrollTop = container.scrollHeight
      stickToBottomRef.current = true
      setHasUnreadBelow(false)
    } else if (hadNewMessages && newestFromPeer) {
      setHasUnreadBelow(true)
    }

    prevMessageCountRef.current = messages.length
    forceScrollRef.current = false
  }, [messages, user?.id])

  const scrollToBottom = () => {
    const container = messagesWrapRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    stickToBottomRef.current = true
    forceScrollRef.current = false
    setHasUnreadBelow(false)
  }

  const markMessageFailed = (localId, detail = '') => {
    setMessages((prev) =>
      prev.map((item) =>
        String(item.id) === String(localId)
          ? { ...item, pending: false, failed: true, error_detail: detail || 'Не удалось отправить.' }
          : item
      )
    )
  }

  const transmitMessage = async (localId, outgoingText) => {
    try {
      const { data } = await authApi.chatSend(userId, outgoingText)
      setMessages((prev) => upsertServerMessage(prev, data, localId))
      return true
    } catch (err) {
      const detail = err.response?.data?.detail || 'Не удалось отправить.'
      markMessageFailed(localId, detail)
      if (err.response?.status === 403) {
        setPeer((prev) => (prev ? { ...prev, can_chat: false } : prev))
      }
      setError(detail)
      return false
    }
  }

  const retryMessage = async (localId) => {
    const target = messages.find((item) => String(item.id) === String(localId))
    if (!target || target.pending || !target.failed) return

    setMessages((prev) =>
      prev.map((item) =>
        String(item.id) === String(localId) ? { ...item, pending: true, failed: false, error_detail: '' } : item
      )
    )
    forceScrollRef.current = true
    await transmitMessage(localId, target.text)
  }

  const handleInputChange = (value) => {
    setText(value)
    if (!canChat || !wsConnected) return

    const hasText = Boolean(value.trim())
    if (hasText && !typingSentRef.current) {
      emitTyping(true)
      typingSentRef.current = true
    }

    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
    }

    if (!hasText) {
      stopTypingSignal()
      return
    }

    typingStopTimerRef.current = setTimeout(() => {
      stopTypingSignal()
    }, TYPING_STOP_DEBOUNCE_MS)
  }

  const send = async (e) => {
    e.preventDefault()
    if (!canChat || sending) return

    const trimmed = text.trim()
    if (!trimmed) return

    setError('')
    setSending(true)
    setText('')
    forceScrollRef.current = true
    stopTypingSignal()

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
      failed: false,
      error_detail: '',
    }
    setMessages((prev) => sortMessages([...prev, optimisticMessage]))

    await transmitMessage(tempId, trimmed)
    setSending(false)
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
        <div className="chat-topbar">
          <Link to={`/users/${peer.id}`}>Открыть профиль</Link>
          <Link to="/chats">Все диалоги</Link>
          <span className={`chat-presence ${peer.is_online ? 'is-online' : ''}`}>
            {peer.is_online ? 'В сети' : formatLastSeen(peer.last_seen_at)}
          </span>
          {canChat && (
            <span className="chat-transport-status">{wsConnected ? 'Синхронизация: онлайн' : 'Синхронизация: переподключение'}</span>
          )}
          {peerTyping && <span className="chat-typing">печатает...</span>}
        </div>
      )}

      <div className="panel chat-panel chat-panel-updated">
        <div className="chat-messages-wrap">
          <div className="chat-messages" ref={messagesWrapRef}>
            {messages.length === 0 && <div className="chat-empty">Пока нет сообщений. Напишите первым.</div>}

            {messages.map((message) => {
              const mine = user && message.sender?.id === user.id
              return (
                <div key={String(message.id)} className={`chat-row ${mine ? 'is-mine' : ''}`}>
                  <div className={`chat-bubble ${mine ? 'is-mine' : ''} ${message.pending ? 'is-pending' : ''} ${message.failed ? 'is-failed' : ''}`}>
                    <div className="chat-bubble-head">
                      <strong>{mine ? 'Вы' : message.sender?.nickname}</strong>
                      <span>{new Date(message.created_at).toLocaleString()}</span>
                    </div>
                    <div className="chat-bubble-text">{message.text}</div>

                    {message.pending && <div className="chat-pending-label">Отправка...</div>}

                    {message.failed && (
                      <div className="chat-failed-row">
                        <span className="chat-failed-text">{message.error_detail || 'Не отправлено.'}</span>
                        <button type="button" className="btn btn-secondary" onClick={() => retryMessage(message.id)}>
                          Повторить
                        </button>
                      </div>
                    )}

                    {mine && !message.pending && !message.failed && (
                      <div className="chat-read-state">
                        {message.read_at ? `Прочитано ${new Date(message.read_at).toLocaleTimeString()}` : 'Не прочитано'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {hasUnreadBelow && (
            <button type="button" className="btn btn-primary chat-jump-btn" onClick={scrollToBottom}>
              Новые сообщения
            </button>
          )}
        </div>

        <form onSubmit={send} className="chat-form">
          <input
            type="text"
            value={text}
            onChange={(e) => handleInputChange(e.target.value)}
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
