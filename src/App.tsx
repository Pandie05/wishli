import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Auth from './pages/Auth'
import ErrorBoundary from './components/ErrorBoundary'

/**
 * Auth stays eager: it is the cold start for anyone without a session, and
 * making it wait on a second request would show a blank page at the one
 * moment first impressions are formed.
 *
 * Everything else is split out. A logged-out visitor -- including someone
 * opening a share link, who may never sign up at all -- was downloading the
 * entire signed-in app to see one read-only page.
 *
 * AppShell carries its own <Suspense> around the routed page, so navigating
 * between signed-in pages never blanks the nav (see AppShell.tsx).
 */
const AppShell = lazy(() => import('./components/AppShell'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const WishlistDetail = lazy(() => import('./pages/WishlistDetail'))
const Friends = lazy(() => import('./pages/Friends'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Settings = lazy(() => import('./pages/Settings'))
const PublicProfile = lazy(() => import('./pages/PublicProfile'))
const SharedWishlist = lazy(() => import('./pages/SharedWishlist'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {/* null rather than a spinner: these chunks are small and local, so a
            flashed loading state reads as a glitch more than as progress */}
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* every signed-in page renders inside one <AppShell>, mounted
                here rather than by the pages themselves. the rail then
                survives a navigation, which is what lets the active pill
                slide and the two pages animate past each other instead of
                the app blanking out. */}
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wishlist/:wishlistId" element={<WishlistDetail />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            {/* no session needed, no shell -- a link-sharing recipient may
                never make an account at all */}
            <Route path="/share/:token" element={<SharedWishlist />} />
            <Route path="/u/:username" element={<PublicProfile />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* /login and /signup share one route so <Auth> survives the
                switch and can animate between them. Static paths above
                outrank it. */}
            <Route path="/:mode" element={<Auth />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
