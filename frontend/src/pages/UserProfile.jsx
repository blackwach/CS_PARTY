import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auth as authApi, cs2 as cs2Api } from '../api'

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

export default function UserProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const [csStats, setCsStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')

  const loadProfile = () => {
    setError('')
    authApi
      .getUserProfile(id)
      .then((res) => setProfile(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось загрузить профиль.'))
      .finally(() => setLoading(false))
  }

  const loadCsStats = () => {
    setStatsLoading(true)
    setStatsError('')
    setCsStats(null)
    cs2Api
      .getUserStats(id)
      .then((res) => {
        const payload = res.data
        setCsStats(payload?.synced === false ? null : payload)
      })
      .catch((err) => {
        setCsStats(null)
        setStatsError(err.response?.data?.detail || 'Не удалось загрузить статистику CS2.')
      })
      .finally(() => setStatsLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    loadProfile()
    loadCsStats()
  }, [id])

  const sendFriendRequest = async () => {
    setActionLoading(true)
    try {
      await authApi.friendRequestCreate(Number(id))
      loadProfile()
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось отправить заявку в друзья.')
    } finally {
      setActionLoading(false)
    }
  }

  const rankId = Number.isInteger(csStats?.rank_id) ? csStats.rank_id : null
  const rankName = csStats?.rank || 'Без ранга'
  const rankBadge = useMemo(() => getRankBadgeDataUrl(rankId, rankName), [rankId, rankName])
  const averages = csStats?.averages || {}

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }

  if (!profile) {
    return <div className="alert alert-error">{error || 'Профиль не найден.'}</div>
  }

  return (
    <>
      <h1 className="page-title">{profile.nickname}</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="panel user-profile-panel">
        <div className="user-profile-header">
          {profile.avatar ? (
            <img src={profile.avatar} alt={profile.nickname} className="user-profile-avatar" />
          ) : (
            <div className="user-profile-avatar user-profile-avatar-fallback">{profile.nickname.slice(0, 1).toUpperCase()}</div>
          )}
          <div>
            <p className="user-profile-meta">Никнейм: {profile.nickname}</p>
            {profile.steam_profile_url && (
              <p className="user-profile-meta">
                Steam: <a href={profile.steam_profile_url} target="_blank" rel="noreferrer">{profile.steam_profile_url}</a>
              </p>
            )}
          </div>
        </div>

        <div className="user-profile-actions">
          {profile.is_self ? (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/profile')}>
              Редактировать профиль
            </button>
          ) : (
            <>
              {profile.friendship_status === 'none' && (
                <button type="button" className="btn btn-primary" onClick={sendFriendRequest} disabled={actionLoading}>
                  Добавить в друзья
                </button>
              )}
              {profile.friendship_status === 'outgoing' && <span className="badge badge-invited">Заявка отправлена</span>}
              {profile.friendship_status === 'incoming' && <span className="badge badge-invited">Входящая заявка</span>}
              {profile.friendship_status === 'friends' && (
                <Link to={`/chat/${profile.id}`} className="btn btn-primary">Открыть чат</Link>
              )}
            </>
          )}
          <Link to="/rooms" className="btn btn-secondary">Назад</Link>
        </div>
      </div>

      <div className="panel user-profile-cs2">
        <h2>Статистика CS2</h2>

        {statsError && <div className="alert alert-warning">{statsError}</div>}

        {statsLoading ? (
          <div className="loading-wrap">
            <div className="loading-spinner" />
          </div>
        ) : !csStats ? (
          <p className="form-hint">У пользователя пока нет синхронизированной статистики CS2.</p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-box stat-box-rank user-profile-cs2-rank">
                <img className="cs2-rank-badge" src={rankBadge} alt={rankName} />
                <div className="stat-value cs2-rank-text">{rankName}</div>
                <div className="stat-label">Ранг</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{csStats.premier_rating ?? '-'}</div>
                <div className="stat-label">Premier рейтинг</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{formatNumber(averages.avg_kda)}</div>
                <div className="stat-label">Средний KDA</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{formatNumber(averages.avg_hs_percent)}%</div>
                <div className="stat-label">Средний HS%</div>
              </div>
            </div>

            {Array.isArray(csStats.map_ranks) && csStats.map_ranks.length > 0 && (
              <div className="user-profile-map-ranks">
                <h3>Ранги по картам</h3>
                <ul className="user-profile-map-ranks-list">
                  {csStats.map_ranks.map((item, index) => (
                    <li key={`${item.map || 'map'}-${index}`} className="user-profile-map-rank-item">
                      <span className="user-profile-map-name">{item.map}</span>
                      <span className="badge badge-open">{item.rank || `Ранг ${item.rank_id ?? '-'}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="user-profile-cs2-updated">
              Обновлено: {formatDate(csStats.last_synced_at)}
            </p>
          </>
        )}
      </div>
    </>
  )
}
