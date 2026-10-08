import type { Metadata } from "next";
import { JetBrains_Mono, Nunito_Sans } from "next/font/google";
import "./globals.css";

// Brand typeface is Avenir Next (Medium headings, Regular body). Until the web licence is confirmed we use it where
// installed and fall back to Nunito Sans, the closest open geometric humanist.
const sans = Nunito_Sans({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "System Guy", template: "%s · System Guy" },
  description: "System Guy by adm Indicia: Briefing+, Shopper IQ, Sourcing+, Logistics+, Execution+ and Assure+",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <head>
        {/* Material Symbols Rounded: the brand's supporting iconography. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0&display=block" />
      </head>
      <body className={`${sans.variable} ${mono.variable} font-sans text-[14px] leading-relaxed antialiased`}>
        {children}
      </body>
    </html>
  );
}
