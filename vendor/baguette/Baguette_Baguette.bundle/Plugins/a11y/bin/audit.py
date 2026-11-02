#!/usr/bin/env python3
"""Accessibility audit — the plugin baguette ships as its reference.

Reads the on-screen accessibility tree from the already-running server
and reports what a screen-reader user would hit. Every rule here is a
pure function over the tree baguette already produces; nothing in this
file knows anything about simulators, HID, or private frameworks.

It is written in python3 (guaranteed present alongside the Xcode
baguette already requires) so a fresh install has a working plugin
with no toolchain to install. Third-party plugins are more likely to
be node — the contract is identical either way:

  in   BAGUETTE_URL / BAGUETTE_UDID / BAGUETTE_TOKEN in the environment
       (the same context arrives as JSON on stdin)
  out  one JSON object on stdout: {"ok": bool, "message"?, "rows": [...]}
"""

import json
import os
import sys
import urllib.request

# iOS Human Interface Guidelines minimum hit target, in points.
MIN_TAP_TARGET = 44.0

# Roles a user is expected to act on. An unlabeled decorative image is
# fine; an unlabeled button is a dead end for VoiceOver.
INTERACTIVE_ROLES = {
    "AXButton", "AXLink", "AXCheckBox", "AXRadioButton",
    "AXTextField", "AXSecureTextField", "AXSlider", "AXSwitch",
    "AXSegmentedControl", "AXPopUpButton", "AXTabButton",
}


def answer(ok, rows=None, message=None):
    out = {"ok": ok, "rows": rows or []}
    if message:
        out["message"] = message
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(0)


def walk(node, depth=0):
    """Yield every node in the tree, depth-first."""
    yield node, depth
    for child in node.get("children") or []:
        yield from walk(child, depth + 1)


def label_of(node):
    for key in ("label", "title", "value"):
        text = node.get(key)
        if text:
            return text
    return None


def rect(node):
    """Frames arrive flat — {"x","y","width","height"} — matching the
    device-point space gesture coordinates use."""
    frame = node.get("frame") or {}
    return (
        frame.get("x", 0.0), frame.get("y", 0.0),
        frame.get("width", 0.0), frame.get("height", 0.0),
    )


def row(title, subtitle, severity, frame=None):
    out = {"title": title, "subtitle": subtitle, "severity": severity}
    # Only attach a frame that can actually be drawn. Plenty of real
    # nodes report 0×0 (not laid out, or a container the translator
    # gives no geometry); a row carrying one would render as a
    # clickable highlight that flashes an invisible box at the origin.
    if frame and frame[2] > 0 and frame[3] > 0:
        x, y, w, h = frame
        out["frame"] = {"x": x, "y": y, "width": w, "height": h}
    return out


def audit(tree):
    rows = []
    seen_identifiers = {}

    for node, _ in walk(tree):
        if node.get("hidden"):
            continue

        role = node.get("role") or "?"
        label = label_of(node)
        x, y, w, h = rect(node)
        interactive = role in INTERACTIVE_ROLES

        # 1. Interactive elements a screen reader cannot announce.
        if interactive and not label:
            rows.append(row(
                "Interactive element has no label",
                f"{role} at ({x:.0f}, {y:.0f}) — VoiceOver announces nothing",
                "error", (x, y, w, h),
            ))

        # 2. Hit targets below the HIG minimum. Only flagged for things
        #    that are actually tappable, and only when the element has
        #    a real frame (a zero frame means "not laid out", which is
        #    a different problem and not this rule's business).
        if interactive and w > 0 and h > 0 and (w < MIN_TAP_TARGET or h < MIN_TAP_TARGET):
            rows.append(row(
                f"Tap target is {w:.0f}×{h:.0f}",
                f"{role} — below the {MIN_TAP_TARGET:.0f}×{MIN_TAP_TARGET:.0f}pt minimum",
                "warn", (x, y, w, h),
            ))

        # 3. Duplicate identifiers. These are what UI tests select on
        #    (RN `testID` lands here), so a duplicate makes a test
        #    ambiguous and silently flaky.
        identifier = node.get("identifier")
        if identifier:
            if identifier in seen_identifiers:
                rows.append(row(
                    f'Duplicate identifier "{identifier}"',
                    f"also on {seen_identifiers[identifier]} — UI-test selectors will be ambiguous",
                    "warn", (x, y, w, h),
                ))
            else:
                seen_identifiers[identifier] = role

    # Severity first, then reading order down the screen.
    rank = {"error": 0, "warn": 1, "info": 2}
    rows.sort(key=lambda r: (
        rank.get(r["severity"], 3),
        (r.get("frame") or {}).get("y", 0),
    ))
    return rows


def main():
    base = os.environ.get("BAGUETTE_URL")
    udid = os.environ.get("BAGUETTE_UDID")
    token = os.environ.get("BAGUETTE_TOKEN", "")
    if not base or not udid:
        answer(False, message="No device focused")

    url = f"{base}/simulators/{udid}/describe-ui.json"
    request = urllib.request.Request(url, headers={"X-Baguette-Token": token})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.load(response)
    except Exception as error:  # noqa: BLE001 - surfaced to the user verbatim
        answer(False, message=f"Could not read the accessibility tree: {error}")

    if not payload.get("ok"):
        answer(False, message=payload.get("error") or "No accessibility data")

    rows = audit(payload.get("tree") or {})
    if not rows:
        answer(True, rows=[row("No issues found", "Every check passed on this screen", "info")])
    answer(True, rows=rows)


if __name__ == "__main__":
    main()
