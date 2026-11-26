'use client';
import './permissions.css';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Bell, Box, CheckCircle2, ChevronRight, CircleDollarSign, CloudUpload, CreditCard, DatabaseBackup, Download, LockKeyhole, Menu, Minus, PackagePlus, Plus, ReceiptText, Search, Settings, ShieldCheck, ShoppingBag, Smartphone, TrendingUp, Undo2, Upload, UserRound, UsersRound, WifiOff, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InventoryControl } from './InventoryControl';
import { PointOfSale } from './PointOfSale';
import { ReportsDashboard } from './ReportsDashboard';
import { CashManagement } from './CashManagement';
import { SalesHistory } from './SalesHistory';
import { NotificationBell, NotificationsCenter, type PosNotification } from './NotificationsCenter';
import { PwaInstallButton } from './PwaInstall';
import { ServiceOrders } from './ServiceOrders';
import { EmployeePayroll } from './EmployeePayroll';
import { ReturnsAdjustments } from './ReturnsAdjustments';
import { DEFAULT_RECEIPT_SETTINGS, receiptSettings as normalizeReceiptSettings, type ReceiptSettings } from './receipt-settings';

type Product = { id: number; name: string; sku: string; barcode?: string; price: number; cost?: number; stock: number; min: number; category: string; image?: string };
type Permission = 'Punto de venta' | 'Inventario' | 'Caja y movimientos' | 'Ventas' | 'Órdenes de servicio' | 'Devoluciones y ajustes' | 'Reportes' | 'Ver costos y márgenes' | 'Ver indicadores financieros';
type Repair = { id: string; customer: string; phone: string; device: string; problem: string; tech: string; status: 'Recibido' | 'Diagnóstico' | 'En reparación' | 'Listo'; total: number; deposit: number };
type OfflineSale = { clientId: string; shiftId: number; offline: boolean; sale: any };

const currency = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialProducts: Product[] = [];
const initialRepairs: Repair[] = [];
const categoryNames = (_products: Product[], saved: string[] = []) => Array.from(new Set(saved.map(value => String(value || '').trim()).filter(value => value && value !== 'Sin categoría'))).sort((a, b) => a.localeCompare(b, 'es'));
const OFFLINE_SNAPSHOT = 'cellhouse-offline-snapshot-v1';
const OFFLINE_SALES = 'cellhouse-offline-sales-v1';
const scopedStorageKey = (key: string) => {
  if (typeof window === 'undefined') return `${key}:default`;
  const code = new URLSearchParams(window.location.search).get('business')?.trim().toUpperCase() || 'default';
  return `${key}:${code}`;
};

function localValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function saveLocal(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* El navegador puede bloquear el almacenamiento privado. */ }
}

function mergePendingSales(products: Product[], sales: any[], pending: OfflineSale[]) {
  let mergedProducts = products;
  const mergedSales = [...sales];
  for (const entry of pending) {
    if (mergedSales.some(sale => sale.clientId === entry.clientId)) continue;
    const quantities = new Map((entry.sale.items || []).map((item: any) => [String(item.id), Number(item.qty) || 0]));
    mergedProducts = mergedProducts.map(product => quantities.has(String(product.id)) ? { ...product, stock: Math.max(0, product.stock - Number(quantities.get(String(product.id)) || 0)) } : product);
    mergedSales.unshift(entry.sale);
  }
  return { products: mergedProducts, sales: mergedSales };
}

