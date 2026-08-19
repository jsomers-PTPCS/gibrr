"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function HomePage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setStatus(data.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "3rem" }}>
      <h1>Astrion</h1>
      <p>A federated social platform.</p>
      <p>
        API status:{" "}
        {status === "loading" ? "checking…" : status === "ok" ? "✅ connected" : "❌ unreachable"}
      </p>
    </main>
  );
}
