import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { auth as authApi } from '../api'

export default function DeleteAccountConfirm() {
  const { token = '' } = useParams()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const confirmDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await authApi.deleteAccountConfirm(token)
      localStorage.removeItem('access')
      localStorage.removeItem('refresh')
      window.dispatchEvent(new Event('auth:logout'))
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.detail || 'Не удалось удалить аккаунт.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="page-title">Удаление аккаунта</h1>
      {done ? (
        <div className="panel">
          <div className="alert alert-success">Ваш аккаунт удалён.</div>
          <Link to="/" className="btn btn-primary">На главную</Link>
        </div>
      ) : (
        <div className="panel">
          <p style={{ color: 'var(--text-muted)' }}>
            Это действие навсегда удалит ваш аккаунт и связанную CS2-статистику.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={loading}>
            {loading ? 'Удаление...' : 'Подтвердить удаление'}
          </button>
        </div>
      )}
    </>
  )
}
