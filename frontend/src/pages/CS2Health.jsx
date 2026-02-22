import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cs2 as cs2Api } from '../api'

function toDetail(err, fallback) {
  const data = err?.response?.data
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail
  if (Array.isArray(data?.detail) && data.detail[0]) return String(data.detail[0])
  if (Array.isArray(data?.non_field_errors) && data.non_field_errors[0]) return String(data.non_field_errors[0])
  return fallback
}

export default function CS2Health() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inviteLink, setInviteLink] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await cs2Api.health()
      setHealth(data)
      setError('')
    } catch (err) {
      setError(toDetail(err, 'Не удалось получить статус CS2 бота.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(true), 10000)
    return () => clearInterval(timer)
  }, [])

  const isConnected = useMemo(() => {
    return Boolean(health?.service_reachable && health?.service?.bot?.logged_on)
  }, [health])

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
        <h1 className="page-title">Healthy</h1>
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

      <section className="panel cs2-health-panel">
        <h2>Статус бота</h2>
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-label">Подключен</div>
            <div className="stat-value">{isConnected ? 'Да' : 'Нет'}</div>
          </div>
        </div>
        {!isConnected && health?.service?.bot?.last_error && (
          <p className="form-hint" style={{ marginTop: '0.6rem' }}>
            Последняя ошибка: {health.service.bot.last_error}
          </p>
        )}
      </section>

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
