import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { USERNAME_TAKEN, usernameTaken, validateUsername } from '../lib/username'
import { useShell } from '../components/AppShell'
import ImageDrop from '../components/ImageDrop'
import '../css/settings.css'

type Message = { text: string; ok: boolean } | null

export default function Settings() {
    const navigate = useNavigate()
    const shell = useShell()
    const [loading, setLoading] = useState(true)
    const [userId, setUserId] = useState<string | null>(null)
    // the address on auth.users, which is the one that can log in. the copy in
    // public.users only catches up once a change is confirmed (see 005).
    const [accountEmail, setAccountEmail] = useState('')
    const [currentUsername, setCurrentUsername] = useState('')
    // google accounts have no password to re-enter or replace
    const [hasPassword, setHasPassword] = useState(true)

    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [avatarError, setAvatarError] = useState<string | null>(null)
    const [savingAvatar, setSavingAvatar] = useState(false)

    const [username, setUsername] = useState('')
    const [usernameMessage, setUsernameMessage] = useState<Message>(null)
    const [savingUsername, setSavingUsername] = useState(false)

    const [publicProfile, setPublicProfile] = useState(false)
    const [profileMessage, setProfileMessage] = useState<Message>(null)
    const [savingProfile, setSavingProfile] = useState(false)

    const [email, setEmail] = useState('')
    const [emailMessage, setEmailMessage] = useState<Message>(null)
    const [savingEmail, setSavingEmail] = useState(false)

    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [passwordMessage, setPasswordMessage] = useState<Message>(null)
    const [savingPassword, setSavingPassword] = useState(false)

    useEffect(() => {
        let cancelled = false

        async function load() {
            const { data } = await supabase.auth.getSession()
            const user = data.session?.user

            if (!user) {
                if (!cancelled) navigate('/login', { replace: true })
                return
            }

            const { data: profile } = await supabase
                .from('users')
                .select('username, avatar_url, public_profile')
                .eq('id', user.id)
                .single()

            if (cancelled) return

            setUserId(user.id)
            setAccountEmail(user.email ?? '')
            setEmail(user.email ?? '')
            setCurrentUsername(profile?.username ?? '')
            setUsername(profile?.username ?? '')
            setAvatarUrl(profile?.avatar_url ?? null)
            setPublicProfile(profile?.public_profile ?? false)
            setHasPassword(user.identities?.some((i) => i.provider === 'email') ?? true)
            setLoading(false)
        }

        load()
        return () => {
            cancelled = true
        }
    }, [navigate])

    // ImageDrop already handles the upload itself and hands back a url (or
    // null on Remove) -- there is nothing else on this form to batch it with,
    // so it saves the moment it changes rather than waiting on a submit
    async function handleAvatarChange(next: string | null) {
        if (!userId || savingAvatar) return

        setSavingAvatar(true)
        setAvatarError(null)

        const { error } = await supabase.from('users').update({ avatar_url: next }).eq('id', userId)

        setSavingAvatar(false)

        if (error) {
            setAvatarError(error.message)
            return
        }

        setAvatarUrl(next)
        shell.refresh()
    }

    async function handlePublicProfile(next: boolean) {
        if (!userId || savingProfile) return

        setSavingProfile(true)
        setProfileMessage(null)

        const { error } = await supabase
            .from('users')
            .update({ public_profile: next })
            .eq('id', userId)

        setSavingProfile(false)

        if (error) {
            setProfileMessage({ text: error.message, ok: false })
            return
        }

        setPublicProfile(next)
        setProfileMessage({
            text: next ? 'Your profile is live.' : 'Your profile is hidden again.',
            ok: true,
        })
    }

    async function handleUsername(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (savingUsername || !userId) return

        const name = username.trim()
        if (name.toLowerCase() === currentUsername.toLowerCase()) {
            setUsernameMessage({ text: 'That is already your username.', ok: false })
            return
        }

        const problem = validateUsername(name)
        if (problem) {
            setUsernameMessage({ text: problem, ok: false })
            return
        }

        setUsernameMessage(null)
        setSavingUsername(true)

        try {
            if (await usernameTaken(name)) {
                setUsernameMessage({ text: USERNAME_TAKEN, ok: false })
                return
            }

            const { error } = await supabase.from('users').update({ username: name }).eq('id', userId)

            if (error) {
                // another account could have claimed it between the check above and
                // here; the unique index on lower(username) is what actually stops it
                setUsernameMessage({
                    text: error.code === '23505' ? USERNAME_TAKEN : error.message,
                    ok: false,
                })
                return
            }

            setCurrentUsername(name)
            setUsername(name)
            setUsernameMessage({ text: 'Username updated.', ok: true })
        } catch {
            setUsernameMessage({ text: 'Could not reach the server. Please try again.', ok: false })
        } finally {
            setSavingUsername(false)
        }
    }

    async function handleEmail(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (savingEmail) return

        const mail = email.trim()
        if (mail.toLowerCase() === accountEmail.toLowerCase()) {
            setEmailMessage({ text: 'That is already your email address.', ok: false })
            return
        }
        if (!mail.includes('@')) {
            setEmailMessage({ text: 'Enter a valid email address.', ok: false })
            return
        }

        setEmailMessage(null)
        setSavingEmail(true)

        const { error } = await supabase.auth.updateUser({ email: mail })

        if (error) {
            setEmailMessage({ text: error.message, ok: false })
            setSavingEmail(false)
            return
        }

        // the address on auth.users does not change until the link is clicked, so
        // accountEmail stays as it is — that is still what logs in right now
        setEmailMessage({
            text: `Check ${mail} for a confirmation link. The change takes effect once you click it.`,
            ok: true,
        })
        setSavingEmail(false)
    }

    async function handlePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (savingPassword) return

        if (!currentPassword || !newPassword) {
            setPasswordMessage({ text: 'Fill in every field.', ok: false })
            return
        }
        if (newPassword.length < 6) {
            setPasswordMessage({ text: 'Password must be at least 6 characters.', ok: false })
            return
        }
        if (newPassword !== confirmPassword) {
            setPasswordMessage({ text: 'Passwords do not match.', ok: false })
            return
        }

        setPasswordMessage(null)
        setSavingPassword(true)

        try {
            // updateUser() happily changes the password of whoever holds the session,
            // so the old one is checked here to stop a walk-up at an unlocked screen.
            // signing in again on success just refreshes the same user's session.
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: accountEmail,
                password: currentPassword,
            })

            if (signInError) {
                setPasswordMessage({ text: 'Current password is incorrect.', ok: false })
                return
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword })

            if (error) {
                setPasswordMessage({ text: error.message, ok: false })
                return
            }

            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
            setPasswordMessage({ text: 'Password updated.', ok: true })
        } catch {
            setPasswordMessage({ text: 'Could not reach the server. Please try again.', ok: false })
        } finally {
            setSavingPassword(false)
        }
    }

    return (
        <div className="set">
            <header className="set-head">
                <p className="set-eyebrow">{accountEmail || 'Your account'}</p>
                <h1 className="set-title">Settings</h1>
            </header>

            <section className="set-section">
                <div className="set-section-head">
                    <span className="set-section-num">01</span>
                    <h2>Profile picture</h2>
                </div>
                <ImageDrop
                    value={avatarUrl}
                    onChange={handleAvatarChange}
                    userId={userId}
                    onError={setAvatarError}
                    hint="PNG, JPG, WEBP or GIF up to 5 MB"
                />
                {savingAvatar && <p className="set-notice">Saving...</p>}
                {avatarError && <p className="set-error">{avatarError}</p>}
            </section>

            <section className="set-section">
                <div className="set-section-head">
                    <span className="set-section-num">02</span>
                    <h2>Username</h2>
                </div>
                <form className="set-form" onSubmit={handleUsername}>
                    <div className="set-field">
                        <label htmlFor="set-username">Username</label>
                        <input
                            id="set-username"
                            name="username"
                            type="text"
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <button type="submit" disabled={savingUsername || loading}>
                        {savingUsername ? 'Saving...' : 'Save username'}
                    </button>
                </form>
                <Notice message={usernameMessage} />
            </section>

            <section className="set-section">
                <div className="set-section-head">
                    <span className="set-section-num">03</span>
                    <h2>Public profile</h2>
                </div>
                <label className="set-toggle">
                    <input
                        type="checkbox"
                        checked={publicProfile}
                        disabled={savingProfile || loading || !currentUsername}
                        onChange={(e) => handlePublicProfile(e.target.checked)}
                    />
                    <span>
                        Let anyone with your username see the wishlists you have already
                        turned link-sharing on for.
                    </span>
                </label>

                {currentUsername ? (
                    <p className="set-empty">
                        {publicProfile ? (
                            <>
                                Live at{' '}
                                <a href={`/u/${currentUsername}`} target="_blank" rel="noreferrer">
                                    /u/{currentUsername}
                                </a>
                                . Lists without a share link stay private.
                            </>
                        ) : (
                            <>Nobody can reach /u/{currentUsername} while this is off.</>
                        )}
                    </p>
                ) : (
                    <p className="set-empty">Pick a username first.</p>
                )}

                <Notice message={profileMessage} />
            </section>

            <section className="set-section">
                <div className="set-section-head">
                    <span className="set-section-num">04</span>
                    <h2>Email</h2>
                </div>
                <form className="set-form" onSubmit={handleEmail}>
                    <div className="set-field">
                        <label htmlFor="set-email">Email</label>
                        <input
                            id="set-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <button type="submit" disabled={savingEmail || loading}>
                        {savingEmail ? 'Sending...' : 'Save email'}
                    </button>
                </form>
                <Notice message={emailMessage} />
            </section>

            <section className="set-section">
                <div className="set-section-head">
                    <span className="set-section-num">05</span>
                    <h2>Password</h2>
                </div>
                {hasPassword ? (
                    <>
                        <form className="set-form" onSubmit={handlePassword}>
                            <div className="set-field">
                                <label htmlFor="set-current-password">Current password</label>
                                <input
                                    id="set-current-password"
                                    name="current-password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                />
                            </div>
                            <div className="set-field">
                                <label htmlFor="set-new-password">New password</label>
                                <input
                                    id="set-new-password"
                                    name="new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                />
                            </div>
                            <div className="set-field">
                                <label htmlFor="set-confirm-password">Confirm new password</label>
                                <input
                                    id="set-confirm-password"
                                    name="confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                />
                            </div>
                            <button type="submit" disabled={savingPassword || loading}>
                                {savingPassword ? 'Saving...' : 'Change password'}
                            </button>
                        </form>
                        <Notice message={passwordMessage} />
                    </>
                ) : (
                    <p className="set-empty">
                        You signed in with Google, so there is no password to change here.
                    </p>
                )}
            </section>
        </div>
    )
}

function Notice({ message }: { message: Message }) {
    if (!message) return null

    return (
        <p
            className={message.ok ? 'set-notice' : 'set-error'}
            role={message.ok ? 'status' : 'alert'}
        >
            {message.text}
        </p>
    )
}
