import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || ''
const wsBaseURL = import.meta.env.VITE_WS_URL || ''

export const api = axios.create({
  baseURL,
})

export function getWsBase() {
  if (wsBaseURL) return wsBaseURL.replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}`
  }
  return ''
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true
      const refresh = localStorage.getItem('refresh')
      if (refresh) {
        try {
          const { data } = await axios.post(`${baseURL}/api/auth/token/refresh/`, { refresh })
          localStorage.setItem('access', data.access)
          original.headers.Authorization = `Bearer ${data.access}`
          return api(original)
        } catch {
          localStorage.removeItem('access')
          localStorage.removeItem('refresh')
          window.dispatchEvent(new Event('auth:logout'))
        }
      }
    }
    return Promise.reject(err)
  }
)

export const auth = {
  login: (email, password) => api.post('/api/auth/login/', { email, password }),
  register: (body) => api.post('/api/auth/register/', body),
  refresh: () => api.post('/api/auth/token/refresh/', { refresh: localStorage.getItem('refresh') }),
  me: () => api.get('/api/auth/me/'),
  updateMe: (payload, config = {}) => api.patch('/api/auth/me/', payload, config),
  getUserProfile: (userId) => api.get(`/api/auth/users/${userId}/`),
  verifyEmail: (token) => api.get('/api/auth/verify-email/', { params: { token } }),
  passwordResetRequest: (email) => api.post('/api/auth/password-reset/request/', { email }),
  passwordResetConfirm: (token, new_password) =>
    api.post('/api/auth/password-reset/confirm/', { token, new_password }),
  deleteAccountRequest: () => api.post('/api/auth/delete-account/request/'),
  deleteAccountConfirm: (token) => api.post('/api/auth/delete-account/confirm/', { token }),
  passwordChange: (old_password, new_password) =>
    api.post('/api/auth/password-change/', { old_password, new_password }),
  usersSearch: (q) => api.get('/api/auth/users/search/', { params: { q } }),
  allowedInviters: (inviter_ids) => api.post('/api/auth/permissions/inviters/', { inviter_ids }),
  telegramLinkCode: () => api.post('/api/auth/telegram/link-code/'),
  telegramToggle: (enabled) => api.post('/api/auth/telegram/toggle/', { enabled }),
  friends: () => api.get('/api/auth/friends/'),
  friendRequestCreate: (user_id) => api.post('/api/auth/friends/request/', { user_id }),
  friendRequestsIncoming: () => api.get('/api/auth/friends/requests/incoming/'),
  friendRequestAccept: (request_id) => api.post(`/api/auth/friends/requests/${request_id}/accept/`),
  friendRequestDecline: (request_id) => api.post(`/api/auth/friends/requests/${request_id}/decline/`),
  notifications: () => api.get('/api/auth/notifications/'),
  notificationRead: (notification_id) => api.post(`/api/auth/notifications/${notification_id}/read/`),
  notificationsReadAll: () => api.post('/api/auth/notifications/read-all/'),
  chats: () => api.get('/api/auth/chats/'),
  chatMessages: (user_id) => api.get(`/api/auth/chats/${user_id}/messages/`),
  chatSend: (user_id, text) => api.post(`/api/auth/chats/${user_id}/messages/`, { text }),
}

export const rooms = {
  list: () => api.get('/api/rooms/'),
  get: (code) => api.get(`/api/rooms/${code}/`),
  create: (data) => api.post('/api/rooms/', data),
  join: (code) => api.post(`/api/rooms/${code}/join/`),
  ready: (code, data = {}) => api.post(`/api/rooms/${code}/ready/`, data),
  unready: (code) => api.post(`/api/rooms/${code}/unready/`),
  decline: (code) => api.post(`/api/rooms/${code}/decline/`),
  close: (code) => api.post(`/api/rooms/${code}/close/`),
  diagnostics: (code, data = {}) => api.post(`/api/rooms/${code}/diagnostics/`, data),
}

export const cs2 = {
  getStats: () => api.get('/api/cs2/me/stats/'),
  sync: () => api.post('/api/cs2/me/sync/', {}),
  health: () => api.get('/api/cs2/health/'),
  addFriendByInvite: (invite_link) => api.post('/api/cs2/friends/add/', { invite_link }),
  submitSteamGuardCode: (code) => api.post('/api/cs2/guard/submit/', { code }),
}
