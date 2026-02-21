import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const [form, setForm] = useState({
    email: '',
    nickname: '',
    birth_date: '',
    initials: '',
    password: '',
    password_confirm: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register({
        ...form,
        username: form.nickname.replace(/\s/g, '_').toLowerCase().slice(0, 30) || undefined,
      })
      setSuccess(true)
    } catch (err) {
      const data = err.response?.data
      if (data) {
        const first = data.email?.[0] || data.nickname?.[0] || data.password?.[0]
          || data.password_confirm?.[0] || data.birth_date?.[0] || data.initials?.[0]
          || (typeof data.password_confirm === 'object' && data.password_confirm?.password_confirm)
        setError(first || 'Ошибка регистрации')
      } else {
        setError('Ошибка регистрации')
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="panel" style={{ maxWidth: 440, margin: '2rem auto' }}>
        <div className="alert alert-success">
          <strong>Регистрация прошла успешно.</strong> Проверьте почту и перейдите по ссылке для подтверждения email, после этого можно войти.
        </div>
        <Link to="/login" className="btn btn-primary">Перейти к входу</Link>
      </div>
    )
  }

  return (
    <div className="panel" style={{ maxWidth: 440, margin: '2rem auto' }}>
      <h2 className="page-title">Регистрация</h2>
      <p className="page-subtitle">18+. Укажите дату рождения и никнейм</p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            required
            autoComplete="email"
          />
        </div>
        <div className="form-group">
          <label htmlFor="nickname">Никнейм</label>
          <input
            id="nickname"
            name="nickname"
            type="text"
            value={form.nickname}
            onChange={handleChange}
            required
            maxLength={40}
            placeholder="В игре"
          />
        </div>
        <div className="form-group">
          <label htmlFor="initials">Инициалы (2–3 буквы)</label>
          <input
            id="initials"
            name="initials"
            type="text"
            value={form.initials}
            onChange={handleChange}
            required
            maxLength={16}
            placeholder="AB"
          />
        </div>
        <div className="form-group">
          <label htmlFor="birth_date">Дата рождения</label>
          <input
            id="birth_date"
            name="birth_date"
            type="date"
            value={form.birth_date}
            onChange={handleChange}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Пароль (мин. 8 символов)</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password_confirm">Повторите пароль</label>
          <input
            id="password_confirm"
            name="password_confirm"
            type="password"
            value={form.password_confirm}
            onChange={handleChange}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Отправка…' : 'Зарегистрироваться'}
          </button>
          <Link to="/login" className="btn btn-secondary">Отмена</Link>
        </div>
      </form>
    </div>
  )
}
