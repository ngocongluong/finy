// The whole look of the app is one JSON document (UiConfig). Finy (Claude)
// edits it through the update_ui tool; sanitizeUi() guarantees that whatever
// comes back is renderable and readable.
import type { CustomCard, HomeSectionId, MetricKey, UiColors, UiConfig } from './types';

export const HOME_SECTIONS: { id: HomeSectionId; label: string }[] = [
  { id: 'credit', label: 'Thẻ tín dụng kỳ này' },
  { id: 'month', label: 'Tháng này' },
  { id: 'networth', label: 'Tổng tiền hiện có' },
  { id: 'budget', label: 'Các khoản chi lớn nhất' },
  { id: 'recent', label: 'Giao dịch gần đây' },
  { id: 'plan', label: 'Kế hoạch dài hạn' },
  { id: 'custom', label: 'Thẻ tuỳ biến' },
];

export const METRIC_LABELS: Record<MetricKey, string> = {
  income: 'Tổng thu tháng này',
  expense: 'Tổng chi tháng này',
  saving: 'Để dành được tháng này',
  extraIncome: 'Thu phát sinh tháng này',
  extraExpense: 'Chi phát sinh tháng này',
  debtPayment: 'Trả nợ mỗi tháng',
  creditSpent: 'Đã xài tín dụng kỳ này',
  creditPlanned: 'Dự chi tín dụng mỗi kỳ',
  spendRatio: 'Chi/Thu',
  savingRate: 'Tỷ lệ để dành',
  netWorth: 'Tổng tiền hiện có',
  dailyAllowance: 'Hạn mức chi tiêu hôm nay',
  spentToday: 'Đã tiêu hôm nay',
  spentMonth: 'Đã tiêu trong tháng',
  projectedNetWorth: 'Tài sản cuối kế hoạch',
};

export const DEFAULT_UI: UiConfig = {
  colors: {
    bg: '#0B0D12',
    card: '#151821',
    cardAlt: '#1D2130',
    text: '#F2F3F7',
    muted: '#9499AB',
    accent: '#8B7CFF',
    onAccent: '#0B0D12',
    positive: '#2FBF71',
    negative: '#F0616D',
    warning: '#FAB219',
    border: '#262B3B',
  },
  radius: 18,
  fontScale: 1,
  density: 'comfortable',
  amountFormat: 'full',
  title: 'Finy',
  home: HOME_SECTIONS.map((s) => ({ id: s.id, visible: true })),
  customCards: [],
};

/** Fixed chart palette (validated for the dark surface, colour-blind safe as a set). */
export const CHART = {
  series: ['#3987e5', '#d95926', '#199e70'],
  grid: '#2c2f3d',
  axis: '#3b4052',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(hex: string): string {
  const h = hex.slice(1);
  return h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
}

function luminance(hex: string): number {
  const h = expandHex(hex);
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Adds an alpha channel to a #rrggbb colour. */
export function alpha(hex: string, a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${expandHex(hex)}${v}`;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

export type UiPatch = Partial<Omit<UiConfig, 'colors'>> & { colors?: Partial<UiColors> };

/**
 * Merges a patch into the current config and validates the result.
 * Returns the new config, or a list of problems when the result would be unusable.
 */
export function applyUiPatch(current: UiConfig, patch: UiPatch): { ui: UiConfig } | { errors: string[] } {
  const errors: string[] = [];
  const colors: UiColors = { ...current.colors };
  for (const [k, v] of Object.entries(patch.colors ?? {})) {
    if (!(k in colors)) continue;
    if (typeof v !== 'string' || !HEX.test(v)) {
      errors.push(`colors.${k}: "${String(v)}" is not a #rgb or #rrggbb colour`);
      continue;
    }
    colors[k as keyof UiColors] = v;
  }

  // Readability guard: Finy must not be able to produce an unreadable screen.
  const checks: [keyof UiColors, keyof UiColors, number][] = [
    ['text', 'bg', 7],
    ['text', 'card', 7],
    ['text', 'cardAlt', 4.5],
    ['muted', 'bg', 3.5],
    ['muted', 'card', 3.5],
    ['accent', 'bg', 3],
    ['accent', 'card', 3],
    ['onAccent', 'accent', 4.5],
    ['positive', 'card', 3],
    ['negative', 'card', 3],
    ['warning', 'card', 3],
  ];
  if (errors.length === 0) {
    for (const [fg, bg, min] of checks) {
      const c = contrast(colors[fg], colors[bg]);
      if (c < min) errors.push(`colors.${fg} on colors.${bg} has contrast ${c.toFixed(1)}:1, needs at least ${min}:1`);
    }
  }

  const known = new Set(HOME_SECTIONS.map((s) => s.id));
  let home = current.home;
  if (patch.home) {
    // Sections that were removed from the app (e.g. the old daily-allowance card) are dropped quietly.
    const REMOVED = ['today'];
    const wanted = patch.home.filter((h) => !REMOVED.includes(h.id as string));
    const seen = new Set<HomeSectionId>();
    const next: UiConfig['home'] = [];
    for (const h of wanted) {
      if (!known.has(h.id)) {
        errors.push(`home: unknown section "${String(h.id)}"`);
        continue;
      }
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      next.push({ id: h.id, visible: h.visible !== false });
    }
    // Sections not mentioned keep their previous state, after the listed ones.
    for (const h of current.home) if (!seen.has(h.id)) next.push(h);
    home = next;
  }

  let customCards = current.customCards;
  if (patch.customCards) {
    customCards = patch.customCards.slice(0, 8).map((c, i): CustomCard => ({
      id: c.id || `card${i}`,
      title: String(c.title ?? '').slice(0, 60),
      lines: (c.lines ?? []).slice(0, 8).map((l) => ({
        label: String(l.label ?? '').slice(0, 60),
        metric: l.metric && l.metric in METRIC_LABELS ? l.metric : undefined,
        text: l.text ? String(l.text).slice(0, 200) : undefined,
      })),
    }));
  }

  if (errors.length) return { errors };
  return {
    ui: {
      colors,
      radius: clamp(patch.radius, 0, 28, current.radius),
      fontScale: clamp(patch.fontScale, 0.85, 1.3, current.fontScale),
      density: patch.density === 'compact' || patch.density === 'comfortable' ? patch.density : current.density,
      amountFormat: patch.amountFormat === 'compact' || patch.amountFormat === 'full' ? patch.amountFormat : current.amountFormat,
      title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 24) : current.title,
      home,
      customCards,
    },
  };
}

/** Repairs a config loaded from storage (older versions, missing fields). */
export function normalizeUi(raw: unknown): UiConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_UI;
  const res = applyUiPatch(DEFAULT_UI, raw as UiPatch);
  if (!('ui' in res)) return DEFAULT_UI;
  // Sections added in a newer app version are missing from a saved layout; applyUiPatch
  // appends them at the end. Move each to where the default layout has it instead.
  const saved = new Set(((raw as UiPatch).home ?? []).map((h) => h.id));
  if (saved.size === 0) return res.ui;
  const home = res.ui.home.filter((h) => saved.has(h.id));
  DEFAULT_UI.home.forEach((h, i) => {
    if (saved.has(h.id)) return;
    const before = DEFAULT_UI.home.slice(0, i).map((x) => x.id);
    let at = 0;
    home.forEach((x, j) => {
      if (before.includes(x.id)) at = j + 1;
    });
    home.splice(at, 0, h);
  });
  return { ...res.ui, home };
}
