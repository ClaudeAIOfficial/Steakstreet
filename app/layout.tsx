import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StakeStreet — Put Your Stocks To Work",
  description: "Stake Robinhood Stock Tokens on Robinhood Chain and earn transparent onchain rewards.",
  icons: {
    icon: "/stakestreet-logo.png",
    shortcut: "/stakestreet-logo.png",
    apple: "/stakestreet-logo.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
