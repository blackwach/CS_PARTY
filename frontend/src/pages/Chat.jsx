import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { auth as authApi, getWsBase } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Chat() {
  const { userId } = useParams()
  const { user } = useAuth()
  const [peer, setPeer] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [socket, setSocket] = useState(null)

  const load = () => {
    Promise.all([
      authApi.getUserProfile(userId),
      authApi.chatMessages(userId),
    ])
      .then(([profileRes, messagesRes]) => {
        setPeer(profileRes.data)
        setMessages(Array.isArray(messagesRes.data) ? messagesRes.data : [])
      })
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось загрузить чат.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const token = localStorage.getItem('access')
    const wsBase = getWsBase()
    if (!token || !wsBase) return undefined
    let ws = null
    try {
      ws = new WebSocket(`${wsBase}/ws/chat/${userId}/?token=${encodeURIComponent(token)}`)
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.type === 'message.new' && payload.data) {
            setMessages((prev) => {
              if (prev.some((item) => item.id === payload.data.id)) return prev
              return [...prev, payload.data]
            })
          }
          if (payload.type === 'error' && payload.detail) {
            setError(payload.detail)
          }
        } catch {
          // ignore malformed events
        }
      }
      setSocket(ws)
    } catch {
      setSocket(null)
    }
    return () => {
      setSocket(null)
      if (ws) ws.close()
    }
  }, [userId])

  const send = async (e) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setError('')
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'message.send', text: trimmed }))
      } else {
        const { data } = await authApi.chatSend(userId, trimmed)
        setMessages((prev) => (prev.some((item) => item.id === data.id) ? prev : [...prev, data]))
      }
      setText('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось отправить сообщение.')
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
        <div style={{ marginBottom: '1rem' }}>
          <Link to={`/users/${peer.id}`}>Открыть профиль</Link>
        </div>
      )}
      <div className="panel chat-panel">
        <div className="chat-messages">
          {messages.map((message) => {
            const mine = user && message.sender?.id === user.id
            return (
              <div key={message.id} className={`chat-bubble ${mine ? 'is-mine' : ''}`}>
                <div className="chat-bubble-head">
                  <strong>{mine ? 'Вы' : message.sender?.nickname}</strong>
                  <span>{new Date(message.created_at).toLocaleString()}</span>
                </div>
                <div>{message.text}</div>
              </div>
            )
          })}
        </div>
        <form onSubmit={send} className="chat-form">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Введите сообщение..."
            maxLength={4000}
          />
          <button type="submit" className="btn btn-primary">Отправить</button>
        </form>
      </div>
    </>
  )
}
