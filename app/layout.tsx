import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DitaEssence Taller',
  description: 'Punto de venta, inventario, caja y órdenes de servicio para talleres de celulares.',
  manifest: '/manifest.webmanifest',
  applicationName: 'DitaEssence Taller',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'DitaEssence Taller' },
  icons: { icon: '/ditaessence-taller.svg', apple: '/ditaessence-taller.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0B3262' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
