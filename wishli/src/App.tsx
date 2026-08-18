import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import WishlistDetail from './pages/WishlistDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/wishlist/:wishlistId" element={<WishlistDetail />} />
        {/* /login and /signup share one route so <Auth> survives the switch
            and can animate between them. Static paths above outrank it. */}
        <Route path="/:mode" element={<Auth />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
