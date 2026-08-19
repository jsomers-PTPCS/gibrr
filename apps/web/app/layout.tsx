import type { ReactNode } from "react";

export const metadata = {
  title: "Astrion",
  description: "A federated social platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
