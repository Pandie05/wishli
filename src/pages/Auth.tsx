import { Navigate, useParams } from 'react-router-dom'
import Login from './Login'
import Signup from './Signup'
import loginImage from '../images/login-image.png'
import loginImageMask from '../images/login-image-mask.png'
import logo from '../images/logo.png'
import '../css/auth.css'
import '../css/login.css'

const MODES = ['login', 'signup']

/**
 * Hosts both credential forms at once so the artwork can slide between them.
 *
 * App.tsx routes /login and /signup through a single `/:mode` route on purpose:
 * separate <Route> elements would unmount this component on every switch and
 * there would be nothing left on screen to animate.
 */
export default function Auth() {
  const { mode } = useParams()

  if (!mode || !MODES.includes(mode)) {
    return <Navigate to="/login" replace />
  }

  const isSignup = mode === 'signup'

  return (
    <div className="auth" data-mode={mode}>
      <img className="auth-logo" src={logo} alt="wishli" />

      {/* The clipped-away pane is inert so its inputs stay out of the tab
          order and off the accessibility tree while it is hidden. */}
      <section className="auth-pane auth-pane--login" inert={isSignup}>
        <Login />
      </section>

      <section className="auth-pane auth-pane--signup" inert={!isSignup}>
        <Signup />
      </section>

      <div className="auth-art">
        <div className="auth-art-frame">
          <img src={loginImage} alt="" />
        </div>
        {/* Cut-out copy of the same art, unclipped, so the dandelions break
            out of the rounded frame. */}
        <img className="auth-art-pop" src={loginImageMask} alt="" />
      </div>
    </div>
  )
}
