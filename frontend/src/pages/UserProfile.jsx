import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { auth as authApi } from '../api'

export default function UserProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const load = () => {
    setError('')
    authApi
      .getUserProfile(id)
      .then((res) => setProfile(res.data))
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось загрузить профиль.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [id])

  const sendFriendRequest = async () => {
    setActionLoading(true)
    try {
      await authApi.friendRequestCreate(Number(id))
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось отправить заявку в друзья.')
    } finally {
      setActionLoading(false)
    }
  }

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
    </>
  )
}
