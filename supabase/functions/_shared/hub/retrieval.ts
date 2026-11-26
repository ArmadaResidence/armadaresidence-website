// Guest Hub — the knowledge read's RULE (H4, 14 Nov 2026; replaced the same day by Ahmed's decision of 14 Nov 2026 —
// DECISIONS.md «the H4 review and the model instructions», spec §1.7, §4.6). The database function
// public.hub_knowledge_for is what the engine calls; this module states the same rule in TypeScript so
// scripts/hub-retrieval-check.mjs proves it on the approved seed offline, and supabase/tests/guest_hub_assistant.sql
// proves the database does the same.
//   - only published, unexpired cards (expires_on ≥ today, Riyadh);
//   - EVERY published card on both branch numbers — the number's own branch first;
//   - never a card tagged with a knowledge_hidden unit (the rooftop restaurant), on any number; that unit reads nothing;
//   - the Airport Road café menu and ordering cards (BRANCH_ONLY) on another branch's number only when the guest named
//     their branch (the understanding's branch);
//   - it must share a topic with the turn, or a topic's parent / child;
//   - order: the focus branch's cards (every unit of the number's branch — or of the branch the guest named), then the
//     cards shared with it, then the untagged, then the other branch's; then exact topic matches, related ones, the card
//     order, the key;
//   - S2e (Ahmed, 26 Nov 2026): the guest's own words rank the cards inside a topic — a card (of the focus, shared with
//     it, or untagged) whose text names one of the guest's words comes first, so the cap never cuts it
//     (internal.hub_guest_words / internal.hub_norm = guestWords / normWords);
//   - at most hub_cards_per_turn (5).
export interface RetrievalUnit {
  key: string;
  kind: 'branch' | 'dining';
  branch: string;
  knowledge_hidden: boolean;
}
export interface RetrievalTopic {
  key: string;
  parent_key: string | null;
}
export interface RetrievalCard {
  key: string;
  unit_keys: string[];
  topic_keys: string[];
  expires_on: string | null;
  sort: number;
  published?: boolean;
  /** S2e: the card's titles and texts (both languages), for the guest's words */
  text?: string;
}

/** = internal.hub_stop_words() (scripts/hub-s2e-migration.mjs → STOP_WORDS) */
export const STOP_WORDS = ['عندكم', 'عندكو', 'عندكوا', 'عندك', 'عندهم', 'لديكم', 'لديك', 'فيه', 'فيها', 'هل', 'يوجد', 'توجد', 'موجود', 'موجوده', 'متوفر', 'متوفره', 'يتوفر', 'تتوفر',
  'غرف', 'غرفه', 'تجهيزات', 'ايش', 'وش', 'شو', 'ماذا', 'كيف', 'ممكن', 'لو', 'سمحت', 'فندق', 'لكم', 'عن', 'على', 'علي', 'من', 'الى', 'الي', 'مع', 'هذا', 'هذه',
  'ابغى', 'ابغي', 'ابي', 'اريد', 'نبي', 'نبغى', 'نبغي', 'كم', 'متى', 'وين', 'اين', 'انا', 'احنا', 'نحن', 'السلام', 'عليكم', 'مرحبا', 'اهلا', 'لو', 'يا',
  'do', 'does', 'you', 'have', 'the', 'rooms', 'room', 'is', 'are', 'there', 'any', 'what', 'your', 'and', 'for', 'with', 'please', 'hotel', 'can', 'how',
  'hello', 'thanks', 'thank', 'would', 'like', 'want', 'need'];
