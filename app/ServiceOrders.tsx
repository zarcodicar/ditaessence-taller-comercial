'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  LogOut,
  Plus,
  Printer,
  Wrench,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReceptionPhotos, SavedServicePhotos } from './ServicePhotos';
import type { ReceiptSettings } from './receipt-settings';

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const moneyInput = (value: string | number) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `$ ${Number(digits).toLocaleString('es-CO')}` : '';
};
export const SERVICE_STATUSES = [
  'Recibido',
  'Esperando respuesta del cliente',
  'Reparado / listo para entregar',
  'Entregado',
  'Sin reparación',
];
const CLOSED_STATUSES = ['Entregado', 'Cancelado', 'Sin reparación'];
const HISTORY_STATUSES = [...CLOSED_STATUSES, 'Reparado / listo para entregar'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const offsetISO = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const emptyForm = {
  customerName: '',
  customerPhone: '',
  customerDocument: '',
  deviceType: 'Celular',
  deviceBrand: '',
  deviceModel: '',
  deviceIdentifier: '',
  devicePassword: '',
  accessories: '',
  physicalCondition: '',
  reportedIssue: '',
  plannedService: '',
  notes: '',
  estimatedTotal: '',
  partsCost: '',
  finalTotal: '',
};
const ORDERS_CACHE = 'cellhouse-service-orders-v1',
  ORDERS_QUEUE = 'cellhouse-service-orders-queue-v1';
const local = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
};
const saveLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

async function api(body: any) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new Error(data.error || 'No fue posible completar la operación.');
  return data;
}

