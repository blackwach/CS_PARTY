import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { cs2 as cs2Api } from '../api'

const STEAM_PROFILE_BASE = 'https://steamcommunity.com/profiles/'

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
        setError(extractApiError(err, 'Failed to load CS2 stats.'))
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
      .catch((err) => setError(extractApiError(err, 'CS2 stats sync failed.')))
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
        <h1 className="page-title" style={{ margin: 0 }}>
          CS2 Stats
        </h1>
        <button type="button" className="btn btn-primary" onClick={sync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {stats?.note && <div className="alert alert-warning">{stats.note}</div>}

      <div className="panel" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Player</h2>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{user?.nickname || '-'}</p>
        {steamProfileUrl ? (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <a href={steamProfileUrl} target="_blank" rel="noopener noreferrer">
              Steam profile
            </a>
            <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              (you can edit it in <Link to="/profile">profile</Link>)
            </span>
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Set Steam profile URL in <Link to="/profile">profile</Link>, then click Sync.
          </p>
        )}
      </div>

      {!stats ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>
            {steamProfileUrl ? 'Click Sync to fetch rank and recent matches.' : 'Add Steam profile URL and run sync.'}
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2>Overview</h2>
            <div className="stat-grid">
              <div className="stat-box">
                <div className="stat-value">{stats.rank || '-'}</div>
                <div className="stat-label">Rank</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.wins ?? '-'}</div>
                <div className="stat-label">Wins</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.losses ?? '-'}</div>
                <div className="stat-label">Losses</div>
              </div>
              <div className="stat-box">
                <div className="stat-value">{stats.total_matches ?? '-'}</div>
                <div className="stat-label">Matches</div>
              </div>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Updated: {formatDate(stats.last_synced_at)}</p>
          </div>

          {stats.recent_matches?.length > 0 && (
            <div className="panel">
              <h2>Recent matches</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {stats.recent_matches.map((item, index) => (
                  <li
                    key={item.external_match_id || index}
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
                      {item.map_name || '-'} | {formatDate(item.played_at)}
                    </span>
                    <span>
                      K/D/A: {item.kills ?? 0}/{item.deaths ?? 0}/{item.assists ?? 0}
                      {item.result != null && (
                        <span className={item.result === 'win' ? 'badge badge-joined' : 'badge badge-declined'} style={{ marginLeft: '0.5rem' }}>
                          {item.result === 'win' ? 'Win' : 'Loss'}
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
