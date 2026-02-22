import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import DeleteAccountConfirm from './pages/DeleteAccountConfirm'
import Profile from './pages/Profile'
import UserProfile from './pages/UserProfile'
import Rooms from './pages/Rooms'
import RoomDetail from './pages/RoomDetail'
import CreateRoom from './pages/CreateRoom'
import CS2Stats from './pages/CS2Stats'
import CS2Health from './pages/CS2Health'
import Chat from './pages/Chat'
import Chats from './pages/Chats'
import Home from './pages/Home'

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function PublicOnly({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="loading-spinner" />
      </div>
    )
  }
  if (isAuthenticated) return <Navigate to="/rooms" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="register" element={<PublicOnly><Register /></PublicOnly>} />
        <Route path="forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
        <Route path="reset-password" element={<PublicOnly><ResetPassword /></PublicOnly>} />
        <Route path="verify-email/:token" element={<PublicOnly><VerifyEmail /></PublicOnly>} />
        <Route path="delete-account/:token" element={<DeleteAccountConfirm />} />
        <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="users/:id" element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
        <Route path="chats" element={<ProtectedRoute><Chats /></ProtectedRoute>} />
        <Route path="chat/:userId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="rooms" element={<ProtectedRoute><Rooms /></ProtectedRoute>} />
        <Route path="rooms/create" element={<ProtectedRoute><CreateRoom /></ProtectedRoute>} />
        <Route path="rooms/:code" element={<ProtectedRoute><RoomDetail /></ProtectedRoute>} />
        <Route path="cs2" element={<ProtectedRoute><CS2Stats /></ProtectedRoute>} />
        <Route path="cs2/health" element={<ProtectedRoute><CS2Health /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
