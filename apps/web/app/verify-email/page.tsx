"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "../../lib/api";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    verifyEmail(token)
      .then(() => setState("done"))
      .catch(() => setState("error"));
  }, [token]);

  return (
    <main className="page" style={{ maxWidth: 380 }}>
      <h1>Verify email</h1>
      <div className="card">
        {state === "loading" && <p className="text-dim">Verifying…</p>}
        {state === "done" && (
          <>
            <p>Your email is verified.</p>
            <Link href="/settings" className="btn btn-accent" style={{ width: "100%", display: "block", textAlign: "center" }}>
              Back to settings
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <p className="error-text">That verification link is invalid or has expired.</p>
            <p className="text-faint" style={{ margin: "0.5rem 0 0" }}>
              You can request a new one from <Link href="/settings">settings</Link>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="page">Loading…</main>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
