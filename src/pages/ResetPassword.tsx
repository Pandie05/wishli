import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
    const navigate = useNavigate()
    const [ready, setReady] = useState(false)
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [done, setDone] = useState(false)

    useEffect(() => {
        const { data: listener } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') setReady(true)
        })

        supabase.auth.getSession().then(({ data }) => {
            if (data.session) setReady(true)
        })

        return () => {
            listener.subscription.unsubscribe()
        }
    }, [])

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return

        if (password.length < 8) {
            setError('Password must be at least 8 characters.')
            return
        }
        if (password !== confirm) {
            setError('Passwords do not match.')
            return
        }

        setError(null)
        setSubmitting(true)

        const { error: updateError } = await supabase.auth.updateUser({ password })

        setSubmitting(false)

        if (updateError) {
            setError(updateError.message)
            return
        }

        setDone(true)
        setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    }

    if (!ready) {
        return (
            <div className="login-form-wrap">
                <h1 className="login-title">Reset link expired</h1>
                <p className="login-subtitle">
                    This link is no longer valid. Request a new one from the login page.
                </p>
            </div>
        )
    }

    if (done) {
        return (
            <div className="login-form-wrap">
                <h1 className="login-title">Password updated</h1>
                <p className="login-subtitle">Taking you to your dashboard...</p>
            </div>
        )
    }

    return (
        <div className="login-form-wrap">
            <h1 className="login-title">Set a new password</h1>
            <p className="login-subtitle">Choose a new password for your account.</p>

            <form className="login-form" onSubmit={handleSubmit} noValidate>
                <div className="login-field">
                    <label htmlFor="reset-password">New password</label>
                    <input
                        id="reset-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="enter new password..."
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <div className="login-field">
                    <label htmlFor="reset-confirm">Confirm password</label>
                    <input
                        id="reset-confirm"
                        name="confirm"
                        type="password"
                        autoComplete="new-password"
                        placeholder="confirm new password..."
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                    />
                </div>

                {error && (
                    <p className="login-error" role="alert">
                        {error}
                    </p>
                )}

                <button type="submit" className="login-submit" disabled={submitting}>
                    {submitting ? 'Updating...' : 'Update password'}
                </button>
            </form>
        </div>
    )
}