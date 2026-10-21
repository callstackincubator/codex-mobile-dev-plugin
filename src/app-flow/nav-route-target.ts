interface RouteTargetNode {
  id: string
  file: string | null
  params: readonly string[]
}

/**
 * Whether a node is the one a live navigator route names. Exported because the explore-UI pass
 * attributes its variants to the focused route and must use the same identity this module's own
 * param bridge does — a second spelling of "is this the same screen" is how two consumers start
 * disagreeing about which capture a frame belongs to.
 */
export const routeAnswersTo = (node: RouteTargetNode, routeName: string): boolean =>
  node.id === routeName || node.id.split('/').pop() === routeName

const answersTo = routeAnswersTo

/**
 * The one param-declaring node a live navigator route's params belong to, or null.
 *
 * A navigator names a screen the way it registered it, and the parser may hold the same component
 * under several nodes: one reached from a tab with no path (and so no params), another registered
 * for its URL (and so declaring them). In a measured sweep the navigator exposed the route that
 * carried the needed value under the first name, no param-declaring node answered to it, and 12
 * nodes stayed blocked behind ~400s of exploration. Two nodes backed by one component file are the
 * same screen, so the values are bridged through the file.
 *
 * A direct name hit is tried first and is never overridden by the bridge. Ambiguity is fatal on
 * every path, for the reason the name match always was: two candidates say nothing about which
 * record these params belong to, and a wrong attachment is a confidently wrong capture. So the bridge
 * is taken only when the name identifies exactly one node, that node has a file, and exactly one
 * other node sharing the file declares params; a file shared by two param-declaring nodes yields
 * none of them. A direct match that is itself ambiguous does not fall through to the bridge.
 */
export function resolveNavRouteTarget<T extends RouteTargetNode>(
  nodes: readonly T[],
  routeName: string
): T | null {
  const direct = nodes.filter((node) => node.params.length > 0 && answersTo(node, routeName))
  if (direct.length) return direct.length === 1 ? direct[0] : null
  const named = nodes.filter((node) => answersTo(node, routeName))
  if (named.length !== 1 || !named[0].file) return null
  const sharing = nodes.filter(
    (node) => node !== named[0] && node.file === named[0].file && node.params.length > 0
  )
  return sharing.length === 1 ? sharing[0] : null
}
