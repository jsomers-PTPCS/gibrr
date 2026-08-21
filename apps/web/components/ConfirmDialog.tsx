"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Styles the confirm button as destructive (red) — the default for
  // every delete/remove action this app actually asks about.
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

// A real in-app popup for "are you sure" prompts — every delete/remove
// action in the app calls this instead of the browser's native
// window.confirm(), so it looks and behaves like the rest of Gibrr
// (same .card styling, respects the theme) rather than an
// unstyleable OS dialog. Mounted once at the root layout; any
// component calls useConfirm() to get a confirm(message) function that
// resolves to true/false once the user picks, same shape
// window.confirm already has.
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      setState({ message, resolve, ...options });
    });
  }, []);

  function respond(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          onClick={() => respond(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 380, width: "100%" }}
          >
            <p style={{ margin: "0 0 1rem", fontWeight: 600 }}>{state.title ?? "Are you sure?"}</p>
            <p style={{ margin: "0 0 1.25rem" }}>{state.message}</p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => respond(false)}>
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button
                className="btn btn-accent"
                onClick={() => respond(true)}
                style={
                  state.danger !== false
                    ? { background: "var(--danger)", borderColor: "var(--danger)" }
                    : undefined
                }
              >
                {state.confirmLabel ?? "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmDialogProvider");
  return ctx;
}
