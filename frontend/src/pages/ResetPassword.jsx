import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { auth } from '../api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 8) {
      setError('Пароль не менее 8 символов')
      return
    }
    setError('')
    setLoading(true)
    try {
      await auth.passwordResetConfirm(token, password)
      setSuccess(true)
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.new_password?.[0]
      setError(msg || 'Ошибка сброса. Ссылка могла истечь.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
        <div className="alert alert-success">Пароль успешно изменён.</div>
        <Link to="/login" className="btn btn-primary">Войти</Link>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
        <div className="alert alert-error">Нет токена в ссылке. Используйте ссылку из письма.</div>
        <Link to="/forgot-password" className="btn btn-primary">Запросить сброс</Link>
      </div>
    )
  }

  return (
    <div className="panel" style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h2 className="page-title">Новый пароль</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="password">Новый пароль (мин. 8)</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password_confirm">Повторите пароль</label>
          <input
            id="password_confirm"
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Сохранение…' : 'Сохранить'}
          </button>
          <Link to="/login" className="btn btn-ghost">Отмена</Link>
        </div>
      </form>
    </div>
  )
}
