import type { ReactNode } from "react";
import { Nav } from "../components/Nav";

export const metadata = {
  title: "Astrion",
  description: "A federated social platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif" }}>
        <Nav />
        {children}
      </body>
    </html>
  );
}
