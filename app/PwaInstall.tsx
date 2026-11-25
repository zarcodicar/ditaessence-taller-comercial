'use client';

import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaInstallButton({ full = false }: { full?: boolean }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);

  if (installed) return null;
  const install = async () => {
    if (prompt) { await prompt.prompt(); await prompt.userChoice; setPrompt(null); return; }
    const apple = /iphone|ipad|ipod/i.test(navigator.userAgent);
    window.alert(apple ? 'En iPhone: toca Compartir y luego “Agregar a pantalla de inicio”.' : 'Abre el menú del navegador y elige “Instalar aplicación” o “Agregar a pantalla de inicio”.');
  };

  return <button type="button" className={`pwa-install ${full ? 'is-full' : ''}`} onClick={() => void install()} aria-label="Instalar DTC Stage como aplicación">{full ? <Smartphone /> : <Download />}<span>Instalar app</span></button>;
}
