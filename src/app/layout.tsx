import type { Metadata } from "next";
import { Barlow_Semi_Condensed, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Assure+", template: "%s · Assure+" },
  description: "adm Indicia supplier relationship management",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className={`${display.variable} ${body.variable} ${mono.variable} font-sans text-[15px] antialiased`}>
        {children}
      </body>
    </html>
  );
}
