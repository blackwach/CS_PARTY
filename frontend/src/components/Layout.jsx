import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { logout, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const pageVariant = pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password') || pathname.startsWith('/verify-email')
    ? 'auth'
    : pathname.startsWith('/rooms')
      ? 'rooms'
      : pathname.startsWith('/profile')
        ? 'profile'
        : pathname.startsWith('/cs2')
          ? 'cs2'
          : 'home'

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className={`app-layout page-${pageVariant}`}>
      <header className="app-header">
        <Link to="/" className="app-brand">
          CS <span>Party</span>
        </Link>
        <nav className="app-nav">
          {isAuthenticated ? (
            <>
              <Link to="/rooms">Комнаты</Link>
              <Link to="/rooms/create">Создать</Link>
              <Link to="/cs2">CS2</Link>
              <Link to="/profile">Профиль</Link>
              <button type="button" onClick={handleLogout}>Выйти</button>
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
    </div>
  )
}
