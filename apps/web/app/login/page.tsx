"use client";

import { useState, type FormEvent } from "react";
import { login, ApiError } from "../../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? "invalid email or password" : "login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 400 }}>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </form>
    </main>
  );
}
