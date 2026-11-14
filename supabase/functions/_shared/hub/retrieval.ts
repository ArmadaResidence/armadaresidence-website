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
}

/** = internal.hub_branch_only_cards() */
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
  branch: string | null = null): RetrievalCard[] {
  const u = units.find((x) => x.key === unit);
  if (!u) throw new Error(`unknown unit ${unit}`);
  if (u.knowledge_hidden || !turn.length) return [];
  const keys = branchUnits(units, u.branch);
  const named = branch && branch !== 'both' && branch !== u.branch ? branchUnits(units, branch) : [];
  const focus = named.length ? named : keys;
  const hidden = units.filter((x) => x.knowledge_hidden).map((x) => x.key);
  const rel = relatedTopics(topics, turn);
  const rankUnit = (c: RetrievalCard) =>
    c.unit_keys.length > 0 && c.unit_keys.every((k) => focus.includes(k)) ? 0 : c.unit_keys.some((k) => focus.includes(k)) ? 1 : c.unit_keys.length === 0 ? 2 : 3;
  const exact = (c: RetrievalCard) => c.topic_keys.filter((k) => turn.includes(k)).length;
  const related = (c: RetrievalCard) => c.topic_keys.filter((k) => rel.includes(k)).length;
  return cards
    .filter((c) => c.published !== false && (!c.expires_on || c.expires_on >= today))
    .filter((c) => !c.unit_keys.some((k) => hidden.includes(k)))
    .filter((c) => exact(c) + related(c) > 0)
    .filter((c) => !BRANCH_ONLY.includes(c.key) || c.unit_keys.some((k) => keys.includes(k) || named.includes(k)))
    .sort((a, b) => rankUnit(a) - rankUnit(b) || exact(b) - exact(a) || related(b) - related(a) || a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(1, limit));
}
