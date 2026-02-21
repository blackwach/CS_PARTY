import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || ''

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

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
  verifyEmail: (token) => api.get('/api/auth/verify-email/', { params: { token } }),
  passwordResetRequest: (email) => api.post('/api/auth/password-reset/request/', { email }),
  passwordResetConfirm: (token, new_password) =>
    api.post('/api/auth/password-reset/confirm/', { token, new_password }),
  passwordChange: (old_password, new_password) =>
    api.post('/api/auth/password-change/', { old_password, new_password }),
  usersSearch: (q) => api.get('/api/auth/users/search/', { params: { q } }),
  allowedInviters: (inviter_ids) => api.post('/api/auth/permissions/inviters/', { inviter_ids }),
  telegramLinkCode: () => api.post('/api/auth/telegram/link-code/'),
  telegramToggle: (enabled) => api.post('/api/auth/telegram/toggle/', { enabled }),
}

export const rooms = {
  list: () => api.get('/api/rooms/'),
  get: (code) => api.get(`/api/rooms/${code}/`),
  create: (data) => api.post('/api/rooms/', data),
  join: (code) => api.post(`/api/rooms/${code}/join/`),
  ready: (code) => api.post(`/api/rooms/${code}/ready/`),
  decline: (code) => api.post(`/api/rooms/${code}/decline/`),
}

export const cs2 = {
  getStats: () => api.get('/api/cs2/me/stats/'),
  sync: () => api.post('/api/cs2/me/sync/'),
}
