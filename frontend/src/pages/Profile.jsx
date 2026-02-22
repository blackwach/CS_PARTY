import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { auth as authApi } from '../api'
import { useAuth } from '../context/AuthContext'

const TELEGRAM_BOT_LINK = (import.meta.env.VITE_TELEGRAM_BOT_LINK || 'https://t.me/blackwach_bot').trim()

export default function Profile() {
  const { user, updateProfile, loadUser } = useAuth()
  const [form, setForm] = useState({
    email: '',
    nickname: '',
    initials: '',
    about: '',
    steam_profile_url: '',
    cs2_match_token: '',
    telegram_notifications_enabled: true,
  })
  const [avatarFile, setAvatarFile] = useState(null)
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
    if (!user) return
    setForm({
      email: user.email || '',
      nickname: user.nickname || '',
      initials: user.initials || '',
      about: user.about || '',
      steam_profile_url: user.steam_profile_url || '',
      cs2_match_token: user.cs2_match_token || '',
      telegram_notifications_enabled: user.telegram_notifications_enabled !== false,
    })
  }, [user])

  const avatarPreview = useMemo(() => {
    if (avatarFile) return URL.createObjectURL(avatarFile)
    return user?.avatar || ''
  }, [avatarFile, user?.avatar])
  const telegramBotLabel = useMemo(() => TELEGRAM_BOT_LINK.replace(/^https?:\/\/t\.me\//i, '@'), [])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const payload = new FormData()
      payload.append('email', form.email.trim())
      payload.append('nickname', form.nickname.trim())
      payload.append('initials', form.initials.trim())
      payload.append('about', form.about.trim())
      payload.append('steam_profile_url', form.steam_profile_url.trim())
      payload.append('cs2_match_token', form.cs2_match_token.trim())
      payload.append('telegram_notifications_enabled', String(form.telegram_notifications_enabled))
      if (avatarFile) payload.append('avatar', avatarFile)

      const { data } = await authApi.updateMe(payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      updateProfile(data)
      await loadUser()
      setAvatarFile(null)
      if (data.pending_email && data.pending_email !== data.email) {
        setMessage('Профиль сохранен. Подтвердите новый email в письме в течение 10 минут.')
      } else {
        setMessage('Профиль сохранен.')
      }
    } catch (err) {
      const data = err.response?.data || {}
      const firstError =
        data.email?.[0] ||
        data.nickname?.[0] ||
        data.initials?.[0] ||
        data.steam_profile_url?.[0] ||
        data.cs2_match_token?.[0] ||
        data.avatar?.[0] ||
        data.detail ||
        'Не удалось сохранить профиль.'
      setError(firstError)
    } finally {
      setLoading(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    if (passwordForm.new_password !== passwordForm.new_password_confirm) {
      setError('Пароли не совпадают.')
      return
    }
    setError('')
    setMessage('')
    setLoading(true)
    try {
      await authApi.passwordChange(passwordForm.old_password, passwordForm.new_password)
      setMessage('Пароль изменён.')
      setPasswordForm({ old_password: '', new_password: '', new_password_confirm: '' })
    } catch (err) {
      setError(
        err.response?.data?.old_password?.[0] ||
          err.response?.data?.new_password?.[0] ||
          err.response?.data?.detail ||
          'Не удалось изменить пароль.'
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
      setError('Не удалось получить код для Telegram.')
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

  const requestDeleteAccount = async () => {
    setError('')
    setMessage('')
    setLoading(true)
    try {
      await authApi.deleteAccountRequest()
      setMessage('Ссылка подтверждения удаления аккаунта отправлена на почту.')
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось отправить письмо для удаления аккаунта.')
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <>
      <h1 className="page-title">Мой профиль</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <div className="panel">
        <h2>Основная информация</h2>
        <form onSubmit={saveProfile}>
          <div className="profile-avatar-row">
            <div className="profile-avatar-wrap">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Предпросмотр аватара" className="profile-avatar-preview" />
              ) : (
                <div className="profile-avatar-placeholder">{(form.nickname || 'U').slice(0, 1).toUpperCase()}</div>
              )}
            </div>
            <div className="profile-avatar-controls">
              <label className="btn btn-secondary" htmlFor="avatar-upload">Загрузить аватар</label>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              <p className="form-hint">Поддерживаются PNG/JPG/GIF. GIF остаётся анимированным.</p>
              <Link to={`/users/${user.id}`}>Открыть публичный профиль</Link>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required />
            {user.pending_email && user.pending_email !== user.email && (
              <p className="form-hint">
                Ожидает подтверждения: {user.pending_email}. Истекает: {new Date(user.pending_email_expires_at).toLocaleString()}.
              </p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor="nickname">Никнейм</label>
            <input id="nickname" name="nickname" value={form.nickname} onChange={handleChange} maxLength={40} required />
          </div>
          <div className="form-group">
            <label htmlFor="initials">Инициалы</label>
            <input id="initials" name="initials" value={form.initials} onChange={handleChange} maxLength={16} required />
          </div>
          <div className="form-group">
            <label htmlFor="about">О себе</label>
            <textarea id="about" name="about" value={form.about} onChange={handleChange} rows={4} />
          </div>
          <div className="form-group">
            <label htmlFor="steam_profile_url">Ссылка на профиль Steam</label>
            <input
              id="steam_profile_url"
              name="steam_profile_url"
              type="url"
              value={form.steam_profile_url}
              onChange={handleChange}
              placeholder="https://steamcommunity.com/profiles/76561198... или /id/yourname"
            />
          </div>
          <div className="form-group">
            <label htmlFor="cs2_match_token">CS2 Match Token (steamidkey)</label>
            <input
              id="cs2_match_token"
              name="cs2_match_token"
              value={form.cs2_match_token}
              onChange={handleChange}
              placeholder="Token для полной истории матчей CS2"
              autoComplete="off"
            />
            <p className="form-hint">
              Укажите steamidkey из CS2 auth code, чтобы подтягивать полную историю матчей без обрезки.
            </p>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить профиль'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Telegram</h2>
        <p className="form-hint">
          Telegram-бот: <a href={TELEGRAM_BOT_LINK} target="_blank" rel="noreferrer">{telegramBotLabel}</a>
        </p>
        {user.telegram_chat_id ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Привязан: @{user.telegram_username || `id ${user.telegram_chat_id}`}
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Получите код и отправьте его боту командой <strong>/link CODE</strong>.
            </p>
            {linkCode && (
              <div className="alert alert-success" style={{ marginBottom: '0.75rem' }}>
                Код: <strong style={{ fontFamily: 'var(--font-mono)' }}>{linkCode.code}</strong>
                <br />
                <small>Истекает: {new Date(linkCode.expires_at).toLocaleString()}</small>
              </div>
            )}
            <button type="button" className="btn btn-secondary" onClick={requestTelegramCode} disabled={loading}>
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
                  setForm((f) => ({ ...f, telegram_notifications_enabled: e.target.checked }))
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
              onChange={(e) => setPasswordForm((p) => ({ ...p, old_password: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="new_password">Новый пароль</label>
            <input
              id="new_password"
              type="password"
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm((p) => ({ ...p, new_password: e.target.value }))}
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
              onChange={(e) => setPasswordForm((p) => ({ ...p, new_password_confirm: e.target.value }))}
              required
              minLength={8}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>Изменить пароль</button>
        </form>
      </div>

      <div className="panel">
        <h2>Удаление аккаунта</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          На почту придёт ссылка для подтверждения удаления.
        </p>
        <button type="button" className="btn btn-danger" onClick={requestDeleteAccount} disabled={loading}>
          Запросить удаление аккаунта
        </button>
      </div>
    </>
  )
}
