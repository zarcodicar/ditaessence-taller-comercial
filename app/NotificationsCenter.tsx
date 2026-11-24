'use client';

import { Bell, CheckCheck, ChevronRight, CircleAlert, Info, ShieldAlert, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

export type PosNotification = {
  id: number;
  type: string;
  severity?: 'info' | 'warning' | 'critical';
  message: string;
  actor_name: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: string | Record<string, unknown>;
  created_at?: string;
  createdAt?: string;
  read_at?: string | null;
  readAt?: string | null;
};

const date = (item: PosNotification) => new Date(item.created_at || item.createdAt || Date.now()).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const detailData = (item: PosNotification) => {
  if (!item.details) return {};
  if (typeof item.details !== 'string') return item.details;
  try { return JSON.parse(item.details); } catch { return {}; }
};
const icon = (severity?: string) => severity === 'critical' ? <ShieldAlert /> : severity === 'warning' ? <CircleAlert /> : <Info />;

export function NotificationBell({ notifications, onOpen }: { notifications: PosNotification[]; onOpen: () => void }) {
  const pending = notifications.filter(item => !(item.read_at || item.readAt)).length;
  return <button aria-label="Abrir centro de notificaciones" className="notification-bell" onClick={onOpen}><Bell />{pending > 0 && <i>{pending > 9 ? '9+' : pending}</i>}</button>;
}

export function NotificationsCenter({ notifications, onMarkRead, onDelete }: { notifications: PosNotification[]; onMarkRead: (ids?: number[]) => Promise<void>; onDelete: (id: number) => Promise<void> }) {
  const [selected, setSelected] = useState<PosNotification | null>(null);
  const [deleting, setDeleting] = useState<PosNotification | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const visible = useMemo(() => notifications.filter(item => filter === 'all' || filter === 'unread' ? filter === 'all' || !(item.read_at || item.readAt) : item.severity === 'critical'), [filter, notifications]);
  const open = async (item: PosNotification) => { setSelected(item); if (!(item.read_at || item.readAt)) await onMarkRead([item.id]); };
  const details = selected ? detailData(selected) : {};
  return <section className="notifications-view">
    <div className="notifications-heading"><div><p className="eyebrow">Actividad del negocio</p><h2>Notificaciones</h2><p>Revisa eventos importantes, abre su detalle o limpia los avisos que ya no necesitas conservar.</p></div><button className="notifications-read-all" onClick={() => onMarkRead()}><CheckCheck /> Marcar leídas</button></div>
    <div className="notification-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <b>{notifications.length}</b></button><button className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>Sin leer <b>{notifications.filter(item => !(item.read_at || item.readAt)).length}</b></button><button className={filter === 'critical' ? 'active' : ''} onClick={() => setFilter('critical')}>Críticas</button></div>
    <div className="notification-list">{visible.length ? visible.map(item => <article className={`notification-row ${item.severity || 'info'} ${!(item.read_at || item.readAt) ? 'unread' : ''}`} key={item.id}><button className="notification-open" onClick={() => open(item)}><span className="notification-icon">{icon(item.severity)}</span><span><b>{item.type}</b><small>{item.actor_name} · {date(item)}</small><p>{item.message}</p></span><ChevronRight /></button><button className="notification-delete" aria-label={`Eliminar ${item.type}`} onClick={() => setDeleting(item)}><Trash2 /></button></article>) : <div className="notification-empty"><Bell /><b>No hay notificaciones en este filtro.</b><p>Los avisos operativos aparecerán aquí y se conservarán como historial.</p></div>}</div>
    {selected && <div className="notification-detail-backdrop" onMouseDown={() => setSelected(null)}><section className="notification-detail" onMouseDown={event => event.stopPropagation()}><button className="notification-close" aria-label="Cerrar detalle" onClick={() => setSelected(null)}><X /></button><div className={`notification-detail-icon ${selected.severity || 'info'}`}>{icon(selected.severity)}</div><p className="eyebrow">{selected.severity === 'critical' ? 'Revisión requerida' : 'Actividad registrada'}</p><h2>{selected.type}</h2><p className="notification-detail-message">{selected.message}</p><dl><div><dt>Registrado por</dt><dd>{selected.actor_name}</dd></div><div><dt>Fecha y hora</dt><dd>{date(selected)}</dd></div>{selected.entity_type && <div><dt>Movimiento</dt><dd>{selected.entity_type}{selected.entity_id ? ` · ${selected.entity_id}` : ''}</dd></div>}{Object.entries(details).filter(([, value]) => value !== '' && value !== null && value !== undefined).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{String(value)}</dd></div>)}</dl></section></div>}
    {deleting && <div className="notification-detail-backdrop" onMouseDown={() => setDeleting(null)}><section className="notification-confirm" onMouseDown={event => event.stopPropagation()}><div className="notification-confirm-icon"><Trash2 /></div><h2>¿Eliminar notificación?</h2><p>Se eliminará “{deleting.type}” de tu historial. Esta acción no se puede deshacer.</p><div><button onClick={() => setDeleting(null)}>Cancelar</button><button className="confirm-delete" onClick={async () => { await onDelete(deleting.id); setSelected(null); setDeleting(null); }}>Eliminar notificación</button></div></section></div>}
  </section>;
}
