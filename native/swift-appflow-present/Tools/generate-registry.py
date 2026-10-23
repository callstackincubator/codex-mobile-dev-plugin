#!/usr/bin/env python3
"""Codegen the screen registry from swift-appflow-parse's report.

Input: the parser's stdout, verbatim -- a path, or `-` for stdin. Output: a Swift
source file containing

    enum ScreenRegistry {
      static let entries: [String: () -> AnyView]
      static let requirements: [String: [String]]
      static let missing: [String: [String]]
    }

Each entry is the construction expression lifted verbatim from source, so the
Swift compiler -- not this script -- is what has to resolve the types. Nothing
here invents an argument, a type or a value: a row the parser refused is carried
into `missing` and left there, which is the honest answer and the one the harness
reports.

The input used to be a hand-authored `screens.json` carrying two fields the parser
did not emit -- `environmentRequires` and `bindingHost`. The parser now emits the
first, so the registry's environment audit is derived rather than asserted.
`bindingHost` has no parser equivalent and is optional: see `entry_body`.
"""
import argparse
import json
import sys

SKIP_RUNGS = {"skipped"}

CONTRACT_VERSION = 1


def entry_body(res: dict) -> str:
    """The Swift expression for one registry entry.

    The parser satisfies a `@Binding` with `.constant(...)`, which is a real binding and
    renders correctly; it is simply not writable, so a screen whose content changes only
    in response to its own writes is captured in its initial state. `bindingHost` is the
    richer alternative -- storage the screen can write back to -- but it needs an initial
    value, and the parser has none to observe. It is therefore read when some other source
    supplies it and never synthesised here.
    """
    expr = res["expression"]
    host = res.get("bindingHost")
    if host:
        return (
            f"AnyView(BindingHost(initial: {host['initial']} as {host['type']}) "
            f"{{ {expr} }})"
        )
    return f"AnyView({expr})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("report", help="swift-appflow-parse output; `-` reads stdin")
    ap.add_argument("-o", "--out", required=True)
    # A single-module app needs nothing here: the lifted expressions resolve against the
    # module they are compiled into. A multi-module app does -- IceCubesApp keeps most of
    # its screens in SPM packages under `Packages/`, so the registry has to name them.
    # These are module names the caller observed in the project, never guessed here.
    ap.add_argument("--import", dest="imports", action="append", default=[],
                    metavar="MODULE", help="emit `import MODULE` (repeatable)")
    ap.add_argument("--testable-import", dest="testable", action="append", default=[],
                    metavar="MODULE",
                    help="emit `@testable import MODULE` (repeatable). Needed only for a "
                         "screen that is internal to its package; valid only in a build "
                         "with testability enabled, which is why the output is also "
                         "DEBUG-guarded.")
    # A rung is a claim that an expression compiles at the lift site. The compiler is the
    # only thing that can settle that claim, and when it refuses, the screen is not
    # constructible -- so it belongs in `missing` with the compiler's reason, exactly like a
    # parser refusal. This is how a *verified* refusal gets recorded; it is not a place to
    # silence a screen that merely renders badly.
    ap.add_argument("--exclude", dest="excludes", action="append", default=[],
                    metavar="VIEW=REASON",
                    help="move VIEW from entries to missing with REASON (repeatable)")
    ap.add_argument("--debug-guard", action="store_true",
                    help="wrap the file in `#if DEBUG` so it cannot reach a release build")
    args = ap.parse_args()

    if args.report == "-":
        report = json.load(sys.stdin)
        source = "swift-appflow-parse (stdin)"
    else:
        with open(args.report) as f:
            report = json.load(f)
        source = args.report

    # The contract exists so a report of an unknown shape is refused rather than half-read
    # into a registry that compiles and is wrong.
    version = report.get("contractVersion")
    if version != CONTRACT_VERSION:
        print(f"generate-registry: report is contract {version}, this script reads "
              f"contract {CONTRACT_VERSION}", file=sys.stderr)
        return 2

    rows, missing = [], []
    for res in report.get("resolutions", []):
        if not res.get("screenEvidence"):
            continue  # leaf component, not a screen
        if res.get("rung") in SKIP_RUNGS or not res.get("expression"):
            # Recorded, not dropped: "we could not construct this, and here is what stood in
            # the way" is a result, and the only one that tells a reader what to fix.
            missing.append(res)
            continue
        rows.append(res)
    excluded = {}
    for spec in args.excludes:
        view, _, reason = spec.partition("=")
        if not reason:
            print(f"generate-registry: --exclude needs VIEW=REASON, got {spec!r}",
                  file=sys.stderr)
            return 2
        excluded[view] = reason
    unused = set(excluded) - {r["view"] for r in rows}
    if unused:
        # An exclusion that matches nothing is stale, and a stale exclusion silently
        # shrinks nothing today but hides a regression tomorrow.
        print(f"generate-registry: --exclude named no entry: {', '.join(sorted(unused))}",
              file=sys.stderr)
        return 2
    for r in list(rows):
        if r["view"] in excluded:
            rows.remove(r)
            missing.append({**r, "missing": [excluded[r["view"]]]})
    rows.sort(key=lambda r: r["view"])
    missing.sort(key=lambda r: r["view"])

    lines = [
        "// Generated by Tools/generate-registry.py -- do not edit.",
        f"// Source report: {source} (contract {version})",
        f"// {len(rows)} screen(s) and {len(missing)} refusal(s) "
        f"from app \"{report.get('app', '?')}\".",
        "",
    ]
    if args.debug_guard:
        lines.append("#if DEBUG")
        lines.append("")
    lines += [
        "import SwiftUI",
    ]
    lines += [f"import {m}" for m in args.imports if m not in args.testable]
    # `@testable` is not a trick to reach past an access control decision we disagree
    # with: it is how a debug build sees a package's internal screens at all. A screen it
    # cannot see is absent from the map, which is a worse answer than an honest one.
    lines += [f"@testable import {m}" for m in args.testable]
    lines += [
        "",
        "enum ScreenRegistry {",
        "  /// Swift cannot instantiate a struct from its type name (no value-type",
        "  /// reflection; NSClassFromString is Obj-C only), so the construction",
        "  /// expressions are compiled in here instead.",
        "  static let entries: [String: () -> AnyView] = [",
    ]
    for r in rows:
        lines.append(f"    // {r['file']}:{r['line']}")
        lines.append(f"    // rung: {r['rung']}  evidence: {','.join(r['screenEvidence'])}")
        if r.get("environmentRequires"):
            lines.append(f"    // requires app-root environment: {', '.join(r['environmentRequires'])}")
        lines.append(f"    \"{r['view']}\": {{ {entry_body(r)} }},")
    lines += [
        "  ]",
        "",
        "  /// What each screen needs from the app-root environment, as DATA.",
        "  ///",
        "  /// This used to be a comment. A comment cannot be checked: a missing",
        "  /// `@Environment` key does not trap, it falls back to `defaultValue` and",
        "  /// renders a plausible lie. The harness compares this list against the",
        "  /// keys actually installed at the presentation site and fails the",
        "  /// capture when one is unsatisfied.",
    ]
    reqs = [(r["view"], r["environmentRequires"]) for r in rows if r.get("environmentRequires")]
    if not reqs:
        lines.append("  static let requirements: [String: [String]] = [:]")
    else:
        lines.append("  static let requirements: [String: [String]] = [")
        for view, keys in reqs:
            joined = ", ".join(f"\"{k}\"" for k in keys)
            lines.append(f"    \"{view}\": [{joined}],")
        lines.append("  ]")
    lines += [
        "",
        "  /// What each screen needs because something INSIDE it reads it -- the parser's",
        "  /// transitive environment closure. Reported by the harness, never enforced.",
        "  ///",
        "  /// Kept apart from `requirements` on purpose. The relation is lexical, so a child",
        "  /// built inside a branch that never runs still contributes, and on a real app the",
        "  /// closure runs to twenty-odd keys per screen. Enforcing that would fail captures of",
        "  /// screens that render perfectly; reporting it gives whoever reads a crash the key",
        "  /// nothing declared. See `EnvironmentAudit.advisory`.",
    ]
    transitive = [
        (r["view"], r["environmentRequiresTransitive"])
        for r in rows
        if r.get("environmentRequiresTransitive")
    ]
    if not transitive:
        lines.append("  static let transitiveRequirements: [String: [String]] = [:]")
    else:
        lines.append("  static let transitiveRequirements: [String: [String]] = [")
        for view, keys in transitive:
            joined = ", ".join(f"\"{k}\"" for k in keys)
            lines.append(f"    \"{view}\": [{joined}],")
        lines.append("  ]")
    lines += [
        "",
        "  /// Screens the parser refused to construct, and what stood in the way.",
        "  ///",
        "  /// A screen we will not build is a correct answer -- a screenshot made from a",
        "  /// fabricated value is a lie, and the whole pipeline rests on not telling one.",
        "  /// Carrying the refusals into the binary lets a run report what is missing instead",
        "  /// of silently producing a smaller map than the app has.",
    ]
    if not missing:
        lines.append("  static let missing: [String: [String]] = [:]")
    else:
        lines.append("  static let missing: [String: [String]] = [")
        for r in missing:
            joined = ", ".join(f"\"{m}\"" for m in r.get("missing", []))
            lines.append(f"    \"{r['view']}\": [{joined}],")
        lines.append("  ]")
    lines += [
        "",
        "  static var names: [String] { entries.keys.sorted() }",
        "}",
        "",
    ]
    if args.debug_guard:
        lines += ["#endif", ""]

    with open(args.out, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {args.out}: {len(rows)} entries -> {', '.join(r['view'] for r in rows)}")
    if missing:
        print("  refused: " + "; ".join(
            f"{r['view']} ({', '.join(r.get('missing', [])) or 'no expression'})"
            for r in missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
