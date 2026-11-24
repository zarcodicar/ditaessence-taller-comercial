"use client";

import { useMemo, useState } from "react";
import { ReceiptText, Search, Trash2, X } from "lucide-react";
import { DateRangePicker } from "./DateRangePicker";
import { DEFAULT_RECEIPT_SETTINGS, receiptSettings as normalizeReceiptSettings } from "./receipt-settings";

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function SalesHistory({ sales, onDelete, isWorker, onNotify, canDelete = true, receiptSettings = DEFAULT_RECEIPT_SETTINGS }: any) {
  const receipt = normalizeReceiptSettings(receiptSettings);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = useMemo(() => sales.filter((sale: any) => (!from || sale.date >= from) && (!to || sale.date <= to) && `${sale.number} ${sale.payment} ${sale.items.map((item: any) => item.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())), [sales, from, to, query]);
  const total = filtered.reduce((sum: number, sale: any) => sum + sale.total, 0);
  const askDelete = (sale: any) => {
    setDeleting(sale);
    setReason("");
  };
  const printSale = (sale: any) => {
    setDetail(sale);
    window.setTimeout(() => window.print(), 180);
  };
  const confirmDelete = async () => {
    if (!deleting || (isWorker && !reason.trim())) return;
    await onDelete?.(deleting);
    if (isWorker)
      onNotify?.({
        type: "Anulación de venta",
        severity: "critical",
        text: `Se anuló ${deleting.number} por ${money.format(deleting.total)}. Motivo: ${reason.trim()}.`,
        entityType: "Venta anulada",
        entityId: deleting.number,
        details: {
          motivo: reason.trim(),
          total: money.format(deleting.total),
          pago: deleting.payment,
          productos: `${deleting.items.length} artículo(s)`,
        },
      });
    setDetail(null);
    setDeleting(null);
  };
  const toggleSale = (number: string) => setSelected(old => old.includes(number) ? old.filter(item => item !== number) : [...old, number]);
  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map((sale: any) => sale.number));
  const deleteSelected = async () => { const chosen = filtered.filter((sale: any) => selected.includes(sale.number)); if (!chosen.length || !window.confirm(`¿Borrar ${chosen.length} venta${chosen.length === 1 ? '' : 's'} seleccionada${chosen.length === 1 ? '' : 's'}?`)) return; for (const sale of chosen) await onDelete?.(sale); setSelected([]); };
  const actions = (sale: any) => (
    <>
      <button onClick={() => setDetail(sale)}>
        <Search /> Ver
      </button>
      <button onClick={() => printSale(sale)}>
        <ReceiptText /> Recibo
      </button>
      {canDelete && (
        <button className="sale-delete" onClick={() => askDelete(sale)}>
          <Trash2 /> Borrar
        </button>
      )}
    </>
  );
  return (
    <section className="sales-history">
      <div className="sales-head">
        <div>
          <h2>Ventas realizadas</h2>
          <p>Consulta, filtra, imprime o anula ventas registradas.</p>
        </div>
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </div>
      <div className="sales-search">
        <Search />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por recibo, producto o método de pago..." />
        <b>
          {filtered.length} ventas · {money.format(total)}
        </b>
      </div>
      {canDelete && <div className="sales-bulk-actions"><label><input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={toggleAll} /> Seleccionar todo</label><button className="sale-delete" disabled={!selected.length} onClick={deleteSelected}><Trash2 /> Borrar seleccionadas ({selected.length})</button></div>}
      <div className="sales-table">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={filtered.length > 0 && selected.length === filtered.length} onChange={toggleAll} aria-label="Seleccionar todas las ventas" /> Recibo</th>
              <th>Fecha</th>
              <th>Productos</th>
              <th>Pago</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((sale: any) => (
              <tr key={sale.number}>
                <td data-label="Recibo">
                  <input type="checkbox" checked={selected.includes(sale.number)} onChange={() => toggleSale(sale.number)} aria-label={`Seleccionar ${sale.number}`} />
                  <b>{sale.number}</b>
                </td>
                <td data-label="Fecha">{new Date(sale.createdAt).toLocaleString("es-CO")}</td>
                <td data-label="Productos">{sale.items.length} productos</td>
                <td data-label="Pago">{sale.payment}</td>
                <td data-label="Total">
                  <b>{money.format(sale.total)}</b>
                </td>
                <td className="sales-actions">{actions(sale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="sales-empty">No hay ventas para los filtros elegidos.</p>}
      </div>
      {detail && (
        <div className="sale-detail-backdrop">
          <section className="sale-detail sale-receipt print-receipt">
            <button className="print-hide" onClick={() => setDetail(null)}>
              <X />
            </button>
            <header className="thermal-receipt-header">
              <b>{receipt.businessName}</b>
              {(receipt.address || receipt.phone) && <div className="thermal-receipt-business">{receipt.address && <span>{receipt.address}</span>}{receipt.phone && <span>Tel. {receipt.phone}</span>}</div>}
              <h2>Comprobante de venta</h2>
              <p>{detail.number}</p>
            </header>
            <div className="thermal-receipt-meta">
              <p>
                <span>Fecha</span>
                <b>{new Date(detail.createdAt).toLocaleDateString("es-CO")}</b>
              </p>
              <p>
                <span>Hora</span>
                <b>
                  {new Date(detail.createdAt).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </b>
              </p>
              <p>
                <span>Pago</span>
                <b>{detail.payment}</b>
              </p>
            </div>
            <div className="thermal-receipt-items">
              <div className="thermal-receipt-columns">
                <span>Producto</span>
                <span>Cant. × precio</span>
                <span>Total</span>
              </div>
              {detail.items.map((item: any) => (
                <article key={item.id}>
                  <b>{item.name}</b>
                  <div>
                    <span>
                      {item.qty} × {money.format(item.price)}
                    </span>
                    <strong>{money.format(item.qty * item.price)}</strong>
                  </div>
                </article>
              ))}
            </div>
            <div className="thermal-receipt-total">
              <span>Total</span>
              <strong>{money.format(detail.total)}</strong>
            </div>
            <section className="thermal-receipt-policy">
              <p>{receipt.warranty}</p>
            </section>
            <footer className="thermal-receipt-footer">
              <p>{receipt.thankYou}</p>
              <small>Conserve este comprobante.</small>
            </footer>
            <button className="sale-print print-hide" onClick={() => window.print()}>
              <ReceiptText /> Imprimir recibo
            </button>
            {canDelete && (
              <button className="sale-delete sale-delete-wide print-hide" onClick={() => askDelete(detail)}>
                <Trash2 /> Borrar venta
              </button>
            )}
          </section>
        </div>
      )}
      {deleting && (
        <div className="sale-detail-backdrop">
          <section className="delete-dialog">
            <Trash2 />
            <h2>¿Anular venta {deleting.number}?</h2>
            <p>Se restaurará el inventario y se ajustará la caja. Esta acción no se puede deshacer.</p>
            {isWorker && (
              <label>
                Motivo obligatorio
                <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explica por qué se anula esta venta" />
              </label>
            )}
            <div>
              <button className="settings-secondary" onClick={() => setDeleting(null)}>
                Cancelar
              </button>
              <button className="sale-delete sale-delete-wide" disabled={isWorker && !reason.trim()} onClick={confirmDelete}>
                <Trash2 /> Confirmar anulación
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
