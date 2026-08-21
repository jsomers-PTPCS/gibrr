"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPassword, ApiError } from "../../lib/api";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? "that reset link is invalid or has expired" : "couldn't reset password");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <main className="page" style={{ maxWidth: 380 }}>
        <h1>Reset password</h1>
        <div className="card">
          <p className="error-text">Missing reset token — use the link from your email.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 380 }}>
      <h1>Reset password</h1>
      {done ? (
        <div className="card">
          <p>Your password has been reset. You&apos;ve been logged out everywhere — log in with your new password.</p>
          <Link href="/login" className="btn btn-accent" style={{ width: "100%", display: "block", textAlign: "center", marginTop: "0.75rem" }}>
            Log in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card">
          <label className="field">
            New password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <button type="submit" disabled={submitting} className="btn btn-accent" style={{ width: "100%" }}>
            {submitting ? "Resetting…" : "Reset password"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      )}
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="page">Loading…</main>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
