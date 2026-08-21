import type { ReactNode } from "react";
import Link from "next/link";
import { Orbitron, Inter } from "next/font/google";
import { Nav } from "../components/Nav";
import { ChatDock } from "../components/ChatDock";
import { ConfirmDialogProvider } from "../components/ConfirmDialog";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import "./globals.css";

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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${inter.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ConfirmDialogProvider>
          <Nav />
          {children}
          <footer style={{ textAlign: "center", padding: "1.5rem 1rem", fontSize: "0.85rem" }} className="text-faint">
            <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
          </footer>
          <ChatDock />
        </ConfirmDialogProvider>
      </body>
    </html>
  );
}
