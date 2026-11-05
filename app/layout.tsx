import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retigram",
  description: "Turn any diagram into an interactive React Flow diagram.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body cz-shortcut-listen="false">{children}</body>
    </html>
  );
}
