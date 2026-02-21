import { useState, useEffect } from 'react'
import { api, auth as authApi } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Profile() {
  const { user, updateProfile } = useAuth()
  const [form, setForm] = useState({
    nickname: '',
    initials: '',
    steam_profile_url: '',
    telegram_notifications_enabled: true,
  })
  const [passwordForm, setPasswordForm] = useState({
    old_password: '',
    new_password: '',
    new_password_confirm: '',
  })
  const [linkCode, setLinkCode] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setForm({
        nickname: user.nickname || '',
        initials: user.initials || '',
        steam_profile_url: user.steam_profile_url || '',
        telegram_notifications_enabled: user.telegram_notifications_enabled !== false,
      })
    }
  }, [user])

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({
      ...f,
      [name]: e.target.type === 'checkbox' ? e.target.checked : value,
    }))
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const payload = {
        nickname: form.nickname,
        initials: form.initials,
        steam_profile_url: (form.steam_profile_url || '').trim() || '',
        telegram_notifications_enabled: form.telegram_notifications_enabled,
      }
      const { data } = await api.patch('/api/auth/me/', payload)
      updateProfile(data)
      setMessage('Профиль сохранён')
    } catch (err) {
      const d = err.response?.data
      setError(d?.nickname?.[0] || d?.initials?.[0] || d?.steam_profile_url?.[0] || 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (passwordForm.new_password !== passwordForm.new_password_confirm) {
      setError('Пароли не совпадают')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      await authApi.passwordChange(passwordForm.old_password, passwordForm.new_password)
      setMessage('Пароль изменён')
      setPasswordForm({ old_password: '', new_password: '', new_password_confirm: '' })
    } catch (err) {
      setError(
        err.response?.data?.old_password?.[0] ||
          err.response?.data?.new_password?.[0] ||
          'Ошибка смены пароля'
      )
    } finally {
      setLoading(false)
    }
  }

  const requestTelegramCode = async () => {
    setError('')
    setLinkCode(null)
    setLoading(true)
    try {
      const { data } = await authApi.telegramLinkCode()
      setLinkCode(data)
    } catch {
      setError('Не удалось получить код')
    } finally {
      setLoading(false)
    }
  }

  const toggleTelegram = async (enabled) => {
    setLoading(true)
    try {
      await authApi.telegramToggle(enabled)
      updateProfile({ telegram_notifications_enabled: enabled })
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <>
      <h1 className="page-title">Профиль</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="panel">
        <h2>Основное</h2>
        <form onSubmit={saveProfile}>
          <div className="form-group">
            <label>Email</label>
            <input type="text" value={user.email || ''} readOnly disabled style={{ opacity: 0.8 }} />
          </div>
          <div className="form-group">
            <label htmlFor="nickname">Никнейм</label>
            <input
              id="nickname"
              name="nickname"
              value={form.nickname}
              onChange={handleChange}
              maxLength={40}
            />
          </div>
          <div className="form-group">
            <label htmlFor="initials">Инициалы</label>
            <input
              id="initials"
              name="initials"
              value={form.initials}
              onChange={handleChange}
              maxLength={16}
            />
          </div>
          <div className="form-group">
            <label htmlFor="steam_profile_url">Ссылка на профиль Steam (для CS2)</label>
            <input
              id="steam_profile_url"
              name="steam_profile_url"
              type="url"
              value={form.steam_profile_url}
              onChange={handleChange}
              placeholder="https://steamcommunity.com/profiles/76561198..."
            />
            <p className="form-hint">
              Укажите ссылку один раз, затем можно редактировать. Формат: steamcommunity.com/profiles/ваш_17-значный_ID
            </p>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Сохранение…' : 'Сохранить'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Telegram</h2>
        {user.telegram_chat_id ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Привязан: @{user.telegram_username || 'id ' + user.telegram_chat_id}
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Получите код и отправьте его боту в Telegram.
            </p>
            {linkCode && (
              <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>
                Код: <strong style={{ fontFamily: 'var(--font-mono)' }}>{linkCode.code}</strong>
                <br />
                <small>Действует до {new Date(linkCode.expires_at).toLocaleString()}</small>
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={requestTelegramCode}
              disabled={loading}
            >
              {linkCode ? 'Обновить код' : 'Получить код'}
            </button>
          </>
        )}
        {user.telegram_chat_id && (
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.telegram_notifications_enabled}
                onChange={(e) => {
                  handleChange(e)
                  toggleTelegram(e.target.checked)
                }}
              />
              Уведомления в Telegram
            </label>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Смена пароля</h2>
        <form onSubmit={changePassword}>
          <div className="form-group">
            <label htmlFor="old_password">Текущий пароль</label>
            <input
              id="old_password"
              type="password"
              value={passwordForm.old_password}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, old_password: e.target.value }))
              }
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="new_password">Новый пароль</label>
            <input
              id="new_password"
              type="password"
              value={passwordForm.new_password}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, new_password: e.target.value }))
              }
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label htmlFor="new_password_confirm">Повторите новый пароль</label>
            <input
              id="new_password_confirm"
              type="password"
              value={passwordForm.new_password_confirm}
              onChange={(e) =>
                setPasswordForm((p) => ({ ...p, new_password_confirm: e.target.value }))
              }
              required
              minLength={8}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Сменить пароль
          </button>
        </form>
      </div>
    </>
  )
}
