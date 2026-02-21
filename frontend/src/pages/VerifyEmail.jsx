import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { auth } from '../api'

export default function VerifyEmail() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | success | error
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('Нет токена в ссылке.')
      return
    }
    auth
      .verifyEmail(token)
      .then((res) => {
        setStatus(res.data.success ? 'success' : 'error')
        setMessage(res.data.message || (res.data.success ? 'Почта подтверждена.' : 'Ссылка недействительна или истекла.'))
      })
      .catch(() => {
        setStatus('error')
        setMessage('Ошибка проверки. Ссылка могла истечь.')
      })
  }, [token])

  if (status === 'loading') {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <div className="panel" style={{ maxWidth: 440, margin: '2rem auto' }}>
      {status === 'success' ? (
        <div className="alert alert-success">{message}</div>
      ) : (
        <div className="alert alert-error">{message}</div>
      )}
      <Link to="/login" className="btn btn-primary">Перейти к входу</Link>
    </div>
  )
}
