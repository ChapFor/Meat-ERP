// Fills the case-label ZPL template. Used by the station agent (every print)
// and the server (office reprints), so both produce identical labels.
import { zplFieldData, humanReadable, encodeWeight } from './gs1.js';

// ^ and ~ are ZPL control characters; anything printed as text must not carry them.
const clean = (s) => String(s ?? '').replace(/[\^~]/g, ' ').slice(0, 60);

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

function addDays(iso, days) {
  const dt = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + Number(days));
  return dt.toISOString().slice(0, 10);
}

export function lotPackDate(lotCode) {
  const m = /^(\d{2})(\d{2})(\d{2})-B\d+$/.exec(lotCode || '');
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

export function buildCaseZpl(template, { product, lotCode, serial, weightLb, customer, orderDoc, farmName }) {
  encodeWeight(weightLb); // throws on an impossible weight before anything prints
  const packDate = lotPackDate(lotCode);
  const useBy = product.shelf_life_days && packDate ? fmtDate(addDays(packDate, product.shelf_life_days)) : '';
  const vals = {
    FARM_NAME: clean(farmName || 'CHAPEL FORD FARM'),
    PRODUCT_NAME: clean(product.label_name || product.name),
    ITEM_CODE: clean(product.code),
    WEIGHT_LB: Number(weightLb).toFixed(2),
    PACK_DATE: fmtDate(packDate),
    USE_BY: useBy ? `Use by: ${useBy}` : '',
    LOT_CODE: clean(lotCode),
    SERIAL: clean(serial),
    CUSTOMER: clean(customer || ''),
    ORDER_NO: orderDoc ? `Order ${clean(orderDoc)}` : '',
    ZPL_FIELD_DATA: zplFieldData({ itemCode: product.code, weightLb, lotCode, serial }),
    HUMAN_READABLE: humanReadable({ itemCode: product.code, weightLb, lotCode, serial }),
  };
  return template.replace(/\{([A-Z_]+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
