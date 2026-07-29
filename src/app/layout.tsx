import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '1minyt — Subscriptions',
  description: 'Organize, search, and curate your YouTube subscriptions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}