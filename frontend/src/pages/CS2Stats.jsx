import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cs2 as cs2Api } from '../api'

function formatDate(d) {
  return d ? new Date(d).toLocaleString('ru-RU') : '—'
}

const STEAM_PROFILE_BASE = 'https://steamcommunity.com/profiles/'

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
      .then((res) => setStats(res.data))
      .catch((err) => {
        if (err.response?.status === 404) setStats(null)
        else setError(err.response?.data?.detail || 'Не удалось загрузить статистику')
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
      .catch((err) => setError(err.response?.data?.detail || 'Ошибка синхронизации'))
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
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>CS2 статистика</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={sync}
          disabled={syncing}
        >
          {syncing ? 'Синхронизация…' : 'Синхронизировать'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {/* Карточка игрока: профиль Steam и данные для статистики */}
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Игрок</h2>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{user?.nickname || '—'}</p>
        {steamProfileUrl ? (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <a href={steamProfileUrl} target="_blank" rel="noopener noreferrer">
              Профиль Steam
            </a>
            <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              (можно изменить в <Link to="/profile">профиле</Link>)
            </span>
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Укажите ссылку на профиль Steam в <Link to="/profile">профиле</Link>, затем нажмите «Синхронизировать».
          </p>
        )}
      </div>

      {!stats ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>
            {steamProfileUrl
              ? 'Нажмите «Синхронизировать», чтобы подтянуть ранг и историю матчей с платформы Steam.'
              : 'Укажите ссылку на профиль Steam в профиле и нажмите «Синхронизировать».'}
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2>Общее</h2>
            <div className="stat-grid">
              <div className="stat-box">
                <div className="stat-value">{stats.rank || '—'}</div>
                <div className="stat-label">Ранг</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.wins ?? '—'}</div>
                <div className="stat-label">Побед</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.losses ?? '—'}</div>
                <div className="stat-label">Поражений</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.total_matches ?? '—'}</div>
                <div className="stat-label">Матчей</div>
              </div>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Обновлено: {formatDate(stats.last_synced_at)}
            </p>
          </div>

          {stats.recent_matches?.length > 0 && (
            <div className="panel">
              <h2>Последние матчи</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {stats.recent_matches.map((m, i) => (
                  <li
                    key={m.external_match_id || i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid var(--border)',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
                      {m.map_name || '—'} · {formatDate(m.played_at)}
                    </span>
                    <span>
                      K/D/A: {m.kills ?? 0}/{m.deaths ?? 0}/{m.assists ?? 0}
                      {m.result != null && (
                        <span className={m.result === 'win' ? 'badge badge-joined' : 'badge badge-declined'} style={{ marginLeft: '0.5rem' }}>
                          {m.result === 'win' ? 'Победа' : 'Поражение'}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}
