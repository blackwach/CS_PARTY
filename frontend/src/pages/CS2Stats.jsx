import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cs2 as cs2Api } from '../api'

const STEAM_PROFILE_BASE = 'https://steamcommunity.com/profiles/'
const RESULT_LABELS = {
  win: 'Победа',
  lose: 'Поражение',
  loss: 'Поражение',
  draw: 'Ничья',
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '-'
}

function extractApiError(err, fallback) {
  const data = err?.response?.data
  if (!data) return fallback
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail
  if (Array.isArray(data.non_field_errors) && data.non_field_errors[0]) return String(data.non_field_errors[0])
  if (Array.isArray(data.detail) && data.detail[0]) return String(data.detail[0])
  return fallback
}

export default function CS2Stats() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const steamProfileUrl = user?.steam_profile_url || (user?.steam_account_id ? `${STEAM_PROFILE_BASE}${user.steam_account_id}` : null)

  const load = () => {
    setError('')
    cs2Api
      .getStats()
      .then((res) => setStats(res.data?.synced === false ? null : res.data))
      .catch((err) => {
        if (err.response?.status === 404) {
          setStats(null)
          return
        }
        setError(extractApiError(err, 'Не удалось загрузить статистику CS2.'))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const sync = () => {
    setSyncing(true)
    setError('')
    cs2Api
      .sync()
      .then((res) => setStats(res.data))
      .catch((err) => setError(extractApiError(err, 'Синхронизация статистики CS2 не удалась.')))
      .finally(() => setSyncing(false))
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  return (
    <div className="cs2-stats-page">
      <header className="cs2-stats-head">
        <h1 className="page-title">Статистика CS2</h1>
        <div className="cs2-stats-actions">
          <button type="button" className="btn btn-primary" onClick={sync} disabled={syncing}>
            {syncing ? 'Синхронизация...' : 'Синхронизировать'}
          </button>
          <Link to="/cs2/health" className="btn btn-secondary">
            Состояние бота
          </Link>
        </div>
      </header>

      <div className="cs2-stats-alerts">
        {error && <div className="alert alert-error">{error}</div>}
        {stats?.note && <div className="alert alert-warning">{stats.note}</div>}
      </div>

      <section className="panel cs2-player-card">
        <h2>Профиль игрока</h2>
        <p className="cs2-player-name">{user?.nickname || '-'}</p>
        {steamProfileUrl ? (
          <p className="cs2-profile-link">
            <a href={steamProfileUrl} target="_blank" rel="noopener noreferrer">
              Открыть Steam-профиль
            </a>
            <span>
              (изменить можно в <Link to="/profile">профиле</Link>)
            </span>
          </p>
        ) : (
          <p className="cs2-profile-link">
            Укажите ссылку на Steam-профиль в <Link to="/profile">профиле</Link>, затем нажмите "Синхронизировать".
          </p>
        )}
      </section>

      {!stats ? (
        <section className="panel">
          <p className="cs2-empty-hint">
            {steamProfileUrl
              ? 'Нажмите "Синхронизировать", чтобы обновить доступные данные.'
              : 'Добавьте Steam-профиль и выполните первую синхронизацию.'}
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Обзор</h2>
            <div className="stat-grid">
              <div className="stat-box">
                <div className="stat-value">{stats.rank || '-'}</div>
                <div className="stat-label">Ранг</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.wins ?? '-'}</div>
                <div className="stat-label">Побед</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.losses ?? '-'}</div>
                <div className="stat-label">Поражений</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.total_matches ?? '-'}</div>
                <div className="stat-label">Матчей</div>
              </div>
            </div>
            <p className="cs2-updated-at">
              Обновлено: {formatDate(stats.last_synced_at)} | Источник: {stats.source || 'unknown'}
            </p>
          </section>

          {stats.recent_matches?.length > 0 && (
            <section className="panel">
              <h2>Последние матчи</h2>
              <ul className="cs2-matches-list">
                {stats.recent_matches.map((item, index) => (
                  <li key={item.external_match_id || index} className="cs2-match-row">
                    <span className="cs2-match-meta">
                      {item.map_name || '-'} | {formatDate(item.played_at)}
                    </span>
                    <span className="cs2-match-stats">
                      K/D/A: {item.kills ?? 0}/{item.deaths ?? 0}/{item.assists ?? 0}
                      {item.result != null && (
                        <span
                          className={`badge ${
                            item.result === 'win' ? 'badge-joined' : item.result === 'draw' ? 'badge-invited' : 'badge-declined'
                          }`}
                        >
                          {RESULT_LABELS[item.result] || 'Матч'}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
