import type { Metadata } from 'next';
import { PublicHeader } from '../components/app-navigation';
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
        <PublicHeader />
        {children}
      </body>
    </html>
  );
}
