import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DTC Stage',
  description: 'Punto de venta, inventario, caja y órdenes de servicio para negocios de tecnología.',
  manifest: '/manifest.webmanifest',
  applicationName: 'DTC Stage',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'DTC Stage' },
  icons: { icon: '/dtc-stage.svg', apple: '/dtc-stage.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0B3262' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
