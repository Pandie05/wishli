import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import GoogleButton from '../components/GoogleButton'

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
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', // Tells Supabase to route through Google APIs
      options: {
        redirectTo: `${window.location.origin}/dashboard`, // Redirect to /dashboard after successful login
      },
    });
    
    if (error) console.error("Error logging in:", error.message);
  };


  return (
    <div className="login-form-wrap">
      <h1 className="login-title">Welcome Back</h1>
      <p className="login-subtitle">
        Log in to pick up right where you left off
        <br />
        your wishlists are waiting for you.
      </p>

      <button onClick={loginWithGoogle} className="login-google">
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16">
          <path d="M0 0h16v16H0z" fill="none" />
          <g fill="none" fill-rule="evenodd" clip-rule="evenodd">
            <path fill="#f44336" d="M7.209 1.061c.725-.081 1.154-.081 1.933 0a6.57 6.57 0 0 1 3.65 1.82a100 100 0 0 0-1.986 1.93q-1.876-1.59-4.188-.734q-1.696.78-2.362 2.528a78 78 0 0 1-2.148-1.658a.26.26 0 0 0-.16-.027q1.683-3.245 5.26-3.86" opacity=".987" />
            <path fill="#ffc107" d="M1.946 4.92q.085-.013.161.027a78 78 0 0 0 2.148 1.658A7.6 7.6 0 0 0 4.04 7.99q.037.678.215 1.331L2 11.116Q.527 8.038 1.946 4.92" opacity=".997" />
            <path fill="#448aff" d="M12.685 13.29a26 26 0 0 0-2.202-1.74q1.15-.812 1.396-2.228H8.122V6.713q3.25-.027 6.497.055q.616 3.345-1.423 6.032a7 7 0 0 1-.51.49" opacity=".999" />
            <path fill="#43a047" d="M4.255 9.322q1.23 3.057 4.51 2.854a3.94 3.94 0 0 0 1.718-.626q1.148.812 2.202 1.74a6.62 6.62 0 0 1-4.027 1.684a6.4 6.4 0 0 1-1.02 0Q3.82 14.524 2 11.116z" opacity=".993" />
          </g>
        </svg>Sign In with Google
      </button>

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
