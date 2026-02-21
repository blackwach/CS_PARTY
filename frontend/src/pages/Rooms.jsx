import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { rooms as roomsApi } from '../api'

const statusLabels = {
  open: 'Р С›РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљР В°',
  ready: 'Р вЂњР С•РЎвЂљР С•Р Р†Р В°',
  started: 'Р ВР Т‘РЎвЂРЎвЂљ',
  finished: 'Р вЂ”Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р ВµР Р…Р В°',
  cancelled: 'Р С›РЎвЂљР СР ВµР Р…Р ВµР Р…Р В°',
}

function formatDate(d) {
  const date = new Date(d)
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Rooms() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    roomsApi
      .list()
      .then((res) => setList(Array.isArray(res.data) ? res.data : (res.data?.results || [])))
      .catch(() => setError('Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С‘РЎвЂљРЎРЉ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№'))
      .finally(() => setLoading(false))
  }, [])

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
        <h1 className="page-title" style={{ margin: 0 }}>Р СљР С•Р С‘ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎвЂ№</h1>
        <Link to="/rooms/create" className="btn btn-primary">Р РЋР С•Р В·Р Т‘Р В°РЎвЂљРЎРЉ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎС“</Link>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {list.length === 0 ? (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>Р Р€ Р Р†Р В°РЎРѓ Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ Р С”Р С•Р СР Р…Р В°РЎвЂљ. Р РЋР С•Р В·Р Т‘Р В°Р в„–РЎвЂљР Вµ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎС“ Р С‘Р В»Р С‘ Р С—РЎР‚Р С‘Р СР С‘РЎвЂљР Вµ Р С—РЎР‚Р С‘Р С–Р В»Р В°РЎв‚¬Р ВµР Р…Р С‘Р Вµ.</p>
          <Link to="/rooms/create" className="btn btn-primary">Р РЋР С•Р В·Р Т‘Р В°РЎвЂљРЎРЉ Р С”Р С•Р СР Р…Р В°РЎвЂљРЎС“</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {list.map((room) => (
            <Link
              key={room.id}
              to={`/rooms/${room.code}`}
              className="card"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 className="card-title">{room.title}</h3>
                  <p className="card-meta">
                    Р С™Р С•Р Т‘: {room.code} Р’В· {formatDate(room.scheduled_for)} Р’В· Р ТђР С•РЎРѓРЎвЂљ: {room.host?.nickname || 'РІР‚вЂќ'}
                  </p>
                </div>
                <span className={`badge badge-${room.status || 'open'}`}>
                  {statusLabels[room.status] || room.status}
                </span>
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Р Р€РЎвЂЎР В°РЎРѓРЎвЂљР Р…Р С‘Р С”Р С•Р Р†: {room.memberships?.length ?? 0} / {room.max_players}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

