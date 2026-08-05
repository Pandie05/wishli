import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import GoogleButton from '../components/GoogleButton'

// Mirrors the check constraints on public.users so bad input is caught before
// it becomes an opaque database error.
const USERNAME_PATTERN = /^[A-Za-z0-9_.]+$/
const USERNAME_TAKEN = 'That username is already taken.'

function validate(username: string, email: string, password: string, confirm: string) {
  if (!username || !email || !password) return 'Fill in every field.'
  if (username.length < 3 || username.length > 30)
    return 'Username must be 3 to 30 characters.'
  if (!USERNAME_PATTERN.test(username))
    return 'Username can only use letters, numbers, dots and underscores.'
  if (!email.includes('@')) return 'Enter a valid email address.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}

/**
 * `email_for_login` matches on username OR email. Usernames cannot contain an
 * "@" (see USERNAME_PATTERN), so a hit here can only mean the username itself
 * is taken. Reusing it saves adding a second database function.
 *
 * This is only for a friendly error message — the unique index on
 * lower(username) is what actually prevents a duplicate, since another signup
 * could land between this check and the insert.
 */
async function usernameTaken(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('email_for_login', {
    identifier: username,
  })

  if (error) throw error
  return data != null
}

export default function Signup() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const name = username.trim()
    const mail = email.trim()

    const problem = validate(name, mail, password, confirm)
    if (problem) {
      setError(problem)
      return
    }

    setError(null)
    setNotice(null)
    setSubmitting(true)

    try {
      if (await usernameTaken(name)) {
        setError(USERNAME_TAKEN)
        return
      }

      // The on_auth_user_created trigger reads this metadata to build the
      // public.users profile row.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: mail,
        password,
        options: { data: { username: name } },
      })

      if (signUpError) {
        // A duplicate username makes the trigger's insert fail, which surfaces
        // as a generic database error rather than a unique violation.
        setError(
          /database error|duplicate key/i.test(signUpError.message)
            ? USERNAME_TAKEN
            : signUpError.message,
        )
        return
      }

      // No session means email confirmation is switched on for the project.
      if (data.session) {
        navigate('/home', { replace: true })
      } else {
        setNotice('Check your email to confirm your account, then log in.')
      }
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
          redirectTo: `${window.location.origin}/home`, // Redirect to /home after successful login
        },
      });
      
      if (error) console.error("Error logging in:", error.message);
    };

  return (
    <div className="login-form-wrap login-form-wrap--signup">
      <h1 className="login-title">Create Account</h1>
      <p className="login-subtitle">
        Join Wishli and start building wishlists
        <br />
        you can share with the people who matter most.
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
          <label htmlFor="signup-username">Username</label>
          <input
            id="signup-username"
            name="username"
            type="text"
            autoComplete="username"
            placeholder="pick a username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="login-field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="enter email..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="login-field">
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="enter password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="login-field">
          <label htmlFor="signup-confirm">Confirm Password</label>
          <input
            id="signup-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="confirm password..."
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="login-notice" role="status">
            {notice}
          </p>
        )}

        <button type="submit" className="login-submit" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      <p className="login-footer">
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  )
}
