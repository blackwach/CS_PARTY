import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import FriendsPanel from './FriendsPanel'
import NotificationBell from './NotificationBell'

function defaultFriendsPanelState() {
  if (typeof window === 'undefined') return true
  return window.innerWidth > 1100
}

export default function Layout() {
  const { logout, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [friendsOpen, setFriendsOpen] = useState(defaultFriendsPanelState)

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
