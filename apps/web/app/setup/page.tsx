"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSetupStatus, completeSetup, ApiError } from "../../lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then(({ needsSetup }) => {
        if (!needsSetup) {
          // Someone hitting /setup after it's already done — bounce
          // them to the normal login instead of showing a dead form.
          router.replace("/login");
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await completeSetup({ username, email, password });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return <main className="page">Loading…</main>;
  }

  return (
    <main className="page" style={{ maxWidth: 420 }}>
      <h1>Welcome to Gibrr</h1>
      <p className="text-dim" style={{ marginTop: 0 }}>
        This room hasn&apos;t been set up yet. Create the first account — it becomes the
        room host.
      </p>
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
          {submitting ? "Setting up…" : "Create host account"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </main>
  );
}