export default function Home() {
  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
  const [account, setAccount] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [section, setSection] = useState('Punto de venta');
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState<string[]>([]);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS);
  const [repairs, setRepairs] = useState(initialRepairs);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cartPrices, setCartPrices] = useState<Record<number, number>>({});
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [accessError, setAccessError] = useState('');
  const [cash, setCash] = useState(0);
  const [cashShift, setCashShift] = useState<any>(null);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [activeRole, setActiveRole] = useState<'owner' | 'worker'>('owner');
  const [workers, setWorkers] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<PosNotification[]>([]);
  const [businessReady, setBusinessReady] = useState(false);
  const [showRepair, setShowRepair] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pendingSales, setPendingSales] = useState<OfflineSale[]>(() => localValue(scopedStorageKey(OFFLINE_SALES), []));
  const syncingSales = useRef(false);
  const savingBusiness = useRef(false);
  const skipBusinessSave = useRef(true);
  const serverUpdatedAt = useRef('');
  const [repairForm, setRepairForm] = useState({ customer: '', phone: '', device: '', problem: '', deposit: '' });
  const nav = [{ label: 'Punto de venta', icon: <ShoppingBag /> }, { label: 'Caja y movimientos', icon: <ReceiptText /> }, { label: 'Ventas', icon: <ReceiptText /> }, { label: 'Inventario', icon: <Box /> }, { label: 'Órdenes de servicio', icon: <Wrench /> }, { label: 'Devoluciones y ajustes', icon: <Undo2 /> }, ...(activeRole === 'owner' ? [{ label: 'Pago de técnicos', icon: <Wrench /> }] : []), { label: 'Reportes', icon: <BarChart3 /> }, ...(activeRole === 'owner' ? [{ label: 'Notificaciones', icon: <Bell /> }] : [])];
  const workerPermissions: Permission[] = ['Punto de venta', 'Inventario', 'Caja y movimientos'];
  const currentWorkerPermissions: Permission[] = account?.permissions || workers[0]?.permissions || workerPermissions;
  // Las devoluciones son parte del cierre seguro de una orden. Los usuarios
  // que ya tienen acceso a Órdenes de servicio deben poder registrarlas sin
  // perder el módulo al actualizar el sistema; las cuentas nuevas pueden
  // recibir además el permiso específico desde Configuración.
  const visibleNav = activeRole === 'owner' ? nav : nav.filter((item) =>
    currentWorkerPermissions.includes(item.label as Permission)
    || (item.label === 'Devoluciones y ajustes' && currentWorkerPermissions.includes('Órdenes de servicio'))
  );
  const selectSection = (label: string) => { setSection(label); setMobileNavOpen(false); };
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  useEffect(() => {
    const cached = localValue<any>(scopedStorageKey(OFFLINE_SNAPSHOT), null);
    const requestedBusinessCode = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('business')?.trim() || '';
    const openSession = isDemo
      ? fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demo-login' }) })
      : Promise.resolve();
    openSession.then(response => {
      if (response && !response.ok) throw new Error('No fue posible abrir la demostración');
      return fetch(`/api/auth${requestedBusinessCode ? `?business=${encodeURIComponent(requestedBusinessCode)}` : ''}`, { cache: 'no-store' });
    }).then(async response => {
      if (!response.ok) throw new Error('Sin conexión');
      return response.json();
    }).then(data => {
      if (!data.user && data.accessStatus === 'suspended') setAccessError('Tu acceso está suspendido. Actualiza tu método de pago o comunícate con DitaEssence para reactivarlo.');
      else if (data.user) setAccessError('');
      setAccount(data.user);
      setWorkers(data.workers || []);
      setNotifications(data.notifications || []);
      setCashShift(data.cashShift || null);
      if (data.businessState) {
        serverUpdatedAt.current = data.businessState.updatedAt || '';
        const loadedProducts = data.businessState.products || [];
        const merged = mergePendingSales(loadedProducts, data.businessState.sales || [], localValue(scopedStorageKey(OFFLINE_SALES), []));
        setProducts(merged.products);
        setSalesHistory(merged.sales);
        setCategories(categoryNames(loadedProducts, data.businessState.categories || []));
        setReceiptSettings(normalizeReceiptSettings(data.businessState.receiptSettings));
      } else { setProducts([]); setSalesHistory([]); setCategories([]); setReceiptSettings(DEFAULT_RECEIPT_SETTINGS); }
      if (data.user?.role === 'worker') setActiveRole('worker');
      setBusinessReady(Boolean(data.user));
      setAuthReady(true);
    }).catch(() => {
      if (cached?.account) {
        const merged = mergePendingSales(cached.products || [], cached.sales || [], localValue(scopedStorageKey(OFFLINE_SALES), []));
        setAccount(cached.account);
        setWorkers(cached.workers || []);
        setNotifications(cached.notifications || []);
        setCashShift(cached.cashShift || null);
        setProducts(merged.products);
        setSalesHistory(merged.sales);
        setCategories(cached.categories || []);
        setReceiptSettings(normalizeReceiptSettings(cached.receiptSettings));
        setActiveRole(cached.account.role === 'worker' ? 'worker' : 'owner');
        setBusinessReady(true);
        setNotice('Modo sin conexión activo. Las ventas quedarán pendientes hasta recuperar internet.');
      }
      setOnline(false);
      setAuthReady(true);
    });
  }, [isDemo]);
  useEffect(() => {
    if (!businessReady || !account) return;
    const offlineProducts = products.map(product => ({ ...product, image: '' }));
    saveLocal(scopedStorageKey(OFFLINE_SNAPSHOT), { account, workers, notifications, cashShift, products: offlineProducts, sales: salesHistory, categories, receiptSettings });
  }, [account, businessReady, cashShift, categories, notifications, products, receiptSettings, salesHistory, workers]);
  useEffect(() => {
    if (!businessReady || !account || !online || pendingSales.length || syncingSales.current) return;
    if (skipBusinessSave.current) { skipBusinessSave.current = false; return; }
    const timer = window.setTimeout(() => {
      savingBusiness.current = true;
      fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-business-state', products, sales: salesHistory, categories, receiptSettings }) }).then(response => {
        if (!response.ok) throw new Error('No fue posible guardar los cambios del negocio.');
        return response.json();
      }).then(data => { serverUpdatedAt.current = data.updatedAt || serverUpdatedAt.current; }).catch(() => setNotice('No fue posible guardar los cambios del negocio. Se intentará nuevamente.')).finally(() => { savingBusiness.current = false; });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [products, salesHistory, categories, receiptSettings, businessReady, account, online, pendingSales.length]);
  useEffect(() => {
    if (!businessReady || !account || !online || !pendingSales.length) return;
    const sync = async () => {
      if (syncingSales.current) return;
      syncingSales.current = true;
      try {
        const queued = localValue<OfflineSale[]>(scopedStorageKey(OFFLINE_SALES), []);
        if (!queued.length) { setPendingSales([]); return; }
        const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync-sales', sales: queued }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No fue posible sincronizar las ventas.');
        const completed = new Set((data.businessState?.synced || []).map((item: any) => item.clientId));
        // A sale may have been queued while this request was in flight. Always
        // remove completed entries from the latest local queue so it cannot be lost.
        const latestQueue = localValue<OfflineSale[]>(scopedStorageKey(OFFLINE_SALES), []);
        const remaining = latestQueue.filter(entry => !completed.has(entry.clientId));
        saveLocal(scopedStorageKey(OFFLINE_SALES), remaining);
        setPendingSales(remaining);
        skipBusinessSave.current = true;
        serverUpdatedAt.current = data.businessState?.updatedAt || serverUpdatedAt.current;
        setProducts(data.businessState?.products || []);
        setSalesHistory(data.businessState?.sales || []);
        setCategories(categoryNames(data.businessState?.products || [], data.businessState?.categories || []));
        setReceiptSettings(normalizeReceiptSettings(data.businessState?.receiptSettings));
        setCashShift(data.cashShift || null);
        setNotice(`${completed.size} venta${completed.size === 1 ? '' : 's'} pendiente${completed.size === 1 ? '' : 's'} sincronizada${completed.size === 1 ? '' : 's'} correctamente.`);
      } catch (error: any) {
        setNotice(error.message || 'Las ventas siguen guardadas y se sincronizarán automáticamente.');
      } finally { syncingSales.current = false; }
    };
    void sync();
    const retry = window.setInterval(() => void sync(), 30000);
    return () => window.clearInterval(retry);
  }, [account, businessReady, online, pendingSales.length]);
  useEffect(() => {
    if (!businessReady || !account || !online) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || syncingSales.current || savingBusiness.current) return;
      try {
        const requestedBusinessCode = new URLSearchParams(window.location.search).get('business')?.trim() || '';
        const response = await fetch(`/api/auth${requestedBusinessCode ? `?business=${encodeURIComponent(requestedBusinessCode)}` : ''}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.user) {
          setAccessError(data.accessStatus === 'suspended'
            ? 'Tu acceso está suspendido. Actualiza tu método de pago o comunícate con DitaEssence para reactivarlo.'
            : 'Tu sesión finalizó. Inicia sesión nuevamente para continuar.');
          setBusinessReady(false);
          setAccount(null);
          setProducts([]);
          setCategories([]);
          setSalesHistory([]);
          setNotifications([]);
          setWorkers([]);
          setCashShift(null);
          setCart({});
          setCartPrices({});
          return;
        }
        const remoteUpdate = data.businessState?.updatedAt || '';
        if (!remoteUpdate || remoteUpdate === serverUpdatedAt.current) return;
        skipBusinessSave.current = true;
        serverUpdatedAt.current = remoteUpdate;
        const loadedProducts = data.businessState.products || [];
        setProducts(loadedProducts);
        setSalesHistory(data.businessState.sales || []);
        setCategories(categoryNames(loadedProducts, data.businessState.categories || []));
        setReceiptSettings(normalizeReceiptSettings(data.businessState.receiptSettings));
        setCashShift(data.cashShift || null);
        setWorkers(data.workers || []);
        setNotifications(data.notifications || []);
      } catch { /* El indicador de conexión y la cola se ocupan de la recuperación. */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(() => void refresh(), 10000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [account, businessReady, online]);
  const cashOpen = Boolean(cashShift);
  const todayLabel = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const lines = products.filter((p) => cart[p.id]);
  const total = useMemo(() => lines.reduce((sum, p) => sum + (cartPrices[p.id] ?? p.price) * cart[p.id], 0), [cart, cartPrices, lines]);
  const setQty = (id: number, qty: number) => {
    const available = products.find(product => product.id === id)?.stock || 0;
    setCart((old) => {
      const next = { ...old };
      if (qty <= 0) delete next[id]; else next[id] = Math.min(qty, available);
      return next;
    });
    if (qty <= 0) setCartPrices(prices => { const updated = { ...prices }; delete updated[id]; return updated; });
  };
  const addSale = async (payment = 'Efectivo', soldItems = lines.map((p) => ({ id: p.id, name: p.name, qty: cart[p.id], price: cartPrices[p.id] ?? p.price, originalPrice: p.price, discount: Math.max(0, p.price - (cartPrices[p.id] ?? p.price)), isGift: (cartPrices[p.id] ?? p.price) === 0, cost: p.cost || 0 })), paymentBreakdown: Record<string, number> = { [payment]: total }) => {
    if (!lines.length) return false;
    if (!cashOpen) { setNotice('La caja está cerrada. Abre caja antes de registrar cualquier venta.'); return false; }
    const saleMoment = new Date();
    const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const lastNumber = salesHistory.reduce((highest, sale) => Math.max(highest, Number(String(sale.number || '').replace(/\D/g, '')) || 0), 0);
    const sale = { clientId, number: `V-${String(lastNumber + 1).padStart(5, '0')}`, createdAt: saleMoment.toISOString(), date: localDateKey(saleMoment), payment, paymentBreakdown, total, items: soldItems };
    const cashReceived = Number(paymentBreakdown.Efectivo || 0);
    const entry: OfflineSale = { clientId, shiftId: Number(cashShift.id), offline: false, sale };
    // When another synchronization is active, append this sale to the durable
    // queue and let the single queue worker preserve server response ordering.
    if (online && pendingSales.length === 0 && !syncingSales.current) {
      try {
        const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync-sales', sales: [entry] }) });
        const data = await response.json();
        if (!response.ok) {
          if (response.status < 500) { setNotice(data.error || 'No fue posible registrar la venta.'); return false; }
          throw new Error(data.error || 'Servidor temporalmente no disponible.');
        }
        setProducts(data.businessState?.products || []);
        skipBusinessSave.current = true;
        serverUpdatedAt.current = data.businessState?.updatedAt || serverUpdatedAt.current;
        setSalesHistory(data.businessState?.sales || []);
        setCategories(categoryNames(data.businessState?.products || [], data.businessState?.categories || []));
        setReceiptSettings(normalizeReceiptSettings(data.businessState?.receiptSettings));
        setCashShift(data.cashShift ?? null);
        if (cashReceived > 0) setCash((value) => value + cashReceived);
        setCart({});
        setCartPrices({});
        setNotice(`Venta registrada por ${currency.format(total)}. Inventario y caja actualizados.`);
        return data.businessState?.sales?.find((item: any) => item.clientId === clientId) || sale;
      } catch { /* Se conserva localmente justo debajo. */ }
    }
    const pendingEntry = { ...entry, offline: true };
    const nextPending = [...localValue<OfflineSale[]>(scopedStorageKey(OFFLINE_SALES), []), pendingEntry];
    saveLocal(scopedStorageKey(OFFLINE_SALES), nextPending);
    setPendingSales(nextPending);
    setProducts((old) => old.map((product) => {
      const item = soldItems.find((line: any) => String(line.id) === String(product.id));
      return item ? { ...product, stock: Math.max(0, product.stock - Number(item.qty || 0)) } : product;
    }));
    setSalesHistory((old) => [sale, ...old]);
    if (cashReceived > 0) {
      setCash((value) => value + cashReceived);
      setCashShift((old: any) => old && old.cash_sales !== undefined ? { ...old, cash_sales: Number(old.cash_sales || 0) + cashReceived } : old);
    }
    setCart({});
    setCartPrices({});
    setNotice(`Venta guardada sin conexión por ${currency.format(total)}. Se sincronizará automáticamente.`);
    return sale;
  };
  const addRepair = () => { if (!repairForm.customer || !repairForm.device || !repairForm.problem) return; setRepairs((old) => [{ id: `R-${1050 + old.length}`, customer: repairForm.customer, phone: repairForm.phone || 'Sin teléfono', device: repairForm.device, problem: repairForm.problem, tech: 'Por asignar', status: 'Recibido', total: 0, deposit: Number(repairForm.deposit) || 0 }, ...old]); setCash((v) => v + (Number(repairForm.deposit) || 0)); setShowRepair(false); setRepairForm({ customer: '', phone: '', device: '', problem: '', deposit: '' }); setNotice('Orden de reparación creada y anticipo registrado.'); };
  const changeRepair = (id: string) => setRepairs((old) => old.map((r) => r.id === id ? { ...r, status: r.status === 'Recibido' ? 'Diagnóstico' : r.status === 'Diagnóstico' ? 'En reparación' : r.status === 'En reparación' ? 'Listo' : 'Listo' } : r));

  if (!authReady) return isDemo ? <main className="auth-shell demo-boot" aria-label="Abriendo demostración" /> : <main className="auth-shell"><div className="auth-card"><img className="auth-brand" src="/dtc-stage.svg" alt="DTC Stage" /><b>DTC Stage</b><p>Preparando acceso seguro…</p></div></main>;
  if (!account) return <Login initialError={accessError} onLogin={(user, activeShift, sessionData) => { const loadedProducts = sessionData?.businessState?.products || []; skipBusinessSave.current = true; serverUpdatedAt.current = sessionData?.businessState?.updatedAt || ''; setAccessError(''); setAccount(user); setActiveRole(user.role === 'worker' ? 'worker' : 'owner'); setCashShift(activeShift || null); setWorkers(sessionData?.workers || []); setNotifications(sessionData?.notifications || []); setProducts(loadedProducts); setSalesHistory(sessionData?.businessState?.sales || []); setCategories(categoryNames(loadedProducts, sessionData?.businessState?.categories || [])); setReceiptSettings(normalizeReceiptSettings(sessionData?.businessState?.receiptSettings)); setBusinessReady(true); }} />;
  const logout = async () => { try { await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); } catch { /* También permite salir sin conexión. */ } window.localStorage.removeItem(scopedStorageKey(OFFLINE_SNAPSHOT)); window.localStorage.removeItem(scopedStorageKey(OFFLINE_SALES)); setBusinessReady(false); setAccount(null); setProducts([]); setCategories([]); setReceiptSettings(DEFAULT_RECEIPT_SETTINGS); setSalesHistory([]); setCart({}); setCartPrices({}); };
  return <main className="app-shell min-h-screen bg-[#f5f7fa] text-slate-950">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-800 bg-[#101827] p-5 text-slate-300 lg:flex lg:flex-col">
      <div className="mb-10 flex items-center gap-3 px-2"><img className="system-logo size-10" src="/dtc-stage.svg" alt="" /><div><p className="font-bold text-white">{receiptSettings.businessName || 'DTC Stage'}</p><p className="text-xs text-slate-400">Servicio técnico y dispositivos</p></div></div>
      <nav className="space-y-1">{visibleNav.map((item) => <button key={item.label} onClick={() => selectSection(item.label)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${section === item.label ? 'bg-lime-400 font-bold text-slate-950' : 'hover:bg-slate-800 hover:text-white'}`}>{item.icon}<span className="flex-1">{item.label}</span></button>)}</nav>
      {activeRole === 'owner' && <button onClick={() => setSection('Configuración')} className={`mt-auto flex items-center gap-3 border-t border-slate-700 px-3 pt-5 text-sm ${section === 'Configuración' ? 'text-lime-300' : ''}`}><Settings />Configuración</button>}
    </aside>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`mobile-nav ${mobileNavOpen ? 'is-open' : ''}`} aria-hidden={!mobileNavOpen}>
      <div className="mobile-nav-brand"><img className="mobile-brand-mark" src="/dtc-stage.svg" alt="" /><div><b>{receiptSettings.businessName || 'DTC Stage'}</b><small>Servicio técnico y dispositivos</small></div><button aria-label="Cerrar menú" onClick={() => setMobileNavOpen(false)}><X /></button></div>
      <nav>{visibleNav.map((item) => <button key={item.label} onClick={() => selectSection(item.label)} className={section === item.label ? 'active' : ''}>{item.icon}<span>{item.label}</span><ChevronRight /></button>)}</nav>
      {activeRole === 'owner' && <button className={`mobile-settings ${section === 'Configuración' ? 'active' : ''}`} onClick={() => selectSection('Configuración')}><Settings /><span>Configuración</span><ChevronRight /></button>}
      <div className="mobile-nav-footer"><PwaInstallButton full /><button onClick={logout}>Cerrar sesión</button></div>
    </aside>
    <section className="app-main lg:pl-64"><header className="app-header flex h-20 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8"><div className="flex min-w-0 gap-3"><Button aria-label="Abrir menú" variant="ghost" size="icon" className="mobile-menu-button lg:hidden" onClick={() => setMobileNavOpen(true)}><Menu /></Button><div className="min-w-0"><p className="header-date text-xs capitalize text-slate-500">{todayLabel}</p><h1 className="truncate text-lg font-bold">{section === 'Vender' ? 'Punto de venta' : section}</h1></div></div><div className="header-actions flex items-center gap-3 text-sm"><span className={`sync-status ${!online ? 'is-offline' : pendingSales.length ? 'is-pending' : 'is-online'}`}>{!online ? <WifiOff /> : <CloudUpload />}<b>{!online ? 'Sin conexión' : pendingSales.length ? 'Sincronizando' : 'En línea'}</b>{pendingSales.length > 0 && <small>{pendingSales.length}</small>}</span><span className={`cash-status ${cashOpen ? 'is-open' : ''}`}>Caja · {cashOpen ? 'Abierta' : 'Cerrada'}</span><PwaInstallButton />{activeRole === 'owner' && <div className="notification-wrap"><NotificationBell notifications={notifications} onOpen={() => selectSection('Notificaciones')} /></div>}<span className="hidden text-slate-400 md:block">{account.name}</span><button onClick={logout} className="desktop-logout rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white">Salir</button><div className="account-avatar grid size-9 place-items-center rounded-full bg-slate-900 font-bold text-slate-100">{account.name.slice(0, 2).toUpperCase()}</div></div></header>
      <div className="app-content mx-auto max-w-[1600px] p-4 sm:p-6 xl:p-8">{notice && <div className="app-notice mb-5 flex items-center justify-between rounded-xl border border-lime-200 bg-lime-50 p-3 text-sm text-lime-800"><span><CheckCircle2 className="mr-2 inline size-4" />{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X className="size-4" /></button></div>}
        {section === 'Punto de venta' && <PointOfSale receiptSettings={receiptSettings} cashOpen={cashOpen} products={products} cart={cart} cartPrices={cartPrices} setCartPrice={(id: number, price: number) => setCartPrices(old => ({ ...old, [id]: Math.max(0, Math.round(price) || 0) }))} total={total} search={search} setSearch={setSearch} add={(id: number) => setQty(id, (cart[id] || 0) + 1)} setQty={setQty} checkout={addSale} onNotice={setNotice} onCashShift={setCashShift} />}
        {section === 'Ventas' && <SalesHistory receiptSettings={receiptSettings} canDelete={online} isWorker={activeRole === 'worker'} onNotify={async (alert: any) => { const created = { id: Date.now(), type: alert.type, severity: alert.severity || 'info', message: alert.text, actor_name: account.name, entity_type: alert.entityType, entity_id: alert.entityId, details: alert.details || {}, createdAt: new Date().toISOString() }; const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notify-owner', ...alert }) }); if (response.ok) setNotifications((old) => [created, ...old]); }} sales={salesHistory} onDelete={async (sale: any) => { if (sale.payment === 'Efectivo' && Number(sale.total) > 0) { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void-cash-sale', amount: sale.total }) }); const result = await response.json(); if (!response.ok) return setNotice(result.error || 'No fue posible ajustar la caja.'); setCashShift(result.shift); } setProducts((old) => old.map((product) => { const item = sale.items.find((line: any) => line.id === product.id); return item ? { ...product, stock: product.stock + item.qty } : product; })); if (sale.payment === 'Efectivo' && Number(sale.total) > 0) setCash((old) => Math.max(0, old - sale.total)); setSalesHistory((old) => old.filter((item) => item.number !== sale.number)); setNotice(`Venta ${sale.number} eliminada y existencias restauradas.`); }} />}
        {section === 'Inventario' && <Inventory products={products} categories={categories} onNotice={setNotice} canManage={online && (activeRole === 'owner' || currentWorkerPermissions.includes('Inventario'))} canDelete={online && activeRole === 'owner'} canEditCategories={online && activeRole === 'owner'} canDeleteCategories={online && activeRole === 'owner'} canSeeCosts={activeRole === 'owner' || currentWorkerPermissions.includes('Inventario') || currentWorkerPermissions.includes('Ver costos y márgenes')} canSeeFinancials={activeRole === 'owner' || currentWorkerPermissions.includes('Ver indicadores financieros')} addCategory={(name: string) => setCategories(old => categoryNames([], [...old, name]))} renameCategory={(oldName: string, newName: string) => { setCategories(old => categoryNames([], old.map(category => category === oldName ? newName : category))); setProducts(old => old.map(product => product.category === oldName ? { ...product, category: newName } : product)); }} removeCategory={(name: string) => { setCategories(old => old.filter(category => category !== name)); setProducts(old => old.map(product => product.category === name ? { ...product, category: 'Sin categoría' } : product)); }} add={(product) => setProducts((old) => [...old, product])} update={(product) => setProducts((old) => old.map((p) => p.id === product.id ? product : p))} remove={(id) => setProducts((old) => old.filter((p) => p.id !== id))} />}
        {section === 'Órdenes de servicio' && <ServiceOrders receiptSettings={receiptSettings} onNotice={setNotice} onCashShift={setCashShift} isOwner={activeRole === 'owner'} />}
        {section === 'Devoluciones y ajustes' && <ReturnsAdjustments receiptSettings={receiptSettings} onNotice={setNotice} onCashShift={setCashShift} onBusinessState={(state: any) => { if (!state) return; skipBusinessSave.current = true; serverUpdatedAt.current = state.updatedAt || serverUpdatedAt.current; setProducts(state.products || []); setSalesHistory(state.sales || []); setCategories(categoryNames(state.products || [], state.categories || [])); setReceiptSettings(normalizeReceiptSettings(state.receiptSettings)); }} />}
        <div className={section === 'Caja y movimientos' ? '' : 'hidden'}><CashManagement shift={cashShift} canSeeFinancials={activeRole === 'owner' || currentWorkerPermissions.includes('Ver indicadores financieros')} canManageCash={activeRole === 'owner'} canRecordMovements={activeRole === 'owner' || currentWorkerPermissions.includes('Caja y movimientos')} onShiftChange={setCashShift} onNotice={setNotice} /></div>
        {section === 'Reportes' && <ReportsDashboard products={products} sales={salesHistory} />}
        {section === 'Pago de técnicos' && activeRole === 'owner' && <EmployeePayroll onNotice={setNotice} onCashShift={setCashShift} receiptSettings={receiptSettings} />}
        {section === 'Notificaciones' && activeRole === 'owner' && <NotificationsCenter notifications={notifications} onMarkRead={async (ids) => { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark-notifications-read', ids }) }); if (!response.ok) return; const markedAt = new Date().toISOString(); setNotifications(old => old.map(item => !ids || ids.includes(item.id) ? { ...item, read_at: markedAt } : item)); }} onDelete={async (id) => { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-notification', id }) }); if (response.ok) setNotifications(old => old.filter(item => item.id !== id)); }} />}
        {section === 'Configuración' && activeRole === 'owner' && <Config4 account={account} setAccount={setAccount} notice={setNotice} workers={workers} setWorkers={setWorkers} receiptSettings={receiptSettings} setReceiptSettings={setReceiptSettings} />}
      </div></section>
    {showRepair && <RepairModal form={repairForm} setForm={setRepairForm} close={() => setShowRepair(false)} save={addRepair} />}
  </main>;
}

