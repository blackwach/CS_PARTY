import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/rooms')
    } catch (err) {
      const d = err.response?.data
      const msg = (typeof d?.detail === 'string' ? d.detail : Array.isArray(d?.detail) ? d.detail[0] : d?.non_field_errors?.[0]) || d?.email?.[0] || 'Неверный email или пароль.'
      setError(typeof msg === 'string' ? msg : 'Ошибка входа.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h2 className="page-title">Вход</h2>
      <p className="page-subtitle">Введите email и пароль</p>
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
            placeholder="you@example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
          <Link to="/forgot-password" className="btn btn-ghost">Забыли пароль?</Link>
        </div>
      </form>
      <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        Нет аккаунта? <Link to="/register">Регистрация</Link>
      </p>
    </div>
  )
}
