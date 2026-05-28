import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

function WishliLogo() {
  return (
    <div className="logo">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="18" fill="#1E1B2E" />
        <path d="M18 8 L20.5 14.5 L27.5 14.5 L22 18.5 L24 25 L18 21 L12 25 L14 18.5 L8.5 14.5 L15.5 14.5 Z"
          fill="white" stroke="white" strokeWidth="0.5" strokeLinejoin="round" />
      </svg>
      <span className="logo-text">Wishli</span>
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      navigate('/dashboard');
    }, 800);
  }

  return (
    <div className="login-root">
      <div className="login-illustration">
        <div className="illustration-blob blob-1" />
        <div className="illustration-blob blob-2" />
        <div className="illustration-blob blob-3" />
        <div className="illustration-blob blob-4" />
        <div className="illustration-center">
          <svg viewBox="0 0 260 260" fill="none" className="illustration-svg">
            <circle cx="130" cy="130" r="90" fill="rgba(255,255,255,0.08)" />
            <circle cx="130" cy="130" r="60" fill="rgba(255,255,255,0.1)" />
            <path d="M130 70 L140 100 L172 100 L147 118 L156 148 L130 130 L104 148 L113 118 L88 100 L120 100 Z"
              fill="white" opacity="0.9" />
            <circle cx="80" cy="80" r="6" fill="white" opacity="0.4" />
            <circle cx="185" cy="75" r="4" fill="white" opacity="0.3" />
            <circle cx="70" cy="170" r="5" fill="white" opacity="0.35" />
            <circle cx="190" cy="175" r="7" fill="white" opacity="0.25" />
            <line x1="80" y1="80" x2="60" y2="50" stroke="white" strokeWidth="1.5" opacity="0.4" />
            <line x1="185" y1="75" x2="200" y2="48" stroke="white" strokeWidth="1.5" opacity="0.3" />
            <line x1="70" y1="170" x2="48" y2="195" stroke="white" strokeWidth="1.5" opacity="0.35" />
          </svg>
          <p className="illustration-tagline">Your lists. Your wishes.<br />All in one place.</p>
        </div>
      </div>

      <div className="login-form-panel">
        <WishliLogo />

        <div className="login-form-container">
          <h1 className="login-title">Login to Get Started</h1>
          <p className="login-subtitle">Welcome back!</p>

          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <input
                type="text"
                placeholder="Email or username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="login-input"
                required
              />
            </div>

            <div className="input-group">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="login-input"
                required
              />
              <button type="button" className="toggle-password" onClick={() => setShowPassword(v => !v)}>
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            <div className="login-options">
              <label className="remember-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="remember-checkbox"
                />
                <span>Remember me</span>
              </label>
              <button type="button" className="forgot-link">Forgot Password?</button>
            </div>

            <button type="submit" className={`login-btn ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? 'Logging in...' : 'Login'}
            </button>

            <p className="signup-prompt">
              Don&#39;t have an account?{' '}
              <button type="button" className="signup-link" onClick={() => {}}>Sign Up</button>
            </p>
          </form>
        </div>

        <p className="legal-text">
          By signing in you agree to the{' '}
          <button type="button" className="legal-link">terms of service</button>
          {' '}and{' '}
          <button type="button" className="legal-link">privacy policy</button>
          , including{' '}
          <button type="button" className="legal-link">cookie use</button>
        </p>
      </div>
    </div>
  );
}