/** = internal.hub_norm: lower case, one alif / ha / ya, no diacritics or tatweel, punctuation → space */
export const normWords = (t: string): string =>
  String(t ?? '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '')
    .replace(/[!-\/:-@\[-`{-~؟،؛«»“”‘’…]+/g, ' ').trim();
/** = internal.hub_guest_words: the guest's words of 3 letters or more, the article taken off a long word, no stop word */
export function guestWords(t: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const x of normWords(t ?? '').split(/\s+/)) {
    const w = x.length >= 5 && /^(وال|بال|فال|كال|لل|ال)/.test(x) ? x.replace(/^(وال|بال|فال|كال|لل|ال)/, '') : x;
    if (w.length >= 3 && !STOP_WORDS.includes(w)) out.add(w);
  }
  return [...out].sort();
}

/** = internal.hub_branch_only_cards() */
// H11c (24 Nov 2026): the reception from the room phone («اضغط 0») is both branches' card again — reception is 0 at both
export const BRANCH_ONLY = ['k-cafe-menu', 'k-cafe-phone', 'k-cafe-breakfast-menu'];

/** the units of a branch (a branch unit with its venues) */
export const branchUnits = (units: RetrievalUnit[], branch: string) => units.filter((x) => x.branch === branch).map((x) => x.key);

export function unitReadKeys(units: RetrievalUnit[], unit: string): string[] {
  const u = units.find((x) => x.key === unit);
  if (!u) throw new Error(`unknown unit ${unit}`);
  return branchUnits(units, u.branch);
}

export function relatedTopics(topics: RetrievalTopic[], turn: string[]): string[] {
  const out = new Set<string>();
  for (const t of topics) {
    if (turn.includes(t.key) && t.parent_key) out.add(t.parent_key);
    if (t.parent_key && turn.includes(t.parent_key)) out.add(t.key);
  }
  return [...out];
}

export function retrieve(units: RetrievalUnit[], topics: RetrievalTopic[], cards: RetrievalCard[], unit: string, turn: string[], today: string, limit = 5,
  branch: string | null = null, words: string | null = null): RetrievalCard[] {
  const u = units.find((x) => x.key === unit);
  if (!u) throw new Error(`unknown unit ${unit}`);
  if (u.knowledge_hidden || !turn.length) return [];
  // S2d (26 Nov 2026): a unit with no branch («السوشيال») is one of its own units
  const keys = [...new Set([...branchUnits(units, u.branch), u.key])];
  const named = branch && branch !== 'both' && branch !== u.branch ? branchUnits(units, branch) : [];
  const focus = named.length ? named : keys;
  const hidden = units.filter((x) => x.knowledge_hidden).map((x) => x.key);
  const rel = relatedTopics(topics, turn);
  const rankUnit = (c: RetrievalCard) =>
    c.unit_keys.length > 0 && c.unit_keys.every((k) => focus.includes(k)) ? 0 : c.unit_keys.some((k) => focus.includes(k)) ? 1 : c.unit_keys.length === 0 ? 2 : 3;
  const exact = (c: RetrievalCard) => c.topic_keys.filter((k) => turn.includes(k)).length;
  const related = (c: RetrievalCard) => c.topic_keys.filter((k) => rel.includes(k)).length;
  const gw = guestWords(words);
  const hits = (c: RetrievalCard) => { const t = normWords(c.text ?? ''); return gw.filter((w) => t.includes(w)).length; };
  const wordFirst = (c: RetrievalCard) => (hits(c) > 0 && (c.unit_keys.length === 0 || c.unit_keys.some((k) => focus.includes(k))) ? 0 : 1);
  return cards
    .filter((c) => c.published !== false && (!c.expires_on || c.expires_on >= today))
    .filter((c) => !c.unit_keys.some((k) => hidden.includes(k)))
    .filter((c) => exact(c) + related(c) > 0)
    .filter((c) => !BRANCH_ONLY.includes(c.key) || c.unit_keys.some((k) => keys.includes(k) || named.includes(k)))
    .sort((a, b) => wordFirst(a) - wordFirst(b) || rankUnit(a) - rankUnit(b) || hits(b) - hits(a) || exact(b) - exact(a) || related(b) - related(a) || a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(1, limit));
}
