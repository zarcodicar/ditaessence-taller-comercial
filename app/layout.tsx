import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DitaEssencePos',
  description: 'Punto de venta, inventario, caja y reportes para DitaEssencePos.',
  manifest: '/manifest.webmanifest',
  applicationName: 'DitaEssencePos',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'DitaEssencePos' },
  icons: { icon: '/favicon.svg', apple: '/cellhouse-logo-192.png?v=151a801' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0B3262' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
