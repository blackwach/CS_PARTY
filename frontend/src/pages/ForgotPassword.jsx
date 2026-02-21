import { useState } from 'react'
import { Link } from 'react-router-dom'
import { auth } from '../api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await auth.passwordResetRequest(email)
      setDone(true)
    } catch {
      setError('Не удалось отправить письмо. Проверьте email.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
        <div className="alert alert-success">
          Если аккаунт с таким email существует, на него отправлена ссылка для сброса пароля.
        </div>
        <Link to="/login" className="btn btn-primary">К входу</Link>
      </div>
    )
  }

  return (
    <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h2 className="page-title">Восстановление пароля</h2>
      <p className="page-subtitle">Введите email — отправим ссылку для сброса</p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Отправка…' : 'Отправить'}
          </button>
          <Link to="/login" className="btn btn-ghost">Назад</Link>
        </div>
      </form>
    </div>
  )
}
