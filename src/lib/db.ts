// Encrypted on-device storage (SQLCipher). The 256-bit key lives in the
// Android Keystore via expo-secure-store; the database file is unreadable
// without it.
import * as SQLite from 'expo-sqlite';
import type { Tx } from './types';

let db: SQLite.SQLiteDatabase | null = null;

function conn(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database is not open');
  return db;
}

export async function openDb(keyHex: string): Promise<void> {
  if (db) return;
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Invalid database key');
  const d = await SQLite.openDatabaseAsync('finy.db');
  // Must be the first statement on the connection.
  await d.execAsync(`PRAGMA key = "x'${keyHex}'";`);
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tx (
      id TEXT PRIMARY KEY NOT NULL,
      ts INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      direction TEXT NOT NULL,
      note TEXT NOT NULL,
      source TEXT NOT NULL,
      counts_daily INTEGER NOT NULL,
      ext_id TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS tx_date ON tx(date);
  `);
  // Added later: marks credit-card transactions.
  const columns = await d.getAllAsync<{ name: string }>('PRAGMA table_info(tx)');
  if (!columns.some((c) => c.name === 'credit')) {
    await d.execAsync('ALTER TABLE tx ADD COLUMN credit INTEGER NOT NULL DEFAULT 0;');
  }
  db = d;
}

export async function closeDb(): Promise<void> {
  if (!db) return;
  await db.closeAsync();
  db = null;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await conn().getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await conn().runAsync('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [
    key,
    JSON.stringify(value),
  ]);
}

interface TxRow {
  id: string;
  ts: number;
  date: string;
  amount: number;
  direction: string;
  note: string;
  source: string;
  counts_daily: number;
  ext_id: string | null;
  credit: number;
}

const fromRow = (r: TxRow): Tx => ({
  id: r.id,
  ts: r.ts,
  date: r.date,
  amount: r.amount,
  direction: r.direction === 'in' ? 'in' : 'out',
  note: r.note,
  source: r.source === 'hsbc' ? 'hsbc' : 'manual',
  countsDaily: r.counts_daily === 1,
  extId: r.ext_id ?? undefined,
  credit: r.credit === 1 || undefined,
});

export async function txAll(): Promise<Tx[]> {
  const rows = await conn().getAllAsync<TxRow>('SELECT * FROM tx ORDER BY ts DESC');
  return rows.map(fromRow);
}

/** Inserts a transaction. Returns false when an imported one already exists (same ext_id). */
export async function txInsert(t: Tx): Promise<boolean> {
  const res = await conn().runAsync(
    'INSERT OR IGNORE INTO tx (id, ts, date, amount, direction, note, source, counts_daily, ext_id, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [t.id, t.ts, t.date, Math.round(t.amount), t.direction, t.note, t.source, t.countsDaily ? 1 : 0, t.extId ?? null, t.credit ? 1 : 0],
  );
  return res.changes > 0;
}

export async function txUpdate(t: Tx): Promise<void> {
  await conn().runAsync(
    'UPDATE tx SET ts = ?, date = ?, amount = ?, direction = ?, note = ?, counts_daily = ?, credit = ? WHERE id = ?',
    [t.ts, t.date, Math.round(t.amount), t.direction, t.note, t.countsDaily ? 1 : 0, t.credit ? 1 : 0, t.id],
  );
}

export async function txDelete(id: string): Promise<void> {
  await conn().runAsync('DELETE FROM tx WHERE id = ?', [id]);
}

/** Gmail message ids that were already imported (including ones the user deleted afterwards). */
export async function seenExtIds(): Promise<Set<string>> {
  const rows = await conn().getAllAsync<{ ext_id: string }>('SELECT ext_id FROM tx WHERE ext_id IS NOT NULL');
  const skipped = (await kvGet<string[]>('gmail_skipped')) ?? [];
  return new Set([...rows.map((r) => r.ext_id), ...skipped]);
}

/** Removes every credit-card transaction imported from HSBC mail (so the mail can be imported again). */
export async function deleteImportedCardTxs(): Promise<void> {
  await conn().runAsync("DELETE FROM tx WHERE source = 'hsbc' AND credit = 1");
}

export async function wipeAll(): Promise<void> {
  await conn().execAsync('DELETE FROM kv; DELETE FROM tx;');
}
