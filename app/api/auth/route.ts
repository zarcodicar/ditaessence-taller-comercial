import { ensureLedger, readLedger, createSettlement, paySettlements } from '@/db/technician-ledger';
import { env } from '@/db/railway';
import { DEFAULT_RECEIPT_SETTINGS, receiptSettings } from '../../receipt-settings';

const SESSION = 'cellhouse_session';
const SETUP_TOKEN = process.env.SETUP_TOKEN?.trim() || '';
// Solo se habilita en la instalación aislada que usamos como demostración.
// Las instalaciones de clientes no definen esta variable y conservan su acceso
// normal con usuario y contraseña.
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const defaultPermissions = ['Punto de venta', 'Inventario', 'Caja y movimientos'];
const servicePermission = 'Órdenes de servicio';
const returnsPermission = 'Devoluciones y ajustes';
const serviceStatuses = ['Recibido', 'Esperando respuesta del cliente', 'Reparado / listo para entregar', 'Entregado', 'Sin reparación'];
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers });
const cop = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const now = () => new Date().toISOString();
const productCode = (product: any) => {
  const code = String(product?.barcode || product?.sku || '').trim().toLocaleUpperCase('es');
  return code && code !== 'SIN-CÓDIGO' ? code : '';
};
const codeMembers = (products: any[]) => {
  const groups = new Map<string, Set<string>>();
  products.forEach(product => {
    const code = productCode(product);
    if (!code) return;
    const members = groups.get(code) || new Set<string>();
    members.add(String(product?.id));
    groups.set(code, members);
  });
  return groups;
};
const newlyIntroducedDuplicate = (savedProducts: any[], incomingProducts: any[]) => {
  const before = codeMembers(savedProducts);
  for (const [code, incomingMembers] of codeMembers(incomingProducts)) {
    if (incomingMembers.size < 2) continue;
    const previousMembers = before.get(code);
    const sameExistingGroup = previousMembers && incomingMembers.size === previousMembers.size && [...incomingMembers].every(id => previousMembers.has(id));
    if (!sameExistingGroup) return code;
  }
  return '';
};
const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const token = (length = 32) => Array.from(bytes(length), byte => byte.toString(16).padStart(2, '0')).join('');

