// Pure helpers: money formatting, dates, ids. No React Native imports so they
// can be unit-tested with plain Node.

function groupThousands(n: number): string {
  return Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function trimDecimal(n: number, digits: number): string {
  const s = n.toFixed(digits);
  // Only strip zeros that follow a decimal point ("1.50" -> "1.5"), never "150" -> "15".
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace('.', ',');
}

export function fmtVND(n: number, mode: 'full' | 'compact' = 'full'): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (mode === 'compact') {
    if (abs >= 1e9) return `${sign}${trimDecimal(abs / 1e9, 2)} tỷ`;
    if (abs >= 1e6) return `${sign}${trimDecimal(abs / 1e6, 1)} tr`;
    if (abs >= 1e3) return `${sign}${trimDecimal(abs / 1e3, 0)}k`;
    return `${sign}${Math.round(abs)} đ`;
  }
  return `${sign}${groupThousands(abs)} đ`;
}

export function fmtPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`;
}

/** Formats raw digits typed by the user into 1.234.567 as they type. */
export function fmtInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parses what a person types for an amount: "1.500.000", "1500000",
 * "1,5tr", "20tr", "500k", "1.2 tỷ".
 */
export function parseAmount(input: string): number {
  const s = input.trim().toLowerCase();
  if (!s) return 0;
  const unit = s.match(/(tỷ|ty|tỉ|ti|b|tr|triệu|trieu|m|k|nghìn|nghin|ngàn|ngan)\s*$/);
  if (unit) {
    const numPart = s.slice(0, unit.index).trim().replace(/\s/g, '');
    // With a unit, "." or "," is a decimal separator: 1,5tr = 1.5tr = 1 500 000.
    const value = parseFloat(numPart.replace(',', '.'));
    if (!Number.isFinite(value)) return 0;
    const u = unit[1];
    const mult = /^(tỷ|ty|tỉ|ti|b)$/.test(u) ? 1e9 : /^(tr|triệu|trieu|m)$/.test(u) ? 1e6 : 1e3;
    return Math.round(value * mult);
  }
  const digits = s.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `Tháng ${m}/${y}`;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export function dayLabel(date: string, today: string = dateKey()): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (date === today) return `Hôm nay, ${d}/${m}`;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (date === dateKey(yest)) return `Hôm qua, ${d}/${m}`;
  return `${WEEKDAYS[dt.getDay()]}, ${d}/${m}/${y}`;
}

/** 22/11 20:15 */
export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
