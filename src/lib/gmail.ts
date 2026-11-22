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

/** Opens Google's account picker and consent screen. Returns the connected address. */
export async function connect(): Promise<string> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res)) throw new Error('Đã huỷ đăng nhập Google.');
  return res.data.user.email;
}

export async function disconnect(): Promise<void> {
  configure();
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // Already revoked or offline: still sign out locally.
  }
  await GoogleSignin.signOut();
}

async function token(): Promise<string> {
  configure();
  if (!GoogleSignin.getCurrentUser()) {
    const silent = await GoogleSignin.signInSilently();
    if (silent.type !== 'success') throw new Error('Chưa kết nối Gmail. Hãy kết nối trong Cài đặt.');
  }
  return (await GoogleSignin.getTokens()).accessToken;
}

async function api<T>(path: string, retry = true): Promise<T> {
  const t = await token();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 401 && retry) {
    await GoogleSignin.clearCachedAccessToken(t);
    return api<T>(path, false);
  }
  if (!res.ok) {
    const body = await res.text();
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
