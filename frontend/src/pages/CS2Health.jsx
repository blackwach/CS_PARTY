import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { cs2 as cs2Api } from '../api'

function boolLabel(value) {
  return value ? 'Да' : 'Нет'
}

export default function CS2Health() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await cs2Api.health()
      setHealth(data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось получить health CS2 stats.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(true), 10000)
    return () => clearInterval(timer)
  }, [])

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
        <h1 className="page-title">CS2 Stats Health</h1>
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

      {health && (
        <div className="panel cs2-health-panel">
          {!health.service_reachable && health.error && <div className="alert alert-warning">{health.error}</div>}

          <div className="cs2-health-grid">
            <div className="stat-box">
              <div className="stat-label">API настроен</div>
              <div className="stat-value">{boolLabel(health.configured)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">API доступен</div>
              <div className="stat-value">{boolLabel(health.service_reachable)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Token задан</div>
              <div className="stat-value">{boolLabel(health.api_token_configured)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">HTTP код</div>
              <div className="stat-value">{health.service_status_code ?? '-'}</div>
            </div>
          </div>

          <p className="cs2-health-url">URL: {health.api_url || '-'}</p>

          <h3 className="room-players-title">Конфигурация Steam-бота</h3>
          <ul className="cs2-health-list">
            <li>Логин задан: {boolLabel(health.bot_credentials?.username_set)}</li>
            <li>Пароль задан: {boolLabel(health.bot_credentials?.password_set)}</li>
            <li>2FA secret задан: {boolLabel(health.bot_credentials?.two_factor_set)}</li>
          </ul>

          <h3 className="room-players-title">Состояние бота</h3>
          <ul className="cs2-health-list">
            <li>Steam logged_on: {boolLabel(health.service?.bot?.logged_on)}</li>
            <li>GC ready: {boolLabel(health.service?.bot?.gc_ready)}</li>
            <li>GC session: {boolLabel(health.service?.bot?.have_gc_session)}</li>
            <li>Последнее подключение: {health.service?.bot?.last_connected_at || '-'}</li>
            <li>Последняя ошибка: {health.service?.bot?.last_error || '-'}</li>
            <li>Reconnect attempts: {health.service?.bot?.reconnect_attempts ?? '-'}</li>
            <li>Cache size: {health.service?.cache_size ?? '-'}</li>
          </ul>
        </div>
      )}
    </>
  )
}
