/** Parses `1.2.3`, `v1.2` or `1.2.3` from a tag; prereleases and other tags give undefined. */
export const parse = version => {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : undefined;
};

export const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The newest stable version above `current`, and the newest compatible one, which the
 * weekly update applies: the same major version, or for 0.y.z the same minor, since
 * 0.x minors may break. 0.0.z has no compatible updates.
 */
export function targets(current, versions) {
  const now = parse(current);
  const stable = versions.map(version => ({ version, parsed: parse(version) })).filter(entry => entry.parsed).sort((a, b) => compare(a.parsed, b.parsed));
  const latest = stable.at(-1);
  if (now === undefined || latest === undefined) return {};
  const compatible = entry => now[0] > 0 ? entry.parsed[0] === now[0] : now[1] > 0 && entry.parsed[0] === 0 && entry.parsed[1] === now[1];
  const safe = stable.filter(entry => compatible(entry) && compare(entry.parsed, now) > 0).at(-1);
  return { latest: compare(latest.parsed, now) > 0 ? latest.version : undefined, safe: safe?.version };
}