export function ServiceOrders({
  receiptSettings,
  onNotice,
  onCashShift,
  isOwner,
}: {
  receiptSettings: ReceiptSettings;
  onNotice: (text: string) => void;
  onCashShift: (shift: any) => void;
  isOwner: boolean;
}) {
  const [orders, setOrders] = useState<any[]>(() =>
      typeof window === 'undefined' ? [] : local(ORDERS_CACHE, []),
    ),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [date, setDate] = useState(''),
    [listMode, setListMode] = useState<'all' | 'workshop' | 'ready' | 'history' | 'agenda'>(
      'all',
    ),
    [agendaDate, setAgendaDate] = useState(todayISO),
    [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [form, setForm] = useState<any>(emptyForm),
    [formError, setFormError] = useState(''),
    [busy, setBusy] = useState(false),
    [paymentModal, setPaymentModal] = useState(false),
    [statusModal, setStatusModal] = useState(''),
    [processModal, setProcessModal] = useState(false),
    [managementLookupOpen, setManagementLookupOpen] = useState(false),
    [autoPrintOrderId, setAutoPrintOrderId] = useState<number | null>(null);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [todayCommission, setTodayCommission] = useState<any>({
    total: 0,
    pending: 0,
    paid: 0,
    orders_count: 0,
  });
  const load = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        resource: 'service-orders',
        search,
        status,
      });
      const response = await fetch(`/api/auth?${q}`, { cache: 'no-store' });
      const data: any = await response.json();
      if (!response.ok) throw new Error(data.error);
      setOrders(data.orders || []);
      saveLocal(ORDERS_CACHE, data.orders || []);
      if (selected)
        setSelected(
          (data.orders || []).find((item: any) => item.id === selected.id) ||
            null,
        );
      return data.orders || [];
    } catch (error: any) {
      if (!orders.length)
        onNotice(
          error.message ||
            'Sin conexión: no hay órdenes guardadas en este equipo.',
        );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [search, status, date]);
  useEffect(() => {
    if (!date) return;
    fetch(
      `/api/auth?resource=service-orders&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&from=${date}&to=${date}`,
      { cache: 'no-store' },
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.orders)) setOrders(data.orders);
      })
      .catch(() => {});
  }, [date]);
  useEffect(() => {
    fetch('/api/auth?resource=service-technicians', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setTechnicians(data.technicians || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetch('/api/auth?resource=my-service-commission', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => data.summary && setTodayCommission(data.summary))
      .catch(() => {});
  }, [orders]);
  const create = async () => {
    if (!String(form.customerDocument || '').trim()) {
      setFormError('Escribe el documento o cédula del cliente para poder crear la orden.');
      return;
    }
    setFormError('');
    setBusy(true);
    const clientId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const payload = { action: 'create-service-order', clientId, ...form };
    try {
      const data = await api(payload);
      if ('cashShift' in data) onCashShift(data.cashShift);
      onNotice(
        `Orden ${data.order.order_number} creada correctamente. Preparando las dos copias…`,
      );
      setCreating(false);
      setForm(emptyForm);
      const refreshed = await load();
      const createdOrder =
        refreshed?.find((o: any) => Number(o.id) === Number(data.order.id)) ||
        null;
      setSelected(createdOrder);
      if (createdOrder) setAutoPrintOrderId(Number(createdOrder.id));
    } catch (error: any) {
      if (!navigator.onLine || String(error.message).includes('fetch')) {
        const queued = [...local<any[]>(ORDERS_QUEUE, []), payload];
        saveLocal(ORDERS_QUEUE, queued);
        const temporary = {
          id: -Date.now(),
          order_number: `PEND-${queued.length}`,
          customer_name: form.customerName,
          customer_phone: form.customerPhone,
          device_brand: form.deviceBrand,
          device_model: form.deviceModel,
          reported_issue: form.reportedIssue,
          status: 'Pendiente de sincronizar',
          device_type: form.deviceType,
          paid_total: 0,
          estimated_total: Number(form.estimatedTotal || 0),
          created_at: new Date().toISOString(),
          events: [],
          payments: [],
        };
        const next = [temporary, ...orders];
        setOrders(next);
        saveLocal(ORDERS_CACHE, next);
        setCreating(false);
        setForm(emptyForm);
        onNotice(
          'Orden guardada sin conexión. Se sincronizará al recuperar internet.',
        );
      } else onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!selected || autoPrintOrderId !== Number(selected.id)) return;
    const timer = window.setTimeout(() => {
      setAutoPrintOrderId(null);
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [selected, autoPrintOrderId]);
  useEffect(() => {
    const sync = async () => {
      const queued = local<any[]>(ORDERS_QUEUE, []);
      if (!navigator.onLine || !queued.length) return;
      try {
        for (const item of queued) await api(item);
        saveLocal(ORDERS_QUEUE, []);
        onNotice(
          `${queued.length} orden${queued.length === 1 ? '' : 'es'} de servicio sincronizada${queued.length === 1 ? '' : 's'}.`,
        );
        await load();
      } catch {}
    };
    window.addEventListener('online', sync);
    void sync();
    return () => window.removeEventListener('online', sync);
  }, []);
  const updateStatus = async (next: string, note = '', delivery: any = {}) => {
    if (!selected || next === selected.status) return;
    const selectedId = Number(selected.id);
    const needsReason = ['Cancelado', 'Sin reparación'].includes(next);
    if (needsReason && !note.trim())
      return onNotice(
        'El motivo es obligatorio para cancelar o dejar una orden sin reparación.',
      );
    setBusy(true);
    try {
      const result = await api({
        action: 'update-service-status',
        orderId: selected.id,
        status: next,
        note,
        ...delivery,
      });
      if (result.cashShift) onCashShift(result.cashShift);
      setStatusModal('');
      const refreshed = await load();
      if (next === 'Entregado') {
        const deliveredOrder = refreshed.find(
          (order: any) => Number(order.id) === selectedId,
        );
        setSelected(deliveredOrder || null);
        if (deliveredOrder) setAutoPrintOrderId(selectedId);
        onNotice(
          'Entrega registrada. Preparando las dos copias del recibo de entrega…',
        );
      } else {
        setSelected(null);
        onNotice(`Estado actualizado a ${next}.`);
      }
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const processOrder = async (values: any) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api({
        action: 'process-service-order',
        orderId: selected.id,
        ...values,
      });
      onNotice('Proceso técnico guardado en la orden.');
      setProcessModal(false);
      await load();
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const addPayment = async (
    amount: number,
    paymentMethod: string,
    printReceipt = true,
  ) => {
    if (!selected || amount <= 0)
      return onNotice('Ingresa un valor de pago válido.');
    const selectedId = Number(selected.id);
    const kind = selected.status === 'Entregado' ? 'Saldo' : 'Anticipo';
    setBusy(true);
    try {
      const data = await api({
        action: 'add-service-payment',
        orderId: selected.id,
        amount,
        paymentMethod,
        kind,
      });
      onCashShift(data.cashShift);
      setPaymentModal(false);
      const refreshed = await load();
      const updatedOrder = refreshed.find(
        (order: any) => Number(order.id) === selectedId,
      );
      setSelected(updatedOrder || null);
      if (printReceipt && updatedOrder) {
        setAutoPrintOrderId(selectedId);
        onNotice(
          `Abono registrado en ${selected.order_number}. Preparando las dos copias del recibo actualizado…`,
        );
      } else onNotice(`${kind} registrado en ${selected.order_number}.`);
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const openCreate = () => {
    setFormError('');
    setCreating(true);
  };
  const openManagementLookup = () => {
    setManagementLookupOpen(true);
  };
  const counts = useMemo(
    () => ({
      workshop: orders.filter(
        (order) =>
          !CLOSED_STATUSES.includes(order.status) &&
          order.status !== 'Reparado / listo para entregar',
      ).length,
      ready: orders.filter(
        (order) => order.status === 'Reparado / listo para entregar',
      ).length,
    }),
    [orders],
  );
  const workshopOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          !CLOSED_STATUSES.includes(order.status) &&
          order.status !== 'Reparado / listo para entregar',
      ),
    [orders],
  );
  const historyOrders = useMemo(
    () => orders.filter((order) => HISTORY_STATUSES.includes(order.status)),
    [orders],
  );
  const readyOrders = useMemo(
    () =>
      orders.filter(
        (order) => order.status === 'Reparado / listo para entregar',
      ),
    [orders],
  );
  const allOrders = useMemo(() => orders, [orders]);
  const agendaOrders = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            order.estimated_delivery_at &&
            !CLOSED_STATUSES.includes(order.status) &&
            String(order.estimated_delivery_at).slice(0, 10) === agendaDate,
        )
        .sort((a, b) =>
          String(a.estimated_delivery_at).localeCompare(
            String(b.estimated_delivery_at),
          ),
        ),
    [orders, agendaDate],
  );
  const visibleOrders =
    listMode === 'history'
      ? historyOrders
      : listMode === 'ready'
        ? readyOrders
        : listMode === 'agenda'
          ? agendaOrders
          : listMode === 'all'
            ? allOrders
            : workshopOrders;
  const normalizedSearch = search.trim().toLocaleLowerCase('es-CO');
  const filteredOrders = useMemo(
    () =>
      visibleOrders.filter((order) => {
        const matchesSearch =
          !normalizedSearch ||
          [
            order.order_number,
            order.customer_name,
            order.customer_phone,
            order.customer_document,
            order.device_brand,
            order.device_model,
            order.device_identifier,
          ].some((value) =>
            String(value || '')
              .toLocaleLowerCase('es-CO')
              .includes(normalizedSearch),
          );
        const matchesStatus = !status || order.status === status;
        const orderDate = String(
          listMode === 'agenda'
            ? order.estimated_delivery_at
            : listMode === 'ready'
            ? order.repair_completed_at || order.updated_at || order.created_at
            : listMode === 'history'
              ? order.delivered_at ||
                order.repair_completed_at ||
                order.updated_at ||
                order.created_at
              : order.created_at,
        ).slice(0, 10);
        return matchesSearch && matchesStatus && (listMode === 'agenda' || !date || orderDate === date);
      }),
    [visibleOrders, normalizedSearch, status, date, listMode],
  );
  const workspaceCopy = {
    all: {
      eyebrow: 'Vista general',
      title: 'Todas las órdenes',
      description: 'Aquí ves todas las órdenes, incluidas las que ya se entregaron o cancelaron.',
      countLabel: 'órdenes en total',
    },
    workshop: {
      eyebrow: 'Taller',
      title: 'Órdenes que ya están dentro',
      description: 'Consulta y actualiza los equipos que siguen en atención.',
      countLabel: 'en taller',
    },
    ready: {
      eyebrow: 'Entrega pendiente',
      title: 'Órdenes listas para entregar',
      description: 'Equipos terminados que esperan ser retirados por el cliente.',
      countLabel: 'listas para entregar',
    },
    history: {
      eyebrow: 'Registro',
      title: 'Historial de órdenes finalizadas',
      description: 'Consulta órdenes entregadas, canceladas o sin reparación.',
      countLabel: 'en historial',
    },
    agenda: {
      eyebrow: 'Programación',
      title: 'Agenda de entregas prometidas',
      description: 'Consulta los equipos programados para entregar en cada fecha y hora.',
      countLabel: 'programadas',
    },
  }[listMode];
  return (
    <section className="service-view">
      <header className="service-heading">
        <div>
          <span>
            <ClipboardList /> Taller integrado
          </span>
          <h2>Órdenes de servicio</h2>
          <p>
            Recibe equipos, documenta la reparación, registra pagos y consulta
            cada cambio.
          </p>
        </div>
      </header>
      <div className="service-metrics">
        <article>
          <b>{orders.length}</b>
          <span>Órdenes encontradas</span>
        </article>
        <article>
          <b>{counts.workshop}</b>
          <span>Órdenes en taller</span>
        </article>
        <article>
          <b>{counts.ready}</b>
          <span>Listas para entregar</span>
        </article>
        <article>
          <b>{money.format(Number(todayCommission.total || 0))}</b>
          <span>
            {isOwner ? 'Comisiones generadas hoy' : 'Mi comisión de hoy'} ·{' '}
            {Number(todayCommission.orders_count || 0)} órdenes
          </span>
        </article>
      </div>
      <section className="service-workflow" aria-label="Flujo de órdenes de servicio">
        <button className="service-workflow-card service-workflow-card-intake" onClick={openCreate}>
          <span className="service-workflow-icon"><Plus /></span>
          <span><b>1. Ingreso de órdenes</b><small>Registra un equipo nuevo</small></span>
        </button>
        <button className={`service-workflow-card service-workflow-card-workshop ${listMode === 'workshop' ? 'is-active' : ''}`} onClick={() => { setListMode('workshop'); document.getElementById('service-workshop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <span className="service-workflow-icon"><Wrench /></span>
          <span><b>2. Órdenes dentro</b><small>{counts.workshop} en taller</small></span>
        </button>
        <button className="service-workflow-card service-workflow-card-management" onClick={openManagementLookup}>
          <span className="service-workflow-icon"><ClipboardCheck /></span>
          <span><b>3. Gestionar orden</b><small>Actualiza estado o finaliza la reparación</small></span>
        </button>
        <button className={`service-workflow-card service-workflow-card-agenda ${listMode === 'agenda' ? 'is-active' : ''}`} onClick={() => { setListMode('agenda'); setStatus(''); setDate(''); document.getElementById('service-workshop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <span className="service-workflow-icon"><CalendarDays /></span>
          <span><b>4. Agenda técnica</b><small>Programación por fecha y hora</small></span>
        </button>
      </section>
      {listMode === 'agenda' ? (
        <AgendaBoard
          date={agendaDate}
          setDate={setAgendaDate}
          search={search}
          setSearch={setSearch}
          loading={loading}
          orders={filteredOrders}
          open={(order: any) => setSelected(order)}
        />
      ) : <>
      <section id="service-workshop" className="service-workspace-heading">
        <div>
          <span>{workspaceCopy.eyebrow}</span>
          <h3>{workspaceCopy.title}</h3>
          <p>{workspaceCopy.description}</p>
        </div>
        <div className="service-workspace-actions">
          <b>{filteredOrders.length} {workspaceCopy.countLabel}</b>
          <Button variant="outline" className={listMode === 'all' ? 'is-active' : ''} onClick={() => { setListMode('all'); setStatus(''); }}>
            Todas
          </Button>
          <Button variant="outline" className={listMode === 'workshop' ? 'is-active' : ''} onClick={() => { setListMode('workshop'); setStatus(''); }}>
            En taller
          </Button>
          <Button variant="outline" className={listMode === 'ready' ? 'is-active' : ''} onClick={() => { setListMode('ready'); setStatus('Reparado / listo para entregar'); }}>
            Listas para entregar
          </Button>
          <Button variant="outline" className={listMode === 'history' ? 'is-active' : ''} onClick={() => { setListMode('history'); setStatus(''); }}>
            Historial
          </Button>
          <Button variant="outline" onClick={() => { setListMode('agenda'); setStatus(''); setDate(''); }}>
            Abrir agenda
          </Button>
        </div>
      </section>
      <div className="service-toolbar">
        <label>
          <Search />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar orden, cliente, teléfono, documento, IMEI o equipo"
          />
        </label>
        <select
          value={status}
          onChange={(event) => {
            const nextStatus = event.target.value;
            setStatus(nextStatus);
            if (nextStatus === 'Reparado / listo para entregar') {
              setListMode('ready');
            } else if (CLOSED_STATUSES.includes(nextStatus)) {
              setListMode('history');
            } else if (nextStatus) {
              setListMode('workshop');
            }
          }}
        >
          <option value="">Todos los estados</option>
          {SERVICE_STATUSES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label>
          Fecha
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          onClick={() => {
            setDate('');
            setStatus('');
            setSearch('');
          }}
        >
          Limpiar
        </Button>
      </div>
      {loading ? (
        <p className="service-empty">Cargando órdenes…</p>
      ) : filteredOrders.length ? (
        <div className="service-list">
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              open={() => setSelected(order)}
            />
          ))}
        </div>
      ) : (
        <p className="service-empty">
          {listMode === 'all'
            ? 'No hay órdenes registradas con este filtro.'
            : listMode === 'history'
            ? 'No hay órdenes finalizadas con este filtro.'
            : listMode === 'ready'
              ? 'No hay órdenes listas para entregar con este filtro.'
              : 'No hay órdenes dentro del taller con este filtro.'}
        </p>
      )}</>}
      {managementLookupOpen && (
        <OrderLookupModal
          mode="management"
          orders={orders}
          close={() => setManagementLookupOpen(false)}
          continueWithOrder={(order: any) => {
            setManagementLookupOpen(false);
            setSelected(order);
          }}
        />
      )}
      {creating && (
        <ServiceForm
          form={form}
          setForm={setForm}
          orders={orders}
          close={() => { setFormError(''); setCreating(false); }}
          save={create}
          busy={busy}
          formError={formError}
          clearFormError={() => setFormError('')}
        />
      )}
      {paymentModal && selected && (
        <PaymentModal
          close={() => setPaymentModal(false)}
          save={addPayment}
          busy={busy}
        />
      )}
      {statusModal && selected && (
        <StatusModal
          status={statusModal}
          order={selected}
          close={() => setStatusModal('')}
          save={updateStatus}
          busy={busy}
        />
      )}
      {processModal && selected && (
        <ProcessModal
          order={selected}
          technicians={technicians}
          supplierValues={rememberedSupplierValues(orders)}
          close={() => setProcessModal(false)}
          save={processOrder}
          busy={busy}
        />
      )}
      {selected && (
        <ServiceDetail
          order={selected}
          receiptSettings={receiptSettings}
          close={() => setSelected(null)}
          requestStatus={setStatusModal}
          openPayment={() => setPaymentModal(true)}
          openProcess={() => setProcessModal(true)}
          busy={busy}
          isOwner={isOwner}
        />
      )}
    </section>
  );
}

function AgendaBoard({ date, setDate, search, setSearch, loading, orders, open }: any) {
  const label = date
    ? new Intl.DateTimeFormat('es-CO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date(`${date}T12:00:00`))
    : 'Selecciona una fecha';
  return (
    <section id="service-workshop" className="service-agenda">
      <header className="service-agenda-hero">
        <div className="service-agenda-title">
          <span><CalendarDays /></span>
          <div>
            <small>PROGRAMACIÓN DEL TALLER</small>
            <h3>Agenda técnica</h3>
            <p>Revisa a qué hora se prometió cada equipo y abre la orden con un clic.</p>
          </div>
        </div>
        <b>{orders.length} {orders.length === 1 ? 'equipo programado' : 'equipos programados'}</b>
      </header>
      <div className="service-agenda-tools">
        <div className="service-agenda-days" aria-label="Seleccionar fecha de agenda">
          <button className={date === todayISO() ? 'is-active' : ''} onClick={() => setDate(todayISO())}>Hoy</button>
          <button className={date === offsetISO(1) ? 'is-active' : ''} onClick={() => setDate(offsetISO(1))}>Mañana</button>
          <label>
            <CalendarDays />
            <span>{label}</span>
            <input aria-label="Elegir fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <label className="service-agenda-search">
          <Search />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente, orden o equipo"
          />
        </label>
      </div>
      <div className="service-agenda-day">
        <div>
          <span>AGENDA DEL DÍA</span>
          <h4>{label}</h4>
        </div>
        <small>La hora se toma de la fecha prometida en la orden.</small>
      </div>
      {loading ? <p className="service-empty">Cargando agenda…</p> : orders.length ? (
        <div className="service-agenda-list">
          {orders.map((order: any) => {
            const promised = new Date(order.estimated_delivery_at);
            return (
              <button key={order.id} className="service-agenda-card" onClick={() => open(order)}>
                <div className="service-agenda-time">
                  <Clock />
                  <b>{promised.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</b>
                </div>
                <div className="service-agenda-line" />
                <div className="service-agenda-device">
                  <span><Smartphone /></span>
                  <div>
                    <small>ORDEN {order.order_number}</small>
                    <b>{order.device_brand} {order.device_model}</b>
                    <p>{order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ''}</p>
                  </div>
                </div>
                <span className={`service-status status-${String(order.status).replace(/\W/g, '-').toLowerCase()}`}>{order.status}</span>
                <ChevronRight />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="service-agenda-empty">
          <CalendarDays />
          <b>No hay equipos programados</b>
          <p>Cuando registres una fecha y hora prometida en una orden, aparecerá aquí automáticamente.</p>
        </div>
      )}
    </section>
  );
}

export function ServiceOrderExit({
  receiptSettings,
  onNotice,
  onCashShift,
}: {
  receiptSettings: ReceiptSettings;
  onNotice: (text: string) => void;
  onCashShift: (shift: any) => void;
}) {
  const [orders, setOrders] = useState<any[]>([]);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoPrintOrderId, setAutoPrintOrderId] = useState<number | null>(null);

  const load = async () => {
    const response = await fetch('/api/auth?resource=service-orders', {
      cache: 'no-store',
    });
    const data: any = await response.json();
    if (!response.ok) throw new Error(data.error || 'No fue posible consultar las órdenes.');
    setOrders(data.orders || []);
    return data.orders || [];
  };
  const open = async () => {
    try {
      await load();
      setLookupOpen(true);
    } catch (error: any) {
      onNotice(error.message);
    }
  };
  const deliver = async (next: string, note = '', delivery: any = {}) => {
    if (!selected || next !== 'Entregado') return;
    setBusy(true);
    const selectedId = Number(selected.id);
    try {
      const data = await api({
        action: 'update-service-status',
        orderId: selectedId,
        status: 'Entregado',
        note,
        ...delivery,
      });
      if (data.cashShift) onCashShift(data.cashShift);
      const refreshed = await load();
      const delivered = refreshed.find((order: any) => Number(order.id) === selectedId);
      setConfirming(false);
      setSelected(delivered || null);
      if (delivered) setAutoPrintOrderId(selectedId);
      onNotice('Entrega registrada. Preparando las dos copias del recibo…');
    } catch (error: any) {
      onNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!selected || autoPrintOrderId !== Number(selected.id)) return;
    const timer = window.setTimeout(() => {
      setAutoPrintOrderId(null);
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [selected, autoPrintOrderId]);

  return (
    <>
      <section className="pos-service-exit">
        <div>
          <span><LogOut /> Entrega de equipos</span>
          <small>Busca una orden lista, registra el pago y entrégala al cliente.</small>
        </div>
        <Button variant="outline" onClick={() => void open()}>
          <LogOut /> Entregar orden
        </Button>
      </section>
      {lookupOpen && (
        <OrderLookupModal
          mode="delivery"
          orders={orders}
          close={() => setLookupOpen(false)}
          continueWithOrder={(order: any) => {
            setLookupOpen(false);
            setSelected(order);
            setConfirming(true);
          }}
        />
      )}
      {confirming && selected && (
        <StatusModal
          status="Entregado"
          order={selected}
          close={() => setConfirming(false)}
          save={deliver}
          busy={busy}
        />
      )}
      {selected?.status === 'Entregado' && !confirming && (
        <ServiceDetail
          order={selected}
          receiptSettings={receiptSettings}
          close={() => setSelected(null)}
          requestStatus={() => {}}
          openPayment={() => {}}
          openProcess={() => {}}
          busy={false}
          isOwner={false}
          showActions={false}
        />
      )}
    </>
  );
}

function OrderLookupModal({ mode, orders, close, continueWithOrder }: any) {
  const [reference, setReference] = useState('');
  const delivery = mode === 'delivery';
  const normalizedReference = reference.trim().toLocaleLowerCase('es-CO');
  const matchesReference = (order: any) =>
    [
      order.order_number,
      order.customer_document,
      order.customer_phone,
      order.device_identifier,
    ].some((value) =>
      String(value || '').toLocaleLowerCase('es-CO').includes(normalizedReference),
    );
  const eligibleOrder = normalizedReference
    ? orders.find(
        (order: any) =>
          (delivery
            ? order.status === 'Reparado / listo para entregar'
            : !CLOSED_STATUSES.includes(order.status)) &&
          matchesReference(order),
      )
    : null;
  const otherOrder = normalizedReference
    ? orders.find((order: any) => matchesReference(order))
    : null;

  return (
    <div className="service-modal-backdrop" role="presentation">
      <section className="service-modal service-delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-title">
        <header>
          <div>
            <h3 id="delivery-title">{delivery ? 'Entrega de orden' : 'Gestionar orden'}</h3>
            <p>{delivery ? 'Escribe la referencia, código de retiro, documento, teléfono o IMEI.' : 'Busca la orden para actualizar su estado, proceso técnico o finalizar la reparación.'}</p>
          </div>
          <button aria-label="Cerrar" onClick={close}><X /></button>
        </header>
        <div className="service-delivery-content">
          <label className="service-delivery-search">
            <Search />
            <input
              autoFocus
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && eligibleOrder) continueWithOrder(eligibleOrder);
              }}
              placeholder="Ej. 035, documento, teléfono o IMEI"
            />
          </label>
          {!normalizedReference && (
            <p className="service-delivery-help">{delivery ? 'Primero identifica la orden. Solo se puede entregar una orden que ya esté terminada y lista.' : 'Primero identifica la orden. Desde el siguiente paso podrás cambiar el estado, documentar el proceso técnico o dejarla lista para entrega.'}</p>
          )}
          {eligibleOrder && (
            <article className="service-delivery-match">
              <span><ClipboardCheck /></span>
              <div>
                <small>{delivery ? 'Orden encontrada y lista para entregar' : 'Orden encontrada para gestionar'}</small>
                <h4>{eligibleOrder.order_number} · {eligibleOrder.device_brand} {eligibleOrder.device_model}</h4>
                <p>{eligibleOrder.customer_name} · {eligibleOrder.customer_phone || 'Sin teléfono'}</p>
                <p>{delivery ? <>Saldo pendiente: <b>{money.format(Math.max(0, Number(eligibleOrder.final_total || eligibleOrder.estimated_total || 0) - Number(eligibleOrder.paid_total || 0)))}</b></> : <>Estado actual: <b>{eligibleOrder.status}</b></>}</p>
              </div>
              <Button onClick={() => continueWithOrder(eligibleOrder)}>
                {delivery ? 'Continuar con entrega' : 'Gestionar esta orden'}
                <ChevronRight />
              </Button>
            </article>
          )}
          {normalizedReference && !eligibleOrder && otherOrder && (
            <p className="service-delivery-warning">
              {delivery ? <>Encontramos la orden <b>{otherOrder.order_number}</b>, pero está en estado <b>{otherOrder.status}</b>. Debe estar marcada como “Reparado / listo para entregar” antes de registrar la entrega.</> : <>Encontramos la orden <b>{otherOrder.order_number}</b>, pero está en estado <b>{otherOrder.status}</b>. Ya fue cerrada y queda disponible únicamente en el historial.</>}
            </p>
          )}
          {normalizedReference && !eligibleOrder && !otherOrder && (
            <p className="service-delivery-warning">No encontramos una orden con esa referencia. Verifica el código e inténtalo de nuevo.</p>
          )}
        </div>
        <footer><Button variant="outline" onClick={close}>Cancelar</Button></footer>
      </section>
    </div>
  );
}

function formatServiceDateTime(value: any) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function currentStatusMoment(order: any) {
  if (order.status === 'Entregado' && order.delivered_at) return order.delivered_at;
  const event = Array.isArray(order.events)
    ? order.events.find((item: any) => item.to_status === order.status)
    : null;
  return event?.created_at || order.updated_at || order.created_at;
}

function currentStatusDateLabel(status: string) {
  if (status === 'Entregado') return 'Entregada';
  if (status === 'Reparado / listo para entregar') return 'Lista para entrega desde';
  if (status === 'Esperando respuesta del cliente') return 'Esperando respuesta desde';
  if (status === 'Sin reparación') return 'Marcada sin reparación';
  if (status === 'Cancelado') return 'Cancelada';
  return 'Recibida';
}

function paymentKindLabel(kind: string) {
  return kind === 'Anticipo' ? 'Abono' : kind === 'Saldo' ? 'Pago de saldo' : 'Pago';
}

function OrderCard({ order, open }: any) {
  const statusMoment = formatServiceDateTime(currentStatusMoment(order));
  return (
    <button
      className={`service-order-card ${CLOSED_STATUSES.includes(order.status) ? 'service-order-card-closed' : ''}`}
      onClick={open}
    >
      <div className="service-device">
        <span>
          <Smartphone />
        </span>
        <div>
          <b>
            {order.order_number} · {order.device_brand} {order.device_model}
          </b>
          <small>
            {order.customer_name} · {order.customer_phone}
            {statusMoment
              ? ` · ${currentStatusDateLabel(order.status)}: ${statusMoment}`
              : ''}
            {order.estimated_delivery_at
              ? ` · Prometida: ${new Date(order.estimated_delivery_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}`
              : ''}
          </small>
        </div>
      </div>
      <span
        className={`service-status status-${String(order.status).replace(/\W/g, '-').toLowerCase()}`}
      >
        {order.status}
      </span>
      <div className="service-money">
        <small>Pagado / estimado</small>
        <b>
          {money.format(Number(order.paid_total || 0))} /{' '}
          {money.format(
            Number(order.final_total || order.estimated_total || 0),
          )}
        </b>
      </div>
      <ChevronRight />
    </button>
  );
}

function rememberedDeviceValues(orders: any[], field: string) {
  const values = new Map<string, { value: string; count: number; last: number }>();

  orders.forEach((order, index) => {
    const value = String(order[field] || '').trim();
    if (!value) return;
    const key = value.toLocaleLowerCase('es-CO');
    const previous = values.get(key);
    values.set(key, {
      value: previous?.value || value,
      count: (previous?.count || 0) + 1,
      last: index,
    });
  });

  return [...values.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last || a.value.localeCompare(b.value, 'es-CO'))
    .map((entry) => entry.value);
}

function rememberedSupplierValues(orders: any[]) {
  const values = new Map<string, { value: string; count: number; last: number }>();
  orders.forEach((order, orderIndex) => {
    (Array.isArray(order.parts) ? order.parts : []).forEach((part: any, partIndex: number) => {
      const value = String(part?.supplier || '').trim();
      if (!value) return;
      const key = value.toLocaleLowerCase('es-CO');
      const previous = values.get(key);
      values.set(key, { value: previous?.value || value, count: (previous?.count || 0) + 1, last: orderIndex * 1000 + partIndex });
    });
  });
  return [...values.values()].sort((a, b) => b.count - a.count || b.last - a.last || a.value.localeCompare(b.value, 'es-CO')).map((entry) => entry.value);
}

function PartSupplierField({ value, onChange, values }: any) {
  const [open, setOpen] = useState(false);
  const query = String(value || '').trim().toLocaleLowerCase('es-CO');
  const suggestions = values.filter((item: string) => !query || item.toLocaleLowerCase('es-CO').includes(query)).slice(0, 8);
  return <div className="service-memory-field service-part-supplier"><label>Proveedor<input value={value} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} placeholder="Selecciona o escribe un proveedor" autoComplete="off" /></label>{open && values.length > 0 && <div className="service-memory-menu" role="listbox" aria-label="Proveedores usados anteriormente"><small>{query ? 'Coincidencias anteriores' : 'Proveedores más usados'}</small>{suggestions.length ? suggestions.map((item: string) => <button type="button" key={item} role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item); setOpen(false); }}>{item}</button>) : <p>No hay coincidencias guardadas.</p>}</div>}</div>;
}

function DeviceMemoryField({
  field,
  label,
  placeholder,
  values,
  form,
  setForm,
}: any) {
  const [open, setOpen] = useState(false);
  const query = String(form[field] || '').trim().toLocaleLowerCase('es-CO');
  const suggestions = values
    .filter((value: string) => !query || value.toLocaleLowerCase('es-CO').includes(query))
    .slice(0, 8);

  return (
    <div className="service-memory-field">
      <label htmlFor={`service-${field}`}>
        {label} *
      </label>
      <input
        id={`service-${field}`}
        value={form[field]}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setForm({ ...form, [field]: event.target.value });
          setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && values.length > 0 && (
        <div className="service-memory-menu" role="listbox" aria-label={`${label} usados anteriormente`}>
          <small>{query ? 'Coincidencias anteriores' : 'Usados con frecuencia'}</small>
          {suggestions.length ? (
            suggestions.map((value: string) => (
              <button
                type="button"
                key={value}
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setForm({ ...form, [field]: value });
                  setOpen(false);
                }}
              >
                {value}
              </button>
            ))
          ) : (
            <p>No hay coincidencias guardadas.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ServiceForm({ form, setForm, orders, close, save, busy, formError, clearFormError }: any) {
  const brands = useMemo(() => rememberedDeviceValues(orders, 'device_brand'), [orders]);
  const models = useMemo(() => rememberedDeviceValues(orders, 'device_model'), [orders]);
  const formatMoneyInput = (value: any) =>
    value
      ? `$ ${Number(String(value).replace(/\D/g, '')).toLocaleString('es-CO')}`
      : '';
  const field = (
    key: string,
    label: string,
    placeholder = '',
    required = false,
    type = 'text',
  ) => (
    <label className={key === 'customerDocument' && formError ? 'service-field-invalid' : ''}>
      {label}
      {required && ' *'}
      <input
        type={type === 'number' ? 'text' : type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        value={type === 'number' ? formatMoneyInput(form[key]) : form[key]}
        onChange={(event) => {
          if (key === 'customerDocument') clearFormError?.();
          setForm({
            ...form,
            [key]:
              type === 'number'
                ? event.target.value.replace(/\D/g, '')
                : event.target.value,
          });
        }}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
  const area = (
    key: string,
    label: string,
    placeholder = '',
    required = false,
  ) => (
    <label className="service-wide">
      {label}
      {required && ' *'}
      <textarea
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <div
      className="service-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="service-modal">
        <header>
          <div>
            <h3>Nueva orden de servicio</h3>
            <p>Registra exactamente cómo se recibe el equipo.</p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="service-form">
          <h4>Cliente</h4>
          {field('customerName', 'Nombre completo', 'Ej. Laura Gómez', true)}
          {field('customerPhone', 'Teléfono', 'Ej. 315 000 0000', true)}
          {field('customerDocument', 'Documento', 'Ej. 1000000000', true)}
          {formError && <p className="service-form-error" role="alert">{formError}</p>}
          <span />
          <h4>Equipo</h4>
          <label>
            Tipo de dispositivo
            <select value={form.deviceType} onChange={(event) => setForm({ ...form, deviceType: event.target.value })}>
              <option>Celular</option><option>Computador portátil</option><option>Computador de escritorio</option><option>Tablet</option><option>Consola</option><option>Otro</option>
            </select>
          </label>
          <span />
          <DeviceMemoryField
            field="deviceBrand"
            label="Marca"
            placeholder="Ej. Samsung"
            values={brands}
            form={form}
            setForm={setForm}
          />
          <DeviceMemoryField
            field="deviceModel"
            label="Modelo"
            placeholder="Ej. Galaxy A54"
            values={models}
            form={form}
            setForm={setForm}
          />
          {field('deviceIdentifier', 'IMEI o serial', 'Opcional')}
          {field('devicePassword', 'Clave, patrón o contraseña', 'Opcional')}
          {area('accessories', 'Accesorios recibidos', 'Cargador, funda, SIM…')}
          {area(
            'physicalCondition',
            'Estado físico al recibir',
            'Rayones, golpes, pantalla…',
          )}
          <ReceptionPhotos
            value={form.photos || []}
            onChange={(photos) => setForm({ ...form, photos })}
          />
          <h4>Servicio y valores</h4>
          {area(
            'plannedService',
            'Diagnóstico o reparación prevista',
            'Trabajo que se revisará',
          )}
          {field(
            'estimatedTotal',
            'Valor estimado ($)',
            'Ej. 500.000',
            false,
            'number',
          )}
          <label>
            Abono inicial ($)
            <input
              type="text"
              inputMode="numeric"
              value={
                form.initialPayment
                  ? `$ ${Number(form.initialPayment).toLocaleString('es-CO')}`
                  : ''
              }
              onChange={(e) =>
                setForm({
                  ...form,
                  initialPayment: e.target.value.replace(/\D/g, ''),
                })
              }
              placeholder="Opcional"
            />
          </label>
          <label>
            Medio de pago
            <select
              value={form.initialPaymentMethod || 'Efectivo'}
              onChange={(e) =>
                setForm({ ...form, initialPaymentMethod: e.target.value })
              }
            >
              <option>Efectivo</option>
              <option>Tarjeta</option>
              <option>Transferencia</option>
            </select>
          </label>
          <ModernDateTimeField
            label="Fecha y hora prometida"
            value={form.estimatedDeliveryAt || ''}
            onChange={(estimatedDeliveryAt: string) =>
              setForm({ ...form, estimatedDeliveryAt })
            }
          />
          {area('notes', 'Observaciones internas', 'Información adicional')}
        </div>
        <footer>
          <Button
            variant="outline"
            className="service-cancel-button"
            onClick={close}
          >
            Cancelar
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : 'Crear orden e imprimir 2 copias'}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function ModernDateTimeField({ label, value, onChange }: any) {
  const [date = '', time = ''] = String(value || '').split('T');
  const localDate = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const setDate = (next: string) =>
    onChange(next ? `${next}T${time || '09:00'}` : '');
  const setTime = (next: string) =>
    onChange(date ? `${date}T${next}` : `${localDate()}T${next}`);
  const times = Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4),
      minute = (index % 4) * 15;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });
  const timeLabel = (item: string) =>
    new Date(`2000-01-01T${item}`).toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <fieldset className="service-datetime service-wide">
      <legend>{label}</legend>
      <div className="service-date-quick">
        <button type="button" onClick={() => setDate(localDate())}>
          Hoy
        </button>
        <button type="button" onClick={() => setDate(localDate(1))}>
          Mañana
        </button>
        <button type="button" onClick={() => onChange('')}>
          Sin fecha
        </button>
      </div>
      <label>
        <CalendarDays />
        <span>Fecha</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        <Clock />
        <span>Hora</span>
        <select
          value={time || '09:00'}
          onChange={(e) => setTime(e.target.value)}
        >
          {times.map((item) => (
            <option key={item} value={item}>
              {timeLabel(item)}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function PaymentModal({ close, save, busy }: any) {
  const [amount, setAmount] = useState(''),
    [method, setMethod] = useState('Efectivo'),
    [printReceipt, setPrintReceipt] = useState(true);
  return (
    <div
      className="service-modal-backdrop payment-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="service-modal payment-modal">
        <header>
          <div>
            <h3>Registrar pago</h3>
            <p>Ingresa el pago recibido por la reparación.</p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="service-form">
          <label className="service-wide">
            Valor del pago
            <input
              autoFocus
              inputMode="numeric"
              value={moneyInput(amount)}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Ej. 50.000"
            />
          </label>
          <label className="service-wide">
            Medio de pago
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>Efectivo</option>
              <option>Tarjeta</option>
              <option>Transferencia</option>
            </select>
          </label>
          <label className="service-wide service-payment-print-option">
            <input
              type="checkbox"
              checked={printReceipt}
              onChange={(event) => setPrintReceipt(event.target.checked)}
            />
            <span>
              <b>Imprimir recibo actualizado al guardar</b>
              <small>Incluye este abono, el medio de pago y el saldo pendiente.</small>
            </span>
          </label>
        </div>
        <footer>
          <Button
            variant="outline"
            className="service-cancel-button"
            onClick={close}
          >
            Cancelar
          </Button>
          <Button
            disabled={busy || !amount}
            onClick={() => save(Number(amount), method, printReceipt)}
          >
            <Banknote />
            {printReceipt ? 'Guardar abono e imprimir' : 'Guardar abono'}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function StatusModal({ status, order, close, save, busy }: any) {
  const [commissionPercent, setLivePercent] = useState<number | null>(null),
    [commissionError, setCommissionError] = useState('');
  useEffect(() => {
    if (status !== 'Entregado' || !order.technician_user_id) {
      setLivePercent(null);
      setCommissionError(
        'La orden debe ser tomada por un técnico durante el proceso técnico.',
      );
      return;
    }
    let active = true;
    setLivePercent(null);
    setCommissionError('');
    fetch(
      '/api/auth?resource=service-technician-commission&technicianId=' +
        order.technician_user_id,
      { cache: 'no-store' },
    )
      .then(async (r) => {
        const d: any = await r.json();
        if (!r.ok || !d.hasCustom)
          throw Error(
            d.error || 'Configura el porcentaje en Pago de técnicos.',
          );
        if (active) setLivePercent(Number(d.commissionPercent));
      })
      .catch((e) => {
        if (active) setCommissionError(e.message);
      });
    return () => {
      active = false;
    };
  }, [status, order.technician_user_id]);

  const [note, setNote] = useState(''),
    [recipient, setRecipient] = useState(''),
    [document, setDocument] = useState(''),
    [deliveryNotes, setDeliveryNotes] = useState(''),
    [finalTotal, setFinalTotal] = useState(
      String(Number(order?.final_total || order?.estimated_total || 0)),
    ),
    [partsCost, setPartsCost] = useState(
      String(Number(order?.parts_cost || 0)),
    ),
    [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const required = ['Cancelado', 'Sin reparación'].includes(status),
    delivery = status === 'Entregado',
    finalValue = Number(finalTotal) || 0,
    partsValue = Number(partsCost) || 0,
    paidBeforeDelivery = Number(order.paid_total || 0),
    balanceToCollect = Math.max(0, finalValue - paidBeforeDelivery),
    base = Math.max(0, finalValue - partsValue),
    commission = Math.round((base * (Number(commissionPercent) || 0)) / 100);
  return (
    <div
      className="service-modal-backdrop payment-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="service-modal payment-modal">
        <header>
          <div>
            <h3>
              {delivery ? 'Registrar entrega al cliente' : 'Cambiar estado'}
            </h3>
            <p>
              La orden pasará a: <b>{status}</b>
            </p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="service-form">
          {delivery && (
            <>
              <label>
                Valor final de la reparación *
                <input
                  autoFocus
                  inputMode="numeric"
                  value={moneyInput(finalTotal)}
                  onChange={(e) =>
                    setFinalTotal(e.target.value.replace(/[^0-9]/g, ''))
                  }
                  placeholder="Ej. 250000"
                />
              </label>
              <label>
                Costo real de repuestos
                <input
                  inputMode="numeric"
                  value={moneyInput(partsCost)}
                  onChange={(e) =>
                    setPartsCost(e.target.value.replace(/[^0-9]/g, ''))
                  }
                  placeholder="0"
                />
              </label>
              <section className="service-wide service-delivery-charge">
                <div className="service-delivery-charge-heading">
                  <span>COBRAR AL CLIENTE AHORA</span>
                  <strong>{money.format(balanceToCollect)}</strong>
                </div>
                <p>
                  {balanceToCollect > 0
                    ? 'Este es el saldo pendiente después de descontar los abonos registrados.'
                    : 'El cliente ya cubrió el valor total. Solo confirma la entrega del equipo.'}
                </p>
                <div className="service-delivery-breakdown">
                  <span>Valor final de la reparación</span>
                  <b>{money.format(finalValue)}</b>
                  <span>Abonos recibidos</span>
                  <b>− {money.format(paidBeforeDelivery)}</b>
                  <span>Saldo a cobrar al entregar</span>
                  <b>{money.format(balanceToCollect)}</b>
                </div>
              </section>
              {Array.isArray(order.payments) && order.payments.length > 0 && (
                <section className="service-wide service-delivery-payment-history">
                  <b>Abonos y pagos ya registrados</b>
                  {order.payments.map((payment: any, index: number) => (
                    <p key={payment.id || `${payment.kind}-${index}`}>
                      <span>
                        {paymentKindLabel(payment.kind)} · {payment.payment_method || 'Medio no registrado'}
                        {payment.created_at ? ` · ${formatServiceDateTime(payment.created_at)}` : ''}
                      </span>
                      <strong>{money.format(Number(payment.amount || 0))}</strong>
                    </p>
                  ))}
                </section>
              )}
              <details className="service-wide service-delivery-internal">
                <summary>Información interna de la reparación</summary>
                <div className="service-settlement">
                  <span>Técnico que tomó la reparación</span>
                  <b>{order.technician_name || 'Sin técnico asignado'}</b>
                  <span>Base de ganancia</span>
                  <b>{money.format(base)}</b>
                  <small>{money.format(finalValue)} − {money.format(partsValue)}</small>
                  <span>
                    {commissionPercent === null
                      ? 'Comisión todavía no habilitada'
                      : `Comisión al confirmar entrega (${commissionPercent}%)`}
                  </span>
                  <b>
                    {commissionPercent === null
                      ? commissionError || 'Consultando porcentaje…'
                      : money.format(commission)}
                  </b>
                </div>
              </details>
              {balanceToCollect > 0 && <label>
                Medio de pago del saldo a cobrar
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option>Efectivo</option>
                  <option>Tarjeta</option>
                  <option>Transferencia</option>
                </select>
              </label>}
              <label>
                Recibe el equipo *
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Nombre de quien recibe"
                />
              </label>
              <label>
                Documento de entrega
                <input
                  value={document}
                  onChange={(e) => setDocument(e.target.value)}
                  placeholder="Opcional"
                />
              </label>
              <label className="service-wide">
                Observaciones de entrega
                <textarea
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Estado de entrega, accesorios entregados…"
                />
              </label>
            </>
          )}
          <label className="service-wide">
            Nota del cambio {required ? '*' : '(opcional)'}
            <textarea
              autoFocus={!delivery}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                required
                  ? 'Explica el motivo de este cambio'
                  : 'Ej. Equipo revisado y listo para entregar'
              }
            />
          </label>
        </div>
        <footer>
          <Button
            variant="outline"
            className="service-cancel-button"
            onClick={close}
          >
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              (required && !note.trim()) ||
              (delivery &&
                (!recipient.trim() ||
                  !order.technician_user_id ||
                  finalValue <= 0 ||
                  commissionPercent === null))
            }
            onClick={() =>
              save(status, note, {
                deliveryRecipient: recipient,
                deliveryDocument: document,
                deliveryNotes,
                finalTotal,
                partsCost,
                paymentMethod,
              })
            }
          >
            {delivery ? 'Confirmar entrega e imprimir recibo' : 'Guardar estado'}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function ProcessModal({ order, technicians, supplierValues, close, save, busy }: any) {
  const [technicianId, setTechnicianId] = useState(
      String(order.technician_user_id || ''),
    ),
    [diagnosis, setDiagnosis] = useState(order.diagnosis || ''),
    [technicalReport, setTechnicalReport] = useState(
      order.technical_report || '',
    ),
    [partsUsed, setPartsUsed] = useState(order.parts_used || ''),
    [finalTotal, setFinalTotal] = useState(
      String(Number(order.final_total || 0)),
    ),
    [partItems, setPartItems] = useState<any[]>(() => {
      const saved = Array.isArray(order.parts) ? order.parts : [];
      if (saved.length) return saved.map((item: any) => ({ amount: String(Number(item.amount || 0)), paymentMethod: item.payment_method || 'Efectivo', supplier: item.supplier || '', note: item.note || '' }));
      return Number(order.parts_cost || 0) > 0 ? [{ amount: String(Number(order.parts_cost)), paymentMethod: 'Efectivo', supplier: '', note: 'Costo registrado anteriormente' }] : [];
    });
  const partsCost = partItems.reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const updatePart = (index: number, patch: any) => setPartItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return (
    <div
      className="service-modal-backdrop payment-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="service-modal payment-modal">
        <header>
          <div>
            <h3>Finalizar reparación</h3>
            <p>
              El técnico toma la orden, registra el resultado y la deja lista
              para que el cliente la recoja.
            </p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <div className="service-form">
          <label className="service-wide service-delivery-technician">
            Técnico que realizó la reparación *
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">Seleccionar técnico</option>
              {(technicians || []).map((tech: any) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
            <small>
              Esta orden quedará a nombre del técnico, pero su comisión solo se
              generará cuando el cliente retire el equipo.
            </small>
          </label>
          <h4>Valores definitivos</h4>
          <label>
            Valor final de la reparación
            <input
              autoFocus
              inputMode="numeric"
              value={moneyInput(finalTotal)}
              onChange={(e) =>
                setFinalTotal(e.target.value.replace(/[^0-9]/g, ''))
              }
              placeholder="Ej. 250000"
            />
            <small>
              Reemplaza el estimado cuando ya conozcas el valor real.
            </small>
          </label>
          <div className="service-parts-editor service-wide">
            <div className="service-parts-heading">
              <span>
                <b>Costos de la reparación</b>
                <small>Registra repuestos, pegantes, insumos u otro gasto. El total se calcula automáticamente y se descuenta antes de la comisión.</small>
              </span>
              <strong>{money.format(partsCost)}</strong>
            </div>
            {partItems.map((item, index) => (
              <div className="service-part-row" key={index}>
                <label>Concepto / detalle<input value={item.note} onChange={(e) => updatePart(index, { note: e.target.value })} placeholder="Ej. Pantalla, pegante, tornillos" /></label>
                <label>Valor<input inputMode="numeric" value={moneyInput(item.amount)} onChange={(e) => updatePart(index, { amount: e.target.value.replace(/[^0-9]/g, '') })} placeholder="0" /></label>
                <PartSupplierField value={item.supplier} onChange={(supplier: string) => updatePart(index, { supplier })} values={supplierValues} />
                <label>Medio de pago<select value={item.paymentMethod} onChange={(e) => updatePart(index, { paymentMethod: e.target.value })}><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option><option>Crédito</option><option>Otro</option></select></label>
                <button type="button" className="service-remove-part" onClick={() => setPartItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button>
              </div>
            ))}
            <button type="button" className="service-add-part" onClick={() => setPartItems((items) => [...items, { amount: '', paymentMethod: 'Efectivo', supplier: '', note: '' }])}><Plus /> Agregar costo</button>
          </div>
          <label className="service-wide">
            Diagnóstico
            <textarea
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="Resultado de la revisión técnica"
            />
          </label>
          <label className="service-wide">
            Trabajo realizado / notas del técnico
            <textarea
              value={technicalReport}
              onChange={(e) => setTechnicalReport(e.target.value)}
              placeholder="Reparación realizada, pruebas, detalles u observaciones del equipo"
            />
          </label>
          <label>
            Notas adicionales sobre repuestos
            <textarea
              value={partsUsed}
              onChange={(e) => setPartsUsed(e.target.value)}
              placeholder="Detalle de piezas o insumos"
            />
          </label>
        </div>
        <footer>
          <Button
            variant="outline"
            className="service-cancel-button"
            onClick={close}
          >
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !technicianId ||
              (!diagnosis.trim() && !technicalReport.trim()) ||
              Number(finalTotal) <= 0
            }
            onClick={() =>
              save({
                technicianUserId: Number(technicianId),
                diagnosis,
                technicalReport,
                partsUsed,
                finalTotal,
                parts: partItems,
                markReady: true,
              })
            }
          >
            {busy ? 'Guardando…' : 'Tomar orden y dejar lista'}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function ServiceDetail({
  order,
  receiptSettings,
  close,
  requestStatus,
  openPayment,
  openProcess,
  busy,
  isOwner,
  showActions = true,
}: any) {
  const paid = Number(order.paid_total || 0),
    total = Number(order.final_total || order.estimated_total || 0),
    balance = Math.max(0, total - paid),
    closed = CLOSED_STATUSES.includes(order.status),
    administrativeStatuses = SERVICE_STATUSES;
  return (
    <div
      className="service-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={
          'service-modal service-detail ' +
          (closed ? 'service-detail-readonly' : '')
        }
      >
        <header>
          <div>
            <span>{order.status}</span>
            <h3>{order.order_number}</h3>
            <p>
              {order.device_brand} {order.device_model} · {order.customer_name}
            </p>
          </div>
          <button className="print-hide" onClick={close}>
            <X />
          </button>
        </header>
        <div className="service-detail-grid">
          <article>
            <small>Cliente</small>
            <b>{order.customer_name}</b>
            <p>
              {order.customer_phone}
              {order.customer_document ? ` · ${order.customer_document}` : ''}
            </p>
          </article>
          <article>
            <small>Equipo</small>
            <b>
              {order.device_brand} {order.device_model}
            </b>
            <p>{order.device_identifier || 'Sin IMEI o serial'}</p>
          </article>
          <article>
            <small>Clave de acceso</small>
            <b>{order.device_password || 'No registrada'}</b>
            <p>Clave, patrón o contraseña registrada al recibir el equipo.</p>
          </article>
          <article className="service-wide">
            <small>Servicio solicitado</small>
            <p>{order.planned_service || order.reported_issue || 'Pendiente de documentar por el técnico.'}</p>
          </article>
          <article>
            <small>Accesorios</small>
            <p>{order.accessories || 'Ninguno registrado'}</p>
          </article>
          <article>
            <small>Estado físico</small>
            <p>{order.physical_condition || 'Sin observaciones'}</p>
          </article>
          <article>
            <small>Técnico responsable</small>
            <b>
              {order.technician_name ||
                'Pendiente de que un técnico tome la orden'}
            </b>
            <p>
              {order.technician_name
                ? 'La comisión se habilitará cuando el cliente retire el equipo.'
                : 'Se asigna al registrar la reparación terminada.'}
            </p>
          </article>
          <article>
            <small>Reparación terminada</small>
            <b>{order.repair_completed_at ? new Date(order.repair_completed_at).toLocaleString('es-CO') : 'Pendiente'}</b>
            <p>
              Hora registrada automáticamente cuando el técnico dejó listo el equipo.
            </p>
          </article>
          <article className="service-wide">
            <small>Proceso técnico</small>
            <p>
              {order.diagnosis || order.technical_report
                ? `${order.diagnosis || 'Sin diagnóstico.'}${order.technical_report ? ` ${order.technical_report}` : ''}`
                : 'Aún no se ha documentado el diagnóstico.'}
            </p>
          </article>
          <article>
            <small>Comisión</small>
            <b>
              {order.commission_status === 'pending' ||
              order.commission_status === 'paid'
                ? money.format(Number(order.commission_amount || 0))
                : 'Todavía no generada'}
            </b>
            <p>
              {order.commission_percent != null
                ? `${order.commission_percent}% de ${money.format(Number(order.commission_base || 0))}`
                : 'Se genera cuando el cliente retira el equipo'}
            </p>
          </article>
        </div>
        <div className="service-finance">
          <p>
            <span>Valor estimado</span>
            <b>{money.format(Number(order.estimated_total || 0))}</b>
          </p>
          <p>
            <span>
              Valor final{' '}
              {Number(order.final_total || 0) > 0 ? 'fijado' : 'pendiente'}
            </span>
            <b>
              {Number(order.final_total || 0) > 0
                ? money.format(Number(order.final_total))
                : '—'}
            </b>
          </p>
          <p>
            <span>Costo real de repuestos</span>
            <b>{money.format(Number(order.parts_cost || 0))}</b>
          </p>
          <p>
            <span>Pagado por cliente</span>
            <b>{money.format(paid)}</b>
          </p>
        </div>
        {Array.isArray(order.payments) && order.payments.length > 0 && (
          <section className="service-payments-detail">
            <h4>Pagos registrados</h4>
            <p className="service-payments-detail-summary">
              <span>Abonos y pagos aplicados a esta reparación</span>
              <strong>{money.format(paid)}</strong>
            </p>
            {order.payments.map((payment: any, index: number) => (
              <p key={payment.id || `${payment.kind}-${index}`}>
                <span>
                  <b>{paymentKindLabel(payment.kind)}</b>
                  <small>
                    {payment.payment_method || 'Medio no registrado'}
                    {payment.created_at
                      ? ` · ${formatServiceDateTime(payment.created_at)}`
                      : ''}
                    {payment.actor_name ? ` · ${payment.actor_name}` : ''}
                  </small>
                </span>
                <strong>{money.format(Number(payment.amount || 0))}</strong>
              </p>
            ))}
          </section>
        )}
        {Array.isArray(order.parts) && order.parts.length > 0 && (
          <section className="service-parts-detail">
            <h4>Costos registrados</h4>
            {order.parts.map((part: any) => (
              <p key={part.id}>
                <span><b>{part.note || 'Costo de reparación'}</b>{part.supplier ? ` · ${part.supplier}` : ''} · {part.payment_method}</span>
                <strong>{money.format(Number(part.amount || 0))}</strong>
              </p>
            ))}
          </section>
        )}
        {showActions && <div className="service-controls print-hide">
          <label>
            Seguimiento
            <select
              disabled={busy}
              value={order.status}
              onChange={(event) => requestStatus(event.target.value)}
            >
              {administrativeStatuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <Button onClick={openProcess} disabled={busy}>
            {order.technician_user_id
              ? 'Editar reparación'
              : 'Completar reparación'}
          </Button>
          <Button onClick={openPayment} disabled={busy}>
            <Banknote />
            Registrar pago
          </Button>
          {isOwner && order.commission_status === 'pending' && (
            <span>Liquida y registra el pago en Pago de técnicos.</span>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            Imprimir 2 copias
          </Button>
        </div>}
        <SavedServicePhotos orderId={Number(order.id)} />
        <ServiceReceipt
          order={order}
          settings={receiptSettings}
          copy="CLIENTE"
        />
        <div className="service-copy-break" />
        <ServiceReceipt order={order} settings={receiptSettings} copy="LOCAL" />
        <section className="service-events print-hide">
          <h4>Historial</h4>
          {(order.events || []).map((event: any) => (
            <p key={event.id}>
              <b>
                {event.event_type}
                {event.to_status ? ` · ${event.to_status}` : ''}
              </b>
              <span>{event.note}</span>
              <small>
                {event.actor_name} ·{' '}
                {new Date(event.created_at).toLocaleString('es-CO')}
              </small>
            </p>
          ))}
        </section>
      </section>
    </div>
  );
}

function ServiceReceipt({ order, settings, copy }: any) {
  const paid = Number(order.paid_total || 0),
    total = Number(order.final_total || order.estimated_total || 0),
    delivered = order.status === 'Entregado',
    payments = Array.isArray(order.payments)
      ? order.payments.filter((payment: any) => Number(payment?.amount || 0) > 0)
      : [],
    advances = payments.filter((payment: any) => payment.kind === 'Anticipo'),
    balancePayments = payments.filter((payment: any) => payment.kind !== 'Anticipo'),
    advanceTotal = advances.reduce(
      (sum: number, payment: any) => sum + Number(payment.amount || 0),
      0,
    ),
    balancePaymentTotal = balancePayments.reduce(
      (sum: number, payment: any) => sum + Number(payment.amount || 0),
      0,
    ),
    formatPaymentDate = (value: any) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CO');
    };
  return (
    <section className="service-receipt print-receipt">
      <header>
        <img className="service-receipt-logo" src="/dtc-stage.svg" alt="Logo de DTC Stage" />
        <b>{settings.businessName}</b>
        {settings.address && <span>{settings.address}</span>}
        {settings.phone && <span>Tel. {settings.phone}</span>}
        <h2>
          {delivered ? 'COMPROBANTE DE ENTREGA' : 'ORDEN DE SERVICIO'}
        </h2>
        <strong>{delivered ? 'ORDEN' : 'CÓDIGO DE RETIRO'}: {order.order_number}</strong>
        <em>COPIA {copy}</em>
        <small>{delivered ? 'Constancia de equipo entregado al cliente.' : 'Presenta este código para identificar y retirar el equipo.'}</small>
        {!delivered && payments.length > 0 && (
          <small>Comprobante actualizado de abonos recibidos.</small>
        )}
      </header>
      <div>
        <p>
          <span>Fecha</span>
          <b>{new Date(delivered ? order.delivered_at : order.created_at).toLocaleString('es-CO')}</b>
        </p>
        <p>
          <span>Cliente</span>
          <b>{order.customer_name}</b>
        </p>
        <p>
          <span>Teléfono</span>
          <b>{order.customer_phone}</b>
        </p>
        <p>
          <span>Documento</span>
          <b>{order.customer_document || 'No registrado'}</b>
        </p>
        <p>
          <span>Equipo</span>
          <b>
            {order.device_brand} {order.device_model}
          </b>
        </p>
        {order.device_identifier && (
          <p>
            <span>IMEI/Serial</span>
            <b>{order.device_identifier}</b>
          </p>
        )}
        {order.device_password && (
          <p>
            <span>Clave de acceso</span>
            <b>{order.device_password}</b>
          </p>
        )}
        <p>
          <span>Estado</span>
          <b>{order.status}</b>
        </p>
        {delivered && (
          <p>
            <span>Técnico</span>
            <b>{order.technician_name}</b>
          </p>
        )}
        {delivered && order.repair_completed_at && (
          <p>
            <span>Reparación terminada</span>
            <b>{new Date(order.repair_completed_at).toLocaleString('es-CO')}</b>
          </p>
        )}
        {!delivered && order.estimated_delivery_at && (
          <p>
            <span>Entrega prometida</span>
            <b>
              {new Date(order.estimated_delivery_at).toLocaleString('es-CO')}
            </b>
          </p>
        )}
      </div>
      <section>
        {order.technical_report && (
          <>
            <b>Trabajo realizado</b>
            <p>{order.technical_report}</p>
          </>
        )}
        {delivered && order.delivery_recipient && (
          <>
            <b>Recibe el equipo</b>
            <p>{order.delivery_recipient}</p>
          </>
        )}
        {delivered && order.delivery_document && (
          <>
            <b>Documento de quien recibe</b>
            <p>{order.delivery_document}</p>
          </>
        )}
        {delivered && order.delivery_notes && (
          <>
            <b>Observaciones de entrega</b>
            <p>{order.delivery_notes}</p>
          </>
        )}
        {!delivered && (
          <>
            {(order.planned_service || order.reported_issue) && <><b>Servicio solicitado</b><p>{order.planned_service || order.reported_issue}</p></>}
            {order.accessories && <><b>Accesorios recibidos</b><p>{order.accessories}</p></>}
            {order.physical_condition && <><b>Estado físico</b><p>{order.physical_condition}</p></>}
          </>
        )}
      </section>
      {payments.length > 0 && (
        <div className="service-receipt-payments">
          <b>{delivered ? 'DETALLE DE PAGOS' : 'ABONOS RECIBIDOS'}</b>
          {payments.map((payment: any, index: number) => {
            const isAdvance = payment.kind === 'Anticipo';
            const paymentDate = formatPaymentDate(payment.created_at);
            return (
              <p key={payment.id || `${payment.kind}-${index}`}>
                <span>
                  {paymentKindLabel(payment.kind)}
                  {payment.payment_method ? ` · ${payment.payment_method}` : ''}
                  {paymentDate ? ` · ${paymentDate}` : ''}
                </span>
                <b>{money.format(Number(payment.amount || 0))}</b>
              </p>
            );
          })}
        </div>
      )}
      <div className="service-receipt-values">
        <p>
          <span>
            {delivered ? 'Valor final' : 'Valor estimado'}
          </span>
          <b>{money.format(total)}</b>
        </p>
        {advanceTotal > 0 && (
          <p>
            <span>Total abonado antes de entrega</span>
            <b>{money.format(advanceTotal)}</b>
          </p>
        )}
        {delivered && balancePaymentTotal > 0 && (
          <p>
            <span>Pago de saldo al entregar</span>
            <b>{money.format(balancePaymentTotal)}</b>
          </p>
        )}
        <p>
          <span>{delivered ? 'Total pagado' : 'Abonos recibidos'}</span>
          <b>{money.format(paid)}</b>
        </p>
        <p>
          <span>
            {delivered ? 'Saldo después de entrega' : 'Saldo estimado'}
          </span>
          <b>{money.format(Math.max(0, total - paid))}</b>
        </p>
      </div>
      <footer>
        {!delivered && (
          <>
            <p>
              El valor es estimado y puede cambiar después del diagnóstico y
              autorización del cliente.
            </p>
            <section className="service-receipt-policies">
              <b>CONDICIONES DE RECEPCIÓN Y GARANTÍA</b>
              <ol>
                <li>Pasados 60 días, no se asumirá responsabilidad por equipos no reclamados.</li>
                <li>Las garantías explicadas por el personal no cubren golpes ni humedad, sin importar la reparación realizada.</li>
                <li>Ningún equipo será entregado sin este recibo o sin el documento del cliente dejado en el establecimiento.</li>
                <li>Los datos personales se tratan conforme a la Ley 1581 de 2012.</li>
              </ol>
            </section>
          </>
        )}
        <div className="service-signatures">
          <span>Firma de quien recibe</span>
          <span>Firma del responsable</span>
        </div>
      </footer>
    </section>
  );
}
