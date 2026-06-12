/**
 * A tiny fuzzy matcher for filter inputs (palette, catalogs, ⌘K). Subsequence
 * matching with the usual bonuses: word starts, consecutive runs, and exact
 * substrings rank highest. Returns a score (higher = better) or null on miss.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  // Exact substring is always a strong match — earlier is better.
  const sub = t.indexOf(q);
  if (sub !== -1) return 1000 - sub + q.length * 4;

  // Subsequence walk with positional bonuses. Consecutive runs dominate (typo'd
  // fragments like "splt" must rank "split" above scattered word-start hits),
  // and a wide match span costs points so dense matches win.
  let score = 0;
  let ti = 0;
  let lastHit = -2;
  let firstHit = -1;
  for (const ch of q) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    score += 1;
    if (found === lastHit + 1) score += 10; // consecutive run
    if (found === 0 || !/[a-z0-9]/.test(t[found - 1]!)) score += 4; // word start
    if (firstHit === -1) firstHit = found;
    lastHit = found;
    ti = found + 1;
  }
  score -= Math.min(20, lastHit - firstHit - q.length + 1); // span penalty
  return score;
}

/** Filter + rank a list by a fuzzy query over each item's searchable text. */
export function fuzzyFilter<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, textOf(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
