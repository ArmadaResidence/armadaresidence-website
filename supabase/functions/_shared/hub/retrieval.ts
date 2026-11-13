// Guest Hub — the knowledge read's RULE (14 Nov 2026, session H4; docs/guest-hub/GUEST-HUB-SPEC.md §1.7, §4.6;
// DECISIONS.md 2026-11-14 «Guest Hub H4 — the knowledge base»). The database function public.hub_knowledge_for is what
// the engine calls; this module states the same rule in TypeScript so scripts/hub-retrieval-check.mjs can prove it on
// the approved seed offline (fast), and supabase/tests/guest_hub_knowledge.sql proves the database does the same.
//   - only published, unexpired cards (expires_on ≥ today, Riyadh);
//   - never a card tagged with a knowledge_hidden unit (the rooftop restaurant), on any number; that unit reads nothing;
//   - a card tagged with units is read only on those units' numbers; a dining unit also reads its branch's; an untagged
//     card is read everywhere;
//   - it must share a topic with the turn, or a topic's parent / child;
//   - order: the unit's own cards (tagged with it alone), then the shared (tagged with it among others or through the
//     dining unit's branch), then the untagged; then exact topic matches, related ones, the card order, the key;
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

export function unitReadKeys(units: RetrievalUnit[], unit: string): string[] {
  const u = units.find((x) => x.key === unit);
  if (!u) throw new Error(`unknown unit ${unit}`);
  return [u.key, ...(u.kind === 'dining' ? units.filter((b) => b.kind === 'branch' && b.branch === u.branch).map((b) => b.key) : [])];
}

export function relatedTopics(topics: RetrievalTopic[], turn: string[]): string[] {
  const out = new Set<string>();
  for (const t of topics) {
    if (turn.includes(t.key) && t.parent_key) out.add(t.parent_key);
    if (t.parent_key && turn.includes(t.parent_key)) out.add(t.key);
  }
  return [...out];
}

export function retrieve(units: RetrievalUnit[], topics: RetrievalTopic[], cards: RetrievalCard[], unit: string, turn: string[], today: string, limit = 5): RetrievalCard[] {
  const u = units.find((x) => x.key === unit);
  if (!u) throw new Error(`unknown unit ${unit}`);
  if (u.knowledge_hidden || !turn.length) return [];
  const keys = unitReadKeys(units, unit);
  const hidden = units.filter((x) => x.knowledge_hidden).map((x) => x.key);
  const rel = relatedTopics(topics, turn);
  const rankUnit = (c: RetrievalCard) =>
    c.unit_keys.length === 1 && c.unit_keys[0] === u.key ? 0 : c.unit_keys.includes(u.key) ? 1 : c.unit_keys.some((k) => keys.includes(k)) ? 2 : 3;
  const exact = (c: RetrievalCard) => c.topic_keys.filter((k) => turn.includes(k)).length;
  const related = (c: RetrievalCard) => c.topic_keys.filter((k) => rel.includes(k)).length;
  return cards
    .filter((c) => c.published !== false && (!c.expires_on || c.expires_on >= today))
    .filter((c) => !c.unit_keys.some((k) => hidden.includes(k)))
    .filter((c) => c.unit_keys.length === 0 || c.unit_keys.some((k) => keys.includes(k)))
    .filter((c) => exact(c) + related(c) > 0)
    .sort((a, b) => rankUnit(a) - rankUnit(b) || exact(b) - exact(a) || related(b) - related(a) || a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(1, limit));
}
