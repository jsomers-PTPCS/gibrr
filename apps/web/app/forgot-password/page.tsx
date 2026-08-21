"use client";

import { useState, type FormEvent } from "react";
import { forgotPassword } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
    } finally {
      // Always show the same "sent" state regardless of outcome — the
      // API itself never reveals whether the email is registered, so
      // the UI shouldn't either.
      setSubmitting(false);
      setSent(true);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 380 }}>
      <h1>Forgot password</h1>
      {sent ? (
        <div className="card">
          <p>If that email is registered, a reset link is on its way.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card">
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={submitting} className="btn btn-accent" style={{ width: "100%" }}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </main>
  );
}
