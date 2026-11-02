#!/usr/bin/env python3
"""Display & Text Size — read and change the settings an audit runs against.

The audit next door reports what a screen-reader user would hit. This
one changes the conditions the screen is rendered under, so you can
re-run that audit in dark mode, with Increase Contrast on, or at an
accessibility text size — which is where layouts actually break.

Every option is a radio row: the row says whether it is on, the manifest
says to draw it as a radio, and baguette draws it. Ticking is local, so
picking a size and an appearance costs one subprocess rather than two —
press Apply and both go together. The panel then re-renders from what
the command prints, so what you see is what the device reports, not what
the clicks assumed.

Each question is its own `group`, which is what keeps them independent:
picking "Dark" must not unpick the text size.

  in   BAGUETTE_URL / BAGUETTE_UDID / BAGUETTE_TOKEN in the environment,
       plus the ticked rows as {"args": {"settings": [...]}} on stdin
  out  one JSON object on stdout: {"ok": bool, "message"?, "rows": [...]}
"""

import json
import os
import sys
import urllib.error
import urllib.request

# The five "Larger Accessibility Sizes" plus the default, which is where
# most testing starts. The full twelve are available over the API; a
# panel listing all of them would be a scroll, not a control.
OFFERED_SIZES = [
    ("large", "Default"),
    ("extra-extra-extra-large", "Largest standard"),
    ("accessibility-medium", "Accessibility M"),
    ("accessibility-large", "Accessibility L"),
    ("accessibility-extra-extra-extra-large", "Accessibility XXXL"),
]


def answer(ok, rows=None, message=None):
    out = {"ok": ok, "rows": rows or []}
    if message:
        out["message"] = message
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(0)


def call(method, path, token, body=None):
    """One request against the running server. Raises on failure."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"X-Baguette-Token": token}
    if data:
        headers["content-type"] = "application/json"
    request = urllib.request.Request(path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def option(group, value, label, subtitle, selected):
    """One choice within a question.

    The row says what it *is* — on or off, which question it belongs to,
    what it submits — and the host draws the radio. This used to write
    "● " / "○ " into the title, which is a plugin drawing a control glyph
    inside a string: unstyleable, and read aloud as a bullet.
    """
    return {
        "title": label,
        "subtitle": subtitle,
        "severity": "info",
        "state": "on" if selected else "off",
        "value": f"{group}:{value}",
        "group": group,
    }


def rows_for(state):
    appearance = state.get("appearance")
    contrast = state.get("increaseContrast")
    size = state.get("contentSize")

    rows = [{"title": "Appearance", "severity": "info"}]
    for value, label in (("light", "Light"), ("dark", "Dark")):
        rows.append(option("appearance", value, label, None, appearance == value))

    rows.append({"title": "Increase Contrast", "severity": "info"})
    for value, label in (("disabled", "Off"), ("enabled", "On")):
        rows.append(option("increaseContrast", value, label, None, contrast == value))

    rows.append({"title": "Text size", "severity": "info"})
    for value, label in OFFERED_SIZES:
        rows.append(option(
            "contentSize", value, label,
            value if value != size else f"{value} — current",
            size == value,
        ))
    # A size outside the offered set is still reachable by stepping. These
    # are steps rather than choices, so they stay `run` rows — ticking a
    # relative change and applying it later would apply it from wherever
    # the size had got to by then, not from where it was when clicked.
    for value, label, hint in (
        ("decrement", "Smaller", "one step down"),
        ("increment", "Larger", "one step up"),
    ):
        rows.append({
            "title": label, "subtitle": hint, "severity": "info",
            "run": "display", "args": {"contentSize": value},
        })
    return rows


def settings_from(args):
    """Turn the ticked rows back into the interface payload.

    The browser submits `{"settings": ["appearance:dark", …]}` — one flat
    list, because that is what a tick set is. Each value carries its own
    question, so unpacking is a split rather than a lookup table.
    """
    if "settings" in args:
        picked = {}
        for entry in args.get("settings") or []:
            key, _, value = str(entry).partition(":")
            if key and value:
                picked[key] = value
        return picked
    # A `run` row (Smaller / Larger) posts the interface payload directly.
    return args


def main():
    base = os.environ.get("BAGUETTE_URL")
    udid = os.environ.get("BAGUETTE_UDID")
    token = os.environ.get("BAGUETTE_TOKEN", "")
    if not base or not udid:
        answer(False, message="No device focused")

    # The clicked row's args, when a row was clicked. Opening the panel
    # sends none, which means "just show me the current state".
    try:
        context = json.load(sys.stdin)
    except Exception:  # noqa: BLE001 - stdin is optional
        context = {}
    settings = settings_from(context.get("args") or {})

    url = f"{base}/simulators/{udid}/interface"
    try:
        if settings:
            state = call("POST", url, token, body=settings)
        else:
            state = call("GET", url + ".json", token)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        answer(False, message=f"Could not reach the interface settings: {detail}")
    except Exception as error:  # noqa: BLE001 - surfaced to the user verbatim
        answer(False, message=f"Could not reach the interface settings: {error}")

    # A device that isn't booted answers "unknown" for all three. Say so
    # rather than drawing a picker whose every option looks unselected.
    if state.get("appearance") in (None, "unknown", "unsupported"):
        answer(True, rows=[{
            "title": "Boot the device to change these",
            "subtitle": "appearance, contrast and text size need a running simulator",
            "severity": "warn",
        }])

    answer(True, rows=rows_for(state))


if __name__ == "__main__":
    main()
