// Returns an editor for pinned Baguette source whose anchors must occur exactly once.
export function sourcePatch(integration) {
  return function replaceOnce(source, before, after) {
    const first = source.indexOf(before);
    const repeated = source.indexOf(before, first + before.length);
    if (first < 0 || repeated >= 0) throw new Error(`The pinned Baguette ${integration} integration point changed.`);
    return source.replace(before, () => after);
  };
}
