import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cs2 as cs2Api } from '../api'

const STEAM_PROFILE_BASE = 'https://steamcommunity.com/profiles/'
const CS2_BOT_ADMIN_EMAIL = 'backwach1@yandex.ru'
const RESULT_LABELS = {
  win: 'Победа',
  lose: 'Поражение',
  loss: 'Поражение',
  draw: 'Ничья',
}

const RANK_COLORS = {
  0: ['#3a3f46', '#5f6670'],
  1: ['#7b8087', '#a2a8b1'],
  2: ['#7b8087', '#a2a8b1'],
  3: ['#7b8087', '#a2a8b1'],
  4: ['#7b8087', '#a2a8b1'],
  5: ['#848a92', '#b3bac4'],
  6: ['#8e959f', '#c2cad6'],
  7: ['#8f7a43', '#d7b766'],
  8: ['#8f7a43', '#d7b766'],
  9: ['#8f7a43', '#d7b766'],
  10: ['#9c8247', '#e0bf6c'],
  11: ['#4f74a6', '#7fb2f0'],
  12: ['#4f74a6', '#7fb2f0'],
  13: ['#3f6f98', '#72b0e8'],
  14: ['#315e8f', '#5ea7df'],
  15: ['#8a7a9e', '#c6a0ef'],
  16: ['#8a7a9e', '#c6a0ef'],
  17: ['#b3883d', '#f0ca77'],
  18: ['#ba9224', '#ffd45b'],
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '-'
}

function formatNumber(value, digits = 2) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '0'
  return parsed.toFixed(digits)
}

function extractApiError(err, fallback) {
  const data = err?.response?.data
  if (!data) return fallback
  if (typeof data.detail === 'string' && data.detail.trim()) return data.detail
  if (Array.isArray(data.non_field_errors) && data.non_field_errors[0]) return String(data.non_field_errors[0])
  if (Array.isArray(data.detail) && data.detail[0]) return String(data.detail[0])
  return fallback
}

function getRankBadgeDataUrl(rankId, rankName) {
  const id = Number.isInteger(rankId) ? rankId : 0
  const colors = RANK_COLORS[id] || RANK_COLORS[0]
  const label = String(rankName || 'Без ранга')
  const shortLabel = id > 0 ? `R${id}` : 'N/A'
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colors[0]}" />
          <stop offset="100%" stop-color="${colors[1]}" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="72" height="72" rx="18" fill="url(#g)" stroke="#0f1218" stroke-width="4" />
      <path d="M42 18L60 30v21L42 66 24 51V30z" fill="#0f1218" fill-opacity="0.34" />
      <text x="42" y="47" text-anchor="middle" fill="#f8fafc" font-size="18" font-family="Arial, sans-serif" font-weight="700">${shortLabel}</text>
      <title>${label}</title>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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

  const averages = stats?.averages || {}
  const rankId = Number.isInteger(stats?.rank_id) ? stats.rank_id : null
  const rankName = stats?.rank || 'Без ранга'
  const rankBadge = useMemo(() => getRankBadgeDataUrl(rankId, rankName), [rankId, rankName])
  const isBotAdmin = String(user?.email || '').trim().toLowerCase() === CS2_BOT_ADMIN_EMAIL

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
          {isBotAdmin && (
            <Link to="/cs2/health" className="btn btn-secondary">
              Состояние бота
            </Link>
          )}
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
              <div className="stat-box stat-box-rank">
                <img className="cs2-rank-badge" src={rankBadge} alt={rankName} />
                <div className="stat-value cs2-rank-text">{rankName}</div>
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
              <div className="stat-box">
                <div className="stat-value">{formatNumber(averages.avg_kda)}</div>
                <div className="stat-label">Средний KDA</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{formatNumber(averages.avg_hs_percent)}%</div>
                <div className="stat-label">Средний HS%</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{formatNumber(averages.avg_kd)}</div>
                <div className="stat-label">Средний K/D</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">
                  {formatNumber(averages.avg_kills)}/{formatNumber(averages.avg_deaths)}/{formatNumber(averages.avg_assists)}
                </div>
                <div className="stat-label">Средний K/D/A</div>
              </div>
            </div>
            <p className="cs2-updated-at">
              Обновлено: {formatDate(stats.last_synced_at)} | Источник: {stats.source || 'неизвестно'}
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
                      <span className="cs2-match-hs">HS: {formatNumber(item.headshot_percent ?? 0)}%</span>
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