async function hashPassword(password: string, salt = token(16)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return `${salt}:${Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
async function validPassword(password: string, saved: string) {
  const [salt] = saved.split(':');
  return (await hashPassword(password, salt)) === saved;
}
let schemaReady:Promise<void>|null=null;
async function tables(){if(!schemaReady)schemaReady=initializeTables().catch(e=>{schemaReady=null;throw e});await schemaReady;}
const demoProducts = [
  { id: 101, name: 'Cable USB-C reforzado 1 m', sku: 'CAB-USBC-01', barcode: '7709001001011', price: 18000, cost: 8500, stock: 24, min: 5, category: 'Cables', image: '/demo-products/cable-usbc-reforzado.png' },
  { id: 102, name: 'Cargador USB-C reforzado 25 W', sku: 'CAR-25W-01', barcode: '7709001001028', price: 49000, cost: 28000, stock: 12, min: 3, category: 'Cargadores', image: 'https://storage.googleapis.com/bpv/charger-usb-cable-type-c-white-isolated-background.exact1600w.jpg' },
  { id: 103, name: 'Vidrio templado Samsung A54', sku: 'VID-A54-01', barcode: '7709001001035', price: 15000, cost: 4200, stock: 18, min: 4, category: 'Protección', image: '/demo-products/vidrio-templado-a54.png' },
  { id: 104, name: 'Audífonos inalámbricos Bluetooth', sku: 'AUD-BT-01', barcode: '7709001001042', price: 78000, cost: 44000, stock: 8, min: 3, category: 'Audio', image: '/demo-products/audifonos-bluetooth.png' },
  { id: 105, name: 'Funda antigolpes iPhone 13', sku: 'FUN-IP13-01', barcode: '7709001001059', price: 32000, cost: 14500, stock: 15, min: 4, category: 'Fundas', image: '/demo-products/funda-antigolpes-iphone-13.png' },
  { id: 106, name: 'Mouse inalámbrico compacto', sku: 'MOU-WL-01', barcode: '7709001001066', price: 39000, cost: 21000, stock: 10, min: 3, category: 'Computadores', image: '/demo-products/mouse-inalambrico.png' },
];
const demoSales = [
  { clientId: 'demo-sale-001', number: 'V-00001', createdAt: '2026-11-26T09:14:00.000Z', date: '2026-11-26', payment: 'Efectivo', paymentBreakdown: { Efectivo: 67000 }, total: 67000, items: [{ id: 101, name: 'Cable USB-C reforzado 1 m', qty: 1, price: 18000, originalPrice: 18000, cost: 8500 }, { id: 102, name: 'Cargador rápido 25 W USB-C', qty: 1, price: 49000, originalPrice: 49000, cost: 28000 }] },
  { clientId: 'demo-sale-003', number: 'V-00003', createdAt: '2026-11-26T11:20:00.000Z', date: '2026-11-26', payment: 'Transferencia', paymentBreakdown: { Transferencia: 47000 }, total: 47000, items: [{ id: 103, name: 'Vidrio templado Samsung A54', qty: 1, price: 15000, originalPrice: 15000, cost: 4200 }, { id: 105, name: 'Funda antigolpes iPhone 13', qty: 1, price: 32000, originalPrice: 32000, cost: 14500 }] },
  { clientId: 'demo-sale-004', number: 'V-00004', createdAt: '2026-11-26T12:05:00.000Z', date: '2026-11-26', payment: 'Pago dividido', paymentBreakdown: { Efectivo: 20000, Tarjeta: 19000 }, total: 39000, items: [{ id: 106, name: 'Mouse inalámbrico compacto', qty: 1, price: 39000, originalPrice: 39000, cost: 21000 }] },
];
async function seedDemoData() {
  const businessId = 1;
  await env.DB.transaction(async db => {
    await db.prepare('INSERT INTO pos_business_state (id,business_id,products,sales,categories,receipt_settings,category_catalog_version,updated_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT (id) DO NOTHING').bind(businessId,businessId,'[]','[]','[]',JSON.stringify({ ...DEFAULT_RECEIPT_SETTINGS, businessName: 'DTC Stage · Demostración', phone: '300 555 0148', address: 'Bogotá, Colombia' }),now()).run();
    const state = await db.prepare('SELECT products,sales FROM pos_business_state WHERE business_id=? FOR UPDATE').bind(businessId).first<any>();
    const savedProducts = JSON.parse(state?.products || '[]');
    if (!savedProducts.length) {
      await db.prepare('UPDATE pos_business_state SET products=?,sales=?,categories=?,receipt_settings=?,category_catalog_version=1,updated_at=? WHERE business_id=?').bind(JSON.stringify(demoProducts),JSON.stringify(demoSales),JSON.stringify(['Audio','Cables','Cargadores','Computadores','Fundas','Protección']),JSON.stringify({ ...DEFAULT_RECEIPT_SETTINGS, businessName: 'DTC Stage · Demostración', phone: '300 555 0148', address: 'Bogotá, Colombia' }),now(),businessId).run();
    } else {
      // El catálogo de prueba se mantiene coherente con las fotografías
      // correspondientes a cada producto mostrado al visitante.
      const hydratedProducts = [
        ...demoProducts.map(example => ({ ...(savedProducts.find((product: any) => Number(product.id) === example.id) || example), image: example.image, name: example.name })),
        ...savedProducts.filter((product: any) => !demoProducts.some(example => example.id === Number(product.id))),
      ];
      const hydratedSales = JSON.parse(state?.sales || '[]').filter((sale: any) => sale.clientId !== 'demo-sale-002');
      const categories = [...new Set(hydratedProducts.map((product: any) => String(product.category || '').trim()).filter(Boolean))].sort();
      if (JSON.stringify(hydratedProducts) !== JSON.stringify(savedProducts) || hydratedSales.length !== JSON.parse(state?.sales || '[]').length) await db.prepare('UPDATE pos_business_state SET products=?,sales=?,categories=?,updated_at=? WHERE business_id=?').bind(JSON.stringify(hydratedProducts),JSON.stringify(hydratedSales),JSON.stringify(categories),now(),businessId).run();
    }
    const shift = await db.prepare("SELECT id,opening_amount,cash_sales,card_sales,transfer_sales,sales_count,units_sold,cash_entries,cash_outs FROM pos_cash_shifts WHERE business_id=? AND status='open' LIMIT 1").bind(businessId).first<any>();
    if (!shift) {
      await db.prepare("INSERT INTO pos_cash_shifts (business_id,status,opened_by_user_id,opened_by_name,opening_amount,cash_sales,card_sales,transfer_sales,sales_count,units_sold,cash_entries,cash_outs,opened_at) VALUES (?,'open',1,'Demostración',100000,87000,19000,47000,3,5,0,0,?)").bind(businessId,now()).run();
    } else if (Number(shift.sales_count || 0) === 0 && Number(shift.cash_sales || 0) === 0 && Number(shift.card_sales || 0) === 0 && Number(shift.transfer_sales || 0) === 0 && Number(shift.cash_entries || 0) === 0 && Number(shift.cash_outs || 0) === 0) {
      // Corrige el turno de la demostración creado antes de que las ventas
      // simuladas alimentaran la caja. Luego no se toca si un visitante vende.
      await db.prepare('UPDATE pos_cash_shifts SET opening_amount=100000,cash_sales=87000,card_sales=19000,transfer_sales=47000,sales_count=3,units_sold=5 WHERE id=?').bind(shift.id).run();
    }
    const examples = [
      ['OS-001','Laura Gómez','300 555 0101','1020304050','Celular','Samsung','Galaxy A54','IMEI 351234567890123','Pantalla quebrada y marco con golpes','Pantalla quebrada y sin respuesta táctil','Cambio de módulo de pantalla','Reparado / listo para entregar',285000,85000,285000],
      ['OS-002','Andrés Ruiz','300 555 0102','1010101010','Computador portátil','Lenovo','IdeaPad 3','Serial PF-4J22AB','No enciende, incluye cargador','No enciende después de una actualización','Diagnóstico de encendido','Esperando respuesta del cliente',0,0,0],
      ['OS-003','Camila Torres','300 555 0103','1030303030','Tablet','Apple','iPad 9ª generación','Serial F9G7X22PQL','Pantalla con líneas verticales','Pantalla con líneas verticales y toque intermitente','Revisión de display','Recibido',0,0,0],
      ['OS-004','Miguel Díaz','300 555 0104','1040404040','Consola','Sony','PlayStation 5','Serial PS5-883920','No lee discos','La consola no reconoce discos físicos','Limpieza y ajuste de lector','Entregado',160000,35000,160000],
    ];
    const orders = await db.prepare('SELECT COUNT(*) AS count FROM pos_service_orders WHERE business_id=?').bind(businessId).first<any>();
    if (Number(orders?.count || 0) === 0) {
      for (const item of examples) {
        const createdAt = now();
        const [orderNumber, customerName, customerPhone, customerDocument, deviceType, deviceBrand, deviceModel, deviceIdentifier, physicalCondition, reportedIssue, plannedService, status, estimatedTotal, partsCost, finalTotal] = item;
        const created = await db.prepare("INSERT INTO pos_service_orders (business_id,order_number,customer_name,customer_phone,customer_document,device_type,device_brand,device_model,device_identifier,physical_condition,reported_issue,planned_service,status,estimated_total,parts_cost,final_total,created_by_user_id,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(businessId,String(orderNumber || ''),String(customerName || ''),String(customerPhone || ''),String(customerDocument || ''),String(deviceType || 'Otro'),String(deviceBrand || ''),String(deviceModel || ''),String(deviceIdentifier || ''),String(physicalCondition || ''),String(reportedIssue || ''),String(plannedService || ''),String(status || 'Recibido'),Number(estimatedTotal || 0),Number(partsCost || 0),Number(finalTotal || 0),1,'Demostración',createdAt,createdAt).run();
      }
    }
    // Corrige únicamente la primera siembra publicada con columnas cruzadas.
    // No toca órdenes que un visitante ya haya trabajado con estados válidos.
    for (const item of examples) {
      const orderNumber = String(item[0]), physicalCondition = String(item[8]), reportedIssue = String(item[9]), plannedService = String(item[10]), status = String(item[11]);
      const estimatedTotal = Number(item[12]), partsCost = Number(item[13]), finalTotal = Number(item[14]);
      await db.prepare("UPDATE pos_service_orders SET physical_condition=?,reported_issue=?,planned_service=?,status=?,estimated_total=?,parts_cost=?,final_total=?,updated_at=? WHERE business_id=? AND order_number=? AND status NOT IN ('Recibido','Esperando respuesta del cliente','Reparado / listo para entregar','Entregado','Sin reparación')").bind(physicalCondition,reportedIssue,plannedService,status,estimatedTotal,partsCost,finalTotal,now(),businessId,orderNumber).run();
    }
    await db.prepare("UPDATE pos_service_orders SET status='Esperando respuesta del cliente',planned_service='Diagnóstico de encendido',updated_at=? WHERE business_id=? AND order_number='OS-002' AND status='Recibido' AND planned_service='Esperando respuesta del cliente'").bind(now(),businessId).run();
    await db.prepare("UPDATE pos_service_orders SET planned_service='Revisión de display',updated_at=? WHERE business_id=? AND order_number='OS-003' AND status='Recibido' AND planned_service='Recibido'").bind(now(),businessId).run();
    let demoStep = 'técnicos';
    try {
    const demoTechnicians = [
      { name: 'Valentina Moreno', phone: '300 555 0191', document: '1032456789', commission: 35 },
      { name: 'Samuel Ortiz', phone: '300 555 0192', document: '1019876543', commission: 30 },
    ];
    const technicians: Record<string, any> = {};
    for (const technician of demoTechnicians) {
      demoStep = `técnico ${technician.name}`;
      let row = await db.prepare('SELECT * FROM pos_employees WHERE business_id=? AND name=? LIMIT 1').bind(businessId,technician.name).first<any>();
      if (!row) {
        const created = await db.prepare("INSERT INTO pos_employees (business_id,name,phone,document,position,is_technician,active,created_at,updated_at) VALUES (?,?,?,?,? ,1,1,?,?) RETURNING *").bind(businessId,technician.name,technician.phone,technician.document,'Técnico',now(),now()).first<any>();
        row = created;
      }
      if (!row) continue;
      const technicianId = Number(row.id ?? row.employee_id ?? row.user_id);
      if (!Number.isInteger(technicianId) || technicianId < 1) throw new Error('No encontramos el identificador del técnico.');
      technicians[technician.name] = { ...row, id: technicianId };
      demoStep = `comisión de ${technician.name}`;
      await db.prepare('INSERT INTO pos_service_technician_commissions (business_id,technician_id,commission_percent,updated_by_name,updated_at) VALUES (?,?,?,?,?) ON CONFLICT (technician_id) DO UPDATE SET commission_percent=EXCLUDED.commission_percent,updated_by_name=EXCLUDED.updated_by_name,updated_at=EXCLUDED.updated_at RETURNING technician_id').bind(businessId,technicianId,technician.commission,'Demostración',now()).first<any>();
    }
    const valentina = technicians['Valentina Moreno'];
    const samuel = technicians['Samuel Ortiz'];
    if (valentina) {
      demoStep = 'comisión pendiente';
      await db.prepare("UPDATE pos_service_orders SET technician_user_id=?,technician_name=?,commission_percent=35,commission_base=125000,commission_amount=43750,commission_status='pending',commission_settled_at=COALESCE(commission_settled_at,?),repair_completed_at=COALESCE(repair_completed_at,?),updated_at=? WHERE business_id=? AND order_number='OS-001'").bind(valentina.id,valentina.name,'2026-11-25T15:40:00.000Z','2026-11-25T15:40:00.000Z',now(),businessId).run();
    }
    if (samuel) {
      demoStep = 'comisión pagada';
      await db.prepare("UPDATE pos_service_orders SET technician_user_id=?,technician_name=?,commission_percent=30,commission_base=125000,commission_amount=37500,commission_status='paid',commission_settled_at=COALESCE(commission_settled_at,?),commission_paid_at=COALESCE(commission_paid_at,?),commission_paid_by_name=COALESCE(NULLIF(commission_paid_by_name,''),'Administración'),repair_completed_at=COALESCE(repair_completed_at,?),delivered_at=COALESCE(delivered_at,?),updated_at=? WHERE business_id=? AND order_number='OS-004'").bind(samuel.id,samuel.name,'2026-11-24T16:20:00.000Z','2026-11-24T17:05:00.000Z','2026-11-24T15:30:00.000Z','2026-11-24T16:40:00.000Z',now(),businessId).run();
      demoStep = 'orden liquidada';
      const paidOrder = await db.prepare("SELECT id,order_number,final_total,parts_cost,commission_percent,commission_amount FROM pos_service_orders WHERE business_id=? AND order_number='OS-004'").bind(businessId).first<any>();
      demoStep = 'liquidación registrada';
      const settlement = await db.prepare('SELECT id FROM pos_technician_settlements WHERE business_id=? AND technician_id=? LIMIT 1').bind(businessId,samuel.id).first<any>();
      if (paidOrder && !settlement) {
        const createdSettlement = await db.prepare("INSERT INTO pos_technician_settlements (business_id,technician_id,technician_name,total,note,created_at,created_by,paid_at,paid_by,payment_method,shift_id) VALUES (?,?,?,?,?,?,?,?,?,?,NULL) RETURNING id").bind(businessId,samuel.id,samuel.name,Number(paidOrder.commission_amount || 0),'Liquidación de reparación entregada · demostración','2026-11-24T17:05:00.000Z','Administración','2026-11-24T17:05:00.000Z','Administración','Transferencia').first<any>();
        if (createdSettlement) await db.prepare('INSERT INTO pos_technician_settlement_items (business_id,settlement_id,order_id,order_number,final_total,parts_cost,commission_percent,commission_amount) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (order_id) DO NOTHING').bind(businessId,createdSettlement.id,paidOrder.id,paidOrder.order_number,paidOrder.final_total,paidOrder.parts_cost,paidOrder.commission_percent,paidOrder.commission_amount).run();
      }
      const servicePayment = await db.prepare("SELECT id FROM pos_service_payments WHERE business_id=? AND order_id=? AND kind='Pago final' LIMIT 1").bind(businessId,paidOrder?.id || 0).first<any>();
      if (paidOrder && !servicePayment) {
        const paymentShift = await db.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' LIMIT 1").bind(businessId).first<any>();
        await db.prepare("INSERT INTO pos_service_payments (business_id,order_id,shift_id,kind,payment_method,amount,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(businessId,paidOrder.id,paymentShift?.id || null,'Pago final','Transferencia',160000,'Demostración','2026-11-24T16:40:00.000Z').run();
        if (paymentShift) await db.prepare('UPDATE pos_cash_shifts SET repair_transfer_income=repair_transfer_income+160000 WHERE id=?').bind(paymentShift.id).run();
      }
    }
    demoStep = 'devolución';
    const returnItems = JSON.stringify([{ id: 105, name: 'Funda antigolpes iPhone 13', qty: 1, price: 32000 }]);
    const existingReturn = await db.prepare("SELECT id FROM pos_returns WHERE business_id=? AND source_type='sale' AND source_id IN ('demo-sale-002','demo-sale-003') LIMIT 1").bind(businessId).first<any>();
    if (existingReturn) await db.prepare("UPDATE pos_returns SET source_id='demo-sale-003',source_number='V-00003',amount=32000,payment_method='Transferencia',reason='La funda no era compatible con el modelo del cliente.',restock=1,items=?,actor_name='Sofía Herrera' WHERE id=?").bind(returnItems,existingReturn.id).run();
    else await db.prepare("INSERT INTO pos_returns (business_id,return_type,source_type,source_id,source_number,amount,payment_method,reason,restock,items,actor_name,shift_id,created_at) VALUES (?,'sale_return','sale','demo-sale-003','V-00003',32000,'Transferencia','La funda no era compatible con el modelo del cliente.',1,?,'Sofía Herrera',NULL,?)").bind(businessId,returnItems,'2026-11-26T10:28:00.000Z').run();
    } catch (error: any) {
      throw new Error(`No pudimos preparar ${demoStep} de demostración: ${error?.message || 'error desconocido'}`);
    }
  });
}
async function initializeTables() {
  // La instalación comercial usa una sola aplicación, pero cada negocio tendrá
  // una identidad y datos propios. Por ahora todos los registros históricos se
  // conservan dentro del negocio inicial (id 1); todavía no se habilita la
  // creación de clientes nuevos hasta que todas las operaciones estén aisladas.
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_businesses (id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', plan TEXT NOT NULL DEFAULT 'monthly', expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT INTO pos_businesses (id,code,name,status,plan,created_at,updated_at) VALUES (1,'demo-dtc-stage','DTC Stage','active','demo',?,?) ON CONFLICT (id) DO NOTHING").bind(now(),now()).run();
  await ensureLedger(env.DB);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pos_service_photos (id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL,image TEXT NOT NULL)').run();
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pos_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT \'[]\', created_at TEXT NOT NULL)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', document TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', is_technician INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pos_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, actor_name TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, read_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_cash_shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, opened_by_user_id INTEGER NOT NULL, opened_by_name TEXT NOT NULL, opening_amount INTEGER NOT NULL DEFAULT 0, cash_sales INTEGER NOT NULL DEFAULT 0, card_sales INTEGER NOT NULL DEFAULT 0, transfer_sales INTEGER NOT NULL DEFAULT 0, other_sales INTEGER NOT NULL DEFAULT 0, sales_count INTEGER NOT NULL DEFAULT 0, units_sold INTEGER NOT NULL DEFAULT 0, cash_entries INTEGER NOT NULL DEFAULT 0, cash_outs INTEGER NOT NULL DEFAULT 0, expected_amount INTEGER, counted_amount INTEGER, difference INTEGER, opened_at TEXT NOT NULL, closed_by_user_id INTEGER, closed_by_name TEXT, closed_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_cash_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, actor_name TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_business_state (id INTEGER PRIMARY KEY, products TEXT NOT NULL DEFAULT '[]', sales TEXT NOT NULL DEFAULT '[]', categories TEXT NOT NULL DEFAULT '[]', receipt_settings TEXT NOT NULL DEFAULT '{}', category_catalog_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS pos_synced_sales (client_id TEXT PRIMARY KEY, sale_number TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL, customer_document TEXT NOT NULL DEFAULT '', device_brand TEXT NOT NULL, device_model TEXT NOT NULL, device_identifier TEXT NOT NULL DEFAULT '', device_password TEXT NOT NULL DEFAULT '', accessories TEXT NOT NULL DEFAULT '', physical_condition TEXT NOT NULL DEFAULT '', reported_issue TEXT NOT NULL, planned_service TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Recibido', estimated_total INTEGER NOT NULL DEFAULT 0, parts_cost INTEGER NOT NULL DEFAULT 0, final_total INTEGER NOT NULL DEFAULT 0, created_by_user_id INTEGER NOT NULL, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, event_type TEXT NOT NULL, from_status TEXT, to_status TEXT, note TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, shift_id INTEGER, kind TEXT NOT NULL, payment_method TEXT NOT NULL, amount INTEGER NOT NULL, actor_name TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_parts (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL, amount INTEGER NOT NULL, payment_method TEXT NOT NULL DEFAULT 'Efectivo', supplier TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_settings (id INTEGER PRIMARY KEY, technician_commission_percent REAL NOT NULL DEFAULT 30, updated_by_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_service_technician_commissions (technician_id INTEGER PRIMARY KEY, commission_percent REAL NOT NULL, updated_by_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_employee_payroll (employee_id INTEGER PRIMARY KEY, salary REAL NOT NULL DEFAULT 0, updated_by_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pos_returns (id BIGSERIAL PRIMARY KEY, return_type TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_number TEXT NOT NULL, amount INTEGER NOT NULL, payment_method TEXT NOT NULL, reason TEXT NOT NULL, restock INTEGER NOT NULL DEFAULT 0, items TEXT NOT NULL DEFAULT '[]', actor_name TEXT NOT NULL, shift_id INTEGER, created_at TEXT NOT NULL)"),
  ]);
  // Migración aditiva y reversible: conserva los datos existentes bajo el
  // negocio inicial. Las rutas se irán acotando por business_id antes de abrir
  // el aprovisionamiento comercial.
  for (const table of ['pos_users','pos_employees','pos_sessions','pos_notifications','pos_cash_shifts','pos_cash_movements','pos_business_state','pos_synced_sales','pos_service_orders','pos_service_order_events','pos_service_payments','pos_service_parts','pos_service_settings','pos_service_technician_commissions','pos_employee_payroll','pos_returns','pos_service_photos','pos_technician_settlements','pos_technician_settlement_items']) {
    try { await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN business_id BIGINT NOT NULL DEFAULT 1`).run(); } catch { /* La columna ya existe. */ }
  }
  // Antes solo podía existir una caja abierta para toda la aplicación. Ahora
  // cada negocio conserva su propia caja, sin bloquear a los demás.
  await env.DB.prepare('DROP INDEX IF EXISTS idx_pos_cash_shifts_single_open').run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_cash_shifts_single_open ON pos_cash_shifts(business_id) WHERE status='open'").run();
  // La misma venta puede existir en dos negocios distintos: el identificador
  // del dispositivo se vuelve único dentro de cada negocio, no globalmente.
  try { await env.DB.prepare('ALTER TABLE pos_synced_sales DROP CONSTRAINT IF EXISTS pos_synced_sales_pkey').run(); } catch { /* Instalación anterior compatible. */ }
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_synced_sales_business_client ON pos_synced_sales(business_id,client_id)').run();
  // Solo cambia el nombre heredado de la demostración comercial. Los negocios
  // reales que tengan un nombre propio no se modifican.
  try {
    await env.DB.prepare("UPDATE pos_business_state SET receipt_settings=jsonb_set(COALESCE(NULLIF(receipt_settings,'')::jsonb,'{}'::jsonb),'{businessName}','\"DTC Stage\"'::jsonb,true) WHERE id=1 AND lower(COALESCE(receipt_settings,'')) ~ '(cellhouse|sellhost|sell host|ditaessence taller)'").run();
  } catch { /* Una configuración antigua no debe impedir iniciar el POS. */ }
  // También actualiza instalaciones locales que se crearon antes del centro de notificaciones.
  for (const statement of ["ALTER TABLE pos_notifications ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'", 'ALTER TABLE pos_notifications ADD COLUMN entity_type TEXT', 'ALTER TABLE pos_notifications ADD COLUMN entity_id TEXT', "ALTER TABLE pos_notifications ADD COLUMN details TEXT NOT NULL DEFAULT '{}' "]) {
    try { await env.DB.prepare(statement).run(); } catch { /* La columna ya existe. */ }
  }
  try { await env.DB.prepare("ALTER TABLE pos_business_state ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'").run(); } catch { /* La columna ya existe. */ }
  try { await env.DB.prepare("ALTER TABLE pos_business_state ADD COLUMN category_catalog_version INTEGER NOT NULL DEFAULT 0").run(); } catch { /* La columna ya existe. */ }
  try { await env.DB.prepare("ALTER TABLE pos_business_state ADD COLUMN receipt_settings TEXT NOT NULL DEFAULT '{}'").run(); } catch { /* La columna ya existe. */ }
  try { await env.DB.prepare('ALTER TABLE pos_service_settings ADD COLUMN order_code_version INTEGER NOT NULL DEFAULT 0').run(); } catch { /* La columna ya existe. */ }
  try { await env.DB.prepare('ALTER TABLE pos_employees ADD COLUMN commission_percent REAL').run(); } catch { /* La columna ya existe. */ }
  for (const statement of ["ALTER TABLE pos_cash_shifts ADD COLUMN card_sales INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN transfer_sales INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN other_sales INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN sales_count INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN units_sold INTEGER NOT NULL DEFAULT 0"]) {
    try { await env.DB.prepare(statement).run(); } catch { /* La columna ya existe. */ }
  }
  for (const statement of ["ALTER TABLE pos_cash_shifts ADD COLUMN repair_cash_income INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN repair_card_income INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_cash_shifts ADD COLUMN repair_transfer_income INTEGER NOT NULL DEFAULT 0"]) {
    try { await env.DB.prepare(statement).run(); } catch { /* La columna ya existe. */ }
  }
  try { await env.DB.prepare('ALTER TABLE pos_service_orders ADD COLUMN client_ref TEXT').run(); } catch { /* La columna ya existe. */ }
  try { await env.DB.prepare("ALTER TABLE pos_service_orders ADD COLUMN device_type TEXT NOT NULL DEFAULT 'Celular'").run(); } catch { /* La columna ya existe. */ }
  for (const statement of ["ALTER TABLE pos_service_orders ADD COLUMN technician_user_id INTEGER", "ALTER TABLE pos_service_orders ADD COLUMN technician_name TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN commission_percent REAL", "ALTER TABLE pos_service_orders ADD COLUMN commission_base INTEGER", "ALTER TABLE pos_service_orders ADD COLUMN commission_amount INTEGER", "ALTER TABLE pos_service_orders ADD COLUMN commission_status TEXT NOT NULL DEFAULT 'not_applicable'", "ALTER TABLE pos_service_orders ADD COLUMN commission_settled_at TEXT", "ALTER TABLE pos_service_orders ADD COLUMN commission_paid_at TEXT", "ALTER TABLE pos_service_orders ADD COLUMN commission_paid_by_name TEXT"]) {
    try { await env.DB.prepare(statement).run(); } catch { /* La columna ya existe. */ }
  }
  // Campos añadidos de forma aditiva: no reemplazan ni recalculan órdenes existentes.
  for (const statement of ["ALTER TABLE pos_service_orders ADD COLUMN diagnosis TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN technical_report TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN parts_used TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN estimated_delivery_at TEXT", "ALTER TABLE pos_service_orders ADD COLUMN customer_authorized INTEGER NOT NULL DEFAULT 0", "ALTER TABLE pos_service_orders ADD COLUMN authorized_at TEXT", "ALTER TABLE pos_service_orders ADD COLUMN repair_completed_at TEXT", "ALTER TABLE pos_service_orders ADD COLUMN delivery_recipient TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN delivery_document TEXT NOT NULL DEFAULT ''", "ALTER TABLE pos_service_orders ADD COLUMN delivery_notes TEXT NOT NULL DEFAULT ''"]) {
    try { await env.DB.prepare(statement).run(); } catch { /* La columna ya existe. */ }
  }
  await env.DB.prepare("UPDATE pos_service_orders SET repair_completed_at=COALESCE((SELECT created_at FROM pos_service_order_events WHERE order_id=pos_service_orders.id AND event_type='Proceso técnico' ORDER BY id DESC LIMIT 1),updated_at) WHERE repair_completed_at IS NULL AND status IN ('Reparado / listo para entregar','Entregado')").run();
  await env.DB.prepare("INSERT INTO pos_service_settings (id,technician_commission_percent,updated_by_name,updated_at) VALUES (1,30,'Sistema',?) ON CONFLICT (id) DO NOTHING").bind(now()).run();
  const codeSettings = await env.DB.prepare('SELECT order_code_version FROM pos_service_settings WHERE id=1').first<any>();
  if (Number(codeSettings?.order_code_version || 0) < 1) {
    await env.DB.transaction(async db => {
      await db.prepare('SELECT pg_advisory_xact_lock(781236)').first();
      await db.prepare("UPDATE pos_service_orders SET order_number='MIG-' || id").run();
      await db.prepare("UPDATE pos_service_orders SET order_number=LPAD(id::text,3,'0')").run();
      await db.prepare('UPDATE pos_technician_settlement_items i SET order_number=o.order_number FROM pos_service_orders o WHERE o.id=i.order_id').run();
      await db.prepare('UPDATE pos_service_settings SET order_code_version=1 WHERE id=1').run();
    });
  }
  // Compatibilidad: trabajadores creados antes de que el cargo Técnico habilitara reparaciones.
  await env.DB.prepare("UPDATE pos_employees SET is_technician=1, updated_at=? WHERE lower(trim(position)) IN ('técnico','tecnico') AND is_technician=0").bind(now()).run();
  await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_client_ref ON pos_service_orders(client_ref) WHERE client_ref IS NOT NULL').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_service_orders_status ON pos_service_orders(status)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_service_payments_order ON pos_service_payments(order_id)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_service_parts_order ON pos_service_parts(order_id)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pos_returns_source ON pos_returns(source_type,source_id)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pos_returns_created ON pos_returns(created_at DESC)').run();
}
function cookie(request: Request) { return request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${SESSION}=`))?.slice(SESSION.length + 1); }
async function current(request: Request) {
  const id = cookie(request); if (!id) return null;
  const row = await env.DB.prepare('SELECT u.id, u.name, u.username, u.role, u.permissions, s.business_id FROM pos_sessions s JOIN pos_users u ON u.id=s.user_id AND u.business_id=s.business_id WHERE s.id=? AND s.expires_at>?').bind(id, now()).first<any>();
  return row ? { ...row, businessId: Number(row.business_id || 1), permissions: JSON.parse(row.permissions || '[]') } : null;
}
async function session(userId: number, businessId = 1) {
  const id = token(); const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  await env.DB.prepare('INSERT INTO pos_sessions (id, user_id, business_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, userId, businessId, expiresAt, now()).run();
  return `${SESSION}=${id}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=43200`;
}

function canUseCash(user: any) { return user?.role === 'owner' || user?.permissions?.includes('Caja y movimientos'); }
function canUseServices(user: any) { return user?.role === 'owner' || user?.permissions?.includes(servicePermission); }
function canUseReturns(user: any) {
  // Las cuentas que ya podían gestionar órdenes deben conservar el flujo de
  // reversar un abono o una venta. El permiso nuevo permite otorgarlo de forma
  // independiente a cuentas creadas posteriormente.
  return user?.role === 'owner'
    || user?.permissions?.includes(returnsPermission)
    || user?.permissions?.includes('Órdenes de servicio');
}
function canSeeCashTotals(user: any) { return user?.role === 'owner' || user?.permissions?.includes('Ver indicadores financieros'); }
async function activeCashShift(user: any) {
  if (!user) return null;
  const shift = await env.DB.prepare("SELECT * FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(user.businessId || 1).first<any>();
  if (!shift) return null;
  if (!canSeeCashTotals(user)) return { id: shift.id, status: shift.status, opened_by_user_id: shift.opened_by_user_id, opened_by_name: shift.opened_by_name, opened_at: shift.opened_at };
  const movements = await env.DB.prepare('SELECT id, shift_id, type, amount, reason, actor_name, created_at FROM pos_cash_movements WHERE shift_id=? ORDER BY id DESC').bind(shift.id).all<any>();
  return { ...shift, movements: movements.results || [] };
}

export async function GET(request: Request) {
  await tables();
  const count = await env.DB.prepare('SELECT COUNT(*) as count FROM pos_users').first<{ count: number }>();
  const user = await current(request);
  const url = new URL(request.url);
  if(url.searchParams.get('resource')==='service-photos'){
    if(!user||!canUseServices(user))return json({error:'Sin permiso.'},403);
    const rows=await env.DB.prepare('SELECT image FROM pos_service_photos WHERE business_id=? AND order_id=? ORDER BY id').bind(user.businessId,Number(url.searchParams.get('orderId'))).all<any>();
    return json({photos:rows.results.map(p=>p.image)});
  }
  if (url.searchParams.get('resource') === 'service-settings') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede configurar comisiones.' }, 403);
    const settings = await env.DB.prepare('SELECT technician_commission_percent,updated_by_name,updated_at FROM pos_service_settings WHERE id=1').first<any>();
    const technicians = await env.DB.prepare("SELECT e.id,e.name,e.phone,e.position,COALESCE(c.commission_percent,0) AS commission_percent,(c.technician_id IS NOT NULL) AS has_custom_commission FROM pos_employees e LEFT JOIN pos_service_technician_commissions c ON c.technician_id=e.id WHERE e.is_technician=1 AND e.active=1 ORDER BY e.name").all<any>();
    return json({ settings, technicians: technicians.results || [] });
  }
  if (url.searchParams.get('resource') === 'service-technician-commission') {
    if (!user || !canUseServices(user)) return json({ error: 'No tienes permiso para consultar comisiones.' }, 403);
    const technicianId = Number(url.searchParams.get('technicianId') || 0);
    if (!technicianId) return json({ error: 'Técnico inválido.' }, 400);
    const settings = await env.DB.prepare('SELECT technician_commission_percent FROM pos_service_settings WHERE id=1').first<any>();
    const custom = await env.DB.prepare('SELECT commission_percent FROM pos_service_technician_commissions WHERE technician_id=?').bind(technicianId).first<any>();
    return json({ commissionPercent: Number(custom?.commission_percent ?? 0), hasCustom: Boolean(custom) });
  }
  if (url.searchParams.get('resource') === 'service-technicians') {
    if (!user || !canUseServices(user)) return json({ error: 'No tienes permiso para consultar técnicos.' }, 403);
    const technicians = await env.DB.prepare("SELECT e.id,e.name,e.phone,e.position,COALESCE(c.commission_percent,0) AS commission_percent,(c.technician_id IS NOT NULL) AS has_custom_commission FROM pos_employees e LEFT JOIN pos_service_technician_commissions c ON c.technician_id=e.id WHERE e.is_technician=1 AND e.active=1 ORDER BY e.name").all<any>();
    return json({ technicians: technicians.results || [] });
  }
  if (url.searchParams.get('resource') === 'employees') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede consultar trabajadores.' }, 403);
    const employees = await env.DB.prepare('SELECT id,name,phone,document,position,is_technician,active,created_at,updated_at FROM pos_employees ORDER BY active DESC,name').all<any>();
    return json({ employees: employees.results || [] });
  }
  if (url.searchParams.get('resource') === 'technician-ledger') {
    if (!user || user.role !== 'owner') return json({error:'Solo el propietario puede consultar liquidaciones.'},403);
    const from=url.searchParams.get('from')||'', to=url.searchParams.get('to')||'';
    const requestedTimeZone=String(url.searchParams.get('timeZone')||'UTC');
    const timeZone=/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(requestedTimeZone)&&requestedTimeZone.length<=64?requestedTimeZone:'UTC';
    return json(await readLedger(env.DB,from,to,timeZone));
  }
  if (url.searchParams.get('resource') === 'employee-payroll') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede consultar pagos de empleados.' }, 403);
    const from = String(url.searchParams.get('from') || ''), to = String(url.searchParams.get('to') || '');
    const employees = await env.DB.prepare(`SELECT e.id,e.name,e.position,COALESCE(c.commission_percent,0) AS commission_percent,COALESCE(SUM(CASE WHEN o.commission_status IN ('pending','paid') THEN o.commission_amount ELSE 0 END),0) AS commission_total,COUNT(o.id) FILTER (WHERE o.commission_status IN ('pending','paid')) AS repairs_count,COALESCE(SUM(CASE WHEN o.commission_status IN ('pending','paid') THEN o.final_total ELSE 0 END),0) AS repairs_total FROM pos_employees e LEFT JOIN pos_service_technician_commissions c ON c.technician_id=e.id LEFT JOIN pos_service_orders o ON o.technician_user_id=e.id AND (?='' OR substr(o.commission_settled_at,1,10)>=?) AND (?='' OR substr(o.commission_settled_at,1,10)<=?) WHERE e.active=1 AND e.is_technician=1 GROUP BY e.id,e.name,e.position,c.commission_percent ORDER BY e.name`).bind(from,from,to,to).all<any>();
    return json({ employees: employees.results || [], from, to });
  }
  if (url.searchParams.get('resource') === 'service-commissions') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede consultar liquidaciones.' }, 403);
    const from = String(url.searchParams.get('from') || ''), to = String(url.searchParams.get('to') || '');
    const requestedTimeZone=String(url.searchParams.get('timeZone')||'UTC');
    const timeZone=/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(requestedTimeZone)&&requestedTimeZone.length<=64?requestedTimeZone:'UTC';
    const commissions = await env.DB.prepare(`SELECT id,order_number,technician_user_id,technician_name,final_total,parts_cost,commission_percent,commission_base,commission_amount,commission_status,commission_settled_at,commission_paid_at FROM pos_service_orders WHERE commission_status IN ('pending','paid') AND (?='' OR (commission_settled_at::timestamptz AT TIME ZONE ?)::date>=CAST(NULLIF(?,'') AS date)) AND (?='' OR (commission_settled_at::timestamptz AT TIME ZONE ?)::date<=CAST(NULLIF(?,'') AS date)) ORDER BY commission_settled_at DESC`).bind(from,timeZone,from,to,timeZone,to).all<any>();
    return json({ commissions: commissions.results || [] });
  }
  if (url.searchParams.get('resource') === 'my-service-commission') {
    if (!user || !canUseServices(user)) return json({ error: 'No tienes permiso para consultar comisiones.' }, 403);
    const today=now().slice(0,10), owner=user.role==='owner';
    const row=await env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS total,COALESCE(SUM(CASE WHEN commission_status='pending' THEN commission_amount ELSE 0 END),0) AS pending,COALESCE(SUM(CASE WHEN commission_status='paid' THEN commission_amount ELSE 0 END),0) AS paid,COUNT(*) AS orders_count FROM pos_service_orders WHERE commission_status IN ('pending','paid') AND substr(commission_settled_at,1,10)=? AND (?=1 OR technician_user_id=?)`).bind(today,owner?1:0,user.id).first<any>();
    return json({ summary: row || {total:0,pending:0,paid:0,orders_count:0} });
  }
  if (url.searchParams.get('resource') === 'service-orders') {
    if (!user || !canUseServices(user)) return json({ error: 'No tienes permiso para consultar las órdenes de servicio.' }, 403);
    const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
    const status = String(url.searchParams.get('status') || '').trim();
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();
    const result = await env.DB.prepare(`SELECT o.*,
      COALESCE((SELECT SUM(p.amount) FROM pos_service_payments p WHERE p.order_id=o.id), 0) AS paid_total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'payment_method',p.payment_method,'amount',p.amount,'actor_name',p.actor_name,'created_at',p.created_at) ORDER BY p.created_at) FROM pos_service_payments p WHERE p.order_id=o.id), '[]'::jsonb) AS payments,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',sp.id,'amount',sp.amount,'payment_method',sp.payment_method,'supplier',sp.supplier,'note',sp.note,'actor_name',sp.actor_name,'created_at',sp.created_at) ORDER BY sp.id) FROM pos_service_parts sp WHERE sp.order_id=o.id), '[]'::jsonb) AS parts,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'from_status',e.from_status,'to_status',e.to_status,'note',e.note,'actor_name',e.actor_name,'created_at',e.created_at) ORDER BY e.created_at DESC) FROM pos_service_order_events e WHERE e.order_id=o.id), '[]'::jsonb) AS events
      FROM pos_service_orders o
      WHERE o.business_id=?
        AND (? = '' OR lower(o.order_number || ' ' || o.customer_name || ' ' || o.customer_phone || ' ' || o.device_brand || ' ' || o.device_model || ' ' || o.device_identifier) LIKE '%' || ? || '%')
        AND (? = '' OR o.status = ?)
        AND (? = '' OR substr(o.created_at,1,10) >= ?)
        AND (? = '' OR substr(o.created_at,1,10) <= ?)
      ORDER BY o.id DESC LIMIT 500`).bind(user.businessId, search, search, status, status, from, from, to, to).all<any>();
    return json({ orders: result.results || [] });
  }
  if (url.searchParams.get('resource') === 'returns-dashboard') {
    if (!user || !canUseReturns(user)) return json({ error: 'No tienes permiso para gestionar devoluciones.' }, 403);
    const [orders, state, returns] = await Promise.all([
      env.DB.prepare(`SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.device_brand,o.device_model,o.status,o.final_total,o.estimated_total,
        COALESCE((SELECT SUM(amount) FROM pos_service_payments p WHERE p.order_id=o.id),0) AS paid_total,
        COALESCE((SELECT SUM(amount) FROM pos_returns r WHERE r.source_type='service_order' AND r.source_id=o.id::text),0) AS returned_total
        FROM pos_service_orders o
        WHERE o.business_id=? AND o.status <> 'Entregado'
          AND COALESCE((SELECT SUM(amount) FROM pos_service_payments p WHERE p.order_id=o.id),0) > COALESCE((SELECT SUM(amount) FROM pos_returns r WHERE r.source_type='service_order' AND r.source_id=o.id::text),0)
        ORDER BY o.id DESC LIMIT 300`).bind(user.businessId).all<any>(),
      env.DB.prepare('SELECT products,sales,categories,receipt_settings,updated_at FROM pos_business_state WHERE business_id=?').bind(user.businessId).first<any>(),
      env.DB.prepare('SELECT * FROM pos_returns WHERE business_id=? ORDER BY created_at DESC LIMIT 300').bind(user.businessId).all<any>(),
    ]);
    const safeParse = (value: string, fallback: any) => { try { return JSON.parse(value || ''); } catch { return fallback; } };
    return json({
      serviceOrders: orders.results || [],
      sales: safeParse(state?.sales, []),
      returns: (returns.results || []).map((item: any) => ({ ...item, items: safeParse(item.items, []) })),
    });
  }
  if (url.searchParams.get('resource') === 'service-summary') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede consultar resultados de reparaciones.' }, 403);
    const from = String(url.searchParams.get('from') || ''), to = String(url.searchParams.get('to') || '');
    const row = await env.DB.prepare(`SELECT COUNT(DISTINCT o.id) AS orders_count,
      COALESCE(SUM(CASE WHEN p.id IS NOT NULL THEN p.amount ELSE 0 END),0) AS income,
      COALESCE((SELECT SUM(parts_cost) FROM pos_service_orders WHERE (?='' OR substr(created_at,1,10)>=?) AND (?='' OR substr(created_at,1,10)<=?)),0) AS parts_cost,
      COALESCE((SELECT SUM(GREATEST(final_total-COALESCE((SELECT SUM(amount) FROM pos_service_payments sp WHERE sp.order_id=so.id),0),0)) FROM pos_service_orders so WHERE so.status NOT IN ('Cancelado','Sin reparación') AND (?='' OR substr(so.created_at,1,10)>=?) AND (?='' OR substr(so.created_at,1,10)<=?)),0) AS pending,
      COALESCE((SELECT SUM(commission_amount) FROM pos_service_orders so WHERE commission_status IN ('pending','paid') AND (?='' OR substr(so.commission_settled_at,1,10)>=?) AND (?='' OR substr(so.commission_settled_at,1,10)<=?)),0) AS technician_commissions
      FROM pos_service_orders o LEFT JOIN pos_service_payments p ON p.order_id=o.id
      WHERE (?='' OR substr(o.created_at,1,10)>=?) AND (?='' OR substr(o.created_at,1,10)<=?)`).bind(from,from,to,to,from,from,to,to,from,from,to,to,from,from,to,to).first<any>();
    return json({ summary: row || { orders_count: 0, income: 0, parts_cost: 0, pending: 0 } });
  }
  if (url.searchParams.get('resource') === 'backup') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede descargar respaldos.' }, 403);
    const [users, employees, notifications, shifts, movements, businessState, syncedSales, serviceOrders, serviceEvents, servicePayments, serviceParts, serviceSettings, serviceTechnicianCommissions, technicianSettlements, technicianSettlementItems, servicePhotos, returns] = await Promise.all([
      env.DB.prepare('SELECT id, name, username, password_hash, role, permissions, created_at FROM pos_users ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_employees ORDER BY id').all<any>(),
      env.DB.prepare('SELECT id, type, severity, message, actor_name, entity_type, entity_id, details, created_at, read_at FROM pos_notifications ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_cash_shifts ORDER BY id').all<any>(),
      env.DB.prepare('SELECT id, shift_id, type, amount, reason, actor_name, created_at FROM pos_cash_movements ORDER BY id').all<any>(),
      env.DB.prepare('SELECT id, products, sales, categories, receipt_settings, category_catalog_version, updated_at FROM pos_business_state ORDER BY id').all<any>(),
      env.DB.prepare('SELECT client_id, sale_number, payload, synced_at FROM pos_synced_sales ORDER BY synced_at').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_orders ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_order_events ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_payments ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_parts ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_settings ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_technician_commissions ORDER BY technician_id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_technician_settlements ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_technician_settlement_items ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_service_photos ORDER BY id').all<any>(),
      env.DB.prepare('SELECT * FROM pos_returns ORDER BY id').all<any>(),
    ]);
    const createdAt = now();
    const backup = { format: 'cellhouse-pos-backup', version: 6, createdAt, data: { users: users.results || [], employees: employees.results || [], notifications: notifications.results || [], cashShifts: shifts.results || [], cashMovements: movements.results || [], businessState: businessState.results || [], syncedSales: syncedSales.results || [], serviceOrders: serviceOrders.results || [], serviceEvents: serviceEvents.results || [], servicePayments: servicePayments.results || [], serviceParts: serviceParts.results || [], serviceSettings: serviceSettings.results || [], serviceTechnicianCommissions: serviceTechnicianCommissions.results || [], technicianSettlements: technicianSettlements.results || [], technicianSettlementItems: technicianSettlementItems.results || [], servicePhotos:servicePhotos.results||[], returns:returns.results||[] } };
    const stamp = createdAt.slice(0, 19).replace(/[:T]/g, '-');
    return new Response(JSON.stringify(backup, null, 2), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="ditaessencepos-respaldo-${stamp}.json"`, 'Cache-Control': 'no-store' } });
  }
  if (url.searchParams.get('resource') === 'cash-closures') {
    if (!user || user.role !== 'owner') return json({ error: 'Solo el propietario puede consultar los cierres de caja.' }, 403);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const closures = await env.DB.prepare(`SELECT s.id, s.opening_amount, s.cash_sales, s.card_sales, s.transfer_sales, s.other_sales, s.repair_cash_income, s.repair_card_income, s.repair_transfer_income, s.sales_count, s.units_sold, s.cash_entries, s.cash_outs, s.expected_amount, s.counted_amount, s.difference, s.opened_by_name, s.opened_at, s.closed_by_name, s.closed_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'type', m.type, 'amount', m.amount, 'reason', m.reason, 'actor_name', m.actor_name, 'created_at', m.created_at) ORDER BY m.created_at) FROM pos_cash_movements m WHERE m.shift_id=s.id), '[]'::jsonb) AS movements
      FROM pos_cash_shifts s
      WHERE s.status='closed'
        AND (? = '' OR substr(s.closed_at, 1, 10) >= ?)
        AND (? = '' OR substr(s.closed_at, 1, 10) <= ?)
      ORDER BY s.closed_at DESC
      LIMIT 200`).bind(from, from, to, to).all<any>();
    return json({ closures: closures.results || [] });
  }
  const workers = user?.role === 'owner' ? await env.DB.prepare("SELECT id, name, username, role, permissions FROM pos_users WHERE role='worker' ORDER BY name").all<any>() : null;
  const notifications = user?.role === 'owner' ? await env.DB.prepare('SELECT * FROM pos_notifications ORDER BY id DESC LIMIT 200').all<any>() : null;
  const state = user ? await env.DB.prepare('SELECT products, sales, categories, receipt_settings, category_catalog_version, updated_at FROM pos_business_state WHERE business_id=?').bind(user.businessId).first<any>() : null;
  return json({ initialized: Number(count?.count || 0) > 0, setupProtected: Boolean(SETUP_TOKEN), user, workers: workers?.results.map(worker => ({ ...worker, permissions: JSON.parse(worker.permissions || '[]') })) || [], notifications: notifications?.results || [], cashShift: await activeCashShift(user), businessState: state ? { products: JSON.parse(state.products || '[]'), sales: JSON.parse(state.sales || '[]'), categories: Number(state.category_catalog_version || 0) >= 1 ? JSON.parse(state.categories || '[]') : [], receiptSettings: receiptSettings(JSON.parse(state.receipt_settings || '{}')), updatedAt: state.updated_at } : null });
}
export async function POST(request: Request) {
  try {
  await tables(); const data = await request.json<any>();
  if (data.action === 'demo-login') {
    if (!DEMO_MODE) return json({ error: 'La demostración no está disponible en esta instalación.' }, 404);
    let user = await env.DB.prepare("SELECT * FROM pos_users WHERE username='demostracion'").first<any>();
    if (!user) {
      const created = await env.DB.prepare('INSERT INTO pos_users (name, username, password_hash, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('Demostración', 'demostracion', await hashPassword(token()), 'owner', '[]', now()).run();
      user = { id: created.meta.last_row_id, name: 'Demostración', username: 'demostracion', role: 'owner', permissions: '[]' };
    }
    await seedDemoData();
    const safeUser = { id: user.id, name: user.name, username: user.username, role: user.role, permissions: JSON.parse(user.permissions || '[]') };
    return json({ user: safeUser, cashShift: await activeCashShift(safeUser) }, 200, { 'Set-Cookie': await session(Number(user.id)) });
  }
  if (['create-technician-settlement','pay-technician-settlements'].includes(data.action)) {
    const actor=await current(request);
    if(!actor || actor.role!=='owner') return json({error:'Solo el propietario puede liquidar y pagar.'},403);
    const result=data.action==='create-technician-settlement'?await createSettlement(env.DB,data,actor):await paySettlements(env.DB,data,actor);
    return json({ok:true,...result,cashShift:await activeCashShift(actor)});
  }
  if (data.action === 'setup') {
    const count = await env.DB.prepare('SELECT COUNT(*) as count FROM pos_users').first<{ count: number }>();
    if (Number(count?.count || 0) > 0) return json({ error: 'El propietario ya fue creado.' }, 409);
    if (SETUP_TOKEN && String(data.setupToken || '').trim() !== SETUP_TOKEN) return json({ error: 'El código de activación no es válido.' }, 403);
    if (!data.name?.trim() || !data.username?.trim() || !data.password || data.password.length < 6) return json({ error: 'Completa los datos y usa una contraseña de al menos 6 caracteres.' }, 400);
    const result = await env.DB.prepare('INSERT INTO pos_users (name, username, password_hash, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(data.name.trim(), data.username.trim().toLowerCase(), await hashPassword(data.password), 'owner', '[]', now()).run();
    return json({ user: { id: result.meta.last_row_id, name: data.name.trim(), username: data.username.trim(), role: 'owner', permissions: [] } }, 201, { 'Set-Cookie': await session(Number(result.meta.last_row_id)) });
  }
  if (data.action === 'login') {
    const user = await env.DB.prepare('SELECT * FROM pos_users WHERE username=?').bind(String(data.username || '').trim().toLowerCase()).first<any>();
    if (!user || !(await validPassword(String(data.password || ''), user.password_hash))) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
    const safeUser = { id: user.id, name: user.name, username: user.username, role: user.role, permissions: JSON.parse(user.permissions || '[]') };
    return json({ user: safeUser, cashShift: await activeCashShift(safeUser) }, 200, { 'Set-Cookie': await session(user.id) });
  }
  if (data.action === 'open-cash') {
    const actor = await current(request); if (!actor || !canUseCash(actor)) return json({ error: 'No tienes permiso para abrir la caja.' }, 403);
    const openingAmount = Math.round(Number(data.openingAmount)); if (!Number.isFinite(openingAmount) || openingAmount < 0) return json({ error: 'Ingresa un fondo inicial válido.' }, 400);
    const existing = await activeCashShift(actor); if (existing) return json({ shift: existing, alreadyOpen: true });
    try {
      const result = await env.DB.prepare("INSERT INTO pos_cash_shifts (business_id, status, opened_by_user_id, opened_by_name, opening_amount, cash_sales, cash_entries, cash_outs, opened_at) VALUES (?, 'open', ?, ?, ?, 0, 0, 0, ?)").bind(actor.businessId, actor.id, actor.name, openingAmount, now()).run();
      if (actor.role === 'worker') await env.DB.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('Apertura de caja', 'info', `${actor.name} abrió la caja principal.`, actor.name, 'turno de caja', String(result.meta.last_row_id), JSON.stringify({ fondo_inicial: cop(openingAmount) }), now()).run();
      return json({ shift: await activeCashShift(actor) }, 201);
    } catch {
      const shift = await activeCashShift(actor); return shift ? json({ shift, alreadyOpen: true }) : json({ error: 'No fue posible abrir la caja.' }, 409);
    }
  }
  if (data.action === 'record-cash-sale') {
    const actor = await current(request); if (!actor || (actor.role !== 'owner' && !actor.permissions?.includes('Punto de venta'))) return json({ error: 'No tienes permiso para registrar ventas.' }, 403);
    const amount = Math.round(Number(data.amount)); if (!Number.isFinite(amount) || amount < 0) return json({ error: 'Monto de venta no válido.' }, 400);
    if (amount === 0) return json({ shift: await activeCashShift(actor) });
    const shift = await env.DB.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(actor.businessId).first<any>(); if (!shift) return json({ error: 'La caja está cerrada.' }, 409);
    await env.DB.prepare("UPDATE pos_cash_shifts SET cash_sales=cash_sales+? WHERE id=? AND status='open'").bind(amount, shift.id).run();
    return json({ shift: await activeCashShift(actor) });
  }
  if (data.action === 'sync-sales') {
    const actor = await current(request);
    if (!actor || (actor.role !== 'owner' && !actor.permissions?.includes('Punto de venta'))) return json({ error: 'No tienes permiso para registrar ventas.' }, 403);
    const incoming = Array.isArray(data.sales) ? data.sales.slice(0, 200) : [];
    if (!incoming.length) return json({ error: 'No hay ventas pendientes para sincronizar.' }, 400);
    const result = await env.DB.transaction(async db => {
      await db.prepare('INSERT INTO pos_business_state (id, business_id, products, sales, categories, receipt_settings, category_catalog_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING').bind(actor.businessId, actor.businessId, '[]', '[]', '[]', JSON.stringify(DEFAULT_RECEIPT_SETTINGS), now()).run();
      await db.prepare('SELECT id FROM pos_business_state WHERE business_id=? FOR UPDATE').bind(actor.businessId).first();
      const state = await db.prepare('SELECT products, sales, categories, receipt_settings FROM pos_business_state WHERE business_id=?').bind(actor.businessId).first<any>();
      let products = JSON.parse(state?.products || '[]');
      const savedSales = JSON.parse(state?.sales || '[]');
      const categories = JSON.parse(state?.categories || '[]');
      let nextNumber = savedSales.reduce((highest: number, sale: any) => Math.max(highest, Number(String(sale?.number || '').replace(/\D/g, '')) || 0), 0) + 1;
      const synced: { clientId: string; number: string }[] = [];
      let applied = 0;

      for (const entry of incoming) {
        const clientId = String(entry?.clientId || entry?.sale?.clientId || '').trim();
        const shiftId = Number(entry?.shiftId);
        const source = entry?.sale || {};
        if (!clientId || clientId.length > 120 || !Number.isInteger(shiftId) || shiftId < 1) return { error: 'Una venta pendiente no contiene una identificación válida.', status: 400 };
        const previous = await db.prepare('SELECT sale_number FROM pos_synced_sales WHERE business_id=? AND client_id=?').bind(actor.businessId, clientId).first<{ sale_number: string }>();
        if (previous) { synced.push({ clientId, number: previous.sale_number }); continue; }
        const shift = await db.prepare('SELECT id, status FROM pos_cash_shifts WHERE id=? AND business_id=?').bind(shiftId, actor.businessId).first<any>();
        if (!shift) return { error: 'No encontramos el turno de caja asociado con una venta pendiente.', status: 409 };
        const items = (Array.isArray(source.items) ? source.items : []).map((item: any) => {
          const originalPrice = Math.max(0, Math.round(Number(item.originalPrice ?? item.price) || 0));
          const price = Math.max(0, Math.min(originalPrice, Math.round(Number(item.price) || 0)));
          return { id: item.id, name: String(item.name || ''), qty: Math.max(0, Math.floor(Number(item.qty) || 0)), price, originalPrice, discount: Math.max(0, originalPrice - price), isGift: price === 0, cost: Math.max(0, Math.round(Number(item.cost) || 0)) };
        }).filter((item: any) => item.qty > 0 && item.name);
        const total = items.reduce((sum: number, item: any) => sum + item.qty * item.price, 0);
        const paymentMethods = ['Efectivo', 'Tarjeta', 'Transferencia'];
        const requestedBreakdown = source.paymentBreakdown && typeof source.paymentBreakdown === 'object' ? source.paymentBreakdown : { [String(source.payment || 'Efectivo')]: total };
        // A gift sale has a valid zero total and therefore does not require a payment method.
        const paymentBreakdown = total === 0 ? {} : Object.fromEntries(paymentMethods.map(method => [method, Math.max(0, Math.round(Number(requestedBreakdown[method]) || 0))]).filter(([, amount]) => amount > 0));
        const paymentTotal = Object.values(paymentBreakdown).reduce((sum: number, amount: any) => sum + Number(amount), 0);
        if (paymentTotal !== total || (total > 0 && !Object.keys(paymentBreakdown).length)) return { error: 'Los medios de pago deben sumar exactamente el total de la venta.', status: 400 };
        const payment = total === 0 ? 'Obsequio' : Object.keys(paymentBreakdown).length > 1 ? 'Pago dividido' : Object.keys(paymentBreakdown)[0];
        const createdAt = Number.isFinite(new Date(source.createdAt).getTime()) ? new Date(source.createdAt).toISOString() : now();
        if (!items.length || !Number.isFinite(total) || total < 0) return { error: 'Una venta pendiente contiene información incompleta.', status: 400 };
        const requestedNumber = String(source.number || '');
        const numberInUse = savedSales.some((sale: any) => sale.number === requestedNumber);
        const saleNumber = requestedNumber && !numberInUse ? requestedNumber : `V-${String(nextNumber++).padStart(5, '0')}`;
        nextNumber = Math.max(nextNumber, (Number(saleNumber.replace(/\D/g, '')) || 0) + 1);
        const sale = { clientId, number: saleNumber, createdAt, date: String(source.date || createdAt.slice(0, 10)), payment, paymentBreakdown, total, items, syncedAt: now() };
        const quantities = new Map(items.map((item: any) => [String(item.id), item.qty]));
        products = products.map((product: any) => quantities.has(String(product.id)) ? { ...product, stock: Math.max(0, Number(product.stock || 0) - Number(quantities.get(String(product.id)) || 0)) } : product);
        savedSales.unshift(sale);
        const units = items.reduce((sum: number, item: any) => sum + item.qty, 0);
        const cashAmount = Number(paymentBreakdown.Efectivo || 0), cardAmount = Number(paymentBreakdown.Tarjeta || 0), transferAmount = Number(paymentBreakdown.Transferencia || 0);
        await db.prepare("UPDATE pos_cash_shifts SET cash_sales=cash_sales+?, card_sales=card_sales+?, transfer_sales=transfer_sales+?, sales_count=sales_count+1, units_sold=units_sold+?, expected_amount=CASE WHEN status='closed' THEN COALESCE(expected_amount, 0)+? ELSE expected_amount END, difference=CASE WHEN status='closed' THEN COALESCE(difference, 0)-? ELSE difference END WHERE id=?").bind(cashAmount, cardAmount, transferAmount, units, cashAmount, cashAmount, shiftId).run();
        await db.prepare('INSERT INTO pos_synced_sales (business_id, client_id, sale_number, payload, synced_at) VALUES (?, ?, ?, ?, ?) RETURNING client_id').bind(actor.businessId, clientId, saleNumber, JSON.stringify(sale), now()).run();
        const adjustedItems = items.filter((item: any) => item.price < item.originalPrice);
        if (adjustedItems.length) {
          const gifts = adjustedItems.filter((item: any) => item.isGift);
          const discountAmount = adjustedItems.reduce((sum: number, item: any) => sum + item.discount * item.qty, 0);
          const summary = gifts.length
            ? `${actor.name} registró ${gifts.length === 1 ? 'un obsequio' : `${gifts.length} obsequios`} en la venta ${saleNumber}.`
            : `${actor.name} aplicó un descuento en la venta ${saleNumber}.`;
          await db.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind('Descuento u obsequio', 'critical', summary, actor.name, 'venta', saleNumber, JSON.stringify({
              venta: saleNumber,
              descuento_total: cop(discountAmount),
              obsequios: gifts.length,
              productos: adjustedItems.map((item: any) => `${item.name} ×${item.qty}: ${cop(item.originalPrice)} → ${item.isGift ? 'Obsequio' : cop(item.price)} (ajuste ${cop(item.discount * item.qty)})`).join(' · ')
            }), now()).run();
        }
        synced.push({ clientId, number: saleNumber });
        applied += 1;
      }

      const updatedAt = now();
      await db.prepare('UPDATE pos_business_state SET products=?, sales=?, categories=?, category_catalog_version=1, updated_at=? WHERE business_id=?').bind(JSON.stringify(products), JSON.stringify(savedSales), JSON.stringify(categories), updatedAt, actor.businessId).run();
      if (applied > 0 && incoming.some((entry: any) => entry?.offline)) await db.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('Sincronización sin conexión', 'info', `${applied} venta${applied === 1 ? '' : 's'} pendiente${applied === 1 ? '' : 's'} se sincronizaron correctamente.`, actor.name, 'ventas', JSON.stringify({ ventas_sincronizadas: applied }), now()).run();
      return { products, sales: savedSales, categories, receiptSettings: receiptSettings(JSON.parse(state?.receipt_settings || '{}')), synced, updatedAt };
    });
    if ('error' in result) return json({ error: result.error }, result.status);
    return json({ ok: true, businessState: result, cashShift: await activeCashShift(actor) });
  }
  if (data.action === 'void-cash-sale') {
    const actor = await current(request); if (!actor || (actor.role !== 'owner' && !actor.permissions?.includes('Ventas'))) return json({ error: 'No tienes permiso para anular ventas.' }, 403);
    const amount = Math.round(Number(data.amount)); if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Monto de venta no válido.' }, 400);
    const shift = await env.DB.prepare("SELECT id, cash_sales FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(actor.businessId).first<any>(); if (!shift) return json({ error: 'La caja está cerrada. Abre caja para ajustar esta venta.' }, 409);
    await env.DB.prepare("UPDATE pos_cash_shifts SET cash_sales=GREATEST(0, cash_sales-?) WHERE id=? AND status='open'").bind(amount, shift.id).run();
    return json({ shift: await activeCashShift(actor) });
  }
  if (data.action === 'create-service-order') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para crear órdenes de servicio.' }, 403);
    const required = ['customerName', 'customerPhone', 'customerDocument', 'deviceBrand', 'deviceModel'];
    if (required.some(key => !String(data[key] || '').trim())) return json({ error: 'Completa cliente, teléfono, documento, marca y modelo.' }, 400);
    const photos=data.photos||[];
    if(!Array.isArray(photos)||photos.length>4||photos.some((p:any)=>typeof p!=='string'||p.length>700000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p)))return json({error:'Fotos no válidas. Adjunta hasta 4 imágenes.'},400);
    const initialPayment = Number(data.initialPayment || 0), initialMethod = String(data.initialPaymentMethod || 'Efectivo');
    if (!Number.isSafeInteger(initialPayment) || initialPayment < 0 || !['Efectivo','Tarjeta','Transferencia'].includes(initialMethod)) return json({error:'Abono inicial no válido.'},400);
    const promised = String(data.estimatedDeliveryAt || '');
    if (promised && !Number.isFinite(Date.parse(promised))) return json({error:'Fecha de entrega no válida.'},400);
    const createdAt = now(), clientRef = String(data.clientId || '').trim() || null;
    if (clientRef) { const previous = await env.DB.prepare('SELECT id,order_number FROM pos_service_orders WHERE business_id=? AND client_ref=?').bind(actor.businessId, clientRef).first<any>(); if (previous) return json({ order: { id: previous.id, order_number: previous.order_number }, alreadyCreated: true, cashShift: await activeCashShift(actor) }); }
    const result = await env.DB.transaction(async db => {
      await db.prepare("SELECT pg_advisory_xact_lock(781234)").first();
      if (clientRef) {
        const previous = await db.prepare('SELECT id,order_number FROM pos_service_orders WHERE business_id=? AND client_ref=?').bind(actor.businessId, clientRef).first<any>();
        if (previous) return {id:previous.id,orderNumber:previous.order_number};
      }
      const cashShift = initialPayment > 0 ? await db.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE").bind(actor.businessId).first<any>() : null;
      if (initialPayment > 0 && !cashShift) throw new Error('Abre caja antes de registrar un abono.');
      const next = await db.prepare('SELECT COALESCE(MAX(id),0)+1 AS number FROM pos_service_orders WHERE business_id=?').bind(actor.businessId).first<any>();
      const orderNumber = String(Number(next?.number || 1)).padStart(3, '0');
      const deviceType = ['Celular','Computador portátil','Computador de escritorio','Tablet','Consola','Otro'].includes(String(data.deviceType)) ? String(data.deviceType) : 'Celular';
      const insert = await db.prepare(`INSERT INTO pos_service_orders (business_id,order_number,customer_name,customer_phone,customer_document,device_type,device_brand,device_model,device_identifier,device_password,accessories,physical_condition,reported_issue,planned_service,notes,status,estimated_total,parts_cost,final_total,created_by_user_id,created_by_name,created_at,updated_at,client_ref,technician_user_id,technician_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Recibido',?,?,?,?,?,?,?, ?,NULL,'')`).bind(actor.businessId,orderNumber,String(data.customerName).trim(),String(data.customerPhone).trim(),String(data.customerDocument||'').trim(),deviceType,String(data.deviceBrand).trim(),String(data.deviceModel).trim(),String(data.deviceIdentifier||'').trim(),String(data.devicePassword||'').trim(),String(data.accessories||'').trim(),String(data.physicalCondition||'').trim(),String(data.reportedIssue||'').trim(),String(data.plannedService||'').trim(),String(data.notes||'').trim(),Math.max(0,Math.round(Number(data.estimatedTotal)||0)),Math.max(0,Math.round(Number(data.partsCost)||0)),Math.max(0,Math.round(Number(data.finalTotal)||0)),actor.id,actor.name,createdAt,createdAt,clientRef).run();
      const id = Number(insert.meta.last_row_id);
      for(const photo of photos)await db.prepare('INSERT INTO pos_service_photos (business_id,order_id,image) VALUES (?,?,?)').bind(actor.businessId,id,photo).run();
      await db.prepare('UPDATE pos_service_orders SET estimated_delivery_at=? WHERE id=? AND business_id=?').bind(promised||null,id,actor.businessId).run();
      if (initialPayment > 0) {
        const column = initialMethod==='Efectivo'?'repair_cash_income':initialMethod==='Tarjeta'?'repair_card_income':'repair_transfer_income';
        await db.prepare('INSERT INTO pos_service_payments (business_id,order_id,shift_id,kind,payment_method,amount,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(actor.businessId,id,cashShift.id,'Anticipo',initialMethod,initialPayment,actor.name,createdAt).run();
        await db.prepare(`UPDATE pos_cash_shifts SET ${column}=${column}+? WHERE id=?`).bind(initialPayment,cashShift.id).run();
      }
      await db.prepare("INSERT INTO pos_service_order_events (business_id,order_id,event_type,to_status,note,actor_name,created_at) VALUES (? ,?,'Creación','Recibido',?,?,?)").bind(actor.businessId,id,'Equipo recibido y orden creada.',actor.name,createdAt).run();
      return { id, orderNumber };
    });
    return json({ order: { id: result.id, order_number: result.orderNumber }, cashShift: await activeCashShift(actor) }, 201);
  }
  if (data.action === 'save-service-settings') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede configurar comisiones.' }, 403);
    const percent = Number(data.technicianCommissionPercent); if (!Number.isFinite(percent) || percent < 0 || percent > 100) return json({ error: 'El porcentaje debe estar entre 0 y 100.' }, 400);
    await env.DB.prepare('UPDATE pos_service_settings SET technician_commission_percent=?,updated_by_name=?,updated_at=? WHERE id=1').bind(percent,owner.name,now()).run();
    return json({ ok: true, percent });
  }
  if (data.action === 'create-employee') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede agregar trabajadores.' }, 403);
    const name=String(data.name||'').trim(),position=String(data.position||'').trim(),isTechnician=position==='Técnico'||Boolean(data.isTechnician); if(!name)return json({error:'Escribe el nombre del trabajador.'},400);
    const result=await env.DB.prepare('INSERT INTO pos_employees (name,phone,document,position,is_technician,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(name,String(data.phone||'').trim(),String(data.document||'').trim(),position,isTechnician?1:0,data.active===false?0:1,now(),now()).run();
    return json({ employee:{id:result.meta.last_row_id,name,phone:String(data.phone||'').trim(),document:String(data.document||'').trim(),position,is_technician:isTechnician?1:0,active:data.active===false?0:1} },201);
  }
  if (data.action === 'update-employee') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede editar trabajadores.' }, 403);
    const id=Number(data.employeeId),name=String(data.name||'').trim(),position=String(data.position||'').trim(),isTechnician=position==='Técnico'||Boolean(data.isTechnician); if(!id||!name)return json({error:'Datos del trabajador incompletos.'},400);
    await env.DB.prepare('UPDATE pos_employees SET name=?,phone=?,document=?,position=?,is_technician=?,active=?,updated_at=? WHERE id=?').bind(name,String(data.phone||'').trim(),String(data.document||'').trim(),position,isTechnician?1:0,data.active===false?0:1,now(),id).run(); return json({ok:true});
  }
  if (data.action === 'delete-employee') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede eliminar trabajadores.' }, 403);
    await env.DB.prepare('DELETE FROM pos_employees WHERE id=?').bind(Number(data.employeeId)).run(); return json({ok:true});
  }
  if (data.action === 'assign-service-technician') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para asignar técnicos.' }, 403);
    const orderId = Number(data.orderId), technicianId = Number(data.technicianUserId);
    const technician = await env.DB.prepare("SELECT id,name FROM pos_employees WHERE id=? AND is_technician=1 AND active=1").bind(technicianId).first<any>(); if (!technician) return json({ error: 'Selecciona un técnico válido.' }, 400);
    const order = await env.DB.prepare('SELECT order_number,commission_status FROM pos_service_orders WHERE id=?').bind(orderId).first<any>(); if (!order) return json({ error: 'No encontramos esa orden.' }, 404);
    if (['pending','paid'].includes(order.commission_status)) return json({ error: 'La orden ya fue liquidada y no permite cambiar el técnico.' }, 409);
    const changedAt=now(); await env.DB.batch([env.DB.prepare("UPDATE pos_service_orders SET technician_user_id=?,technician_name=?,commission_status='not_applicable',updated_at=? WHERE id=?").bind(technician.id,technician.name,changedAt,orderId),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Asignación',?,?,?)").bind(orderId,`Técnico asignado: ${technician.name}.`,actor.name,changedAt)]);
    return json({ ok: true });
  }
  if (data.action === 'save-service-technician-commission') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede configurar comisiones.' }, 403);
    const technicianId = Number(data.technicianId), percent = Number(data.commissionPercent);
    if (!Number.isInteger(technicianId) || technicianId < 1 || !Number.isFinite(percent) || percent < 0 || percent > 100) return json({ error: 'El porcentaje debe estar entre 0 y 100.' }, 400);
    await env.DB.prepare('INSERT INTO pos_service_technician_commissions (technician_id,commission_percent,updated_by_name,updated_at) VALUES (?,?,?,?) ON CONFLICT (technician_id) DO UPDATE SET commission_percent=EXCLUDED.commission_percent,updated_by_name=EXCLUDED.updated_by_name,updated_at=EXCLUDED.updated_at RETURNING technician_id').bind(technicianId,percent,owner.name,now()).run();
    const saved = await env.DB.prepare('SELECT commission_percent FROM pos_service_technician_commissions WHERE technician_id=?').bind(technicianId).first<any>();
    return json({ ok: true, percent: Number(saved?.commission_percent ?? percent) });
  }
  if (data.action === 'save-employee-salary') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede configurar sueldos.' }, 403);
    const employeeId = Number(data.employeeId), salary = Number(data.salary);
    if (!Number.isInteger(employeeId) || employeeId < 1 || !Number.isFinite(salary) || salary < 0) return json({ error: 'Sueldo no válido.' }, 400);
    await env.DB.prepare('INSERT INTO pos_employee_payroll (employee_id,salary,updated_by_name,updated_at) VALUES (?,?,?,?) ON CONFLICT (employee_id) DO UPDATE SET salary=EXCLUDED.salary,updated_by_name=EXCLUDED.updated_by_name,updated_at=EXCLUDED.updated_at RETURNING employee_id').bind(employeeId,salary,owner.name,now()).run();
    return json({ ok: true, salary });
  }
  if (data.action === 'update-service-order') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para editar órdenes de servicio.' }, 403);
    const id = Number(data.orderId); if (!Number.isInteger(id) || id < 1) return json({ error: 'Orden no válida.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM pos_service_orders WHERE id=?').bind(id).first(); if (!existing) return json({ error: 'No encontramos esa orden.' }, 404);
    await env.DB.prepare(`UPDATE pos_service_orders SET customer_name=?,customer_phone=?,customer_document=?,device_brand=?,device_model=?,device_identifier=?,device_password=?,accessories=?,physical_condition=?,reported_issue=?,planned_service=?,notes=?,estimated_total=?,parts_cost=?,final_total=?,updated_at=? WHERE id=?`).bind(String(data.customerName||'').trim(),String(data.customerPhone||'').trim(),String(data.customerDocument||'').trim(),String(data.deviceBrand||'').trim(),String(data.deviceModel||'').trim(),String(data.deviceIdentifier||'').trim(),String(data.devicePassword||'').trim(),String(data.accessories||'').trim(),String(data.physicalCondition||'').trim(),String(data.reportedIssue||'').trim(),String(data.plannedService||'').trim(),String(data.notes||'').trim(),Math.max(0,Math.round(Number(data.estimatedTotal)||0)),Math.max(0,Math.round(Number(data.partsCost)||0)),Math.max(0,Math.round(Number(data.finalTotal)||0)),now(),id).run();
    await env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Edición',?,?,?)").bind(id,String(data.changeNote||'Datos de la orden actualizados.'),actor.name,now()).run();
    return json({ ok: true });
  }
  if (data.action === 'delete-service-order') {
    return json({ error: 'Las órdenes de servicio no se pueden borrar. Conserva el historial completo para control y trazabilidad.' }, 403);
  }
  if (data.action === 'process-service-order') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para procesar órdenes.' }, 403);
    const id = Number(data.orderId); if (!Number.isInteger(id) || id < 1) return json({ error: 'Orden no válida.' }, 400);
    const order = await env.DB.prepare('SELECT order_number,status,commission_status FROM pos_service_orders WHERE id=?').bind(id).first<any>(); if (!order) return json({ error: 'No encontramos esa orden.' }, 404);
    if(['Entregado','Cancelado','Sin reparación'].includes(order.status))return json({error:'Esta orden ya está cerrada.'},409);
    const technicianId=Number(data.technicianUserId||0),technician=await env.DB.prepare("SELECT id,name FROM pos_employees WHERE id=? AND is_technician=1 AND active=1").bind(technicianId).first<any>();
    if(!technician)return json({error:'Selecciona el técnico activo que realizó la reparación.'},400);
    if(['pending','paid'].includes(order.commission_status))return json({error:'Esta orden ya generó una comisión y no permite cambiar de técnico.'},409);
    const diagnosis=String(data.diagnosis||'').trim(), report=String(data.technicalReport||'').trim(), parts=String(data.partsUsed||'').trim();
    const suppliedParts=(Array.isArray(data.parts)?data.parts:[]).map((item:any)=>({amount:Math.max(0,Math.round(Number(item?.amount)||0)),paymentMethod:['Efectivo','Tarjeta','Transferencia','Crédito','Otro'].includes(String(item?.paymentMethod))?String(item.paymentMethod):'Efectivo',supplier:String(item?.supplier||'').trim().slice(0,160),note:String(item?.note||'').trim().slice(0,500)})).filter((item:any)=>item.amount>0);
    const finalTotal=Math.max(0,Math.round(Number(data.finalTotal)||0)),partsCost=suppliedParts.reduce((total:number,item:any)=>total+item.amount,0);
    if (!diagnosis && !report) return json({ error: 'Registra el diagnóstico o el trabajo técnico realizado.' }, 400);
    if(data.markReady===true&&finalTotal<=0)return json({error:'Registra el valor final real antes de dejar el equipo listo.'},400);
    const changedAt=now();
    await env.DB.batch([
      env.DB.prepare("UPDATE pos_service_orders SET technician_user_id=?,technician_name=?,commission_status='not_applicable',diagnosis=?,technical_report=?,parts_used=?,repair_completed_at=CASE WHEN ?=1 THEN ? ELSE repair_completed_at END,final_total=?,parts_cost=?,updated_at=? WHERE id=?").bind(technician.id,technician.name,diagnosis,report,parts,data.markReady===true?1:0,changedAt,finalTotal,partsCost,changedAt,id),
      env.DB.prepare('DELETE FROM pos_service_parts WHERE order_id=?').bind(id),
      ...suppliedParts.map((item:any)=>env.DB.prepare('INSERT INTO pos_service_parts (order_id,amount,payment_method,supplier,note,actor_name,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,item.amount,item.paymentMethod,item.supplier,item.note,actor.name,changedAt)),
      env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Proceso técnico',?,?,?)").bind(id,`${technician.name} tomó la orden y registró la reparación terminada. La comisión queda pendiente hasta la entrega al cliente.`,actor.name,changedAt),
      ...(data.markReady===true?[env.DB.prepare("UPDATE pos_service_orders SET status='Reparado / listo para entregar' WHERE id=?").bind(id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,to_status,note,actor_name,created_at) VALUES (?,'Cambio de estado','Reparado / listo para entregar',?,?,?)").bind(id,'Proceso técnico completado.',actor.name,changedAt)]:[]),
    ]);
    return json({ ok:true });
  }
  if (data.action === 'update-service-status') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para cambiar el estado.' }, 403);
    const id = Number(data.orderId), status = String(data.status || ''), note = String(data.note || '').trim();
    if (!Number.isInteger(id) || !serviceStatuses.includes(status)) return json({ error: 'Orden o estado no válido.' }, 400);
    if(status==='Reparado / listo para entregar')return json({error:'Completa el formulario de reparación para dejar el equipo listo.'},409);
    if (['Cancelado','Sin reparación'].includes(status) && !note) return json({ error: 'Debes explicar por qué la orden queda en ese estado.' }, 400);
    const order = await env.DB.prepare('SELECT order_number,status,technician_user_id,technician_name,final_total,estimated_total,parts_cost,commission_status,COALESCE((SELECT SUM(amount) FROM pos_service_payments WHERE order_id=pos_service_orders.id),0) AS paid_total FROM pos_service_orders WHERE id=?').bind(id).first<any>(); if (!order) return json({ error: 'No encontramos esa orden.' }, 404);
    if(status==='Entregado'&&order.status!=='Reparado / listo para entregar')return json({error:'Primero el técnico debe completar la reparación y dejar el equipo listo.'},409);
    const finalTotal = data.finalTotal == null || data.finalTotal === '' ? Number(order.final_total || 0) : Math.max(0, Math.round(Number(data.finalTotal) || 0));
    const deliveredPartsCost = data.partsCost == null || data.partsCost === '' ? Number(order.parts_cost || 0) : Math.max(0, Math.round(Number(data.partsCost) || 0));
    if (status === 'Entregado' && finalTotal <= 0) return json({ error: 'Registra el valor final de la reparación antes de entregar.' }, 409);
    const deliveryTechnician=status==='Entregado'&&order.technician_user_id?await env.DB.prepare(`SELECT e.id,e.name,c.commission_percent FROM pos_employees e JOIN pos_service_technician_commissions c ON c.technician_id=e.id WHERE e.id=? AND e.is_technician=1 AND e.active=1`).bind(order.technician_user_id).first<any>():null;
    if(status==='Entregado'&&!deliveryTechnician)return json({error:'La reparación debe ser tomada por un técnico con porcentaje personalizado antes de entregarla.'},409);
    const recipient=String(data.deliveryRecipient||'').trim(), recipientDocument=String(data.deliveryDocument||'').trim(), deliveryNotes=String(data.deliveryNotes||'').trim();
    if (status === 'Entregado' && !recipient) return json({ error: 'Registra quién recibe el equipo para completar la salida.' }, 400);
    const changedAt = now();
    const paymentMethod=String(data.paymentMethod||'Efectivo');
    if(status==='Entregado'&&!['Efectivo','Tarjeta','Transferencia'].includes(paymentMethod)) return json({error:'Selecciona un medio de pago válido.'},400);
    const outstanding=Math.max(0,finalTotal-Number(order.paid_total||0));
    const shift=status==='Entregado'&&outstanding>0?await env.DB.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(actor.businessId).first<any>():null;
    if(status==='Entregado'&&outstanding>0&&!shift)return json({error:'Abre la caja antes de entregar para registrar automáticamente el pago.'},409);
    const updates:any[]=[env.DB.prepare("UPDATE pos_service_orders SET status=?,updated_at=?,delivered_at=CASE WHEN ?='Entregado' THEN ? ELSE delivered_at END,final_total=CASE WHEN ?='Entregado' THEN ? ELSE final_total END,parts_cost=CASE WHEN ?='Entregado' THEN ? ELSE parts_cost END,delivery_recipient=CASE WHEN ?='Entregado' THEN ? ELSE delivery_recipient END,delivery_document=CASE WHEN ?='Entregado' THEN ? ELSE delivery_document END,delivery_notes=CASE WHEN ?='Entregado' THEN ? ELSE delivery_notes END WHERE id=?").bind(status,changedAt,status,changedAt,status,finalTotal,status,deliveredPartsCost,status,recipient,status,recipientDocument,status,deliveryNotes,id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,from_status,to_status,note,actor_name,created_at) VALUES (?,'Cambio de estado',?,?,?,?,?)").bind(id,order.status,status,note,actor.name,changedAt)];
    if(status==='Entregado') updates.push(env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Salida / entrega',?,?,?)").bind(id,`Equipo entregado a ${recipient}${recipientDocument?` · Documento: ${recipientDocument}`:''}${deliveryNotes?` · ${deliveryNotes}`:''}.`,actor.name,changedAt));
    if(status==='Entregado'&&deliveryTechnician&&!['pending','paid'].includes(order.commission_status)){const percent=Number(deliveryTechnician.commission_percent);const base=Math.max(0,finalTotal-deliveredPartsCost),commission=Math.round(base*percent/100);updates.push(env.DB.prepare("UPDATE pos_service_orders SET commission_percent=?,commission_base=?,commission_amount=?,commission_status='pending',commission_settled_at=? WHERE id=?").bind(percent,base,commission,changedAt,id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Liquidación',?,?,?)").bind(id,`Comisión de ${deliveryTechnician.name}: ${cop(commission)} (${percent}% de ${cop(base)}).`,actor.name,changedAt));}
    if(status==='Entregado'&&outstanding>0){const column=paymentMethod==='Efectivo'?'repair_cash_income':paymentMethod==='Tarjeta'?'repair_card_income':'repair_transfer_income';updates.push(env.DB.prepare('INSERT INTO pos_service_payments (order_id,shift_id,kind,payment_method,amount,actor_name,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,shift.id,'Saldo',paymentMethod,outstanding,actor.name,changedAt),env.DB.prepare(`UPDATE pos_cash_shifts SET ${column}=${column}+? WHERE id=?`).bind(outstanding,shift.id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Pago automático',?,?,?)").bind(id,`Pago automático de ${cop(outstanding)} mediante ${paymentMethod} al entregar.`,actor.name,changedAt));}
    await env.DB.batch(updates);
    if (actor.role === 'worker' && ['Cancelado','Sin reparación'].includes(status)) await env.DB.prepare('INSERT INTO pos_notifications (type,severity,message,actor_name,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('Orden de servicio','critical',`${actor.name} cambió ${order.order_number} a ${status}.`,actor.name,'orden de servicio',order.order_number,JSON.stringify({ estado:status,motivo:note }),changedAt).run();
    return json({ ok: true, cashShift: await activeCashShift(actor) });
  }
  if (data.action === 'pay-technician-commission') {
    const owner=await current(request); if(!owner||owner.role!=='owner')return json({error:'Solo el propietario puede pagar comisiones.'},403);
    const orderId=Number(data.orderId);
    if(await env.DB.prepare('SELECT id FROM pos_technician_settlement_items WHERE order_id=?').bind(orderId).first()) return json({error:'Registra el pago desde Pago de técnicos para conservar su liquidación.'},409);
    const order=await env.DB.prepare("SELECT order_number,technician_name,commission_amount,commission_status FROM pos_service_orders WHERE id=?").bind(orderId).first<any>(); if(!order)return json({error:'No encontramos esa orden.'},404); if(order.commission_status!=='pending')return json({error:'Esta comisión no está pendiente.'},409);
    const shift=await env.DB.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(owner.businessId).first<any>(); if(!shift)return json({error:'Abre la caja para registrar el pago de la comisión.'},409); const paidAt=now(),amount=Number(order.commission_amount||0),reason=`Comisión ${order.order_number} · ${order.technician_name}`;
    await env.DB.batch([env.DB.prepare("UPDATE pos_service_orders SET commission_status='paid',commission_paid_at=?,commission_paid_by_name=?,updated_at=? WHERE id=?").bind(paidAt,owner.name,paidAt,orderId),env.DB.prepare("INSERT INTO pos_cash_movements (shift_id,type,amount,reason,actor_name,created_at) VALUES (?,'out',?,?,?,?)").bind(shift.id,amount,reason,owner.name,paidAt),env.DB.prepare("UPDATE pos_cash_shifts SET cash_outs=cash_outs+? WHERE id=?").bind(amount,shift.id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Pago de comisión',?,?,?)").bind(orderId,`${cop(amount)} pagados a ${order.technician_name}.`,owner.name,paidAt)]);
    return json({ok:true,cashShift:await activeCashShift(owner)});
  }
  if (data.action === 'add-service-payment') {
    const actor = await current(request); if (!actor || !canUseServices(actor)) return json({ error: 'No tienes permiso para registrar pagos de reparaciones.' }, 403);
    const id = Number(data.orderId), amount = Math.round(Number(data.amount)), method = String(data.paymentMethod || ''), kind = data.kind === 'Saldo' ? 'Saldo' : 'Anticipo';
    if (!Number.isInteger(id) || !Number.isFinite(amount) || amount <= 0 || !['Efectivo','Tarjeta','Transferencia'].includes(method)) return json({ error: 'Completa un pago válido.' }, 400);
    const order = await env.DB.prepare('SELECT order_number,status FROM pos_service_orders WHERE id=?').bind(id).first<any>(); if (!order) return json({ error: 'No encontramos esa orden.' }, 404);
    const shift = await env.DB.prepare("SELECT id FROM pos_cash_shifts WHERE business_id=? AND status='open' ORDER BY id DESC LIMIT 1").bind(actor.businessId).first<any>(); if (!shift) return json({ error: 'Abre la caja antes de registrar un pago.' }, 409);
    const column = method === 'Efectivo' ? 'repair_cash_income' : method === 'Tarjeta' ? 'repair_card_income' : 'repair_transfer_income'; const createdAt = now();
    await env.DB.batch([env.DB.prepare('INSERT INTO pos_service_payments (order_id,shift_id,kind,payment_method,amount,actor_name,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,shift.id,kind,method,amount,actor.name,createdAt),env.DB.prepare(`UPDATE pos_cash_shifts SET ${column}=${column}+? WHERE id=? AND status='open'`).bind(amount,shift.id),env.DB.prepare("INSERT INTO pos_service_order_events (order_id,event_type,note,actor_name,created_at) VALUES (?,'Pago',?,?,?)").bind(id,`${kind} por ${cop(amount)} mediante ${method}.`,actor.name,createdAt)]);
    if (actor.role === 'worker') await env.DB.prepare('INSERT INTO pos_notifications (type,severity,message,actor_name,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('Pago de reparación','info',`${actor.name} registró un ${kind.toLowerCase()} en ${order.order_number}.`,actor.name,'orden de servicio',order.order_number,JSON.stringify({ tipo:kind,valor:cop(amount),medio:method }),createdAt).run();
    return json({ ok: true, cashShift: await activeCashShift(actor) });
  }
  if (data.action === 'create-service-refund') {
    const actor = await current(request); if (!actor || !canUseReturns(actor)) return json({ error: 'No tienes permiso para registrar devoluciones.' }, 403);
    const orderId = Number(data.orderId), amount = Math.round(Number(data.amount)), method = String(data.paymentMethod || ''), reason = String(data.reason || '').trim();
    if (!Number.isInteger(orderId) || amount <= 0 || !['Efectivo','Tarjeta','Transferencia'].includes(method) || !reason) return json({ error: 'Completa orden, valor, medio de devolución y motivo.' }, 400);
    const result = await env.DB.transaction(async db => {
      const order = await db.prepare(`SELECT o.id,o.order_number,o.status,o.commission_status,COALESCE((SELECT SUM(amount) FROM pos_service_payments p WHERE p.order_id=o.id),0) AS paid_total,
        COALESCE((SELECT SUM(amount) FROM pos_returns r WHERE r.source_type='service_order' AND r.source_id=o.id::text),0) AS returned_total FROM pos_service_orders o WHERE o.id=? FOR UPDATE`).bind(orderId).first<any>();
      if (!order) return { error: 'No encontramos esa orden.', status: 404 };
      if (order.status === 'Entregado') return { error: 'No se puede devolver desde aquí un equipo que ya fue entregado al cliente.', status: 409 };
      if (amount > Number(order.paid_total) - Number(order.returned_total)) return { error: 'El valor supera lo recibido y aún no devuelto en esta orden.', status: 400 };
      const shift = method === 'Efectivo' ? await db.prepare("SELECT id FROM pos_cash_shifts WHERE status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE").first<any>() : null;
      if (method === 'Efectivo' && !shift) return { error: 'Abre caja antes de devolver efectivo.', status: 409 };
      const createdAt = now();
      const insert = await db.prepare("INSERT INTO pos_returns (return_type,source_type,source_id,source_number,amount,payment_method,reason,restock,items,actor_name,shift_id,created_at) VALUES ('service_refund','service_order',?,?,?,?,?,0,'[]',?,?,?) RETURNING id").bind(String(order.id),order.order_number,amount,method,reason,actor.name,shift?.id || null,createdAt).first<any>();
      const statements = [
        db.prepare("INSERT INTO pos_service_order_events (order_id,event_type,from_status,to_status,note,actor_name,created_at) VALUES (?,'Devolución',?,?,?, ?,?)").bind(order.id,order.status,data.markNoRepair === false ? order.status : 'Sin reparación',`Devolución de ${cop(amount)} por ${method}. Motivo: ${reason}`,actor.name,createdAt),
      ];
      if (data.markNoRepair !== false && order.status !== 'Entregado') statements.push(db.prepare("UPDATE pos_service_orders SET status='Sin reparación',commission_status='not_applicable',commission_amount=0,updated_at=? WHERE id=?").bind(createdAt,order.id));
      if (shift) statements.push(db.prepare("INSERT INTO pos_cash_movements (shift_id,type,amount,reason,actor_name,created_at) VALUES (?,'out',?,?,?,?)").bind(shift.id,amount,`Devolución orden ${order.order_number} · ${reason}`,actor.name,createdAt),db.prepare('UPDATE pos_cash_shifts SET cash_outs=cash_outs+? WHERE id=?').bind(amount,shift.id));
      statements.push(db.prepare("INSERT INTO pos_notifications (type,severity,message,actor_name,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)").bind('Devolución registrada','warning',`${actor.name} registró una devolución de ${cop(amount)} en la orden ${order.order_number}.`,actor.name,'devolución de reparación',order.order_number,JSON.stringify({ motivo: reason, medio: method, valor: cop(amount), orden: order.order_number }),createdAt));
      await db.batch(statements);
      return { record: { id: insert?.id, return_type: 'service_refund', source_number: order.order_number, amount, payment_method: method, reason, actor_name: actor.name, created_at: createdAt }, shift: shift?.id || null };
    });
    if ('error' in result) return json({ error: result.error }, result.status);
    return json({ ok: true, record: result.record, cashShift: await activeCashShift(actor) });
  }
  if (data.action === 'create-sale-return') {
    const actor = await current(request); if (!actor || !canUseReturns(actor)) return json({ error: 'No tienes permiso para registrar devoluciones.' }, 403);
    const number = String(data.saleNumber || '').trim(), amount = Math.round(Number(data.amount)), method = String(data.paymentMethod || ''), reason = String(data.reason || '').trim();
    const requestedItems = Array.isArray(data.items) ? data.items.map((item: any) => ({ id: String(item.id), qty: Math.floor(Number(item.qty) || 0) })).filter((item: any) => item.id && item.qty > 0) : [];
    if (!number || amount <= 0 || !requestedItems.length || !['Efectivo','Tarjeta','Transferencia'].includes(method) || !reason) return json({ error: 'Completa la venta, productos, valor, medio y motivo.' }, 400);
    const result = await env.DB.transaction(async db => {
      const state = await db.prepare('SELECT products,sales,categories,receipt_settings,updated_at FROM pos_business_state WHERE id=1 FOR UPDATE').first<any>();
      const products = JSON.parse(state?.products || '[]'), sales = JSON.parse(state?.sales || '[]');
      const sale = sales.find((item: any) => String(item.number) === number); if (!sale) return { error: 'No encontramos esa venta.', status: 404 };
      const old = await db.prepare("SELECT amount,items FROM pos_returns WHERE source_type='sale' AND source_id=?").bind(number).all<any>();
      const returnedAmount = (old.results || []).reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
      if (amount > Number(sale.total || 0) - returnedAmount) return { error: 'El valor supera el saldo que puede devolverse de esta venta.', status: 400 };
      const returnedQty = new Map<string,number>(); for (const row of old.results || []) { try { for (const item of JSON.parse(row.items || '[]')) returnedQty.set(String(item.id), (returnedQty.get(String(item.id)) || 0) + Number(item.qty || 0)); } catch {} }
      const items = requestedItems.map((item: any) => { const sold = (sale.items || []).find((line: any) => String(line.id) === item.id); return { ...item, name: sold?.name || '', price: Number(sold?.price || 0), max: Number(sold?.qty || 0) - (returnedQty.get(item.id) || 0) }; });
      if (items.some((item: any) => !item.name || item.qty > item.max)) return { error: 'Una cantidad supera lo vendido o ya devuelto.', status: 400 };
      const shift = method === 'Efectivo' ? await db.prepare("SELECT id FROM pos_cash_shifts WHERE status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE").first<any>() : null;
      if (method === 'Efectivo' && !shift) return { error: 'Abre caja antes de devolver efectivo.', status: 409 };
      const createdAt = now(), restock = data.restock !== false;
      const updatedProducts = restock ? products.map((product: any) => { const item = items.find((line: any) => String(line.id) === String(product.id)); return item ? { ...product, stock: Number(product.stock || 0) + item.qty } : product; }) : products;
      const insert = await db.prepare("INSERT INTO pos_returns (return_type,source_type,source_id,source_number,amount,payment_method,reason,restock,items,actor_name,shift_id,created_at) VALUES ('sale_return','sale',?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(number,number,amount,method,reason,restock ? 1 : 0,JSON.stringify(items.map(({max,...item}: any) => item)),actor.name,shift?.id || null,createdAt).first<any>();
      await db.prepare('UPDATE pos_business_state SET products=?,updated_at=? WHERE id=1').bind(JSON.stringify(updatedProducts),createdAt).run();
      if (shift) await db.batch([db.prepare("INSERT INTO pos_cash_movements (shift_id,type,amount,reason,actor_name,created_at) VALUES (?,'out',?,?,?,?)").bind(shift.id,amount,`Devolución venta ${number} · ${reason}`,actor.name,createdAt),db.prepare('UPDATE pos_cash_shifts SET cash_outs=cash_outs+? WHERE id=?').bind(amount,shift.id)]);
      await db.prepare("INSERT INTO pos_notifications (type,severity,message,actor_name,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)").bind('Devolución registrada','warning',`${actor.name} registró una devolución de ${cop(amount)} en la venta ${number}.`,actor.name,'devolución de mercancía',number,JSON.stringify({ motivo: reason, medio: method, valor: cop(amount), venta: number }),createdAt).run();
      return { record: { id: insert?.id, return_type: 'sale_return', source_number: number, amount, payment_method: method, reason, restock: restock ? 1 : 0, items, actor_name: actor.name, created_at: createdAt }, businessState: { products: updatedProducts, sales, categories: JSON.parse(state?.categories || '[]'), receiptSettings: receiptSettings(JSON.parse(state?.receipt_settings || '{}')), updatedAt: createdAt } };
    });
    if ('error' in result) return json({ error: result.error }, result.status);
    return json({ ok: true, record: result.record, businessState: result.businessState, cashShift: await activeCashShift(actor) });
  }
  if (data.action === 'save-business-state') {
    const actor = await current(request); if (!actor) return json({ error: 'Sesión requerida.' }, 401);
    const products = Array.isArray(data.products) ? data.products : [];
    const sales = Array.isArray(data.sales) ? data.sales : [];
    const categories = Array.isArray(data.categories) ? data.categories.map((item: unknown) => String(item).trim()).filter(Boolean) : [];
    const savedState = await env.DB.prepare('SELECT products, receipt_settings FROM pos_business_state WHERE business_id=?').bind(actor.businessId).first<{ products: string; receipt_settings: string }>();
    const savedProducts = savedState ? JSON.parse(savedState.products || '[]') : [];
    const duplicateCode = newlyIntroducedDuplicate(savedProducts, products);
    if (duplicateCode) return json({ error: `El código “${duplicateCode}” ya está asignado a otro producto. Usa un código diferente.` }, 409);
    let savedReceiptSettings = receiptSettings(data.receiptSettings);
    if (actor.role === 'worker') {
      savedReceiptSettings = receiptSettings(JSON.parse(savedState?.receipt_settings || '{}'));
      const incomingIds = new Set(products.map((item: any) => String(item?.id)));
      if (savedProducts.some((item: any) => !incomingIds.has(String(item?.id)))) return json({ error: 'Los trabajadores no pueden borrar productos del inventario.' }, 403);
    }
    const updatedAt = now();
    await env.DB.prepare("INSERT INTO pos_business_state (id, business_id, products, sales, categories, receipt_settings, category_catalog_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO UPDATE SET products=EXCLUDED.products, sales=EXCLUDED.sales, categories=EXCLUDED.categories, receipt_settings=EXCLUDED.receipt_settings, category_catalog_version=1, updated_at=EXCLUDED.updated_at").bind(actor.businessId, actor.businessId, JSON.stringify(products), JSON.stringify(sales), JSON.stringify(categories), JSON.stringify(savedReceiptSettings), updatedAt).run();
    return json({ ok: true, updatedAt });
  }
  if (data.action === 'restore-backup') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede restaurar respaldos.' }, 403);
    const saved = await env.DB.prepare("SELECT password_hash FROM pos_users WHERE id=? AND role='owner'").bind(owner.id).first<{ password_hash: string }>();
    if (!saved || !(await validPassword(String(data.currentPassword || ''), saved.password_hash))) return json({ error: 'La contraseña actual no es correcta.' }, 401);
    const backup = data.backup; const payload = backup?.data;
    if (backup?.format !== 'cellhouse-pos-backup' || ![1,2,3,4,5,6].includes(Number(backup?.version)) || !payload || !Array.isArray(payload.users) || !Array.isArray(payload.businessState)) return json({ error: 'El archivo no es un respaldo válido de DTC Stage.' }, 400);
    if (!payload.users.some((item: any) => item?.role === 'owner')) return json({ error: 'El respaldo no contiene una cuenta de propietario.' }, 400);
    const statements = [
      env.DB.prepare('DELETE FROM pos_returns'), env.DB.prepare('DELETE FROM pos_service_photos'), env.DB.prepare('DELETE FROM pos_technician_settlement_items'), env.DB.prepare('DELETE FROM pos_technician_settlements'), env.DB.prepare('DELETE FROM pos_service_parts'), env.DB.prepare('DELETE FROM pos_service_payments'), env.DB.prepare('DELETE FROM pos_service_order_events'), env.DB.prepare('DELETE FROM pos_service_orders'), env.DB.prepare('DELETE FROM pos_service_technician_commissions'), env.DB.prepare('DELETE FROM pos_service_settings'), env.DB.prepare('DELETE FROM pos_employees'), env.DB.prepare('DELETE FROM pos_cash_movements'), env.DB.prepare('DELETE FROM pos_cash_shifts'), env.DB.prepare('DELETE FROM pos_notifications'), env.DB.prepare('DELETE FROM pos_synced_sales'), env.DB.prepare('DELETE FROM pos_business_state'), env.DB.prepare('DELETE FROM pos_sessions'), env.DB.prepare('DELETE FROM pos_users'),
    ];
    for (const item of payload.users) statements.push(env.DB.prepare('INSERT INTO pos_users (id, name, username, password_hash, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(Number(item.id), String(item.name), String(item.username), String(item.password_hash), String(item.role), String(item.permissions || '[]'), String(item.created_at)));
    for (const item of Array.isArray(payload.employees) ? payload.employees : []) statements.push(env.DB.prepare('INSERT INTO pos_employees (id,name,phone,document,position,is_technician,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(Number(item.id),String(item.name),String(item.phone||''),String(item.document||''),String(item.position||''),Number(item.is_technician||0),Number(item.active??1),String(item.created_at||now()),String(item.updated_at||now())));
    for (const item of Array.isArray(payload.cashShifts) ? payload.cashShifts : []) statements.push(env.DB.prepare('INSERT INTO pos_cash_shifts (id, status, opened_by_user_id, opened_by_name, opening_amount, cash_sales, card_sales, transfer_sales, other_sales, sales_count, units_sold, cash_entries, cash_outs, expected_amount, counted_amount, difference, opened_at, closed_by_user_id, closed_by_name, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(Number(item.id), String(item.status), Number(item.opened_by_user_id), String(item.opened_by_name), Number(item.opening_amount), Number(item.cash_sales), Number(item.card_sales || 0), Number(item.transfer_sales || 0), Number(item.other_sales || 0), Number(item.sales_count || 0), Number(item.units_sold || 0), Number(item.cash_entries), Number(item.cash_outs), item.expected_amount == null ? null : Number(item.expected_amount), item.counted_amount == null ? null : Number(item.counted_amount), item.difference == null ? null : Number(item.difference), String(item.opened_at), item.closed_by_user_id == null ? null : Number(item.closed_by_user_id), item.closed_by_name == null ? null : String(item.closed_by_name), item.closed_at == null ? null : String(item.closed_at)));
    for (const item of Array.isArray(payload.cashMovements) ? payload.cashMovements : []) statements.push(env.DB.prepare('INSERT INTO pos_cash_movements (id, shift_id, type, amount, reason, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(Number(item.id), Number(item.shift_id), String(item.type), Number(item.amount), String(item.reason), String(item.actor_name), String(item.created_at)));
    for (const item of Array.isArray(payload.notifications) ? payload.notifications : []) statements.push(env.DB.prepare('INSERT INTO pos_notifications (id, type, severity, message, actor_name, entity_type, entity_id, details, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(Number(item.id), String(item.type), String(item.severity || 'info'), String(item.message), String(item.actor_name), item.entity_type == null ? null : String(item.entity_type), item.entity_id == null ? null : String(item.entity_id), String(item.details || '{}'), String(item.created_at), item.read_at == null ? null : String(item.read_at)));
    for (const item of payload.businessState) statements.push(env.DB.prepare('INSERT INTO pos_business_state (id, products, sales, categories, receipt_settings, category_catalog_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(Number(item.id), String(item.products || '[]'), String(item.sales || '[]'), String(item.categories || '[]'), String(item.receipt_settings || JSON.stringify(DEFAULT_RECEIPT_SETTINGS)), Number(item.category_catalog_version ?? 0), String(item.updated_at)));
    for (const item of Array.isArray(payload.syncedSales) ? payload.syncedSales : []) statements.push(env.DB.prepare('INSERT INTO pos_synced_sales (client_id, sale_number, payload, synced_at) VALUES (?, ?, ?, ?) RETURNING client_id').bind(String(item.client_id), String(item.sale_number), String(item.payload || '{}'), String(item.synced_at)));
    for (const item of Array.isArray(payload.serviceOrders) ? payload.serviceOrders : []) statements.push(env.DB.prepare('INSERT INTO pos_service_orders (id,order_number,customer_name,customer_phone,customer_document,device_brand,device_model,device_identifier,device_password,accessories,physical_condition,reported_issue,planned_service,notes,status,estimated_total,parts_cost,final_total,created_by_user_id,created_by_name,created_at,updated_at,delivered_at,client_ref,technician_user_id,technician_name,commission_percent,commission_base,commission_amount,commission_status,commission_settled_at,commission_paid_at,commission_paid_by_name,diagnosis,technical_report,parts_used,estimated_delivery_at,customer_authorized,authorized_at,delivery_recipient,delivery_document,delivery_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(item.id,item.order_number,item.customer_name,item.customer_phone,item.customer_document||'',item.device_brand,item.device_model,item.device_identifier||'',item.device_password||'',item.accessories||'',item.physical_condition||'',item.reported_issue,item.planned_service||'',item.notes||'',item.status,Number(item.estimated_total||0),Number(item.parts_cost||0),Number(item.final_total||0),Number(item.created_by_user_id),item.created_by_name,item.created_at,item.updated_at,item.delivered_at||null,item.client_ref||null,item.technician_user_id||null,item.technician_name||'',item.commission_percent==null?null:Number(item.commission_percent),item.commission_base==null?null:Number(item.commission_base),item.commission_amount==null?null:Number(item.commission_amount),item.commission_status||'not_applicable',item.commission_settled_at||null,item.commission_paid_at||null,item.commission_paid_by_name||null,item.diagnosis||'',item.technical_report||'',item.parts_used||'',item.estimated_delivery_at||null,Number(item.customer_authorized||0),item.authorized_at||null,item.delivery_recipient||'',item.delivery_document||'',item.delivery_notes||''));
    for (const item of Array.isArray(payload.serviceEvents) ? payload.serviceEvents : []) statements.push(env.DB.prepare('INSERT INTO pos_service_order_events (id,order_id,event_type,from_status,to_status,note,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(item.id,item.order_id,item.event_type,item.from_status||null,item.to_status||null,item.note||'',item.actor_name,item.created_at));
    for (const item of Array.isArray(payload.servicePayments) ? payload.servicePayments : []) statements.push(env.DB.prepare('INSERT INTO pos_service_payments (id,order_id,shift_id,kind,payment_method,amount,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(item.id,item.order_id,item.shift_id||null,item.kind,item.payment_method,Number(item.amount),item.actor_name,item.created_at));
    for (const item of Array.isArray(payload.serviceParts) ? payload.serviceParts : []) statements.push(env.DB.prepare('INSERT INTO pos_service_parts (id,order_id,amount,payment_method,supplier,note,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(item.id,item.order_id,Number(item.amount),String(item.payment_method||'Efectivo'),String(item.supplier||''),String(item.note||''),String(item.actor_name||''),String(item.created_at||now())));
    statements.push(env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_service_parts','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_service_parts), 1), 1), true)"));
    for (const item of Array.isArray(payload.serviceSettings) ? payload.serviceSettings : []) statements.push(env.DB.prepare('INSERT INTO pos_service_settings (id,technician_commission_percent,updated_by_name,updated_at) VALUES (?,?,?,?)').bind(Number(item.id),Number(item.technician_commission_percent||0),String(item.updated_by_name||''),String(item.updated_at||now())));
    if (!Array.isArray(payload.serviceSettings) || !payload.serviceSettings.length) statements.push(env.DB.prepare("INSERT INTO pos_service_settings (id,technician_commission_percent,updated_by_name,updated_at) VALUES (1,30,'Sistema',?)").bind(now()));
    for (const item of Array.isArray(payload.serviceTechnicianCommissions) ? payload.serviceTechnicianCommissions : []) statements.push(env.DB.prepare('INSERT INTO pos_service_technician_commissions (technician_id,commission_percent,updated_by_name,updated_at) VALUES (?,?,?,?) RETURNING technician_id').bind(Number(item.technician_id),Number(item.commission_percent||0),String(item.updated_by_name||''),String(item.updated_at||now())));
    for(const item of payload.servicePhotos||[])statements.push(env.DB.prepare('INSERT INTO pos_service_photos (order_id,image) VALUES (?,?)').bind(item.order_id,item.image));
    for(const item of payload.returns||[])statements.push(env.DB.prepare('INSERT INTO pos_returns (id,return_type,source_type,source_id,source_number,amount,payment_method,reason,restock,items,actor_name,shift_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(item.id,item.return_type,item.source_type,item.source_id,item.source_number,Number(item.amount),item.payment_method,item.reason,Number(item.restock||0),item.items||'[]',item.actor_name,item.shift_id||null,item.created_at));
    for (const item of payload.technicianSettlements || []) statements.push(env.DB.prepare('INSERT INTO pos_technician_settlements (id,technician_id,technician_name,total,note,created_at,created_by,paid_at,paid_by,payment_method,shift_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(item.id,item.technician_id,item.technician_name,item.total,item.note||'',item.created_at,item.created_by,item.paid_at||null,item.paid_by||null,item.payment_method||null,item.shift_id||null));
    for (const item of payload.technicianSettlementItems || []) statements.push(env.DB.prepare('INSERT INTO pos_technician_settlement_items (id,settlement_id,order_id,order_number,final_total,parts_cost,commission_percent,commission_amount) VALUES (?,?,?,?,?,?,?,?)').bind(item.id,item.settlement_id,item.order_id,item.order_number,item.final_total,item.parts_cost,item.commission_percent,item.commission_amount));
    for (const table of ['pos_technician_settlements','pos_technician_settlement_items']) statements.push(env.DB.prepare(`SELECT setval(pg_get_serial_sequence('${table}','id'),GREATEST(COALESCE((SELECT MAX(id) FROM ${table}),1),1),true)`));
    for (const item of payload.cashShifts || []) statements.push(env.DB.prepare('UPDATE pos_cash_shifts SET repair_cash_income=?,repair_card_income=?,repair_transfer_income=? WHERE id=?').bind(Number(item.repair_cash_income||0),Number(item.repair_card_income||0),Number(item.repair_transfer_income||0),item.id));
    statements.push(env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_users','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_users), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_employees','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_employees), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_notifications','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_notifications), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_cash_shifts','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_cash_shifts), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_cash_movements','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_cash_movements), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_service_orders','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_service_orders), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_service_order_events','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_service_order_events), 1), 1), true)"), env.DB.prepare("SELECT setval(pg_get_serial_sequence('pos_service_payments','id'), GREATEST(COALESCE((SELECT MAX(id) FROM pos_service_payments), 1), 1), true)"));
    await env.DB.batch(statements);
    return json({ ok: true, message: 'Respaldo restaurado. Inicia sesión nuevamente.' }, 200, { 'Set-Cookie': `${SESSION}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0` });
  }
  if (data.action === 'record-cash-movement') {
    const actor = await current(request); if (!actor || !canUseCash(actor)) return json({ error: 'No tienes permiso para registrar movimientos manuales.' }, 403);
    const type = data.type === 'out' ? 'out' : data.type === 'in' ? 'in' : ''; const amount = Math.round(Number(data.amount)); const reason = String(data.reason || '').trim();
    if (!type || !Number.isFinite(amount) || amount <= 0 || !reason) return json({ error: 'Completa el tipo, monto y motivo del movimiento.' }, 400);
    const shift = await env.DB.prepare("SELECT id FROM pos_cash_shifts WHERE status='open' ORDER BY id DESC LIMIT 1").first<any>(); if (!shift) return json({ error: 'La caja está cerrada.' }, 409);
    const totalColumn = type === 'in' ? 'cash_entries' : 'cash_outs';
    const createdAt = now();
    const statements = [env.DB.prepare('INSERT INTO pos_cash_movements (shift_id, type, amount, reason, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(shift.id, type, amount, reason, actor.name, createdAt), env.DB.prepare(`UPDATE pos_cash_shifts SET ${totalColumn}=${totalColumn}+? WHERE id=? AND status='open'`).bind(amount, shift.id)];
    if (actor.role === 'worker') statements.push(env.DB.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('Movimiento de caja', 'critical', `${actor.name} registró una ${type === 'in' ? 'entrada' : 'salida'} de caja.`, actor.name, 'movimiento de caja', String(shift.id), JSON.stringify({ tipo: type === 'in' ? 'Entrada' : 'Salida', monto: cop(amount), motivo: reason }), createdAt));
    await env.DB.batch(statements);
    return json({ shift: await activeCashShift(actor) });
  }
  if (data.action === 'close-cash') {
    const actor = await current(request); if (!actor || !canUseCash(actor)) return json({ error: 'No tienes permiso para cerrar la caja.' }, 403);
    const countedAmount = Math.round(Number(data.countedAmount)); if (!Number.isFinite(countedAmount) || countedAmount < 0) return json({ error: 'Ingresa un conteo válido.' }, 400);
    const shift = await env.DB.prepare("SELECT * FROM pos_cash_shifts WHERE status='open' ORDER BY id DESC LIMIT 1").first<any>(); if (!shift) return json({ error: 'La caja ya está cerrada.' }, 409);
    if (actor.role !== 'owner' && Number(shift.opened_by_user_id) !== Number(actor.id)) return json({ error: 'Solo quien abrió este turno o el propietario puede cerrarlo.' }, 403);
    const expected = Number(shift.opening_amount) + Number(shift.cash_sales) + Number(shift.repair_cash_income || 0) + Number(shift.cash_entries) - Number(shift.cash_outs); const difference = countedAmount - expected; const closedAt = now();
    const business = await env.DB.prepare('SELECT sales FROM pos_business_state WHERE id=1').first<{ sales: string }>();
    const shiftSales = (business ? JSON.parse(business.sales || '[]') : []).filter((sale: any) => { const moment = new Date(sale?.createdAt || sale?.date || 0).getTime(); return Number.isFinite(moment) && moment >= new Date(shift.opened_at).getTime() && moment <= new Date(closedAt).getTime(); });
    const paymentTotal = (method: string) => shiftSales.reduce((sum: number, sale: any) => {
      const breakdown = sale?.paymentBreakdown;
      if (breakdown && typeof breakdown === 'object') return sum + Number(breakdown[method] || 0);
      return String(sale.payment || '').toLocaleLowerCase('es') === method.toLocaleLowerCase('es') ? sum + Number(sale.total || 0) : sum;
    }, 0);
    const cardSales = paymentTotal('Tarjeta'), transferSales = paymentTotal('Transferencia');
    const otherSales = shiftSales.filter((sale: any) => !sale?.paymentBreakdown && !['efectivo', 'tarjeta', 'transferencia'].includes(String(sale.payment || '').toLocaleLowerCase('es'))).reduce((sum: number, sale: any) => sum + Number(sale.total || 0), 0);
    const salesCount = shiftSales.length, unitsSold = shiftSales.reduce((sum: number, sale: any) => sum + (Array.isArray(sale.items) ? sale.items.reduce((items: number, item: any) => items + Number(item.qty || 0), 0) : 0), 0);
    const movements = await env.DB.prepare('SELECT id, type, amount, reason, actor_name, created_at FROM pos_cash_movements WHERE shift_id=? ORDER BY created_at').bind(shift.id).all<any>();
    const updates = [env.DB.prepare("UPDATE pos_cash_shifts SET status='closed', closed_by_user_id=?, closed_by_name=?, counted_amount=?, expected_amount=?, difference=?, card_sales=?, transfer_sales=?, other_sales=?, sales_count=?, units_sold=?, closed_at=? WHERE id=? AND status='open'").bind(actor.id, actor.name, countedAmount, expected, difference, cardSales, transferSales, otherSales, salesCount, unitsSold, closedAt, shift.id)];
    updates.push(env.DB.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('Cierre de caja', difference === 0 ? 'info' : 'critical', `${actor.name} cerró la caja y registró el conteo del turno.`, actor.name, 'turno de caja', String(shift.id), JSON.stringify({ efectivo_contado: cop(countedAmount), efectivo_esperado: cop(expected), diferencia: cop(difference) }), closedAt));
    await env.DB.batch(updates);
    return json({ summary: canSeeCashTotals(actor) ? { actual: countedAmount, expected, diff: difference } : { recorded: true }, receipt: { id: Number(shift.id), opened_by_name: shift.opened_by_name, opened_at: shift.opened_at, closed_by_name: actor.name, closed_at: closedAt, opening_amount: Number(shift.opening_amount), cash_sales: Number(shift.cash_sales), card_sales: cardSales, transfer_sales: transferSales, other_sales: otherSales, repair_cash_income: Number(shift.repair_cash_income||0), repair_card_income: Number(shift.repair_card_income||0), repair_transfer_income: Number(shift.repair_transfer_income||0), sales_count: salesCount, units_sold: unitsSold, cash_entries: Number(shift.cash_entries), cash_outs: Number(shift.cash_outs), expected_amount: expected, counted_amount: countedAmount, difference, movements: movements.results || [] }, cashShift: null });
  }
  if (data.action === 'create-worker') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede crear usuarios.' }, 403);
    if (!data.name?.trim() || !data.username?.trim() || !data.password || data.password.length < 6) return json({ error: 'Completa los datos y usa una contraseña de al menos 6 caracteres.' }, 400);
    try { const result = await env.DB.prepare('INSERT INTO pos_users (name, username, password_hash, role, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(data.name.trim(), data.username.trim().toLowerCase(), await hashPassword(data.password), 'worker', JSON.stringify(data.permissions || defaultPermissions), now()).run(); return json({ worker: { id: result.meta.last_row_id, name: data.name.trim(), username: data.username.trim(), role: 'worker', permissions: data.permissions || defaultPermissions } }, 201); } catch { return json({ error: 'Ese nombre de usuario ya existe.' }, 409); }
  }
  if (data.action === 'update-worker') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede cambiar permisos.' }, 403);
    const existing = await env.DB.prepare("SELECT id FROM pos_users WHERE id=? AND role='worker'").bind(Number(data.workerId)).first(); if (!existing) return json({ error: 'No encontramos ese trabajador.' }, 404);
    if (!data.name?.trim() || !data.username?.trim()) return json({ error: 'Nombre y usuario son obligatorios.' }, 400);
    const passwordPart = data.password ? ', password_hash=?' : ''; const bindings: any[] = [data.name.trim(), data.username.trim().toLowerCase(), JSON.stringify(data.permissions || defaultPermissions)]; if (data.password) { if (data.password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400); bindings.push(await hashPassword(data.password)); } bindings.push(Number(data.workerId));
    try { await env.DB.prepare(`UPDATE pos_users SET name=?, username=?, permissions=?${passwordPart} WHERE id=? AND role='worker'`).bind(...bindings).run(); } catch { return json({ error: 'Ese usuario ya existe.' }, 409); }
    return json({ ok: true });
  }
  if (data.action === 'update-owner') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Sesión de propietario requerida.' }, 403);
    if (!data.name?.trim() || !data.username?.trim() || !data.currentPassword) return json({ error: 'Nombre, usuario y contraseña actual son obligatorios.' }, 400);
    const saved = await env.DB.prepare("SELECT password_hash FROM pos_users WHERE id=? AND role='owner'").bind(owner.id).first<{ password_hash: string }>();
    if (!saved || !(await validPassword(String(data.currentPassword), saved.password_hash))) return json({ error: 'La contraseña actual no es correcta.' }, 401);
    if (data.newPassword && String(data.newPassword).length < 6) return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' }, 400);
    try {
      if (data.newPassword) await env.DB.prepare("UPDATE pos_users SET name=?, username=?, password_hash=? WHERE id=? AND role='owner'").bind(data.name.trim(), data.username.trim().toLowerCase(), await hashPassword(String(data.newPassword)), owner.id).run();
      else await env.DB.prepare("UPDATE pos_users SET name=?, username=? WHERE id=? AND role='owner'").bind(data.name.trim(), data.username.trim().toLowerCase(), owner.id).run();
    } catch { return json({ error: 'Ese nombre de usuario ya está en uso.' }, 409); }
    return json({ user: { name: data.name.trim(), username: data.username.trim().toLowerCase() } });
  }
  if (data.action === 'delete-worker') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede eliminar usuarios.' }, 403);
    await env.DB.batch([env.DB.prepare('DELETE FROM pos_sessions WHERE user_id=?').bind(Number(data.workerId)), env.DB.prepare("DELETE FROM pos_users WHERE id=? AND role='worker'").bind(Number(data.workerId))]);
    return json({ ok: true });
  }
  if (data.action === 'notify-owner') {
    const actor = await current(request); if (!actor) return json({ error: 'Sesión requerida.' }, 401);
    await env.DB.prepare('INSERT INTO pos_notifications (type, severity, message, actor_name, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(String(data.type || 'Actividad'), String(data.severity || 'info'), String(data.message || ''), actor.name, data.entityType ? String(data.entityType) : null, data.entityId ? String(data.entityId) : null, JSON.stringify(data.details || {}), now()).run();
    return json({ ok: true });
  }
  if (data.action === 'mark-notifications-read') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede gestionar las notificaciones.' }, 403);
    const ids = Array.isArray(data.ids) ? data.ids.map(Number).filter(Number.isFinite) : [];
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      await env.DB.prepare(`UPDATE pos_notifications SET read_at=? WHERE id IN (${marks})`).bind(now(), ...ids).run();
    } else await env.DB.prepare('UPDATE pos_notifications SET read_at=? WHERE read_at IS NULL').bind(now()).run();
    return json({ ok: true });
  }
  if (data.action === 'delete-notification') {
    const owner = await current(request); if (!owner || owner.role !== 'owner') return json({ error: 'Solo el propietario puede eliminar notificaciones.' }, 403);
    const id = Number(data.id); if (!Number.isInteger(id) || id < 1) return json({ error: 'Notificación no válida.' }, 400);
    await env.DB.prepare('DELETE FROM pos_notifications WHERE id=?').bind(id).run();
    return json({ ok: true });
  }
  if (data.action === 'logout') { const id = cookie(request); if (id) await env.DB.prepare('DELETE FROM pos_sessions WHERE id=?').bind(id).run(); return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0` }); }
  return json({ error: 'Acción no válida.' }, 400);
  } catch (error: any) { return json({ error: `No fue posible completar la operación: ${error?.message || 'error desconocido'}` }, 500); }
}
