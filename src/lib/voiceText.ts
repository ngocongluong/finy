// Text side of talking to Finy: finding its name in what the Vietnamese speech
// recognizer heard, and turning a written answer into something to read aloud.
// No React Native imports, so it can be tested.

/** Lowercase, Vietnamese accents and punctuation removed: "Phai Nì!" -> "phai ni". */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// How the recognizer writes "Finy": as one word, or as two syllables.
const ONE_WORD = new Set(['finy', 'fini', 'finny', 'phiny', 'phini', 'phinny', 'fainy', 'faini', 'phainy', 'phaini', 'fyni', 'feeny', 'fynee']);
const FIRST = new Set(['phi', 'fi', 'phai', 'fai', 'phay', 'fay', 'fy', 'phy', 'fee']);
const SECOND = new Set(['ni', 'ny', 'nee']);
// Said after the name and not part of the request: "Finy ơi", "Finy à".
const CALL = new Set(['oi', 'a', 'nay', 'nhe', 'nha']);

export interface Wake {
  /** What was said after the name (and after "ơi"), as written by the recognizer. */
  rest: string;
}

/** Finds Finy's name in what was heard, and what was said after it; null when it was not called. */
export function findWake(text: string): Wake | null {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ raw: m[0], at: m.index ?? 0, p: plain(m[0]) }));
  for (let i = 0; i < words.length; i++) {
    let end = -1;
    if (ONE_WORD.has(words[i].p)) end = i;
    else if (FIRST.has(words[i].p) && i + 1 < words.length && SECOND.has(words[i + 1].p)) end = i + 1;
    if (end < 0) continue;
    let next = end + 1;
    while (next < words.length && CALL.has(words[next].p)) next++;
    const rest = next < words.length ? text.slice(words[next].at) : '';
    return { rest: rest.replace(/^[\s,.:;!?-]+/, '').trim() };
  }
  return null;
}

/** Whether what was said after the name is already a request (not just "Finy" or "Finy ơi"). */
export function isRequest(rest: string): boolean {
  return plain(rest).split(' ').filter(Boolean).length >= 2;
}

/**
 * A written answer as it should be read aloud: no markdown, "đ" read as
 * "đồng", and only the first sentences of a long answer (the whole answer is
 * in the chat).
 */
export function speakable(text: string, max = 320): string {
  let s = text
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    // (\b does not work after "đ": it only knows ASCII letters.)
    .replace(/(\d)\s?đ(?=$|[\s.,;:!?)])/g, '$1 đồng')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  // Cut at the last sentence end that fits; otherwise at a word.
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  s = end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  return `${s} Phần còn lại có trong khung chat.`;
}

/** Whether Finy's answer asks the user something back (then Finy listens again). */
export function asksBack(text: string): boolean {
  return /\?\s*$/.test(text.trim());
}
