export type ReceiptSettings = {
  businessName: string;
  phone: string;
  address: string;
  thankYou: string;
  warranty: string;
};

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  businessName: 'DitaEssence Taller',
  phone: '3157801078',
  address: 'Carrera 13 # 72-71',
  thankYou: 'Gracias por su compra',
  warranty: 'GARANTÍA: Para hacer efectiva la garantía es indispensable presentar este tiquete, el empaque y el producto en perfecto estado. La garantía aplica únicamente por fallas atribuibles al producto. No se realizan devoluciones de dinero. Si la falla no puede ser solucionada, se realizará cambio por otro producto de igual o similar valor, según corresponda.',
};

export function receiptSettings(value: unknown): ReceiptSettings {
  const source = value && typeof value === 'object' ? value as Partial<ReceiptSettings> : {};
  return {
    businessName: String(source.businessName ?? DEFAULT_RECEIPT_SETTINGS.businessName).trim() || DEFAULT_RECEIPT_SETTINGS.businessName,
    phone: String(source.phone ?? DEFAULT_RECEIPT_SETTINGS.phone).trim(),
    address: String(source.address ?? DEFAULT_RECEIPT_SETTINGS.address).trim(),
    thankYou: String(source.thankYou ?? DEFAULT_RECEIPT_SETTINGS.thankYou).trim() || DEFAULT_RECEIPT_SETTINGS.thankYou,
    warranty: String(source.warranty ?? DEFAULT_RECEIPT_SETTINGS.warranty).trim() || DEFAULT_RECEIPT_SETTINGS.warranty,
  };
}
