import type { ReactNode } from "react";
import Link from "next/link";
import { Orbitron, Inter } from "next/font/google";
import { Nav } from "../components/Nav";
import { BottomTabBar } from "../components/BottomTabBar";
import { ChatDock } from "../components/ChatDock";
import { ConfirmDialogProvider } from "../components/ConfirmDialog";
import { PwaRegister } from "../components/PwaRegister";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "./globals.css";

// Every page under this layout has per-session state (login, unread
// counts) even though most of it loads client-side — Next's default
// static-optimization otherwise marks pages as long-lived-cacheable
// (s-maxage=31536000), which meant a client's HTTP cache (a phone's
// Chrome, in the Android app's case) could keep serving an old build's
// HTML/nav indefinitely after a deploy instead of revalidating.
export const dynamic = "force-dynamic";

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata = {
  title: "Gibrr",
  description: "A federated social platform.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Gibrr",
  },
};

// initialScale/maximumScale deliberately left at their defaults (no
// maximumScale: 1) — installable-app polish shouldn't come at the cost
// of a low-vision visitor's ability to pinch-zoom.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0710",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <PwaRegister />
        <ConfirmDialogProvider>
          <Nav />
          {children}
          <footer style={{ textAlign: "center", padding: "1.5rem 1rem", fontSize: "0.85rem" }} className="text-faint">
            <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
          </footer>
          <ChatDock />
          <BottomTabBar />
        </ConfirmDialogProvider>
      </body>
    </html>
  );
}
