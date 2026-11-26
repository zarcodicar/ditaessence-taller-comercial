// A liquidation reviews the selected work and records the technician payment atomically.
export async function ensureLedger(db:any) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS pos_technician_settlements (
    id BIGSERIAL PRIMARY KEY, technician_id BIGINT NOT NULL, technician_name TEXT NOT NULL,
    total BIGINT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    created_by TEXT NOT NULL, paid_at TEXT, paid_by TEXT, payment_method TEXT, shift_id BIGINT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS pos_technician_settlement_items (
    id BIGSERIAL PRIMARY KEY, settlement_id BIGINT NOT NULL REFERENCES pos_technician_settlements(id),
    order_id BIGINT NOT NULL UNIQUE, order_number TEXT NOT NULL, final_total BIGINT NOT NULL,
    parts_cost BIGINT NOT NULL, commission_percent REAL NOT NULL, commission_amount BIGINT NOT NULL
  )`).run();
}

export async function readLedger(db:any, from:string, to:string, timeZone='UTC', businessId=1) {
  const technicians = await db.prepare(`SELECT e.id,e.name,e.active,c.commission_percent
    FROM pos_employees e LEFT JOIN pos_service_technician_commissions c ON c.technician_id=e.id
    WHERE e.business_id=? AND e.is_technician=1 ORDER BY e.active DESC,e.name`).bind(businessId).all();
  const orders = await db.prepare(`SELECT o.id,o.order_number,o.customer_name,o.device_brand,o.device_model,
    o.reported_issue,o.technical_report,o.technician_user_id,o.technician_name,o.final_total,o.parts_cost,
    o.commission_base,o.commission_percent,o.commission_amount,o.commission_status,o.repair_completed_at,o.delivered_at,
    i.settlement_id FROM pos_service_orders o LEFT JOIN pos_technician_settlement_items i ON i.order_id=o.id
    WHERE o.business_id=? AND o.commission_status IN ('pending','paid')
    AND (?='' OR (o.delivered_at::timestamptz AT TIME ZONE ?)::date>=CAST(NULLIF(?,'') AS date))
    AND (?='' OR (o.delivered_at::timestamptz AT TIME ZONE ?)::date<=CAST(NULLIF(?,'') AS date))
    ORDER BY o.delivered_at,o.id`).bind(businessId,from,timeZone,from,to,timeZone,to).all();
  const settlements = await db.prepare(`SELECT * FROM pos_technician_settlements
    WHERE business_id=? AND (?='' OR (created_at::timestamptz AT TIME ZONE ?)::date>=CAST(NULLIF(?,'') AS date))
    AND (?='' OR (created_at::timestamptz AT TIME ZONE ?)::date<=CAST(NULLIF(?,'') AS date))
    ORDER BY id DESC`).bind(businessId,from,timeZone,from,to,timeZone,to).all();
  const items = await db.prepare(`SELECT i.* FROM pos_technician_settlement_items i
    JOIN pos_technician_settlements s ON s.id=i.settlement_id
    WHERE s.business_id=? AND (?='' OR (s.created_at::timestamptz AT TIME ZONE ?)::date>=CAST(NULLIF(?,'') AS date))
    AND (?='' OR (s.created_at::timestamptz AT TIME ZONE ?)::date<=CAST(NULLIF(?,'') AS date))
    ORDER BY i.id`).bind(businessId,from,timeZone,from,to,timeZone,to).all();
  return {technicians:technicians.results,orders:orders.results,settlements:settlements.results,items:items.results};
}

function ids(values:unknown):number[] {
  if (!Array.isArray(values) || !values.length || values.length>500) throw new Error('Selecciona entre 1 y 500 registros.');
  const result=[...new Set(values.map(Number))];
  if(result.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error('Selección no válida.');
  return result;
}

export async function createSettlement(db:any, data:any, actor:any) {
  const selected=ids(data.orderIds), technicianId=Number(data.technicianId),method=String(data.paymentMethod||'');
  const businessId=Number(actor.businessId||1);
  if(!['Efectivo','Tarjeta','Transferencia'].includes(method)) throw new Error('Selecciona el medio usado para pagar al técnico.');
  return db.transaction(async(tx:any)=>{
    // Serializes retries so an order cannot be liquidated and paid twice.
    await tx.prepare('SELECT pg_advisory_xact_lock(781235)').first();
    const rows=await tx.prepare(`SELECT * FROM pos_service_orders WHERE business_id=? AND id IN (${selected.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`).bind(businessId,...selected).all();
    if(rows.results.length!==selected.length) throw new Error('Alguna orden ya no existe. Actualiza la lista.');
    for(const order of rows.results) {
      if(Number(order.technician_user_id)!==technicianId || order.status!=='Entregado' || order.commission_status!=='pending') throw new Error('Solo puedes liquidar órdenes entregadas y pendientes del mismo técnico.');
      if(await tx.prepare('SELECT id FROM pos_technician_settlement_items WHERE order_id=?').bind(order.id).first()) throw new Error('Una orden ya está liquidada. Actualiza la lista.');
    }
    const total=rows.results.reduce((sum:number,o:any)=>sum+Number(o.commission_amount),0),at=new Date().toISOString();
    const shift=method==='Efectivo'?await tx.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE").bind(businessId).first():null;
    if(method==='Efectivo'&&!shift) throw new Error('Abre caja antes de liquidar en efectivo.');
    const created=await tx.prepare(`INSERT INTO pos_technician_settlements (business_id,technician_id,technician_name,total,note,created_at,created_by,paid_at,paid_by,payment_method,shift_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(businessId,technicianId,rows.results[0].technician_name,total,String(data.note||'').slice(0,2000),at,actor.name,at,actor.name,method,shift?.id||null).run();
    for(const o of rows.results) await tx.prepare(`INSERT INTO pos_technician_settlement_items (business_id,settlement_id,order_id,order_number,final_total,parts_cost,commission_percent,commission_amount) VALUES (?,?,?,?,?,?,?,?) RETURNING id`).bind(businessId,created.meta.last_row_id,o.id,o.order_number,o.final_total,o.parts_cost,o.commission_percent,o.commission_amount).run();
    await tx.prepare("UPDATE pos_service_orders SET commission_status='paid',commission_paid_at=?,commission_paid_by_name=? WHERE business_id=? AND id IN (SELECT order_id FROM pos_technician_settlement_items WHERE settlement_id=?)").bind(at,actor.name,businessId,created.meta.last_row_id).run();
    if(shift&&total>0){
      await tx.prepare('UPDATE pos_cash_shifts SET cash_outs=cash_outs+? WHERE id=?').bind(total,shift.id).run();
      await tx.prepare("INSERT INTO pos_cash_movements (shift_id,type,amount,reason,actor_name,created_at) VALUES (?,'out',?,?,?,?) RETURNING id").bind(shift.id,total,`Liquidación pagada a ${rows.results[0].technician_name} · #${created.meta.last_row_id}`,actor.name,at).run();
    }
    return {id:created.meta.last_row_id,total};
  });
}

export async function paySettlements(db:any, data:any, actor:any) {
  const selected=ids(data.settlementIds), method=String(data.paymentMethod||'');
  const businessId=Number(actor.businessId||1);
  if(!['Efectivo','Tarjeta','Transferencia'].includes(method)) throw new Error('Selecciona un medio de pago.');
  return db.transaction(async(tx:any)=>{
    await tx.prepare('SELECT pg_advisory_xact_lock(781235)').first();
    const rows=await tx.prepare(`SELECT * FROM pos_technician_settlements WHERE business_id=? AND id IN (${selected.map(()=>'?').join(',')}) ORDER BY id FOR UPDATE`).bind(businessId,...selected).all();
    if(rows.results.length!==selected.length || rows.results.some((s:any)=>s.paid_at)) throw new Error('Alguna liquidación ya fue pagada o no existe. Actualiza la lista.');
    if(new Set(rows.results.map((s:any)=>Number(s.technician_id))).size!==1) throw new Error('Selecciona liquidaciones de un solo técnico.');
    const shift=method==='Efectivo'?await tx.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE").bind(businessId).first():null;
    if(method==='Efectivo'&&!shift) throw new Error('Abre caja antes de pagar en efectivo.');
    const at=new Date().toISOString(),total=rows.results.reduce((sum:number,s:any)=>sum+Number(s.total),0);
    for(const s of rows.results) {
      await tx.prepare('UPDATE pos_technician_settlements SET paid_at=?,paid_by=?,payment_method=?,shift_id=? WHERE business_id=? AND id=?').bind(at,actor.name,method,shift?.id||null,businessId,s.id).run();
      await tx.prepare("UPDATE pos_service_orders SET commission_status='paid',commission_paid_at=?,commission_paid_by_name=? WHERE business_id=? AND id IN (SELECT order_id FROM pos_technician_settlement_items WHERE settlement_id=?)").bind(at,actor.name,businessId,s.id).run();
    }
    if(shift && total>0) {
      await tx.prepare("UPDATE pos_cash_shifts SET cash_outs=cash_outs+? WHERE id=?").bind(total,shift.id).run();
      await tx.prepare("INSERT INTO pos_cash_movements (shift_id,type,amount,reason,actor_name,created_at) VALUES (?,'out',?,?,?,?) RETURNING id").bind(shift.id,total,`Pago a ${rows.results[0].technician_name} · Liquidaciones ${selected.join(', ')}`,actor.name,at).run();
    }
    return {total};
  });
}
