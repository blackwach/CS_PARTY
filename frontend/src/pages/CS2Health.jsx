import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cs2 as cs2Api } from '../api'
import { useAuth } from '../context/AuthContext'

const CS2_BOT_ADMIN_EMAIL = 'backwach1@yandex.ru'

function toDetail(err, fallback) {
  const data = err?.response?.data
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail
  if (Array.isArray(data?.detail) && data.detail[0]) return String(data.detail[0])
  if (Array.isArray(data?.non_field_errors) && data.non_field_errors[0]) return String(data.non_field_errors[0])
  return fallback
}

export default function CS2Health() {
  const { user } = useAuth()
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [inviteLink, setInviteLink] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')
  const [guardCode, setGuardCode] = useState('')
  const [guardLoading, setGuardLoading] = useState(false)
  const [guardError, setGuardError] = useState('')
  const [guardSuccess, setGuardSuccess] = useState('')

  const isBotAdmin = String(user?.email || '').trim().toLowerCase() === CS2_BOT_ADMIN_EMAIL

  const load = async (silent = false) => {
    if (!isBotAdmin) {
      setLoading(false)
      return
    }

    if (!silent) setLoading(true)
    try {
      const { data } = await cs2Api.health()
      setHealth(data)
      setError('')
    } catch (err) {
      setError(toDetail(err, 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ CS2-Р±РѕС‚Р°.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isBotAdmin) {
      setLoading(false)
      return undefined
    }

    load(false)
    const timer = setInterval(() => load(true), 10000)
    return () => clearInterval(timer)
  }, [isBotAdmin])

  const serviceReachable = Boolean(health?.service_reachable)
  const botLoggedOn = Boolean(health?.service?.bot?.logged_on)
  const gcReady = Boolean(health?.service?.bot?.gc_ready)
  const isConnected = useMemo(() => {
    return Boolean(serviceReachable && botLoggedOn && gcReady)
  }, [serviceReachable, botLoggedOn, gcReady])
  const steamGuardPending = health?.service?.bot?.steam_guard_pending || null

  const onSubmit = async (event) => {
    event.preventDefault()
    const link = inviteLink.trim()
    if (!link) {
      setSubmitError('Р’РІРµРґРёС‚Рµ СЃСЃС‹Р»РєСѓ РїСЂРёРіР»Р°С€РµРЅРёСЏ РІ РґСЂСѓР·СЊСЏ.')
      setSubmitSuccess('')
      return
    }

    setSubmitLoading(true)
    setSubmitError('')
    setSubmitSuccess('')
    try {
      const { data } = await cs2Api.addFriendByInvite(link)
      const status = data?.status || 'request_sent'
      const steamId = data?.steam_id ? ` (${data.steam_id})` : ''
      if (status === 'already_or_pending') {
        setSubmitSuccess(`РЈР¶Рµ РІ РґСЂСѓР·СЊСЏС… РёР»Рё Р·Р°СЏРІРєР° СѓР¶Рµ РѕС‚РїСЂР°РІР»РµРЅР°${steamId}.`)
      } else {
        setSubmitSuccess(`Р—Р°СЏРІРєР° РІ РґСЂСѓР·СЊСЏ РѕС‚РїСЂР°РІР»РµРЅР°${steamId}.`)
      }
      setInviteLink('')
      await load(true)
    } catch (err) {
      setSubmitError(toDetail(err, 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ РІ РґСЂСѓР·СЊСЏ.'))
    } finally {
      setSubmitLoading(false)
    }
  }

  const onSubmitGuardCode = async (event) => {
    event.preventDefault()
    const code = guardCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      setGuardError('Р’РІРµРґРёС‚Рµ РєРѕСЂСЂРµРєС‚РЅС‹Р№ 5-СЃРёРјРІРѕР»СЊРЅС‹Р№ РєРѕРґ Steam Guard.')
      setGuardSuccess('')
      return
    }

    setGuardLoading(true)
    setGuardError('')
    setGuardSuccess('')
    try {
      await cs2Api.submitSteamGuardCode(code)
      setGuardSuccess('РљРѕРґ Steam Guard РѕС‚РїСЂР°РІР»РµРЅ.')
      setGuardCode('')
      await load(true)
    } catch (err) {
      setGuardError(toDetail(err, 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєРѕРґ Steam Guard.'))
    } finally {
      setGuardLoading(false)
    }
  }

  if (!isBotAdmin) {
    return (
      <section className="panel cs2-health-panel">
        <h1 className="page-title">РЎРѕСЃС‚РѕСЏРЅРёРµ CS2-Р±РѕС‚Р°</h1>
        <div className="alert alert-error">
          Р”РѕСЃС‚СѓРї Рє СѓРїСЂР°РІР»РµРЅРёСЋ CS2-Р±РѕС‚РѕРј СЂР°Р·СЂРµС€РµРЅ С‚РѕР»СЊРєРѕ РґР»СЏ {CS2_BOT_ADMIN_EMAIL}.
        </div>
        <Link className="btn btn-secondary" to="/cs2">Рљ СЃС‚Р°С‚РёСЃС‚РёРєРµ</Link>
      </section>
    )
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
      <div className="cs2-health-head">
        <h1 className="page-title">РЎРѕСЃС‚РѕСЏРЅРёРµ CS2-Р±РѕС‚Р°</h1>
        <div className="cs2-health-head-actions">
          <button type="button" className="btn btn-secondary" onClick={() => load(false)}>
            РћР±РЅРѕРІРёС‚СЊ
          </button>
          <Link className="btn btn-ghost" to="/cs2">
            Рљ СЃС‚Р°С‚РёСЃС‚РёРєРµ
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {submitError && <div className="alert alert-error">{submitError}</div>}
      {submitSuccess && <div className="alert alert-success">{submitSuccess}</div>}
      {guardError && <div className="alert alert-error">{guardError}</div>}
      {guardSuccess && <div className="alert alert-success">{guardSuccess}</div>}

      <section className="panel cs2-health-panel">
        <h2>РЎС‚Р°С‚СѓСЃ Р±РѕС‚Р°</h2>
        <div className="stat-grid">
          <div className="stat-box">
            <div className="stat-label">API reachable</div>
            <div className="stat-value">{serviceReachable ? 'Yes' : 'No'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Steam logged on</div>
            <div className="stat-value">{botLoggedOn ? 'Yes' : 'No'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">GC ready</div>
            <div className="stat-value">{gcReady ? 'Yes' : 'No'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">/players ready</div>
            <div className="stat-value">{isConnected ? 'Yes' : 'No'}</div>
          </div>
        </div>
        {!isConnected && health?.service?.bot?.last_error && (
          <p className="form-hint" style={{ marginTop: '0.6rem' }}>
            РџРѕСЃР»РµРґРЅСЏСЏ РѕС€РёР±РєР°: {health.service.bot.last_error}
          </p>
        )}
      </section>

      {steamGuardPending && (
        <section className="panel cs2-health-panel">
          <h2>Steam Guard</h2>
          <p className="form-hint">
            Р”Р»СЏ РІС…РѕРґР° Р±РѕС‚Р° С‚СЂРµР±СѓРµС‚СЃСЏ РєРѕРґ Steam Guard.
            {steamGuardPending?.source ? ` РўРёРї РїСЂРѕРІРµСЂРєРё: ${steamGuardPending.source}.` : ''}
          </p>
          <form onSubmit={onSubmitGuardCode}>
            <div className="room-search-bar">
              <input
                type="text"
                value={guardCode}
                onChange={(event) => setGuardCode(event.target.value)}
                placeholder="ABCDE"
                autoComplete="one-time-code"
                maxLength={5}
              />
              <button type="submit" className="btn btn-primary" disabled={guardLoading}>
                {guardLoading ? 'РћС‚РїСЂР°РІРєР°...' : 'РћС‚РїСЂР°РІРёС‚СЊ РєРѕРґ'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel cs2-health-panel">
        <h2>Р”РѕР±Р°РІРёС‚СЊ РґСЂСѓРіР° РїРѕ СЃСЃС‹Р»РєРµ</h2>
        <form onSubmit={onSubmit}>
          <div className="room-search-bar">
            <input
              type="text"
              value={inviteLink}
              onChange={(event) => setInviteLink(event.target.value)}
              placeholder="https://steamcommunity.com/profiles/7656119..."
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary" disabled={submitLoading}>
              {submitLoading ? 'РћС‚РїСЂР°РІРєР°...' : 'Р”РѕР±Р°РІРёС‚СЊ'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

