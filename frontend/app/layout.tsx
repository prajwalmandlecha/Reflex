import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';

// NOTE: IBM Plex fonts were previously loaded via next/font/google, but that
// fetches from Google Fonts at build time and fails in offline/air-gapped
// build containers (EAI_AGAIN). globals.css already falls back to
// system-ui, sans-serif, so we rely on the system font stack here.

export const metadata: Metadata = {
  title: 'Governance Control Center — Agent Fleet Operations',
  description:
    'Operator control room for governing autonomous financial agents: policies, spend caps, audit, and emergency stop.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
