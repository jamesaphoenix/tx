import './globals.css';
import { Banner } from 'fumadocs-ui/components/banner';
import { RootProvider } from 'fumadocs-ui/provider/next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

const GA_ID = 'G-JPDS4Q62K4';

export const metadata: Metadata = {
  title: {
    default: 'tx Documentation',
    template: '%s | tx Docs',
  },
  description: 'Primitives, not frameworks. Headless infrastructure for memory, tasks, and orchestration.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
      </head>
      <body className="flex min-h-screen flex-col">
        <Banner id="tx-agent-kit-launch" variant="rainbow">
          <span className="font-medium">
            tx-agent-kit is now open source
            <span className="mx-2 opacity-50">|</span>
            Full-stack starter with Effect, Temporal, Next.js &amp; Drizzle
            <a
              href="https://github.com/jamesaphoenix/tx-agent-kit"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/30"
            >
              View on GitHub
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </span>
        </Banner>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
