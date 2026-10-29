// The scaffolding the CPU and React selection hand-offs share. Their evidence and arithmetic stay their own.

export const percentOf = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);

/**
 * A share, as the hand-offs write it. One decimal throughout: a whole percent
 * makes 99.6 read as "100% of the recording", and 70.4 and 69.5 read as equal.
 */
export const percentText = (value: number) => `${value.toFixed(1)}%`;

/**
 * Each picked id once, with its pick number. The same item can be clicked twice before state settles,
 * so the number is the first-occurrence position, matching the views.
 */
export function numberedPicks(selected: readonly string[]): { id: string; pick: number }[] {
  return [...new Set(selected)].map(id => ({ id, pick: selected.indexOf(id) + 1 }));
}

/** Picks that share a name and location, each group in pick order. */
export function sameSitePicks<T extends { name: string }>(picks: readonly T[], location: (pick: T) => string | undefined): T[][] {
  const sites = new Map<string, T[]>();
  for (const pick of picks) {
    const key = `${pick.name}\u0000${location(pick) ?? ""}`;
    sites.set(key, [...(sites.get(key) ?? []), pick]);
  }
  return [...sites.values()].filter(group => group.length > 1);
}

/** The section naming picks the loaded data holds nothing for, after `holder`'s "holds no …" clause. */
export function unplacedSection(unresolved: readonly string[], holder: string): string[] {
  if (unresolved.length === 0) return [];
  const one = unresolved.length === 1;
  return [
    `## I could not place ${one ? "one selection" : `${unresolved.length} selections`}`,
    `The view reported ${one ? "it" : "them"} as selected but ${holder} with ${one ? "that reference" : "those references"}, so ${one ? "it carries" : "they carry"} no figures. Say which selections those are rather than guessing at what they were.`,
    "",
  ];
}
