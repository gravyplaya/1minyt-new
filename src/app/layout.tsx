import './globals.css';
import type { Metadata } from 'next';
import { Footer } from './_components/Footer';

export const metadata: Metadata = {
  title: '1minyt — Subscriptions',
  description: 'Organize, search, and curate your YouTube subscriptions.',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=5',
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