// Run with CELLHOUSE_TEST_DEPS pointing at an isolated install of @electric-sql/pglite.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import ts from 'typescript';
const req=createRequire(process.env.CELLHOUSE_TEST_DEPS+'/package.json');
const {PGlite}=req('@electric-sql/pglite');
const pg=new PGlite();
function db(client){
 return {prepare(query){let values=[];return {bind(...v){values=v;return this},async execute(target=client){
  // Single-connection test engine: PostgreSQL advisory locking is tested on deployment.
  if(query.includes('pg_advisory_xact_lock'))return {rows:[]};
  let i=0,q=query.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi,'BIGSERIAL PRIMARY KEY').replace(/\?/g,()=>'$'+(++i));
  if(/^\s*insert\s+into/i.test(q)&&!(/\breturning\b/i.test(q)))q+=' RETURNING id';
  return target.query(q,values);
 },async first(){return (await this.execute()).rows[0]||null},async all(){return {results:(await this.execute()).rows}},async run(target=client){const r=await this.execute(target);return {meta:{last_row_id:r.rows[0]?.id,changes:r.affectedRows}}}}},
 async batch(statements){return client.transaction(async tx=>{const out=[];for(const s of statements)out.push(await s.run(tx));return out})},
 async transaction(fn){return client.transaction(tx=>fn(db(tx)))}};
}
globalThis.workshopTestDB=db(pg);
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const receipt=moduleURL(await readFile(new URL('../app/receipt-settings.ts',import.meta.url),'utf8'));
const ledger=moduleURL(await readFile(new URL('../db/technician-ledger.ts',import.meta.url),'utf8'));
let source=await readFile(new URL('../app/api/auth/route.ts',import.meta.url),'utf8');
source=source.replace("import { env } from '@/db/railway';","const env={DB:globalThis.workshopTestDB};").replace("'@/db/technician-ledger'",JSON.stringify(ledger)).replace("'../../receipt-settings'",JSON.stringify(receipt));
const {GET,POST}=await import(moduleURL(source));
await GET(new Request('http://localhost/api/auth'));
await pg.exec("INSERT INTO pos_users(name,username,password_hash,role,permissions,created_at) VALUES ('Test owner','test','unused','owner','[]','2026-09-08'); INSERT INTO pos_sessions(id,user_id,expires_at,created_at) VALUES ('test-session',1,'2099-01-01','2026-09-08');");
async function post(body,ok=true){const r=await POST(new Request('http://localhost/api/auth',{method:'POST',headers:{cookie:'cellhouse_session=test-session','Content-Type':'application/json'},body:JSON.stringify(body)}));const d=await r.json();if(ok)assert.equal(r.ok,true,JSON.stringify(d));else assert.equal(r.ok,false);return d;}
async function get(resource){const r=await GET(new Request('http://localhost/api/auth?resource='+resource,{headers:{cookie:'cellhouse_session=test-session'}}));assert.equal(r.ok,true);return r.json();}
await post({action:'open-cash',openingAmount:0});
await post({action:'create-employee',name:'Test technician',position:'Técnico',isTechnician:true});
const tech=(await get('employees')).employees[0].id;
await post({action:'save-service-technician-commission',technicianId:tech,commissionPercent:50});
const orderData={action:'create-service-order',clientId:'test-order',technicianUserId:tech,customerName:'Test client',customerPhone:'000',deviceBrand:'Test',deviceModel:'Test',reportedIssue:'Screen',estimatedTotal:500000,initialPayment:100000,estimatedDeliveryAt:'2026-09-10T15:30',photos:['data:image/jpeg;base64,/9j/2Q==']};
const created=await post(orderData),id=created.order.id;
assert.equal(created.order.order_number,'001','service order codes must be numeric and start at 001');
assert.equal(Number(created.cashShift.repair_cash_income),100000);
await post(orderData);
const received=(await get('service-orders')).orders[0];
assert.equal(Number(received.paid_total),100000,'retry must not duplicate deposit');
assert.equal(received.technician_user_id,null,'reception must not assign a technician');
await post({action:'update-service-status',orderId:id,status:'Reparado / listo para entregar'},false);
await post({action:'update-service-status',orderId:id,status:'Entregado',deliveryRecipient:'Test client',finalTotal:500000,partsCost:100000,paymentMethod:'Efectivo'},false);
await post({action:'process-service-order',orderId:id,diagnosis:'Screen broken',technicalReport:'Screen replaced',finalTotal:500000,partsCost:100000,markReady:true},false);
await post({action:'process-service-order',orderId:id,technicianUserId:tech,diagnosis:'Screen broken',technicalReport:'Screen replaced',finalTotal:500000,partsCost:100000,markReady:true});
const ready=(await get('service-orders')).orders[0];
assert.equal(ready.status,'Reparado / listo para entregar');
assert.equal(Number(ready.technician_user_id),Number(tech),'technician must claim the repaired order');
assert.ok(ready.repair_completed_at,'repair completion time must be stored automatically');
assert.equal(ready.commission_status,'not_applicable','commission must not exist before customer pickup');
await post({action:'create-technician-settlement',technicianId:tech,orderIds:[id]},false);
const delivered=await post({action:'update-service-status',orderId:id,status:'Entregado',deliveryRecipient:'Test client',finalTotal:500000,partsCost:100000,paymentMethod:'Efectivo'});
assert.equal(Number(delivered.cashShift.repair_cash_income),500000);
const order=(await get('service-orders')).orders[0];
assert.equal(Number(order.commission_amount),200000);assert.equal(Number(order.paid_total),500000);
await pg.exec(`UPDATE pos_service_orders SET delivered_at='2026-09-09T01:00:00.000Z',commission_settled_at='2026-09-09T01:00:00.000Z' WHERE id=${Number(id)}`);
const localLedgerResponse=await GET(new Request('http://localhost/api/auth?resource=technician-ledger&from=2026-09-08&to=2026-09-08&timeZone=America%2FBogota',{headers:{cookie:'cellhouse_session=test-session'}}));
assert.equal(localLedgerResponse.ok,true);
const localLedger=await localLedgerResponse.json();
assert.equal(localLedger.technicians.length,1,'active technician must remain visible in payroll');
assert.equal(localLedger.orders.length,1,'delivery must be included on its local calendar date');
const localCommissions=await GET(new Request('http://localhost/api/auth?resource=service-commissions&from=2026-09-08&to=2026-09-08&timeZone=America%2FBogota',{headers:{cookie:'cellhouse_session=test-session'}}));
assert.equal(localCommissions.ok,true);
assert.equal((await localCommissions.json()).commissions.length,1,'technician report must use the selected local date');
await post({action:'save-service-technician-commission',technicianId:tech,commissionPercent:25});
assert.equal(Number((await get('service-orders')).orders[0].commission_amount),200000);
const settlement=await post({action:'create-technician-settlement',technicianId:tech,orderIds:[id],paymentMethod:'Efectivo'});
assert.equal(Number(settlement.total),200000);assert.equal(Number(settlement.cashShift.cash_outs),200000);
await post({action:'create-technician-settlement',technicianId:tech,orderIds:[id]},false);
await post({action:'delete-service-order',orderId:id},false);
await post({action:'pay-technician-settlements',settlementIds:[settlement.id],paymentMethod:'Efectivo'},false);
const ledgerData=await get('technician-ledger');
assert.equal(ledgerData.orders[0].commission_status,'paid');
assert.equal(Number(ledgerData.items[0].commission_percent),50);
const backup=await get('backup');assert.equal(backup.data.technicianSettlements.length,1);assert.equal(backup.data.technicianSettlementItems.length,1);assert.equal(backup.data.servicePhotos.length,1);
console.log('PASS: reception, technician completion, customer delivery, and atomic technician liquidation/payment.');
await pg.close();
