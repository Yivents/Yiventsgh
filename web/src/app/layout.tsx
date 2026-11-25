import type { Metadata, Viewport } from 'next';
import '@yivents/ui/tokens.css';
import '@yivents/ui/components.css';
import './globals.css';
import { PwaRegister } from '@/components/PwaRegister';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yivents.com'),
  title: { default: 'Yivents — Events, registration and tickets', template: '%s | Yivents' },
  description: 'Registration, payment tracking and tickets for Ghanaian event organizers. Built for MoMo and bank payments.',
  applicationName: 'Yivents',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/brand/logo.png', apple: '/brand/logo.png' },
  openGraph: {
    type: 'website',
    siteName: 'Yivents',
    title: 'Yivents — Events, registration and tickets',
    description: 'Registration, payment tracking and tickets in one place.',
    images: ['/brand/logo.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#104080',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="yv-visually-hidden">
          Skip to content
        </a>
        {children}
        <PwaRegister />
        <div id="yv-toast" aria-live="polite" />
      </body>
    </html>
  );
}
