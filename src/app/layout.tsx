import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Footer } from './_components/Footer';

export const metadata: Metadata = {
  title: '1minyt — Subscriptions',
  description: 'Organize, search, and curate your YouTube subscriptions.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
        <Footer />
      </body>
    </html>
  );
}