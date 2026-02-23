import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cs2 as cs2Api } from '../api'
import { useAuth } from '../context/AuthContext'

const CS2_BOT_ADMIN_EMAIL = 'backwach1@yandex.ru'

function toDetail(err, fallback) {
  const data = err?.response?.data
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail
  if (Array.isArray(data?.detail) && data.detail[0]) return String(data.detail[0])
  if (Array.isArray(data?.non_field_errors) && data.non_field_errors[0]) return String(data.non_field_errors[0])
  return fallback
}

export default function CS2Health() {
  const { user } = useAuth()
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inviteLink, setInviteLink] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')
  const [guardCode, setGuardCode] = useState('')
  const [guardLoading, setGuardLoading] = useState(false)
  const [guardError, setGuardError] = useState('')
  const [guardSuccess, setGuardSuccess] = useState('')

  const isBotAdmin = String(user?.email || '').trim().toLowerCase() === CS2_BOT_ADMIN_EMAIL

  const load = async (silent = false) => {
    if (!isBotAdmin) {
      setLoading(false)
      return
    }

    if (!silent) setLoading(true)
    try {
      const { data } = await cs2Api.health()
      setHealth(data)
      setError('')
    } catch (err) {
      setError(toDetail(err, 'Не удалось получить статус CS2-бота.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isBotAdmin) {
      setLoading(false)
      return undefined
    }

    load(false)
    const timer = setInterval(() => load(true), 10000)
    return () => clearInterval(timer)
  }, [isBotAdmin])

  const serviceReachable = Boolean(health?.service_reachable)
  const botLoggedOn = Boolean(health?.service?.bot?.logged_on)
  const gcReady = Boolean(health?.service?.bot?.gc_ready)
  const isConnected = useMemo(() => {
    return Boolean(serviceReachable && botLoggedOn && gcReady)
  }, [serviceReachable, botLoggedOn, gcReady])
  const steamGuardPending = health?.service?.bot?.steam_guard_pending || null

  const onSubmit = async (event) => {
    event.preventDefault()
    const link = inviteLink.trim()
    if (!link) {
      setSubmitError('Введите ссылку приглашения в друзья.')
      setSubmitSuccess('')
      return
    }

    setSubmitLoading(true)
    setSubmitError('')
    setSubmitSuccess('')
    try {
      const { data } = await cs2Api.addFriendByInvite(link)
      const status = data?.status || 'request_sent'
      const steamId = data?.steam_id ? ` (${data.steam_id})` : ''
      if (status === 'already_or_pending') {
        setSubmitSuccess(`Уже в друзьях или заявка уже отправлена${steamId}.`)
      } else {
        setSubmitSuccess(`Заявка в друзья отправлена${steamId}.`)
      }
      setInviteLink('')
      await load(true)
    } catch (err) {
      setSubmitError(toDetail(err, 'Не удалось отправить заявку в друзья.'))
    } finally {
      setSubmitLoading(false)
    }
  }

  const onSubmitGuardCode = async (event) => {
    event.preventDefault()
    const code = guardCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      setGuardError('Введите корректный 5-символьный код Steam Guard.')
      setGuardSuccess('')
      return
    }

    setGuardLoading(true)
    setGuardError('')
    setGuardSuccess('')
    try {
      await cs2Api.submitSteamGuardCode(code)
      setGuardSuccess('Код Steam Guard отправлен.')
      setGuardCode('')
      await load(true)
    } catch (err) {
      setGuardError(toDetail(err, 'Не удалось отправить код Steam Guard.'))
    } finally {
      setGuardLoading(false)
    }
  }

  if (!isBotAdmin) {
    return (
      <section className="panel cs2-health-panel">
        <h1 className="page-title">Состояние CS2-бота</h1>
        <div className="alert alert-error">Доступ к управлению CS2-ботом разрешен только для {CS2_BOT_ADMIN_EMAIL}.</div>
        <Link className="btn btn-secondary" to="/cs2">
          К статистике
        </Link>
      </section>
    )
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
      <div className="cs2-health-head">
        <h1 className="page-title">Состояние CS2-бота</h1>
        <div className="cs2-health-head-actions">
          <button type="button" className="btn btn-secondary" onClick={() => load(false)}>
            Обновить
          </button>
          <Link className="btn btn-ghost" to="/cs2">
            К статистике
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {submitError && <div className="alert alert-error">{submitError}</div>}
      {submitSuccess && <div className="alert alert-success">{submitSuccess}</div>}
      {guardError && <div className="alert alert-error">{guardError}</div>}
      {guardSuccess && <div className="alert alert-success">{guardSuccess}</div>}
      {health?.hint && <div className="alert alert-warning">{health.hint}</div>}

      <section className="panel cs2-health-panel">
        <h2>Статус бота</h2>
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-label">API доступен</div>
            <div className="stat-value">{serviceReachable ? 'Да' : 'Нет'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Вход в Steam</div>
            <div className="stat-value">{botLoggedOn ? 'Да' : 'Нет'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">GC готов</div>
            <div className="stat-value">{gcReady ? 'Да' : 'Нет'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">/players готов</div>
            <div className="stat-value">{isConnected ? 'Да' : 'Нет'}</div>
          </div>
        </div>
        {!isConnected && health?.service?.bot?.last_error && (
          <p className="form-hint" style={{ marginTop: '0.6rem' }}>
            Последняя ошибка: {health.service.bot.last_error}
          </p>
        )}
      </section>

      {steamGuardPending && (
        <section className="panel cs2-health-panel">
          <h2>Steam Guard</h2>
          <p className="form-hint">
            Для входа бота требуется код Steam Guard.
            {steamGuardPending?.source ? ` Тип проверки: ${steamGuardPending.source}.` : ''}
          </p>
          <form onSubmit={onSubmitGuardCode}>
            <div className="room-search-bar">
              <input
                type="text"
                value={guardCode}
                onChange={(event) => setGuardCode(event.target.value)}
                placeholder="ABCDE"
                autoComplete="one-time-code"
                maxLength={5}
              />
              <button type="submit" className="btn btn-primary" disabled={guardLoading}>
                {guardLoading ? 'Отправка...' : 'Отправить код'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel cs2-health-panel">
        <h2>Добавить друга по ссылке</h2>
        <form onSubmit={onSubmit}>
          <div className="room-search-bar">
            <input
              type="text"
              value={inviteLink}
              onChange={(event) => setInviteLink(event.target.value)}
              placeholder="https://steamcommunity.com/profiles/7656119..."
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary" disabled={submitLoading}>
              {submitLoading ? 'Отправка...' : 'Добавить'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
