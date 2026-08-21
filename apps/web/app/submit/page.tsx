"use client";

import { useEffect, useState } from "react";
import { getMe } from "../../lib/api";
import { PostComposer } from "../../components/PostComposer";

export default function SubmitPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    getMe()
      .then(() => setAuthChecked(true))
      .catch(() => {
        window.location.href = "/login";
      });
  }, []);

  if (!authChecked) return null;

  return (
    <main className="page" style={{ maxWidth: 480 }}>
      <h1>Gib something</h1>
      <div className="card">
        <PostComposer
          title={title}
          onTitleChange={setTitle}
          onPosted={() => (window.location.href = "/")}
        />
      </div>
    </main>
  );
}