function Dashboard({ products, sales, cashOpen, go }: { products: Product[]; sales: any[]; cashOpen: boolean; go: (s: string) => void }) { const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0); const unitsSold = sales.reduce((sum, sale) => sum + sale.items.reduce((items: number, item: any) => items + item.qty, 0), 0); const inventoryValue = products.reduce((sum, product) => sum + (product.cost || 0) * product.stock, 0); const alerts = products.filter((product) => product.stock <= product.min); return <><div className="mb-6"><h2 className="text-2xl font-black">Resumen del día</h2><p className="mt-1 text-sm text-slate-500">Tu operación de DTC Stage en tiempo real.</p></div><div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="Ventas realizadas" value={currency.format(totalSales)} note={`${sales.length} ventas registradas`} icon={<TrendingUp />} /><Metric label="Productos vendidos" value={`${unitsSold} unidades`} note="Acumulado del turno" icon={<ShoppingBag />} /><Metric label="Capital en inventario" value={currency.format(inventoryValue)} note={`${products.length} productos registrados`} icon={<Box />} /><Metric label="Estado de caja" value={cashOpen ? 'Abierta' : 'Cerrada'} note={cashOpen ? 'Lista para registrar ventas' : 'Abre caja antes de cobrar'} icon={<CircleDollarSign />} /></div><div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]"><Panel title="Acciones rápidas"><div className="grid gap-3 sm:grid-cols-2"><Action label="Nueva venta" text="Escanear y cobrar productos" icon={<ShoppingBag />} go={() => go('Punto de venta')} /><Action label="Ver ventas" text="Recibos y detalle de cada venta" icon={<ReceiptText />} go={() => go('Ventas')} /><Action label="Agregar producto" text="Inventario y código de barras" icon={<PackagePlus />} go={() => go('Inventario')} /><Action label={cashOpen ? 'Gestionar caja' : 'Abrir caja'} text={cashOpen ? 'Movimientos y cierre del turno' : 'Registra el fondo inicial'} icon={<CircleDollarSign />} go={() => go('Caja y movimientos')} /></div></Panel><Panel title={alerts.length ? 'Atención requerida' : 'Inventario al día'}>{alerts.length ? <div className="space-y-3">{alerts.map((product) => <div key={product.id} className="flex items-center justify-between rounded-xl bg-amber-50 p-3"><div><p className="font-semibold">{product.name}</p><p className="text-xs text-amber-700">{product.stock === 0 ? 'Producto agotado' : `Stock bajo · mínimo ${product.min}`}</p></div><span className="font-bold text-amber-700">{product.stock} unid.</span></div>)}</div> : <div className="rounded-xl bg-lime-50 p-5 text-center"><CheckCircle2 className="mx-auto size-7 text-lime-600" /><p className="mt-2 font-bold text-lime-900">Todo en orden</p><p className="mt-1 text-sm text-lime-700">No hay productos con stock bajo.</p></div>}</Panel></div></> }
function Sales({ products, cart, total, search, setSearch, add, setQty, checkout }: any) { const list = products.filter((p: Product) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode || p.sku).includes(search)); const scan = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key !== 'Enter') return; const product = products.find((p: Product) => (p.barcode || p.sku) === search.trim()); if (product && product.stock > 0) { add(product.id); setSearch(''); } }; const lines = products.filter((p: Product) => cart[p.id]); return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]"><section><div className="mb-5 flex items-end justify-between"><div><h2 className="text-xl font-bold">Nueva venta</h2><p className="text-sm text-slate-500">Escanea un código de barras para agregar el producto al carrito.</p></div><Button variant="outline"><PackagePlus /> Nuevo producto</Button></div><div className="relative mb-4"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 outline-none focus:ring-2 focus:ring-lime-300" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={scan} placeholder="Escanea o escribe código de barras" /></div><div className="grid gap-3 sm:grid-cols-2">{list.map((p: Product) => <button key={p.id} onClick={() => add(p.id)} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-lime-400"><div className="grid size-11 place-items-center rounded-xl bg-lime-100 text-lime-700"><Smartphone /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.name}</p><p className="text-xs text-slate-500">{p.barcode || p.sku} · {p.stock} disponibles</p><b>{currency.format(p.price)}</b></div><Plus className="text-slate-400" /></button>)}</div></section><aside className="h-fit rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex justify-between border-b p-5"><div><b>Venta actual</b><p className="text-xs text-slate-500">Cliente de mostrador</p></div><button onClick={() => Object.keys(cart).forEach((id) => setQty(Number(id), 0))}><X className="size-5" /></button></div><div className="min-h-56 space-y-4 p-5">{lines.length ? lines.map((p: Product) => <div key={p.id} className="flex gap-3"><div className="grid size-9 place-items-center rounded-lg bg-slate-100"><Smartphone className="size-4" /></div><div className="flex-1"><b className="text-sm">{p.name}</b><p className="text-xs text-slate-500">{currency.format(p.price)}</p><div className="mt-2 flex gap-2"><button className="qty" onClick={() => setQty(p.id, cart[p.id] - 1)}><Minus /></button><span>{cart[p.id]}</span><button className="qty" onClick={() => setQty(p.id, cart[p.id] + 1)}><Plus /></button></div></div><b>{currency.format(p.price * cart[p.id])}</b></div>) : <p className="py-16 text-center text-sm text-slate-400">El carrito está vacío.</p>}</div><div className="border-t p-5"><div className="mb-4 flex justify-between"><span className="text-slate-500">Total</span><b className="text-2xl">{currency.format(total)}</b></div><Button onClick={checkout} disabled={!lines.length} className="h-11 w-full bg-lime-400 font-bold text-slate-950 hover:bg-lime-300"><CreditCard /> Cobrar venta</Button></div></aside></div> }
function Repairs({ repairs, open, advance }: any) { return <><div className="mb-6 flex items-end justify-between"><div><h2 className="text-xl font-bold">Órdenes de reparación</h2><p className="text-sm text-slate-500">Controla el equipo desde el recibo hasta la entrega.</p></div><Button onClick={open} className="bg-lime-400 font-bold text-slate-950 hover:bg-lime-300"><Plus /> Nueva reparación</Button></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><table><thead><tr><th>Orden / cliente</th><th>Equipo y falla</th><th>Técnico</th><th>Estado</th><th>Saldo</th><th></th></tr></thead><tbody>{repairs.map((r: Repair) => <tr key={r.id}><td><b>{r.id}</b><br /><span>{r.customer}<br />{r.phone}</span></td><td><b>{r.device}</b><br /><span>{r.problem}</span></td><td>{r.tech}</td><td><Status value={r.status} /></td><td>{currency.format(Math.max(0, r.total - r.deposit))}</td><td><Button size="sm" variant="outline" onClick={() => advance(r.id)}>{r.status === 'Listo' ? 'Ver orden' : 'Avanzar'}</Button></td></tr>)}</tbody></table></div></> }
function Inventory(props: any) {
  return <InventoryControl {...props} />;
  /* Implementación anterior conservada temporalmente fuera de compilación.
  const [adding, setAdding] = useState(false); const [query, setQuery] = useState(''); const [form, setForm] = useState({ name: '', sku: '', barcode: '', price: '', stock: '', min: '', category: 'Accesorios', image: '' });
  const shown = products.filter((p: Product) => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.includes(query) || (p as any).barcode?.includes(query));
  const save = () => { if (!form.name || !form.price || !form.stock) return; add({ id: Date.now(), name: form.name, sku: form.sku || form.barcode || `SKU-${Date.now().toString().slice(-4)}`, barcode: form.barcode, price: Number(form.price), stock: Number(form.stock), min: Number(form.min) || 0, category: form.category, image: form.image } as any); setAdding(false); setForm({ name: '', sku: '', barcode: '', price: '', stock: '', min: '', category: 'Accesorios', image: '' }); };
  return <><div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Inventario</h2><p className="text-sm text-slate-500">Agrega productos, códigos de barras, imágenes y controla tus existencias.</p></div><Button onClick={() => setAdding(true)} className="bg-lime-400 font-bold text-slate-950 hover:bg-lime-300"><Plus /> Agregar producto</Button></div><div className="relative mb-4"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 outline-none focus:ring-2 focus:ring-lime-300" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, SKU o código de barras" /></div><div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Existencia</th><th>Mínimo</th><th>Ajustar</th><th></th></tr></thead><tbody>{shown.map((p: Product & { barcode?: string }) => <tr key={p.id}><td><div className="flex items-center gap-3">{p.image ? <img src={p.image} alt="" className="size-10 rounded-lg object-cover" /> : <div className="grid size-10 place-items-center rounded-lg bg-lime-100 text-lime-700"><Smartphone className="size-4" /></div>}<div><b>{p.name}</b><br /><span>{currency.format(p.price)}</span></div></div></td><td><b>{p.barcode || p.sku}</b><br /><span>{p.sku}</span></td><td>{p.category}</td><td><b className={p.stock <= p.min ? 'text-amber-600' : ''}>{p.stock} unidades</b></td><td>{p.min}</td><td><div className="flex gap-2"><Button size="icon-sm" variant="outline" onClick={() => adjust(p.id, -1)}><Minus /></Button><Button size="icon-sm" className="bg-lime-400 text-slate-950 hover:bg-lime-300" onClick={() => adjust(p.id, 1)}><Plus /></Button></div></td><td><Button size="sm" variant="destructive" onClick={() => remove(p.id)}>Eliminar</Button></td></tr>)}</tbody></table></div>{adding && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">Agregar producto</h2><p className="text-sm text-slate-500">Los campos con * son obligatorios. La imagen es opcional.</p></div><button onClick={() => setAdding(false)}><X /></button></div><div className="grid gap-4 sm:grid-cols-2"><InvField label="Nombre del producto *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Ej. Cargador rápido 25W" /><InvField label="Código de barras" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} placeholder="Escanea o escribe el código" /><InvField label="SKU interno" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} placeholder="Ej. CG-25W" /><InvField label="Categoría" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="Accesorios" /><InvField label="Precio de venta (COP) *" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="0" type="number" /><InvField label="Existencia inicial *" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} placeholder="0" type="number" /><InvField label="Stock mínimo" value={form.min} onChange={(v) => setForm({ ...form, min: v })} placeholder="0" type="number" /><label className="text-sm font-medium">Imagen (opcional)<input type="file" accept="image/*" className="mt-1 block w-full text-xs" onChange={(e) => { const file = e.target.files?.[0]; if (file) setForm({ ...form, image: URL.createObjectURL(file) }); }} /></label></div>{form.image && <img src={form.image} alt="Vista previa" className="mt-4 size-24 rounded-xl object-cover" />}<div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={() => setAdding(false)}>Cancelar</Button><Button onClick={save} className="bg-lime-400 font-bold text-slate-950 hover:bg-lime-300">Guardar producto</Button></div></div></div>}</> }
  */
}
function Cash({ cash, move }: any) { const [amount, setAmount] = useState(''); return <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]"><Panel title="Caja principal · turno abierto"><p className="text-sm text-slate-500">Efectivo esperado actualmente</p><p className="mt-2 text-4xl font-black">{currency.format(cash)}</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Ventas efectivo</p><b>{currency.format(684000)}</b></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Transferencias</p><b>{currency.format(240000)}</b></div></div></Panel><Panel title="Registrar movimiento"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto en COP" className="mb-3 h-11 w-full rounded-xl border px-3" /><div className="flex gap-3"><Button className="flex-1 bg-lime-400 text-slate-950 hover:bg-lime-300" onClick={() => { move(Number(amount)); setAmount(''); }}>Ingreso</Button><Button className="flex-1" variant="outline" onClick={() => { move(-Number(amount)); setAmount(''); }}>Egreso</Button></div><p className="mt-5 border-t pt-4 text-sm text-slate-500">Movimientos recientes: compra de empaques −$18.000 · fondo de caja +$50.000</p></Panel></div> }
function Reports({ products, repairs }: any) { return <><div className="mb-6"><h2 className="text-xl font-bold">Reportes</h2><p className="text-sm text-slate-500">Resumen operativo de la sucursal para este mes.</p></div><div className="grid gap-4 md:grid-cols-4"><Metric label="Ventas del mes" value="$ 18.640.000" note="+12,4% vs. mes anterior" icon={<TrendingUp />} /><Metric label="Ticket promedio" value="$ 69.800" note="267 ventas" icon={<ReceiptText />} /><Metric label="Utilidad estimada" value="$ 6.770.000" note="36,3% margen" icon={<CircleDollarSign />} /><Metric label="Reparaciones" value={String(repairs.length)} note="83% entregadas a tiempo" icon={<Wrench />} /></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><Panel title="Productos con mayor rotación"><ol className="space-y-3">{products.slice(0, 5).map((p: Product, i: number) => <li key={p.id} className="flex justify-between border-b pb-2"><span>{i + 1}. {p.name}</span><b>{32 - i * 4} unidades</b></li>)}</ol></Panel><Panel title="Rendimiento de reparaciones"><div className="space-y-4"><Progress label="Entregadas a tiempo" value="83%" /><Progress label="Diagnóstico en menos de 24 h" value="76%" /><Progress label="Reparaciones con garantía" value="100%" /></div></Panel></div></> }
function Config({ notice, workers, setWorkers }: any) { const [form, setForm] = useState({ name: '', username: '', password: '', permissions: ['Punto de venta', 'Inventario', 'Caja y movimientos'] as Permission[] }); const sectionPermissions: { value: Permission; label: string; text: string }[] = [{ value: 'Punto de venta', label: 'Punto de venta', text: 'Escanear y cobrar' }, { value: 'Inventario', label: 'Inventario', text: 'Agregar productos' }, { value: 'Caja y movimientos', label: 'Caja y movimientos', text: 'Abrir caja y registrar movimientos' }, { value: 'Ventas', label: 'Ventas', text: 'Consultar comprobantes' }, { value: 'Reportes', label: 'Reportes', text: 'Ver resultados y ganancias' }]; const privatePermissions: { value: Permission; label: string; text: string }[] = [{ value: 'Ver costos y márgenes', label: 'Ver costos y márgenes', text: 'Costo, margen y rentabilidad por producto' }, { value: 'Ver indicadores financieros', label: 'Ver indicadores financieros', text: 'Capital del inventario, efectivo esperado y balances' }]; const toggle = (value: Permission) => setForm((old) => ({ ...old, permissions: old.permissions.includes(value) ? old.permissions.filter((item) => item !== value) : [...old.permissions, value] })); const saveWorker = () => { if (!form.name.trim() || !form.username.trim() || !form.password) { notice('Completa nombre, usuario y contraseña para crear el trabajador.'); return; } if (workers.some((worker: any) => worker.username.toLowerCase() === form.username.trim().toLowerCase())) { notice('Ese usuario ya existe. Elige otro nombre de usuario.'); return; } setWorkers((old: any[]) => [...old, { id: Date.now(), name: form.name.trim(), username: form.username.trim(), permissions: form.permissions }]); setForm({ name: '', username: '', password: '', permissions: ['Punto de venta', 'Inventario', 'Caja y movimientos'] }); notice('Trabajador creado con los permisos seleccionados.'); }; const permissionList = (items: any[]) => <div className="permissions-list">{items.map((permission) => <label key={permission.value}><input type="checkbox" checked={form.permissions.includes(permission.value)} onChange={() => toggle(permission.value)} /><span><b>{permission.label}</b><small>{permission.text}</small></span></label>)}</div>; return <section className="settings-view"><div className="settings-heading"><div><h2>Configuración del propietario</h2><p>Crea cuentas de trabajadores y decide tanto las secciones como la información sensible que puede ver cada una.</p></div><span><ShieldCheck /> Propietario</span></div><div className="settings-grid"><Panel title="Crear trabajador"><div className="settings-form"><Field label="Nombre del trabajador" value={form.name} onChange={(value: string) => setForm({ ...form, name: value })} placeholder="Ej. Valentina Pérez" /><Field label="Usuario" value={form.username} onChange={(value: string) => setForm({ ...form, username: value })} placeholder="Ej. valentina" /><Field label="Contraseña" value={form.password} onChange={(value: string) => setForm({ ...form, password: value })} placeholder="Crea una contraseña" type="password" /><div><b className="settings-label">Secciones permitidas</b><p className="settings-help">Define en qué módulos podrá trabajar.</p>{permissionList(sectionPermissions)}</div><div><b className="settings-label">Información confidencial</b><p className="settings-help">Por seguridad, estas opciones empiezan desactivadas.</p>{permissionList(privatePermissions)}</div><Button onClick={saveWorker} className="settings-save"><UsersRound />Crear trabajador</Button></div></Panel><Panel title="Protección del trabajador"><div className="privacy-card"><LockKeyhole /><div><b>Acceso limitado por defecto</b><p>Puede vender, agregar productos y abrir caja, pero no verá costos, márgenes, capital en inventario ni balances del negocio.</p></div></div><p className="settings-help">El propietario puede habilitar cada dato sensible mediante las casillas de la izquierda cuando realmente lo necesite.</p></Panel></div><Panel title="Usuarios creados"><div className="settings-users"><div className="settings-user owner"><div><b>Propietario</b><small>Cuenta administradora · acceso total</small></div><span>Propietario</span></div>{workers.length ? workers.map((worker: any) => <div className="settings-user" key={worker.id}><div><b>{worker.name}</b><small>@{worker.username} · {worker.permissions.length} permisos asignados</small></div><span>Trabajador</span></div>) : <p className="settings-empty"><LockKeyhole />Aún no hay trabajadores creados. Usa el formulario para agregar el primero.</p>}</div></Panel></section> }
function Login({ onLogin, initialError = '' }: { onLogin: (user: any, cashShift?: any, sessionData?: any) => void; initialError?: string }) {
  const [mode, setMode] = useState<'loading' | 'login' | 'setup'>('loading'); const [setupProtected, setSetupProtected] = useState(false); const [setupToken, setSetupToken] = useState(''); const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(initialError); const [busy, setBusy] = useState(false);
  useEffect(() => { setError(initialError); }, [initialError]);
  useEffect(() => { const businessCode = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('business')?.trim() || ''; fetch(`/api/auth${businessCode ? `?business=${encodeURIComponent(businessCode)}` : ''}`).then(r => r.json()).then(data => { setSetupProtected(Boolean(data.setupProtected)); setMode(data.initialized ? 'login' : 'setup'); if (data.accessStatus === 'suspended') setError('Tu acceso está suspendido. Actualiza tu método de pago o comunícate con DitaEssence para reactivarlo.'); }).catch(() => setError('No fue posible conectar con el acceso seguro.')); }, []);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); try { const businessCode = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('business')?.trim() || ''; const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'setup' ? { action: 'setup', setupToken, name, username, password } : { action: 'login', username, password, businessCode }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); const sessionResponse = await fetch(`/api/auth${businessCode ? `?business=${encodeURIComponent(businessCode)}` : ''}`); const sessionData = sessionResponse.ok ? await sessionResponse.json() : data; onLogin(sessionData.user || data.user, sessionData.cashShift || data.cashShift, sessionData); } catch (reason: any) { setError(reason.message || 'No se pudo iniciar sesión.'); } finally { setBusy(false); } };
  return <main className="auth-shell"><form className="auth-card" onSubmit={submit} autoComplete="off"><img className="auth-brand" src="/dtc-stage.svg" alt="DTC Stage" /><h1>DTC Stage</h1><p>{mode === 'setup' ? 'Activa el negocio y crea la cuenta del propietario. Esta cuenta tendrá acceso total.' : 'Ingresa con tu usuario y contraseña para continuar.'}</p>{mode === 'setup' && <><Field label="Nombre del propietario" value={name} onChange={setName} placeholder="Ej. Diego González" autoComplete="off" />{setupProtected && <NoAutofillField purpose="setup-token" label="Código de activación" value={setupToken} onChange={setSetupToken} placeholder="Código entregado con el sistema" />}</>}{mode === 'loading' ? <p className="auth-loading">Preparando acceso…</p> : <><NoAutofillField purpose="login-user" label="Usuario" value={username} onChange={setUsername} placeholder="Escribe tu usuario" /><NoAutofillField purpose="login-password" label="Contraseña" value={password} onChange={setPassword} placeholder="Escribe tu contraseña" type="password" />{error && <p className="auth-error">{error}</p>}<Button disabled={busy} type="submit" className="auth-submit">{busy ? 'Validando…' : mode === 'setup' ? 'Activar y crear propietario' : 'Iniciar sesión'}</Button><PwaInstallButton full /></>}</form></main>;
}
function Config2({ notice, workers, setWorkers }: any) {
  const [form, setForm] = useState({ name: '', username: '', password: '', permissions: ['Punto de venta', 'Inventario', 'Caja y movimientos'] as Permission[] }); const [saving, setSaving] = useState(false);
  const options: { value: Permission; label: string; text: string }[] = [{ value: 'Punto de venta', label: 'Punto de venta', text: 'Escanear y cobrar' }, { value: 'Inventario', label: 'Inventario', text: 'Consultar productos y existencias' }, { value: 'Caja y movimientos', label: 'Caja y movimientos', text: 'Abrir y cerrar su turno' }, { value: 'Ventas', label: 'Ventas', text: 'Consultar comprobantes' }, { value: 'Órdenes de servicio', label: 'Órdenes de servicio', text: 'Recibir equipos, actualizar estados y registrar pagos' }, { value: 'Devoluciones y ajustes', label: 'Devoluciones y ajustes', text: 'Registrar reintegros de reparaciones y mercancía' }, { value: 'Reportes', label: 'Reportes', text: 'Ver resultados' }, { value: 'Ver costos y márgenes', label: 'Ver costos y márgenes', text: 'Costo y margen por producto' }, { value: 'Ver indicadores financieros', label: 'Ver indicadores financieros', text: 'Capital y balances' }];
  const toggle = (permission: Permission) => setForm(old => ({ ...old, permissions: old.permissions.includes(permission) ? old.permissions.filter(value => value !== permission) : [...old.permissions, permission] }));
  const create = async () => { setSaving(true); try { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create-worker', ...form }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setWorkers((old: any[]) => [...old, data.worker]); setForm({ name: '', username: '', password: '', permissions: ['Punto de venta', 'Inventario', 'Caja y movimientos'] }); notice('Trabajador creado. Ya puede iniciar sesión con sus datos.'); } catch (reason: any) { notice(reason.message || 'No se pudo crear el trabajador.'); } finally { setSaving(false); } };
  return <section className="settings-view"><div className="settings-heading"><div><h2>Configuración del propietario</h2><p>Crea cuentas reales para el equipo y controla tanto las secciones como la información sensible.</p></div><span><ShieldCheck /> Propietario</span></div><div className="settings-grid"><Panel title="Crear trabajador"><div className="settings-form"><Field label="Nombre del trabajador" value={form.name} onChange={name => setForm({ ...form, name })} placeholder="Ej. Valentina Pérez" autoComplete="off" /><NoAutofillField purpose="worker-user" label="Usuario" value={form.username} onChange={username => setForm({ ...form, username })} placeholder="Ej. valentina" /><NoAutofillField purpose="worker-password" label="Contraseña" value={form.password} onChange={password => setForm({ ...form, password })} placeholder="Mínimo 6 caracteres" type="password" /><b className="settings-label">Permisos</b><p className="settings-help">Con acceso a Inventario podrá ver costo y precio, agregar mercancía y categorías, pero nunca borrar productos.</p><div className="permissions-list">{options.map(option => <label key={option.value}><input type="checkbox" checked={form.permissions.includes(option.value)} onChange={() => toggle(option.value)} /><span><b>{option.label}</b><small>{option.text}</small></span></label>)}</div><Button disabled={saving} onClick={create} className="settings-save"><UsersRound />{saving ? 'Creando…' : 'Crear trabajador'}</Button></div></Panel><Panel title="Acceso protegido"><div className="privacy-card"><LockKeyhole /><div><b>Cada persona inicia con su cuenta</b><p>El trabajador solo verá los módulos que selecciones. En Inventario puede consultar costos y precios para recibir mercancía y calcular descuentos, sin permiso para eliminar productos.</p></div></div></Panel></div><Panel title="Usuarios creados"><div className="settings-users"><div className="settings-user owner"><div><b>Propietario</b><small>Cuenta administradora · acceso total</small></div><span>Propietario</span></div>{workers.map((worker: any) => <div className="settings-user" key={worker.id}><div><b>{worker.name}</b><small>@{worker.username} · {worker.permissions.length} permisos</small></div><span>Trabajador</span></div>)}</div></Panel></section>;
}
function Config3({ notice, workers, setWorkers }: any) {
  const [selected, setSelected] = useState<any>(null); const [permissions, setPermissions] = useState<Permission[]>([]); const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [saving, setSaving] = useState(false);
  const options: { value: Permission; label: string; text: string }[] = [{ value: 'Punto de venta', label: 'Punto de venta', text: 'Escanear y cobrar' }, { value: 'Inventario', label: 'Inventario', text: 'Agregar productos' }, { value: 'Caja y movimientos', label: 'Caja y movimientos', text: 'Abrir caja' }, { value: 'Ventas', label: 'Ventas', text: 'Consultar comprobantes' }, { value: 'Reportes', label: 'Reportes', text: 'Ver resultados' }, { value: 'Ver costos y márgenes', label: 'Ver costos y márgenes', text: 'Costo y margen por producto' }, { value: 'Ver indicadores financieros', label: 'Ver indicadores financieros', text: 'Capital y balances' }];
  const edit = (worker: any) => { setSelected(worker); setPermissions(worker.permissions || []); setName(worker.name); setUsername(worker.username); setPassword(''); };
  const toggle = (value: Permission) => setPermissions(old => old.includes(value) ? old.filter(item => item !== value) : [...old, value]);
  const save = async () => { if (!selected) return; setSaving(true); try { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-worker', workerId: selected.id, name, username, password, permissions }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setWorkers((old: any[]) => old.map(worker => worker.id === selected.id ? { ...worker, name, username, permissions } : worker)); setSelected(null); notice(`Datos y permisos de ${name} guardados.`); } catch (reason: any) { notice(reason.message || 'No se pudieron guardar los cambios.'); } finally { setSaving(false); } };
  const remove = async () => { if (!selected || !confirm(`¿Eliminar a ${selected.name}? Esta acción no se puede deshacer.`)) return; const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-worker', workerId: selected.id }) }); const data = await response.json(); if (!response.ok) return notice(data.error || 'No se pudo eliminar el trabajador.'); setWorkers((old: any[]) => old.filter(worker => worker.id !== selected.id)); notice(`Trabajador ${selected.name} eliminado.`); setSelected(null); };
  return <section className="settings-view"><div className="settings-heading"><div><h2>Configuración del propietario</h2><p>Selecciona un trabajador para revisar y guardar sus permisos reales.</p></div><span><ShieldCheck /> Propietario</span></div><div className="settings-grid"><Panel title="Trabajadores"><div className="settings-users">{workers.length ? workers.map((worker: any) => <div className="settings-user" key={worker.id}><div><b>{worker.name}</b><small>@{worker.username} · {worker.permissions.length} permisos</small></div><Button size="sm" className="settings-secondary" onClick={() => edit(worker)}>Editar permisos</Button></div>) : <p className="settings-empty"><LockKeyhole />No hay trabajadores. Crea el primero abajo.</p>}</div></Panel><Panel title={selected ? `Permisos de ${selected.name}` : 'Acceso protegido'}>{selected ? <><p className="settings-help">Estos cambios se guardan para el inicio de sesión de este trabajador.</p><div className="permissions-list">{options.map(option => <label key={option.value}><input type="checkbox" checked={permissions.includes(option.value)} onChange={() => toggle(option.value)} /><span><b>{option.label}</b><small>{option.text}</small></span></label>)}</div><div className="mt-4 flex gap-2"><Button className="settings-secondary" onClick={() => setSelected(null)}>Cancelar</Button><Button disabled={saving} onClick={save} className="settings-save !mt-0">{saving ? 'Guardando…' : 'Guardar permisos'}</Button></div></> : <div className="privacy-card"><LockKeyhole /><div><b>Permisos persistentes</b><p>Las casillas de cada trabajador se guardan y se aplican en su siguiente inicio de sesión.</p></div></div>}</Panel></div><Panel title="Crear trabajador"><Config2 notice={notice} workers={workers} setWorkers={setWorkers} /></Panel></section>;
}
function OwnerAccount({ account, setAccount, notice }: any) {
  const [form, setForm] = useState({ name: account.name || '', username: account.username || '', currentPassword: '', newPassword: '' }); const [saving, setSaving] = useState(false);
  const save = async () => { if (!form.name.trim() || !form.username.trim() || !form.currentPassword) return notice('Completa nombre, usuario y contraseña actual.'); setSaving(true); try { const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update-owner', ...form }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setAccount((old: any) => ({ ...old, ...data.user })); setForm(old => ({ ...old, currentPassword: '', newPassword: '' })); notice('Tu información se actualizó correctamente.'); } catch (error: any) { notice(error.message || 'No se pudo actualizar tu cuenta.'); } finally { setSaving(false); } };
  return <><EmployeesPanel notice={notice}/><Panel title="Mi cuenta"><div className="settings-form owner-account-form"><div className="owner-account-grid"><Field label="Nombre" value={form.name} onChange={name => setForm({ ...form, name })} placeholder="Tu nombre" autoComplete="off" /><Field label="Usuario" value={form.username} onChange={username => setForm({ ...form, username })} placeholder="Tu usuario" autoComplete="off" /><NoAutofillField purpose="owner-current-password" label="Contraseña actual" value={form.currentPassword} onChange={currentPassword => setForm({ ...form, currentPassword })} placeholder="Escríbela para confirmar" type="password" /><NoAutofillField purpose="owner-new-password" label="Nueva contraseña" value={form.newPassword} onChange={newPassword => setForm({ ...form, newPassword })} placeholder="Déjala vacía para conservarla" type="password" /></div><p className="settings-help">La contraseña actual debe escribirse manualmente para guardar cualquier cambio.</p><Button disabled={saving} className="settings-save" onClick={save}><ShieldCheck />{saving ? 'Guardando…' : 'Guardar mi información'}</Button></div></Panel></>;
}
function DataBackup({ notice }: { notice: (message: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth?resource=backup', { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'No se pudo crear el respaldo.');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || `ditaessencepos-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
      notice('Respaldo completo descargado. Guárdalo en un lugar seguro.');
    } catch (error: any) { notice(error.message || 'No se pudo descargar el respaldo.'); } finally { setBusy(false); }
  };
  const choose = async (file?: File) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return notice('El respaldo supera el límite de 25 MB.');
    try { const parsed = JSON.parse(await file.text()); if (parsed?.format !== 'cellhouse-pos-backup' || ![1, 2, 3, 4, 5, 6].includes(Number(parsed?.version))) throw new Error(); setBackup(parsed); setFileName(file.name); } catch { setBackup(null); setFileName(''); notice('El archivo seleccionado no es un respaldo válido de DTC Stage.'); }
  };
  const restore = async () => {
    if (!backup || !password) return notice('Selecciona el respaldo y escribe tu contraseña actual.');
    if (!confirm(`¿Restaurar ${fileName}? Los datos actuales serán reemplazados por los del respaldo.`)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore-backup', backup, currentPassword: password }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      notice('Respaldo restaurado. Volverás al inicio de sesión.'); window.setTimeout(() => window.location.reload(), 900);
    } catch (error: any) { notice(error.message || 'No se pudo restaurar el respaldo.'); } finally { setBusy(false); }
  };
  return <Panel title="Respaldo y recuperación"><div className="backup-panel"><div className="backup-summary"><DatabaseBackup/><div><b>Protege la información del negocio</b><p>Descarga productos, ventas, usuarios, caja, movimientos y notificaciones en un solo archivo.</p></div></div><Button disabled={busy} className="backup-download" onClick={download}><Download/>{busy ? 'Procesando…' : 'Descargar respaldo completo'}</Button><div className="backup-restore"><div><b>Restaurar un respaldo</b><p>Esta operación reemplaza la información actual y siempre requiere confirmación y contraseña del propietario.</p></div><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => void choose(event.target.files?.[0])}/><Button className="settings-secondary" onClick={() => fileInput.current?.click()}><Upload/>{fileName || 'Seleccionar archivo'}</Button><NoAutofillField purpose="restore-password" label="Contraseña actual" value={password} onChange={setPassword} placeholder="Confirma tu identidad" type="password"/><Button disabled={busy || !backup || !password} variant="destructive" onClick={restore}>Restaurar información</Button></div></div></Panel>;
}
function ReceiptSettingsPanel({ value, onSave, notice }: { value: ReceiptSettings; onSave: (value: ReceiptSettings) => void; notice: (message: string) => void }) {
  const [form, setForm] = useState<ReceiptSettings>(() => normalizeReceiptSettings(value));
  useEffect(() => setForm(normalizeReceiptSettings(value)), [value]);
  const save = () => {
    const next = normalizeReceiptSettings(form);
    onSave(next);
    notice('Datos del recibo guardados. Las próximas impresiones y reimpresiones usarán esta información.');
  };
  return <Panel title="Datos adicionales para recibos"><div className="receipt-settings-intro"><ReceiptText/><div><b>Personaliza la factura del local</b><p>Estos datos aparecen en todos los comprobantes de venta. Solo el propietario puede modificarlos.</p></div></div><div className="receipt-settings-grid"><Field label="Nombre que aparece en la factura" value={form.businessName} onChange={businessName => setForm({...form,businessName})} placeholder="Ej. Nombre de tu tienda"/><Field label="Teléfono" value={form.phone} onChange={phone => setForm({...form,phone})} placeholder="Ej. 315 780 1078"/><Field label="Dirección" value={form.address} onChange={address => setForm({...form,address})} placeholder="Ej. Carrera 13 # 72-71"/><Field label="Mensaje de agradecimiento" value={form.thankYou} onChange={thankYou => setForm({...form,thankYou})} placeholder="Gracias por su compra"/></div><label className="receipt-settings-message">Mensaje de garantía<textarea value={form.warranty} onChange={event=>setForm({...form,warranty:event.target.value})} rows={5}/></label><div className="receipt-settings-preview"><small>Vista previa del encabezado</small><b>{form.businessName || DEFAULT_RECEIPT_SETTINGS.businessName}</b>{form.address && <span>{form.address}</span>}{form.phone && <span>Tel. {form.phone}</span>}</div><Button className="settings-save" onClick={save}><ReceiptText/>Guardar datos del recibo</Button></Panel>;
}

function Config4({ account, setAccount, notice, workers, setWorkers, receiptSettings, setReceiptSettings }: any) {
  const [worker, setWorker] = useState<any>(null); const [form, setForm] = useState({ name:'', username:'', password:'', permissions: [] as Permission[] }); const [saving, setSaving] = useState(false);
  const rights: Permission[] = ['Punto de venta','Inventario','Caja y movimientos','Ventas','Órdenes de servicio','Devoluciones y ajustes','Reportes','Ver costos y márgenes','Ver indicadores financieros']; const select = (item:any) => { setWorker(item); setForm({ name:item.name, username:item.username, password:'', permissions:item.permissions || [] }); }; const toggle=(right:Permission)=>setForm(old=>({...old,permissions:old.permissions.includes(right)?old.permissions.filter(x=>x!==right):[...old.permissions,right]}));
  const save=async()=>{if(!worker)return;setSaving(true);try{const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update-worker',workerId:worker.id,...form})});const data=await response.json();if(!response.ok)throw new Error(data.error);setWorkers((old:any[])=>old.map(item=>item.id===worker.id?{...item,name:form.name,username:form.username,permissions:form.permissions}:item));notice('Datos y permisos guardados.');setWorker(null)}catch(error:any){notice(error.message)}finally{setSaving(false)}};
  const remove=async()=>{if(!worker||!confirm(`¿Eliminar a ${worker.name}?`))return;const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete-worker',workerId:worker.id})});const data=await response.json();if(!response.ok)return notice(data.error);setWorkers((old:any[])=>old.filter(item=>item.id!==worker.id));notice('Trabajador eliminado.');setWorker(null)};
  return <section className="settings-view"><div className="settings-heading"><div><h2>Usuarios y permisos</h2><p>Administra tu cuenta, los datos de los recibos, los accesos del equipo y los respaldos del negocio.</p></div><span><ShieldCheck/>Propietario</span></div><OwnerAccount account={account} setAccount={setAccount} notice={notice}/><ReceiptSettingsPanel value={receiptSettings} onSave={setReceiptSettings} notice={notice}/><DataBackup notice={notice}/><div className="settings-grid"><Panel title="Trabajadores"><div className="settings-users">{workers.map((item:any)=><div className="settings-user" key={item.id}><div><b>{item.name}</b><small>@{item.username}</small></div><Button className="settings-secondary" size="sm" onClick={()=>select(item)}>Editar</Button></div>)}</div></Panel><Panel title={worker?`Editar: ${worker.name}`:'Selecciona un trabajador'}>{worker?<div className="settings-form"><Field label="Nombre" value={form.name} onChange={name=>setForm({...form,name})}/><Field label="Usuario" value={form.username} onChange={username=>setForm({...form,username})}/><NoAutofillField purpose="edit-worker-password" label="Nueva contraseña" value={form.password} onChange={password=>setForm({...form,password})} placeholder="Déjala vacía para conservarla" type="password"/><div className="permissions-list">{rights.map(right=><label key={right}><input type="checkbox" checked={form.permissions.includes(right)} onChange={()=>toggle(right)}/><span><b>{right}</b></span></label>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button className="settings-secondary" onClick={()=>setWorker(null)}>Cancelar</Button><Button variant="destructive" onClick={remove}>Eliminar trabajador</Button><Button disabled={saving} className="settings-save !mt-0" onClick={save}>{saving?'Guardando…':'Guardar cambios'}</Button></div></div>:<div className="privacy-card"><LockKeyhole/><div><b>Elige una cuenta</b><p>Podrás modificar su nombre, usuario, contraseña y permisos.</p></div></div>}</Panel></div><Panel title="Crear trabajador"><Config2 notice={notice} workers={workers} setWorkers={setWorkers}/></Panel></section>;
}
function RepairModal({ form, setForm, close, save }: any) { const field = (key: string, label: string, placeholder: string) => <label className="block text-sm font-medium">{label}<input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>; return <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">Nueva reparación</h2><p className="text-sm text-slate-500">Recibe el equipo y registra el anticipo.</p></div><button onClick={close}><X /></button></div><div className="grid gap-3 sm:grid-cols-2">{field('customer', 'Cliente *', 'Nombre completo')}{field('phone', 'Teléfono', '300 000 0000')}{field('device', 'Equipo *', 'Marca y modelo')}{field('deposit', 'Anticipo', '0')}</div><label className="mt-3 block text-sm font-medium">Falla reportada *<textarea value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-3 font-normal" placeholder="Detalle de la falla, accesorios entregados y estado físico" /></label><div className="mt-5 flex justify-end gap-3"><Button variant="outline" onClick={close}>Cancelar</Button><Button onClick={save} className="bg-lime-400 font-bold text-slate-950 hover:bg-lime-300">Crear orden</Button></div></div></div> }
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-base font-bold">{title}</h2>{children}</section> }
function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) { return <section className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid size-10 place-items-center rounded-xl bg-lime-100 text-lime-700">{icon}</div><div><p className="text-sm text-slate-500">{label}</p><b className="text-xl">{value}</b><p className="text-xs text-slate-400">{note}</p></div></section> }
function Action({ label, text, icon, go }: any) { return <button onClick={go} className="flex items-center gap-3 rounded-xl border p-4 text-left hover:border-lime-400"><div className="text-lime-700">{icon}</div><div><b>{label}</b><p className="text-xs text-slate-500">{text}</p></div><ChevronRight className="ml-auto size-4" /></button> }
function Status({ value }: { value: string }) { const map: any = { 'Recibido': 'bg-slate-100 text-slate-700', 'Diagnóstico': 'bg-sky-100 text-sky-700', 'En reparación': 'bg-amber-100 text-amber-700', 'Listo': 'bg-lime-100 text-lime-700' }; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[value]}`}>{value}</span> }
function Progress({ label, value }: { label: string; value: string }) { return <div><div className="mb-1 flex justify-between text-sm"><span>{label}</span><b>{value}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-lime-400" style={{ width: value }} /></div></div> }
function Field({ label, value, onChange, placeholder, type = 'text', autoComplete }: { label: string; value: string; onChange?: (value: string) => void; placeholder?: string; type?: string; autoComplete?: string }) { return <label className="mb-3 block text-sm font-medium">{label}<input type={type} value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label> }
function NoAutofillField({ purpose, label, value, onChange, placeholder, type = 'text' }: { purpose: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { const [ready, setReady] = useState(false); const activate = () => { if (!ready) { setReady(true); onChange(''); } }; return <label className="mb-3 block text-sm font-medium">{label}<input name={`manual-${purpose}`} type={type} value={value} readOnly={!ready} onPointerDown={activate} onFocus={activate} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" data-1p-ignore="true" data-lpignore="true" data-form-type="other" className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label> }
function InvField({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string }) { return <label className="text-sm font-medium">{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label> }
function EmployeesPanel({ notice }: { notice: (message: string) => void }) { const [employees,setEmployees]=useState<any[]>([]),[form,setForm]=useState<any>({name:'',phone:'',document:'',position:'',isTechnician:false}),[editing,setEditing]=useState<any>(null),[saving,setSaving]=useState(false); const load=()=>fetch('/api/auth?resource=employees',{cache:'no-store'}).then(r=>r.json()).then(d=>setEmployees(d.employees||[])).catch(()=>{}); useEffect(()=>{void load()},[]); const save=async()=>{if(!form.name.trim())return notice('Escribe el nombre del trabajador.');setSaving(true);try{const action=editing?'update-employee':'create-employee';const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,employeeId:editing?.id,...form})});const d=await r.json();if(!r.ok)throw new Error(d.error);notice(editing?'Trabajador actualizado.':'Trabajador agregado.');setForm({name:'',phone:'',document:'',position:'',isTechnician:false});setEditing(null);await load()}catch(e:any){notice(e.message)}finally{setSaving(false)}}; const remove=async(item:any)=>{if(!confirm(`¿Eliminar a ${item.name}?`))return;const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete-employee',employeeId:item.id})});if(r.ok){notice('Trabajador eliminado.');void load()}}; return <Panel title="Trabajadores del negocio"><p className="settings-help">Estos datos son independientes de los usuarios de acceso. Los trabajadores marcados como técnicos aparecerán en Órdenes de servicio.</p><div className="settings-form"><div className="owner-account-grid"><Field label="Nombre completo" value={form.name} onChange={name=>setForm({...form,name})} placeholder="Ej. Carlos Pérez"/><Field label="Teléfono" value={form.phone} onChange={phone=>setForm({...form,phone})} placeholder="315 000 0000"/><Field label="Documento" value={form.document} onChange={document=>setForm({...form,document})} placeholder="Opcional"/><label className="text-sm font-medium">Cargo o función<select value={form.position} onChange={e=>setForm({...form,position:e.target.value})} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">Selecciona un cargo</option><option>Técnico</option><option>Domiciliario</option><option>Caja</option><option>Vendedor</option><option>Administrador</option><option>Varios</option></select></label></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isTechnician} onChange={e=>setForm({...form,isTechnician:e.target.checked})}/><span>Puede realizar reparaciones</span></label><div className="flex gap-2"><Button disabled={saving} onClick={save}>{editing?'Guardar cambios':'Agregar trabajador'}</Button>{editing&&<Button variant="outline" onClick={()=>{setEditing(null);setForm({name:'',phone:'',document:'',position:'',isTechnician:false})}}>Cancelar</Button>}</div></div><div className="settings-users">{employees.map(item=><div className="settings-user" key={item.id}><div><b>{item.name}</b><small>{item.position||'Sin cargo'} · {item.phone||'Sin teléfono'} {item.is_technician?'· Técnico':''}</small></div><div className="flex gap-2"><Button size="sm" className="settings-secondary" onClick={()=>{setEditing(item);setForm({name:item.name,phone:item.phone||'',document:item.document||'',position:item.position||'',isTechnician:Boolean(item.is_technician)})}}>Editar</Button><Button size="sm" variant="destructive" onClick={()=>void remove(item)}>Eliminar</Button></div></div>)}</div></Panel>; }
