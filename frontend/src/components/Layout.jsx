import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FriendsPanel from './FriendsPanel'
import NotificationBell from './NotificationBell'

const FRIENDS_PANEL_STORAGE_KEY = 'cs_party_friends_panel_open'

function defaultFriendsPanelState() {
  if (typeof window === 'undefined') return false
  const persisted = window.localStorage.getItem(FRIENDS_PANEL_STORAGE_KEY)
  if (persisted === '1') return true
  if (persisted === '0') return false
  return window.innerWidth > 1100
}

export default function Layout() {
  const { logout, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [friendsOpen, setFriendsOpen] = useState(defaultFriendsPanelState)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FRIENDS_PANEL_STORAGE_KEY, friendsOpen ? '1' : '0')
  }, [friendsOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => {
      if (window.innerWidth <= 1100) {
        setFriendsOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const pageVariant =
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email')
      ? 'auth'
      : pathname.startsWith('/rooms')
        ? 'rooms'
        : pathname.startsWith('/profile') || pathname.startsWith('/users')
          ? 'profile'
          : pathname.startsWith('/chat') || pathname.startsWith('/chats')
            ? 'rooms'
            : pathname.startsWith('/cs2')
              ? 'cs2'
              : 'home'

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className={`app-layout page-${pageVariant} ${isAuthenticated ? 'has-friends' : ''}`}>
      <header className="app-header">
        <Link to="/" className="app-brand">
          CS <span>Party</span>
        </Link>
        <nav className="app-nav">
          {isAuthenticated ? (
            <>
              <Link to="/rooms">Комнаты</Link>
              <Link to="/chats">Чаты</Link>
              <Link to="/rooms/create">Создать</Link>
              <Link to="/cs2">CS2</Link>
              <Link to="/profile">Профиль</Link>
              <button type="button" className="btn btn-ghost friends-toggle-btn" onClick={() => setFriendsOpen((v) => !v)}>
                Друзья
              </button>
              <NotificationBell />
              <button type="button" onClick={handleLogout}>
                Выйти
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Вход</Link>
              <Link to="/register">Регистрация</Link>
            </>
          )}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      {isAuthenticated && <FriendsPanel isVisible={friendsOpen} onClose={() => setFriendsOpen(false)} />}
    </div>
  )
}
