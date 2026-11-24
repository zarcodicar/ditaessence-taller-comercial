"use client";

import { useEffect, useRef, useState } from "react";
import { Barcode, CreditCard, FileText, Gift, Minus, Pencil, Plus, ReceiptText, Search, ShoppingCart, Tag, Trash2, WalletCards, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_RECEIPT_SETTINGS, receiptSettings as normalizeReceiptSettings } from "./receipt-settings";
import { ServiceOrderExit } from "./ServiceOrders";

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const moneyInput = (value: string | number) => { const digits = String(value ?? '').replace(/\D/g, ''); return digits ? `$ ${Number(digits).toLocaleString('es-CO')}` : ''; };

export function PointOfSale({ cashOpen, products, cart, cartPrices = {}, setCartPrice, total, search, setSearch, add, setQty, checkout, receiptSettings = DEFAULT_RECEIPT_SETTINGS, onNotice, onCashShift }: any) {
  const receipt = normalizeReceiptSettings(receiptSettings);
  const scanRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const receiptOpenedAt = useRef(0);
  const [filter, setFilter] = useState("Todos");
  const [payment, setPayment] = useState("Efectivo");
  const [paymentMode, setPaymentMode] = useState<'single' | 'split'>('single');
  const [splitPayments, setSplitPayments] = useState<Record<string, string>>({ Efectivo: '', Tarjeta: '', Transferencia: '' });
  const [autoPrint, setAutoPrint] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingPriceFor, setEditingPriceFor] = useState<number | null>(null);
  const [editingPrice, setEditingPrice] = useState("");
  useEffect(() => {
    scanRef.current?.focus();
  }, []);
  const printReceipt = () => {
    setReceiptOpen(true);
    window.setTimeout(() => window.print(), 180);
  };
  useEffect(() => {
    if (!receiptOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReceiptOpen(false);
      if (event.key === "Enter" && Date.now() - receiptOpenedAt.current > 450) {
        event.preventDefault();
        printReceipt();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [receiptOpen]);
  const addFromCard = (productId: number) => {
    add(productId);
    setSearch("");
    window.requestAnimationFrame(() => scanRef.current?.focus());
  };
  const list = products.filter((p: any) => {
    const code = p.barcode || p.sku || "";
    const term = search.toLowerCase();
    const matches = p.name.toLowerCase().includes(term) || code.includes(search);
    return matches && (filter === "Todos" || (filter === "Bajo stock" && p.stock > 0 && p.stock <= p.min) || (filter === "Agotados" && p.stock === 0));
  });
  const lines = products.filter((p: any) => cart[p.id]);
  const splitTotal = Object.values(splitPayments).reduce((sum, value) => sum + (Number(String(value).replace(/\D/g, '')) || 0), 0);
  const splitRemaining = total - splitTotal;
  const linePrice = (product: any) => Number(cartPrices[product.id] ?? product.price);
  const openPriceEditor = (product: any) => {
    setEditingPriceFor(product.id);
    setEditingPrice(String(linePrice(product)));
  };
  const savePrice = (product: any) => {
    const next = Math.max(0, Math.min(Number(product.price) || 0, Math.round(Number(editingPrice) || 0)));
    setCartPrice(product.id, next);
    setEditingPriceFor(null);
  };
  const scan = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const code = search.trim();
    const matchingProducts = products.filter((p: any) => String(p.barcode || p.sku || '').trim().toLocaleUpperCase('es') === code.toLocaleUpperCase('es'));
    if (matchingProducts.length > 1) {
      event.preventDefault();
      onNotice?.(`No se puede agregar “${code}”: ese código está repetido en ${matchingProducts.length} productos. Corrígelo en Inventario antes de vender.`);
      return;
    }
    const product = matchingProducts[0];
    if (product && product.stock > 0) {
      event.preventDefault();
      add(product.id);
      setSearch("");
    } else if (!code && lines.length) {
      event.preventDefault();
      void complete();
    }
  };
  const complete = async () => {
    if (!cashOpen || !lines.length || busy) return;
    const paymentBreakdown = paymentMode === 'split'
      ? Object.fromEntries(Object.entries(splitPayments).map(([method, value]) => [method, Number(String(value).replace(/\D/g, '')) || 0]).filter(([, amount]) => amount > 0))
      : { [payment]: total };
    if (paymentMode === 'split' && (splitRemaining !== 0 || !Object.keys(paymentBreakdown).length)) {
      onNotice?.(splitRemaining > 0 ? `Faltan ${money.format(splitRemaining)} por asignar entre los medios de pago.` : `Los medios de pago superan el total por ${money.format(Math.abs(splitRemaining))}.`);
      return;
    }
    setBusy(true);
    const saleDate = new Date();
    const soldItems = lines.map((p: any) => ({
      id: p.id,
      name: p.name,
      qty: cart[p.id],
      price: linePrice(p),
      originalPrice: p.price,
      discount: Math.max(0, p.price - linePrice(p)),
      isGift: linePrice(p) === 0,
      cost: p.cost || 0,
    }));
    try {
      const paymentName = paymentMode === 'split' ? 'Pago dividido' : payment;
      const saved = await checkout(paymentName, soldItems, paymentBreakdown);
      if (saved === false) return;
      const savedSale = typeof saved === "object" ? saved : null;
      setLastReceipt({
        number: savedSale?.number || "",
        lines: savedSale?.items || soldItems,
        total: savedSale?.total ?? total,
        payment: savedSale?.payment || paymentName,
        paymentBreakdown: savedSale?.paymentBreakdown || paymentBreakdown,
        date: new Date(savedSale?.createdAt || saleDate),
      });
      if (autoPrint) printReceipt();
      else {
        receiptOpenedAt.current = Date.now();
        setReceiptOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pos-layout">
      <section className="pos-products">
        {!cashOpen && <div className="pos-cash-required">La caja está cerrada. Abre caja antes de registrar ventas.</div>}
        <div className="pos-search-row">
          <label className="pos-search">
            <Search />
            <input ref={scanRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={scan} autoComplete="off" placeholder="Escanea un código o busca por nombre..." />
            <span>
              <Barcode /> Lector listo
            </span>
          </label>
          <div className="pos-filters">
            {["Todos", "Inventario", "Bajo stock", "Agotados"].map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item === "Inventario" ? "Todos" : item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="pos-availability">
          <b>{list.filter((p: any) => p.stock > 0).length} disponibles</b>
          <span>Escanea + Enter para agregar. Con el campo vacío, Enter cobra la venta.</span>
        </div>
        <div className="pos-grid">
          {list.map((p: any) => (
            <article key={p.id} className="pos-card pos-card-clickable" onClick={() => p.stock && addFromCard(p.id)}>
              {p.image ? <img src={p.image} alt={p.name} /> : <div className="pos-card-image">{p.name.slice(0, 1)}</div>}
              <h3>{p.name}</h3>
              <p>{p.barcode || p.sku || "Sin código"}</p>
              <div className="pos-card-price">
                <small>Stock: {p.stock}</small>
                <strong>{money.format(p.price)}</strong>
              </div>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  addFromCard(p.id);
                }}
                disabled={!p.stock}
                className="pos-add"
              >
                <Plus />
                Agregar
              </Button>
            </article>
          ))}
        </div>
        {!list.length && <div className="pos-no-results">No se encontraron productos.</div>}
      </section>
      <aside ref={cartRef} className="pos-cart">
        <div className="pos-cart-title">
          <div>
            <ShoppingCart />
            <div>
              <b>Carrito de venta</b>
              <small>{lines.length ? `${lines.length} productos agregados` : "Listo para escanear"}</small>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => Object.keys(cart).forEach((id) => setQty(Number(id), 0))}>
            <Trash2 />
            Vaciar
          </Button>
        </div>
        <ServiceOrderExit receiptSettings={receipt} onNotice={onNotice} onCashShift={onCashShift || (() => {})} />
        <div className="pos-summary">
          <label className="pos-invoice">
            <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
            <FileText />
            Imprimir recibo automáticamente
          </label>
          {lastReceipt && (
            <Button variant="outline" className="pos-print" onClick={printReceipt}>
              <FileText />
              Imprimir último recibo
            </Button>
          )}
          <div>
            <span>Subtotal</span>
            <b>{money.format(total)}</b>
          </div>
          <div>
            <span>Productos</span>
            <b>{lines.reduce((sum: number, p: any) => sum + cart[p.id], 0)} uds</b>
          </div>
          <div className="pos-total">
            <span>Total</span>
            <strong>{money.format(total)}</strong>
          </div>
          <div className="pos-payments">
            {[
              ["Efectivo", WalletCards],
              ["Tarjeta", CreditCard],
              ["Transferencia", ReceiptText],
            ].map(([name, Icon]: any) => (
              <button key={name} className={paymentMode === 'single' && payment === name ? "active" : ""} onClick={() => { setPaymentMode('single'); setPayment(name); }}>
                <Icon />
                {name}
              </button>
            ))}
          </div>
          <button className={`pos-split-toggle ${paymentMode === 'split' ? 'active' : ''}`} onClick={() => setPaymentMode(old => old === 'split' ? 'single' : 'split')}>
            <WalletCards /> Pago dividido
          </button>
          {paymentMode === 'split' && (
            <div className="pos-split-payments">
              <b>Divide el total</b>
              {['Efectivo', 'Tarjeta', 'Transferencia'].map((method) => (
                <label key={method}><span>{method}</span><input inputMode="numeric" value={moneyInput(splitPayments[method])} onChange={(event) => setSplitPayments(old => ({ ...old, [method]: event.target.value.replace(/\D/g, '') }))} placeholder="$ 0" /></label>
              ))}
              <p className={splitRemaining === 0 ? 'complete' : splitRemaining < 0 ? 'over' : ''}>{splitRemaining === 0 ? 'Total completo' : splitRemaining > 0 ? `Faltan ${money.format(splitRemaining)}` : `Sobran ${money.format(Math.abs(splitRemaining))}`}</p>
            </div>
          )}
          <Button className="pos-charge" disabled={busy || !cashOpen || !lines.length} onClick={() => void complete()}>
            <ShoppingCart />
            {busy ? "Registrando…" : cashOpen ? `Cobrar ${money.format(total)}` : "Abre caja para cobrar"}
          </Button>
        </div>
        <div className="pos-lines">
          {lines.length ? (
            lines.map((p: any) => (
              <div className="pos-line" key={p.id}>
                {p.image ? <img src={p.image} alt="" /> : <div>{p.name.slice(0, 1)}</div>}
                <section>
                  <b>{p.name}</b>
                  <small>{linePrice(p) === 0 ? "Obsequio" : linePrice(p) < p.price ? `${money.format(linePrice(p))} · antes ${money.format(p.price)}` : money.format(p.price)}</small>
                  <div className="pos-quantity">
                    <button aria-label={`Restar ${p.name}`} onClick={() => setQty(p.id, cart[p.id] - 1)}>
                      <Minus />
                    </button>
                    <span>{cart[p.id]}</span>
                    <button aria-label={`Sumar ${p.name}`} onClick={() => setQty(p.id, cart[p.id] + 1)}>
                      <Plus />
                    </button>
                  </div>
                </section>
                <div className="pos-line-price">
                  <strong>{money.format(linePrice(p) * cart[p.id])}</strong>
                  <button className="pos-edit-price" onClick={() => openPriceEditor(p)} aria-label={`Editar precio de ${p.name}`}><Pencil /></button>
                </div>
                {editingPriceFor === p.id && (
                  <div className="pos-price-editor">
                    <label>Precio final por unidad
                      <input inputMode="numeric" value={moneyInput(editingPrice)} onChange={(event) => setEditingPrice(event.target.value.replace(/\D/g, ""))} placeholder="$ 0" autoFocus />
                    </label>
                    <div>
                      <Button size="sm" variant="outline" onClick={() => setEditingPriceFor(null)}>Cancelar</Button>
                      <Button size="sm" onClick={() => savePrice(p)}><Tag />Guardar</Button>
                      <Button size="sm" className="pos-gift" onClick={() => { setCartPrice(p.id, 0); setEditingPriceFor(null); }}><Gift />Obsequio</Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="pos-empty">
              <Barcode />
              <p>Escanea un producto para iniciar la venta.</p>
            </div>
          )}
        </div>
      </aside>
      {lines.length > 0 && (
        <button
          className="mobile-cart-dock"
          onClick={() =>
            cartRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
        >
          <span>
            <ShoppingCart />
            {lines.reduce((sum: number, p: any) => sum + cart[p.id], 0)} uds
          </span>
          <b>{money.format(total)}</b>
          <small>Ver carrito</small>
        </button>
      )}
      {receiptOpen && lastReceipt && (
        <div className="pos-receipt-backdrop" onMouseDown={() => setReceiptOpen(false)}>
          <section className="pos-receipt print-receipt" role="dialog" aria-modal="true" aria-label="Recibo de venta" onMouseDown={(event) => event.stopPropagation()}>
            <button className="pos-close print-hide" onClick={() => setReceiptOpen(false)} aria-label="Cerrar recibo">
              <X />
            </button>
            <header className="thermal-receipt-header">
              <b>{receipt.businessName}</b>
              {(receipt.address || receipt.phone) && <div className="thermal-receipt-business">{receipt.address && <span>{receipt.address}</span>}{receipt.phone && <span>Tel. {receipt.phone}</span>}</div>}
              <h2>Comprobante de venta</h2>
              {lastReceipt.number && <p>{lastReceipt.number}</p>}
            </header>
            <div className="thermal-receipt-meta">
              <p>
                <span>Fecha</span>
                <b>{lastReceipt.date.toLocaleDateString("es-CO")}</b>
              </p>
              <p>
                <span>Hora</span>
                <b>
                  {lastReceipt.date.toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </b>
              </p>
              <p>
                <span>Pago</span>
                <b>{lastReceipt.payment}</b>
              </p>
              {lastReceipt.paymentBreakdown && Object.entries(lastReceipt.paymentBreakdown).filter(([, amount]: any) => Number(amount) > 0).map(([method, amount]: any) => <p key={method}><span>{method}</span><b>{money.format(Number(amount))}</b></p>)}
            </div>
            <div className="thermal-receipt-items">
              <div className="thermal-receipt-columns">
                <span>Producto</span>
                <span>Cant. × precio</span>
                <span>Total</span>
              </div>
              {lastReceipt.lines.map((line: any) => (
                <article key={line.id}>
                  <b>{line.name}</b>
                  <div>
                    <span>
                      {line.qty} × {line.isGift ? "Obsequio" : money.format(line.price)}
                    </span>
                    <strong>{line.isGift ? "$ 0" : money.format(line.qty * line.price)}</strong>
                  </div>
                </article>
              ))}
            </div>
            <div className="thermal-receipt-total">
              <span>Total</span>
              <strong>{money.format(lastReceipt.total)}</strong>
            </div>
            <section className="thermal-receipt-policy">
              <p>{receipt.warranty}</p>
            </section>
            <footer className="thermal-receipt-footer">
              <p>{receipt.thankYou}</p>
              <small>Conserve este comprobante.</small>
            </footer>
            <p className="receipt-screen-help print-hide">Presiona Enter para imprimir o Esc para cerrar.</p>
            <Button className="print-hide" onClick={printReceipt}>
              <FileText />
              Imprimir recibo
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
