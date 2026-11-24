'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Percent, Plus, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReceiptSettings } from './receipt-settings';

const money = (value: unknown) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const localDay = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : day(date);
};

const dateTime = (value: string) =>
  value ? new Date(value).toLocaleString('es-CO') : '—';

type Props = {
  onNotice: (message: string) => void;
  onCashShift: (shift: any) => void;
  receiptSettings: ReceiptSettings;
};

export function EmployeePayroll({
  onNotice,
  onCashShift,
  receiptSettings,
}: Props) {
  const today = new Date();
  const [from, setFrom] = useState(
    day(new Date(today.getFullYear(), today.getMonth(), 1)),
  );
  const [to, setTo] = useState(day(today));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [data, setData] = useState<any>({
    technicians: [],
    orders: [],
    settlements: [],
    items: [],
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);

  const [addOpen, setAddOpen] = useState(false);
  const [addTech, setAddTech] = useState('');
  const [liquidationFrom, setLiquidationFrom] = useState(day(today));
  const [liquidationTo, setLiquidationTo] = useState(day(today));
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
  const [liquidationNote, setLiquidationNote] = useState('');
  const [detailOrder, setDetailOrder] = useState<any>(null);

  const [historyTech, setHistoryTech] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [receiptSettlement, setReceiptSettlement] = useState<any>(null);
  const [autoPrintSettlementId, setAutoPrintSettlementId] = useState<
    number | null
  >(null);

  async function load() {
    const currentRevision = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/auth?${new URLSearchParams({ resource: 'technician-ledger', from, to, timeZone })}`,
        { cache: 'no-store' },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'No se pudo cargar pago de técnicos.');
      if (currentRevision !== revision.current) return result;
      setData(result);
      setDrafts(
        Object.fromEntries(
          result.technicians.map((technician: any) => [
            technician.id,
            technician.commission_percent == null
              ? ''
              : String(technician.commission_percent),
          ]),
        ),
      );
      return result;
    } catch (loadError: any) {
      if (currentRevision === revision.current)
        setError(loadError.message || 'No se pudo cargar el resumen.');
      throw loadError;
    } finally {
      if (currentRevision === revision.current) setLoading(false);
    }
  }

  async function post(body: any) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || 'No se pudo completar la operación.');
    if ('cashShift' in result) onCashShift(result.cashShift);
    return result;
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [from, to]);

  useEffect(() => {
    if (!receiptSettlement || receiptSettlement.id !== autoPrintSettlementId)
      return;
    const timer = window.setTimeout(() => {
      setAutoPrintSettlementId(null);
      window.print();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [receiptSettlement, autoPrintSettlementId]);

  const activeTechnicians = useMemo(
    () =>
      data.technicians.filter(
        (technician: any) => Number(technician.active) === 1,
      ),
    [data.technicians],
  );
  const pendingOrders = useMemo(
    () =>
      data.orders.filter(
        (order: any) =>
          order.commission_status === 'pending' && !order.settlement_id,
      ),
    [data.orders],
  );
  const candidateOrders = useMemo(
    () =>
      pendingOrders.filter(
        (order: any) => {
          const deliveredDay = localDay(order.delivered_at);
          return (
            String(order.technician_user_id) === addTech &&
            Boolean(deliveredDay) &&
            deliveredDay >= liquidationFrom &&
            deliveredDay <= liquidationTo
          );
        },
      ),
    [pendingOrders, addTech, liquidationFrom, liquidationTo],
  );
  const invalidLiquidationRange = liquidationFrom > liquidationTo;
  const liquidationTotal = candidateOrders
    .filter((order: any) => selectedOrders.includes(Number(order.id)))
    .reduce(
      (sum: number, order: any) => sum + Number(order.commission_amount),
      0,
    );
  const historyRows = data.settlements.filter(
    (settlement: any) =>
      !historyTech || String(settlement.technician_id) === historyTech,
  );

  function openAdd() {
    setAddTech('');
    const currentDay = day(new Date());
    setLiquidationFrom(currentDay);
    setLiquidationTo(currentDay);
    setSelectedOrders([]);
    setLiquidationNote('');
    setPaymentMethod('Efectivo');
    setDetailOrder(null);
    setAddOpen(true);
  }

  function itemsForSettlement(settlementId: number, source = data) {
    return source.items.filter(
      (item: any) => Number(item.settlement_id) === Number(settlementId),
    );
  }

  function showReceipt(settlement: any, source = data) {
    setReceiptSettlement({
      ...settlement,
      items: itemsForSettlement(settlement.id, source),
    });
  }

  async function savePercentage(technician: any) {
    const value = Number(drafts[technician.id]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError('El porcentaje debe estar entre 0 y 100.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await post({
        action: 'save-service-technician-commission',
        technicianId: technician.id,
        commissionPercent: value,
      });
      await load();
      onNotice(`Porcentaje de ${technician.name} actualizado a ${value}%.`);
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createLiquidation() {
    if (!addTech || !selectedOrders.length) return;
    setBusy(true);
    setError('');
    try {
      const created = await post({
        action: 'create-technician-settlement',
        technicianId: Number(addTech),
        orderIds: selectedOrders,
        note: liquidationNote,
        paymentMethod,
      });
      const refreshed = await load();
      const settlement = refreshed.settlements.find(
        (item: any) => Number(item.id) === Number(created.id),
      );
      setAddOpen(false);
      setSelectedOrders([]);
      if (settlement) {
        showReceipt(settlement, refreshed);
        setAutoPrintSettlementId(Number(settlement.id));
      }
      onNotice('Liquidación pagada y guardada. Se preparó el comprobante.');
    } catch (createError: any) {
      setError(createError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="payroll-view">
      <header className="payroll-heading">
        <div>
          <h2>Pago de técnicos</h2>
          <p>
            Revisa las reparaciones, paga al técnico y conserva el historial.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus /> Agregar liquidación
        </Button>
      </header>

      <div className="payroll-period">
        <label>
          Desde
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          Todo el historial
        </Button>
        <Button
          variant="secondary"
          onClick={() => load().catch(() => undefined)}
        >
          Actualizar
        </Button>
      </div>

      <div className="payroll-summary">
        <article>
          <b>{activeTechnicians.length}</b>
          <span>Técnicos activos</span>
        </article>
        <article>
          <b>{pendingOrders.length}</b>
          <span>Reparaciones sin liquidar</span>
        </article>
        <article>
          <b>
            {money(
              pendingOrders.reduce(
                (sum: number, order: any) =>
                  sum + Number(order.commission_amount),
                0,
              ),
            )}
          </b>
          <span>Pendiente de liquidar</span>
        </article>
        <article>
          <b>
            {money(
              data.settlements.reduce(
                (sum: number, settlement: any) =>
                  sum + Number(settlement.total),
                0,
              ),
            )}
          </b>
          <span>Total pagado en liquidaciones</span>
        </article>
      </div>

      {error && <p role="alert">{error}</p>}

      <section className="payroll-commission-settings">
        <header>
          <span><Percent /></span>
          <div>
            <h3>Porcentajes de comisión por técnico</h3>
            <p>Configura aquí el porcentaje de cada técnico antes de liquidar sus reparaciones.</p>
          </div>
        </header>
        <div className="payroll-list">
          {activeTechnicians.map((technician: any) => (
            <article className="payroll-card" key={technician.id}>
              <div>
                <h3>{technician.name}</h3>
                <p>
                  Este porcentaje se usa en las reparaciones que tome el
                  técnico.
                </p>
              </div>
              <label>
                Comisión %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={drafts[technician.id] ?? ''}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [technician.id]: event.target.value,
                    }))
                  }
                />
                <Button
                  disabled={busy}
                  onClick={() => savePercentage(technician)}
                >
                  Guardar
                </Button>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="payroll-history">
        <header>
          <div>
            <h3>Liquidaciones guardadas</h3>
            <p>
              Historial de pagos realizados a los técnicos.
            </p>
          </div>
          <label>
            Técnico
            <select
              value={historyTech}
              onChange={(event) => setHistoryTech(event.target.value)}
            >
              <option value="">Todos los técnicos</option>
              {activeTechnicians.map((technician: any) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        {loading ? (
          <p className="payroll-empty">Actualizando liquidaciones…</p>
        ) : historyRows.length === 0 ? (
          <p className="payroll-empty">
            No hay liquidaciones en esta vista. Usa “Agregar liquidación” para
            revisar las reparaciones pendientes.
          </p>
        ) : (
          <div className="payroll-history-list">
            {historyRows.map((settlement: any) => (
              <article className="payroll-history-row" key={settlement.id}>
                <div>
                  <h4>
                    Liquidación #{settlement.id} · {settlement.technician_name}
                  </h4>
                  <p>
                    {dateTime(settlement.created_at)} ·{' '}
                    {itemsForSettlement(settlement.id).length} reparación(es) ·{' '}
                    {settlement.payment_method || 'Pago registrado'}
                  </p>
                </div>
                <strong>{money(settlement.total)}</strong>
                <Button
                  variant="secondary"
                  onClick={() => showReceipt(settlement)}
                >
                  <Printer /> Ver e imprimir
                </Button>
              </article>
            ))}
          </div>
        )}

      </section>

      {addOpen && (
        <div className="payroll-modal-backdrop" role="dialog" aria-modal="true">
          <section className="payroll-modal">
            <header>
              <div>
                <h3>Agregar liquidación</h3>
                <p>
                  Revisa el trabajo, selecciona las reparaciones y registra el
                  pago al técnico en una sola operación. Puedes seleccionar un
                  día, una semana, una quincena o el período que necesites.
                </p>
              </div>
              <button onClick={() => setAddOpen(false)} aria-label="Cerrar">
                <X />
              </button>
            </header>
            <div className="payroll-modal-fields">
              <label>
                Técnico *
                <select
                  value={addTech}
                  onChange={(event) => {
                    setAddTech(event.target.value);
                    setSelectedOrders([]);
                  }}
                >
                  <option value="">Seleccionar técnico</option>
                  {activeTechnicians.map((technician: any) => (
                    <option key={technician.id} value={technician.id}>
                      {technician.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="payroll-date-range">
                <label>
                  Entregadas desde *
                  <input
                    type="date"
                    value={liquidationFrom}
                    onChange={(event) => {
                      setLiquidationFrom(event.target.value);
                      setSelectedOrders([]);
                    }}
                  />
                </label>
                <label>
                  Hasta *
                  <input
                    type="date"
                    value={liquidationTo}
                    onChange={(event) => {
                      setLiquidationTo(event.target.value);
                      setSelectedOrders([]);
                    }}
                  />
                </label>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const current = new Date();
                      const monday = new Date(current);
                      monday.setDate(current.getDate() - ((current.getDay() + 6) % 7));
                      setLiquidationFrom(day(monday));
                      setLiquidationTo(day(current));
                      setSelectedOrders([]);
                    }}
                  >
                    Esta semana
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const current = new Date();
                      const start = new Date(current);
                      start.setDate(current.getDate() - 14);
                      setLiquidationFrom(day(start));
                      setLiquidationTo(day(current));
                      setSelectedOrders([]);
                    }}
                  >
                    Últimos 15 días
                  </Button>
                </div>
              </div>
              <label className="payroll-payment-method">
                Medio de pago *
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option>Efectivo</option>
                  <option>Transferencia</option>
                  <option>Tarjeta</option>
                </select>
              </label>
              <label className="payroll-modal-note">
                Observación
                <textarea
                  value={liquidationNote}
                  onChange={(event) => setLiquidationNote(event.target.value)}
                  placeholder="Opcional"
                />
              </label>
            </div>
            <div className="payroll-liquidation-total">
              <span>Total seleccionado</span>
              <strong>{money(liquidationTotal)}</strong>
            </div>
            <div className="payroll-actions">
              <Button
                variant="secondary"
                disabled={!candidateOrders.length || invalidLiquidationRange}
                onClick={() =>
                  setSelectedOrders(
                    candidateOrders.map((order: any) => Number(order.id)),
                  )
                }
              >
                Marcar todas
              </Button>
              <Button
                variant="secondary"
                disabled={!selectedOrders.length}
                onClick={() => setSelectedOrders([])}
              >
                Desmarcar todas
              </Button>
            </div>
            <div className="payroll-order-list">
              {!addTech ? (
                <p className="payroll-empty">
                  Elige un técnico para ver sus reparaciones entregadas.
                </p>
              ) : invalidLiquidationRange ? (
                <p className="payroll-empty">
                  La fecha inicial no puede ser posterior a la fecha final.
                </p>
              ) : candidateOrders.length === 0 ? (
                <p className="payroll-empty">
                  No hay reparaciones pendientes de este técnico en el período
                  elegido.
                </p>
              ) : (
                candidateOrders.map((order: any) => (
                  <article className="payroll-order-card" key={order.id}>
                    <input
                      aria-label={`Seleccionar orden ${order.order_number}`}
                      type="checkbox"
                      checked={selectedOrders.includes(Number(order.id))}
                      onChange={() =>
                        setSelectedOrders((current) =>
                          current.includes(Number(order.id))
                            ? current.filter((id) => id !== Number(order.id))
                            : [...current, Number(order.id)],
                        )
                      }
                    />
                    <div>
                      <h4>
                        {order.order_number} · {order.customer_name}
                      </h4>
                      <p>
                        {order.device_brand} {order.device_model} ·{' '}
                        {money(order.final_total)} − {money(order.parts_cost)} ·{' '}
                        {order.commission_percent}% · Entregada: {dateTime(order.delivered_at)}
                      </p>
                    </div>
                    <strong>{money(order.commission_amount)}</strong>
                    <button
                      className="payroll-eye"
                      onClick={() => setDetailOrder(order)}
                      aria-label={`Ver ${order.order_number}`}
                    >
                      <Eye />
                    </button>
                  </article>
                ))
              )}
            </div>
            <footer>
              <Button variant="secondary" onClick={() => setAddOpen(false)}>
                Cerrar
              </Button>
              <Button
                disabled={!selectedOrders.length || busy}
                onClick={createLiquidation}
              >
                {busy ? 'Guardando pago…' : 'Pagar y guardar liquidación'}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {detailOrder && (
        <div
          className="payroll-modal-backdrop payroll-detail-backdrop"
          role="dialog"
          aria-modal="true"
        >
          <section className="payroll-detail">
            <header>
              <div>
                <h3>{detailOrder.order_number}</h3>
                <p>Detalle de la reparación</p>
              </div>
              <button onClick={() => setDetailOrder(null)} aria-label="Cerrar">
                <X />
              </button>
            </header>
            <dl>
              <div>
                <dt>Cliente</dt>
                <dd>{detailOrder.customer_name || '—'}</dd>
              </div>
              <div>
                <dt>Equipo</dt>
                <dd>
                  {[detailOrder.device_brand, detailOrder.device_model]
                    .filter(Boolean)
                    .join(' ') || '—'}
                </dd>
              </div>
              <div>
                <dt>Valor final</dt>
                <dd>{money(detailOrder.final_total)}</dd>
              </div>
              <div>
                <dt>Repuestos</dt>
                <dd>{money(detailOrder.parts_cost)}</dd>
              </div>
              <div>
                <dt>Base</dt>
                <dd>{money(detailOrder.commission_base)}</dd>
              </div>
              <div>
                <dt>Comisión</dt>
                <dd>
                  {detailOrder.commission_percent}% ·{' '}
                  {money(detailOrder.commission_amount)}
                </dd>
              </div>
              <div>
                <dt>Reparación terminada</dt>
                <dd>{dateTime(detailOrder.repair_completed_at)}</dd>
              </div>
            </dl>
            <h4>Trabajo realizado</h4>
            <p>
              {detailOrder.technical_report ||
                detailOrder.reported_issue ||
                'Sin notas registradas.'}
            </p>
          </section>
        </div>
      )}

      {receiptSettlement && (
        <div
          className="payroll-receipt-backdrop"
          role="dialog"
          aria-modal="true"
        >
          <section className="payroll-receipt print-receipt">
            <button
              className="payroll-receipt-close"
              onClick={() => setReceiptSettlement(null)}
              aria-label="Cerrar"
            >
              <X />
            </button>
            <header>
              <b>{receiptSettings.businessName}</b>
              <span>{receiptSettings.address}</span>
              <span>{receiptSettings.phone}</span>
              <h2>COMPROBANTE DE LIQUIDACIÓN</h2>
            </header>
            <div className="payroll-receipt-meta">
              <p>
                <span>Fecha</span>
                <b>
                  {new Date(receiptSettlement.created_at).toLocaleDateString(
                    'es-CO',
                  )}
                </b>
              </p>
              <p>
                <span>Hora</span>
                <b>
                  {new Date(receiptSettlement.created_at).toLocaleTimeString(
                    'es-CO',
                  )}
                </b>
              </p>
              <p>
                <span>Técnico</span>
                <b>{receiptSettlement.technician_name}</b>
              </p>
              <p>
                <span>Total de reparaciones</span>
                <b>{receiptSettlement.items.length}</b>
              </p>
            </div>
            <div className="payroll-receipt-total">
              <span>Comisión total</span>
              <strong>{money(receiptSettlement.total)}</strong>
            </div>
            <footer>
              <span>Firma del técnico</span>
              <span>Firma de quien liquida</span>
            </footer>
            <div className="payroll-receipt-actions">
              <Button
                variant="secondary"
                onClick={() => setReceiptSettlement(null)}
              >
                Cerrar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer /> Imprimir
              </Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
