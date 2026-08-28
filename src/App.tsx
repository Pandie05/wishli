import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Auth from './pages/Auth'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import WishlistDetail from './pages/WishlistDetail'
import Friends from './pages/Friends'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* every signed-in page renders inside one <AppShell>, mounted here
            rather than by the pages themselves. the rail then survives a
            navigation, which is what lets the active pill slide and the two
            pages animate past each other instead of the app blanking out. */}
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/wishlist/:wishlistId" element={<WishlistDetail />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* /login and /signup share one route so <Auth> survives the switch
            and can animate between them. Static paths above outrank it. */}
        <Route path="/:mode" element={<Auth />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
