// Read-only Gmail access through Google Sign-In on the phone. No server: the
// access token is obtained on-device and used directly against the Gmail API.
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { htmlToText } from './mailText';

export { senderAllowed } from './mailText';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

let configured = false;
function configure() {
  if (configured) return;
  GoogleSignin.configure({ scopes: [SCOPE] });
  configured = true;
}

export function currentEmail(): string | null {
  configure();
  return GoogleSignin.getCurrentUser()?.user.email ?? null;
}

/**
 * The Google account this app is already signed in with and allowed to read
 * mail with, without showing any UI. null when there is none.
 */
export async function existingAccount(): Promise<string | null> {
  configure();
  const user = GoogleSignin.getCurrentUser() ?? (await GoogleSignin.signInSilently().then((r) => (r.type === 'success' ? r.data : null)).catch(() => null));
  if (!user || !user.scopes?.includes(SCOPE)) return null;
  return user.user.email;
}

let pending: Promise<string> | null = null;

/**
 * Opens Google's account picker and consent screen. Returns the connected address.
 * Only one sign-in can run at a time: the native module keeps a single pending
 * result, so a second call while the first is open would lose the first one's answer.
 */
export function connect(): Promise<string> {
  if (pending) return pending;
  pending = (async () => {
    configure();
    const existing = await existingAccount();
    if (existing) return existing;
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new Error('Đã huỷ đăng nhập Google.');
    if (!res.data.scopes?.includes(SCOPE)) throw new Error('Chưa cấp quyền đọc Gmail. Bấm Kết nối Gmail lại và đánh dấu cho phép đọc email.');
    return res.data.user.email;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function disconnect(): Promise<void> {
  configure();
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // Already revoked or offline: still sign out locally.
  }
  await GoogleSignin.signOut();
  cachedToken = null;
}

// The native module answers one getTokens call at a time (a second call while
// one is running overwrites it), and email bodies are fetched in parallel. So
// one token request is shared, and the token is reused until Gmail rejects it.
let cachedToken: string | null = null;
let tokenRequest: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  configure();
  if (!GoogleSignin.getCurrentUser()) {
    const silent = await GoogleSignin.signInSilently();
    if (silent.type !== 'success') throw new Error('Chưa kết nối Gmail. Hãy kết nối trong Cài đặt.');
  }
  return (await GoogleSignin.getTokens()).accessToken;
}

function token(): Promise<string> {
  if (cachedToken) return Promise.resolve(cachedToken);
  if (!tokenRequest) {
    tokenRequest = fetchToken()
      .then((t) => {
        cachedToken = t;
        return t;
      })
      .finally(() => {
        tokenRequest = null;
      });
  }
  return tokenRequest;
}

let refreshing: Promise<void> | null = null;

/** Drops a token Gmail rejected so the next request gets a fresh one (once, however many requests saw it). */
function invalidate(rejected: string): Promise<void> {
  if (cachedToken !== rejected) return refreshing ?? Promise.resolve();
  cachedToken = null;
  refreshing = GoogleSignin.clearCachedAccessToken(rejected)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, attempt = 0): Promise<T> {
  const t = await token();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 401 && attempt === 0) {
    await invalidate(t);
    return api<T>(path, 1);
  }
  if (!res.ok) {
    const body = await res.text();
    // Too many requests at once (for example two devices syncing): wait and try again.
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimit|quota/i.test(body));
    if (rateLimited && attempt < 5) {
      await wait(1000 * 2 ** attempt + Math.random() * 500);
      return api<T>(path, attempt + 1);
    }
    if (rateLimited) throw new Error('Gmail đang giới hạn tốc độ đọc thư. Thử đồng bộ lại sau ít phút.');
    if (res.status === 403) throw new Error('Gmail từ chối truy cập. Kiểm tra Gmail API đã bật và tài khoản đã cấp quyền đọc thư.');
    throw new Error(`Gmail API lỗi ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
}

interface GmailMessage {
  id: string;
  internalDate: string;
  snippet?: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
}

export interface Email {
  id: string;
  ts: number;
  from: string;
  subject: string;
  body: string;
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  // UTF-8 decode by hand (TextDecoder is not guaranteed on Hermes).
  let out = '';
  for (let i = 0; i < bin.length; ) {
    const c = bin.charCodeAt(i++);
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bin.charCodeAt(i++) & 0x3f));
    else if (c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bin.charCodeAt(i++) & 0x3f) << 6) | (bin.charCodeAt(i++) & 0x3f));
    } else {
      const cp =
        (((c & 0x07) << 18) | ((bin.charCodeAt(i++) & 0x3f) << 12) | ((bin.charCodeAt(i++) & 0x3f) << 6) | (bin.charCodeAt(i++) & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function findPart(p: Part | undefined, mime: string): string | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return decodeBase64Url(p.body.data);
  for (const child of p.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

export async function listMessageIds(query: string, max = 200): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  while (ids.length < max) {
    const page = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `/messages?maxResults=100&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    ids.push(...(page.messages ?? []).map((m) => m.id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return ids.slice(0, max);
}

export async function getEmail(id: string): Promise<Email> {
  const m = await api<GmailMessage>(`/messages/${id}?format=full`);
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const plain = findPart(m.payload, 'text/plain');
  const html = findPart(m.payload, 'text/html');
  const body = (plain && plain.trim().length > 40 ? plain : html ? htmlToText(html) : plain ?? m.snippet ?? '').trim();
  return { id: m.id, ts: Number(m.internalDate), from: header('from'), subject: header('subject'), body };
}
