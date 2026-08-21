"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { login, verifyTwoFactorChallenge, ApiError } from "../../lib/api";

export default function LoginPage() {
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set only once a 2FA-enabled account's password checks out — the
  // form below swaps to asking for the authenticator code (or a backup
  // code) instead, same challengeId used for every attempt.
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [token, setToken] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ emailOrUsername, password });
      if ("requiresTwoFactor" in result) {
        setChallengeId(result.challengeId);
      } else {
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof ApiError ? "invalid email/username or password" : "login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyTwoFactorChallenge(challengeId, token.trim());
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? "invalid code" : "verification failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (challengeId) {
    return (
      <main className="page" style={{ maxWidth: 380 }}>
        <h1>Two-factor authentication</h1>
        <form onSubmit={handleVerify} className="card">
          <label className="field">
            Authenticator code (or a backup code)
            <input
              className="input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              required
            />
          </label>
          <button type="submit" disabled={submitting || !token.trim()} className="btn btn-accent" style={{ width: "100%" }}>
            {submitting ? "Verifying…" : "Verify"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 380 }}>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit} className="card">
        <label className="field">
          Email or username
          <input
            className="input"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting} className="btn btn-accent" style={{ width: "100%" }}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
        {error && <p className="error-text">{error}</p>}
        <p className="text-faint" style={{ margin: "0.75rem 0 0", textAlign: "center" }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      </form>
    </main>
  );
}
