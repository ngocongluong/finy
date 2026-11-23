// Pure text helpers for email handling (no native imports, unit-tested).

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** True when the From header's address belongs to one of the allowed domains. */
export function senderAllowed(from: string, domains: string[]): boolean {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = addr.split('@')[1] ?? '';
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** What an HSBC Vietnam credit-card transaction email says. */
export interface HsbcCardEmail {
  /** Last digits of the card as written in the email, without the mask character. */
  last4: string;
  amount: number;
  /** ISO currency code as written ("VND", "USD"...). Only VND amounts can be budgeted. */
  currency: string;
  merchant: string;
  /** Transaction date, YYYY-MM-DD. */
  date: string;
  /** Outstanding balance and available credit after the transaction, when stated (VND). */
  balance: number | null;
  available: number | null;
}

/** "62,654" / "62.654" / "1,234,567.00" -> a number. The last separator is a decimal point only when two digits follow it and another separator precedes it, or the currency has decimals. */
function parseMoney(raw: string, decimals: boolean): number {
  const s = raw.trim();
  const m = s.match(/^(.*)[.,](\d{2})$/);
  if (m && (decimals || /[.,]/.test(m[1]))) return Number(m[1].replace(/[.,]/g, '')) + Number(m[2]) / 100;
  return Number(s.replace(/[.,]/g, ''));
}

/**
 * Reads the card-transaction notification HSBC Vietnam sends:
 * "... thẻ tín dụng X1234 của Quý khách vừa thực hiện giao dịch với số tiền 62,654 VND
 *  tại MERCHANT vào ngày 20/11/2026. Dư nợ hiện tại là ... VND và số dư khả dụng là ... VND"
 * Returns null for any other email.
 */
export function parseHsbcCardEmail(body: string): HsbcCardEmail | null {
  const text = body.replace(/\s+/g, ' ');
  const m = text.match(
    /thẻ tín dụng\s+(\S+)\s+của Quý khách vừa thực hiện giao dịch với số tiền\s+([\d.,]+)\s*([A-Za-z]{3})\s+tại\s+(.+?)\s+vào ngày\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (!m) return null;
  const currency = m[3].toUpperCase();
  const amount = parseMoney(m[2], currency !== 'VND');
  const day = Number(m[5]);
  const month = Number(m[6]);
  if (!(amount > 0) || day < 1 || day > 31 || month < 1 || month > 12) return null;
  const vnd = (re: RegExp) => {
    const x = text.match(re);
    return x ? parseMoney(x[1], false) : null;
  };
  return {
    last4: m[1].replace(/[^0-9]/g, '').slice(-4),
    amount,
    currency,
    merchant: m[4].trim(),
    date: `${m[7]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    balance: vnd(/Dư nợ hiện tại là\s+([\d.,]+)\s*VND/i),
    available: vnd(/số dư khả dụng là\s+([\d.,]+)\s*VND/i),
  };
}

// HSBC Vietnam sends card alerts from notification.hsbc.com.hk (the group's Hong Kong domain).
export const ALLOWED_SENDER_DOMAINS = ['hsbc.com.vn', 'hsbc.com', 'hsbc.com.hk'];

/** Mail worth asking Claude about: it names an amount and reads like a transaction. Marketing and statements are skipped. */
export function looksLikeTransaction(body: string): boolean {
  return /\d[\d.,]*\s*(VND|VNĐ|đ\b)/i.test(body) && /giao dịch|transaction|ghi nợ|ghi có|debit|credit|chuyển khoản|thanh toán|payment/i.test(body);
}
