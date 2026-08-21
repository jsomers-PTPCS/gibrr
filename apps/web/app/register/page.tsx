"use client";

import { useState, type FormEvent } from "react";
import { register, ApiError } from "../../lib/api";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ username, email, password });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 380 }}>
      <h1>Register</h1>
      <form onSubmit={handleSubmit} className="card">
        <label className="field">
          Username
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
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
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit" disabled={submitting} className="btn btn-accent" style={{ width: "100%" }}>
          {submitting ? "Registering…" : "Register"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </main>
  );
}
