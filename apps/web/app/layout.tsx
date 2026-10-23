import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'SitePulse',
  description: 'Your website operations workspace.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="Main navigation">
          <Link href="/">SitePulse</Link>
          <Link href="/app">Workspace</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
