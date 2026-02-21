import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { isAuthenticated } = useAuth()

  return (
    <>
      <section className="panel" style={{ marginTop: 0 }}>
        <h1 className="page-title">Собери команду. Запускай матчи вовремя.</h1>
        <p className="page-subtitle">
          Регистрация, подтверждение почты, Telegram-бот, комнаты до 5 игроков и напоминания перед стартом.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {isAuthenticated ? (
            <Link to="/rooms" className="btn btn-primary">К комнатам</Link>
          ) : (
            <>
              <Link to="/register" className="btn btn-primary">Регистрация</Link>
              <Link to="/login" className="btn btn-secondary">Вход</Link>
            </>
          )}
        </div>
      </section>

      <section className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="card">
          <h3 className="card-title">Безопасность</h3>
          <p className="card-meta">Подтверждение email, сброс пароля, JWT.</p>
        </div>
        <div className="card">
          <h3 className="card-title">Telegram</h3>
          <p className="card-meta">Привязка аккаунта, приглашения и уведомления.</p>
        </div>
        <div className="card">
          <h3 className="card-title">CS2 статистика</h3>
          <p className="card-meta">Ранг, победы и история матчей.</p>
        </div>
        <div className="card">
          <h3 className="card-title">Комнаты</h3>
          <p className="card-meta">Хост создает комнату, приглашает друзей, все отмечают готовность.</p>
        </div>
      </section>

      <div className="alert alert-warning">
        <strong>18+</strong> Регистрация только для игроков старше 18 лет.
      </div>
    </>
  )
}
