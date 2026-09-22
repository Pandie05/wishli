import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GoogleSignInButton from '../components/GoogleSignInButton'
import { getRememberMe, setRememberMe, supabase } from '../lib/supabase'

const BAD_CREDENTIALS = 'Incorrect email/username or password.'

/**
 * Supabase only signs people in by email, so a typed username has to be
 * traded for the email behind it first. `email_for_login` is the security
 * definer function from sql-queries/001_create_users_table.sql.
 */
async function resolveEmail(identifier: string): Promise<string | null> {
  if (identifier.includes('@')) return identifier

  const { data, error } = await supabase.rpc('email_for_login', {
    identifier,
  })

  if (error) throw error
  return data as string | null
}

export default function Login() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(getRememberMe)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleForgotPassword() {
    const trimmed = identifier.trim()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter your email above, then click "Forgot password?"')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setError(error ? error.message : 'If an account exists for that email, a reset link is on its way.')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmed = identifier.trim()
    if (!trimmed || !password) {
      setError('Enter your email or username and your password.')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      // Has to happen before the sign-in call so the session Supabase writes
      // goes straight into the store the user picked.
      setRememberMe(remember)

      const email = await resolveEmail(trimmed)

      // No account owns that username. Say the same thing as a wrong password
      // so the form cannot be used to test which usernames exist.
      if (!email) {
        setError(BAD_CREDENTIALS)
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? BAD_CREDENTIALS
            : signInError.message,
        )
        return
      }

      navigate('/dashboard', { replace: true })
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-form-wrap">
      <h1 className="login-title">Welcome Back</h1>
      <p className="login-subtitle">
        Log in to pick up right where you left off
        <br />
        your wishlists are waiting for you.
      </p>

      <GoogleSignInButton remember={remember} />

      <div className="login-divider">or continue with email</div>

      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <div className="login-field">
          <label htmlFor="login-identifier">Email</label>
          <input
            id="login-identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            placeholder="enter email..."
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </div>

        <div className="login-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="enter password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        
        <label className="login-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember me
        </label>

        <button type="button" className="login-forgot" onClick={handleForgotPassword}>
          Forgot password?
        </button>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="login-submit" disabled={submitting}>
          {submitting ? 'Logging in...' : 'Login'}
        </button>
      </form>

      <p className="login-footer">
        Dont have an account? <Link to="/signup">Sign up for Free</Link>
      </p>
    </div>
  )
}
