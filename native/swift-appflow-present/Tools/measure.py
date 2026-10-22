#!/usr/bin/env python3
"""Measurement rig for the readiness-signal comparison.

Subcommands:
  fidelity     is an in-app raster the same image the compositor shows?
  truth        known-good settled screenshot per screen (the baseline)
  signals      time every readiness signal in one presentation per screen
  verdict      per (screen, signal): capture at the signal, diff vs truth
  leak         does root-owned store state survive a capture?
  relaunch     what a full relaunch between captures costs
  table        render the comparison table from the recorded JSON

Everything writes to shots/ and results/ next to this script's parent.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "Tools"))
import pngdiff  # noqa: E402

CTRL = os.environ.get("CTRL", "http://127.0.0.1:8765")
DEV = os.environ.get("DEV", "booted")
BUNDLE = "dev.codex.appflow.demo"
SIGNALS = ["frame", "stable", "idle", "timeout"]
# Mean grayscale difference (0..1) below which two captures are "the same
# screen". Calibrated in `fidelity` from repeat captures of a static screen,
# not picked to make the table look good -- see the report.
SAME_SCREEN = 0.010


def get(path, timeout=30):
    with urllib.request.urlopen(f"{CTRL}{path}", timeout=timeout) as r:
        return r.read()


def get_json(path, timeout=30):
    return json.loads(get(path, timeout))


def snap_app(dest, kind="layer"):
    """In-app raster over the control channel. Returns elapsed ms."""
    t0 = time.time()
    data = get(f"/snapshot?kind={kind}")
    ms = (time.time() - t0) * 1000
    with open(dest, "wb") as f:
        f.write(data)
    return ms


def snap_simctl(dest):
    t0 = time.time()
    subprocess.run(["xcrun", "simctl", "io", DEV, "screenshot", "--type=png", dest],
                   check=True, capture_output=True)
    return (time.time() - t0) * 1000


def outdir(*parts):
    d = os.path.join(HERE, *parts)
    os.makedirs(d, exist_ok=True)
    return d


def results(name):
    d = outdir("results")
    return os.path.join(d, name)


def screens():
    return get_json("/screens")["detail"]


def dismiss():
    get("/dismiss")


def relaunch(timeout_s=30):
    """Terminate and relaunch the app, returning when the control channel answers.

    This is how a capture is reset. There is no in-process alternative that does not
    require the app's own stores to conform to a protocol of ours -- the per-screen
    source change this harness exists to avoid -- and a fresh process additionally
    cannot leak pending work and isolates a crashing screen. Measured at ~620 ms.
    """
    t0 = time.time()
    subprocess.run(["xcrun", "simctl", "terminate", DEV, BUNDLE], capture_output=True)
    subprocess.run(["xcrun", "simctl", "launch", DEV, BUNDLE], check=True, capture_output=True)
    while True:
        try:
            get_json("/screens", timeout=2)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.05)
        if time.time() - t0 > timeout_s:
            raise SystemExit("relaunch never answered")
    get("/hud?on=0")
    return (time.time() - t0) * 1000


def present(screen, **kw):
    q = "&".join(f"{k}={v}" for k, v in kw.items())
    return get_json(f"/present?screen={screen}&{q}", timeout=60)


# ---------------------------------------------------------------- fidelity

def cmd_fidelity(_args):
    """Deliverable 4: is a cheap in-app raster faithful, and how cheap?

    Compares, on screens chosen to stress it (plain content, a material/glass
    nav bar, an animation), the three in-app raster paths against what
    `simctl io screenshot` -- i.e. the actual compositor output -- produces.
    """
    get("/hud?on=0")
    rows = []
    for screen in ["AboutView", "SelfContainedNavView", "ProfileView"]:
        relaunch()
        present(screen, signal="timeout", budget_ms=2500)
        d = outdir("shots", "fidelity")
        ref = os.path.join(d, f"{screen}-simctl.png")
        ms_simctl = snap_simctl(ref)
        # A second simctl shot of the same static screen: the floor on how
        # equal two "identical" captures can be.
        ref2 = os.path.join(d, f"{screen}-simctl2.png")
        ms_simctl2 = snap_simctl(ref2)
        g_ref = pngdiff.gray_grid(ref)
        noise = pngdiff.diff(g_ref, pngdiff.gray_grid(ref2))
        row = {"screen": screen, "simctl_ms": round(ms_simctl, 1),
               "simctl2_ms": round(ms_simctl2, 1), "simctl_self_diff": round(noise, 5)}
        for kind in ["layer", "draw", "renderer"]:
            p = os.path.join(d, f"{screen}-{kind}.png")
            try:
                ms = snap_app(p, kind)
                row[f"{kind}_ms"] = round(ms, 1)
                row[f"{kind}_diff"] = round(pngdiff.diff(g_ref, pngdiff.gray_grid(p)), 5)
            except Exception as e:  # noqa: BLE001
                row[f"{kind}_ms"] = None
                row[f"{kind}_err"] = str(e)[:120]
        rows.append(row)
        print(json.dumps(row))
    with open(results("fidelity.json"), "w") as f:
        json.dump(rows, f, indent=2)


# ------------------------------------------------------------------- truth

def cmd_truth(args):
    """Ground truth: a generously settled capture per screen."""
    get("/hud?on=0")
    d = outdir("shots", "truth")
    rows = []
    for s in screens():
        name = s["name"]
        relaunch()
        # `timeout` as the wait signal == a flat, generous settle delay.
        r = present(name, signal="timeout", budget_ms=args.settle_ms)
        path = os.path.join(d, f"{name}.png")
        ms = snap_app(path, args.kind) if args.kind != "simctl" else snap_simctl(path)
        rows.append({"screen": name, "settle_ms": args.settle_ms,
                     "capture_ms": round(ms, 1), "signals": r["signals"],
                     "env": r["env"]})
        print(f"{name:22s} settled {args.settle_ms}ms  capture {ms:6.1f}ms  env={r['env']}")
    with open(results("truth.json"), "w") as f:
        json.dump(rows, f, indent=2)


# ----------------------------------------------------------------- signals

def cmd_signals(args):
    """One presentation per screen; record when each signal first fired."""
    get("/hud?on=0")
    rows = []
    for s in screens():
        name = s["name"]
        relaunch()
        r = present(name, signal="timeout", observe_all=1, budget_ms=args.budget_ms,
                    stable_threshold=args.stable_threshold,
                    stable_quiet_ms=args.stable_quiet_ms,
                    idle_quiet_ms=args.idle_quiet_ms)
        rows.append({"screen": name, **r["signals"], "env": r["env"]})
        sg = r["signals"]
        print(f"{name:22s} frame={sg['frame_ms']} "
              f"stable={sg['stable_ms']} idle={sg['idle_ms']} "
              f"anim={sg['saw_animation']} peak_work={sg['peak_outstanding']}")
    with open(results("signals.json"), "w") as f:
        json.dump({"tuning": {"stable_threshold": args.stable_threshold,
                              "stable_quiet_ms": args.stable_quiet_ms,
                              "idle_quiet_ms": args.idle_quiet_ms,
                              "budget_ms": args.budget_ms},
                   "rows": rows}, f, indent=2)


# ----------------------------------------------------------------- verdict

def cmd_verdict(args):
    """For each (screen, signal): capture AT the signal, diff against truth."""
    get("/hud?on=0")
    truth_dir = os.path.join(HERE, "shots", "truth")
    grids = {}
    out = []
    for s in screens():
        name = s["name"]
        tp = os.path.join(truth_dir, f"{name}.png")
        if not os.path.exists(tp):
            print(f"!! no ground truth for {name}; run `truth` first")
            continue
        grids[name] = pngdiff.gray_grid(tp)
        for sig in SIGNALS:
            relaunch()
            r = present(name, signal=sig, budget_ms=args.budget_ms)
            d = outdir("shots", "signal", sig)
            path = os.path.join(d, f"{name}.png")
            cap_ms = snap_app(path, args.kind)
            dv = pngdiff.diff(grids[name], pngdiff.gray_grid(path))
            fired = r["fired"] and r["signals"][f"{sig}_ms"] is not None
            row = {"screen": name, "signal": sig,
                   "fired_ms": r["signals"][f"{sig}_ms"],
                   "fired": fired,
                   "capture_lag_ms": round(cap_ms, 1),
                   "diff": round(dv, 5),
                   "correct": dv <= SAME_SCREEN,
                   "env_missing": r["env"]["missing"]}
            out.append(row)
            mark = "OK " if row["correct"] else "BAD"
            print(f"{mark} {name:22s} {sig:8s} fired={row['fired_ms']}ms diff={dv:.5f}")
    with open(results("verdict.json"), "w") as f:
        json.dump({"same_screen_threshold": SAME_SCREEN, "rows": out}, f, indent=2)


# --------------------------------------------------------------- calibrate

# Grid for the correctness metric. Finer than the in-app stability raster
# because this runs on the host with no time budget.
JUDGE_W, JUDGE_H = 160, 347
# A cell counts as changed when it moves this much (0..1 grayscale).
JUDGE_CELL = 0.06


def judge_grid(path):
    return pngdiff.gray_grid(path, JUDGE_W, JUDGE_H)


def cmd_calibrate(_args):
    """Establish that the correctness metric can tell these screens apart.

    Floor: two captures of the same settled screen.
    Ceiling: captures of screens a human would never confuse.
    A metric whose floor and ceiling overlap cannot judge anything, so this
    runs before any verdict is believed.
    """
    truth = os.path.join(HERE, "shots", "truth")
    names = [n[:-4] for n in sorted(os.listdir(truth)) if n.endswith(".png")]
    grids = {n: judge_grid(os.path.join(truth, f"{n}.png")) for n in names}

    relaunch()
    present("AboutView", signal="timeout", budget_ms=2500)
    d = outdir("shots", "calibrate")
    a = os.path.join(d, "AboutView-repeat1.png")
    b = os.path.join(d, "AboutView-repeat2.png")
    snap_app(a, "draw")
    snap_app(b, "draw")
    floor_same = pngdiff.changed_fraction(judge_grid(a), judge_grid(b), JUDGE_CELL)
    floor_truth = pngdiff.changed_fraction(judge_grid(a), grids["AboutView"], JUDGE_CELL)

    pairs = [("FeedView", "AboutView"), ("ProfileView", "OrderDetailView"),
             ("EmptyInboxView", "FeedView"), ("ThemeProbeView", "AboutView"),
             ("TwoStageOrderView", "OrderDetailView")]
    ceil = {f"{x}|{y}": round(pngdiff.changed_fraction(grids[x], grids[y], JUDGE_CELL), 5)
            for x, y in pairs}

    out = {"grid": [JUDGE_W, JUDGE_H], "cell_threshold": JUDGE_CELL,
           "floor_repeat_capture": round(floor_same, 5),
           "floor_vs_truth": round(floor_truth, 5),
           "ceiling_different_screens": ceil}
    print(json.dumps(out, indent=2))
    with open(results("calibrate.json"), "w") as f:
        json.dump(out, f, indent=2)


def cmd_rejudge(args):
    """Re-score the already-captured signal shots with the current metric.

    Separated from `verdict` on purpose: re-capturing 60 screenshots to change a
    host-side comparison would be re-running the experiment to get a different
    answer. The captures are the data; the metric is not.
    """
    with open(results("verdict.json")) as f:
        v = json.load(f)
    truth = os.path.join(HERE, "shots", "truth")
    grids = {}
    for row in v["rows"]:
        n = row["screen"]
        if n not in grids:
            grids[n] = judge_grid(os.path.join(truth, f"{n}.png"))
        p = os.path.join(HERE, "shots", "signal", row["signal"], f"{n}.png")
        if not os.path.exists(p):
            row["changed_fraction"] = None
            continue
        cf = pngdiff.changed_fraction(grids[n], judge_grid(p), JUDGE_CELL)
        row["changed_fraction"] = round(cf, 5)
        row["correct"] = cf <= args.threshold
        mark = "OK " if row["correct"] else "BAD"
        print(f"{mark} {n:22s} {row['signal']:8s} fired={row['fired_ms']} changed={cf:.5f}")
    v["metric"] = {"grid": [JUDGE_W, JUDGE_H], "cell_threshold": JUDGE_CELL,
                   "same_screen_max_changed_fraction": args.threshold}
    with open(results("verdict.json"), "w") as f:
        json.dump(v, f, indent=2)


# ------------------------------------------------------------------- sweep

# The screens the stability signal has to separate, and what a correct `stable`
# would have to do on each. "late" = must not fire before the data lands;
# "early" = should fire promptly because the screen really is finished;
# "never"  = the screen never stops moving, so stable cannot be right.
SWEEP_EXPECT = {
    "AboutView": "early",
    "ProfileView": "early",
    "EmptyInboxView": "early",
    "FeedView": "late",
    "RemoteAvatarView": "late",
    "TwoStageOrderView": "late",
    "AnimatedBannerView": "never",
}


def cmd_sweep(args):
    """Is there ANY (raster size, threshold, quiet window) that works?

    Sweeping is the only honest way to answer this. Reporting one hand-picked
    threshold that happens to pass on these seven screens would be fitting to
    the demo app and calling it a contract.
    """
    get("/hud?on=0")
    grids = ["32x70", "48x104", "96x208", "200x434"]
    thresholds = [0.02, 0.004, 0.001, 0.0002, 0.00002]
    rows = []
    for grid in grids:
        tw, th = grid.split("x")
        for thr in thresholds:
            verdicts = {}
            for screen, want in SWEEP_EXPECT.items():
                relaunch()
                r = present(screen, signal="timeout", observe_all=1,
                            budget_ms=args.budget_ms, thumb_w=tw, thumb_h=th,
                            stable_threshold=thr,
                            stable_quiet_ms=args.stable_quiet_ms)
                st = r["signals"]["stable_ms"]
                # The reference for "late" used to be the screen's own `captureReady`
                # declaration. With that removed, `idle` is the reference: it is the
                # signal the pipeline actually ships, and on these screens it is the
                # one measured to be right.
                reference = r["signals"]["idle_ms"]
                if want == "never":
                    ok = st is None
                elif want == "early":
                    ok = st is not None and st < 1000
                else:  # late: must not fire appreciably before the data lands
                    ok = st is not None and reference is not None and st >= reference * 0.9
                verdicts[screen] = {"stable_ms": st, "idle_ms": reference, "ok": ok}
            n_ok = sum(1 for v in verdicts.values() if v["ok"])
            rows.append({"grid": grid, "threshold": thr,
                         "quiet_ms": args.stable_quiet_ms,
                         "passed": n_ok, "of": len(SWEEP_EXPECT),
                         "screens": verdicts})
            print(f"grid={grid:9s} thr={thr:<9g} quiet={args.stable_quiet_ms}ms  "
                  f"{n_ok}/{len(SWEEP_EXPECT)} "
                  + " ".join(f"{s.replace('View','')}={'ok' if v['ok'] else 'NO'}"
                             f"({'-' if v['stable_ms'] is None else int(v['stable_ms'])})"
                             for s, v in verdicts.items()))
    with open(results(f"sweep-q{args.stable_quiet_ms}.json"), "w") as f:
        json.dump(rows, f, indent=2)
    best = max(rows, key=lambda r: r["passed"])
    print(f"\nbest: grid={best['grid']} threshold={best['threshold']} "
          f"-> {best['passed']}/{best['of']}")


# -------------------------------------------------------------------- leak

def cmd_leak(_args):
    """Does a presented screen's write to a root store survive the capture?

    TwoStageOrderView mutates a root-owned store by itself (its `onAppear`
    drives the store to stage 3), so this needs no synthetic input. The second
    presentation is a DIFFERENT screen: if the store is still at stage 3 when an
    unrelated screen is up, the first capture leaked into the pipeline.

    The two arms are the two resets available to a harness that requires no source
    changes: dismissing the overlay (view identity only) and relaunching the process.
    The in-process store reset the first version of this measured is gone -- it needed
    every store in the app to conform to a protocol of ours.
    """
    rows = []
    for mode in ("dismiss", "relaunch"):
        relaunch()
        present("TwoStageOrderView", signal="timeout", budget_ms=4000)
        after_first = get_json("/state")["orderStage"]
        if mode == "relaunch":
            relaunch()
        else:
            dismiss()
            time.sleep(0.2)
        present("EmptyInboxView", signal="idle", budget_ms=2000)
        leaked = get_json("/state")["orderStage"]
        rows.append({"reset": mode, "stage_after_first_capture": after_first,
                     "stage_during_next_capture": leaked, "leaked": leaked != 0})
        print(f"reset={mode}: stage after capture={after_first}, "
              f"stage during NEXT capture={leaked} -> "
              f"{'LEAKED' if leaked != 0 else 'clean'}")
    with open(results("leak.json"), "w") as f:
        json.dump(rows, f, indent=2)


def cmd_relaunch(args):
    """What a full relaunch between captures costs, measured end to end."""
    times = []
    for _ in range(args.n):
        # The helper returns when the control channel answers again: that is when the
        # app is usable, which is the number that matters.
        times.append(relaunch())
        print(f"relaunch+ready {times[-1]:.0f}ms")
    print(f"min={min(times):.0f}ms median={sorted(times)[len(times)//2]:.0f}ms max={max(times):.0f}ms")
    with open(results("relaunch.json"), "w") as f:
        json.dump({"ms": [round(t, 1) for t in times]}, f, indent=2)


# ------------------------------------------------------------------- table

def cmd_table(_args):
    with open(results("verdict.json")) as f:
        v = json.load(f)
    with open(results("signals.json")) as f:
        sg = json.load(f)
    by = {}
    for r in v["rows"]:
        by.setdefault(r["screen"], {})[r["signal"]] = r
    names = sorted(by)
    head = f"{'screen':24s}" + "".join(f"{s:>20s}" for s in SIGNALS)
    print(head)
    print("-" * len(head))
    for n in names:
        cells = []
        for s in SIGNALS:
            r = by[n].get(s)
            if not r:
                cells.append(f"{'-':>20s}")
                continue
            t = "never" if r["fired_ms"] is None else f"{r['fired_ms']:.0f}ms"
            cells.append(f"{t + ' ' + ('OK' if r['correct'] else 'WRONG'):>20s}")
        print(f"{n:24s}" + "".join(cells))
    print()
    print("tuning:", json.dumps(sg["tuning"]))
    m = v.get("metric")
    if m:
        print(f"verdict metric: {m['grid'][0]}x{m['grid'][1]} grid, cell>{m['cell_threshold']} "
              f"counts as changed; same screen when changed fraction <= "
              f"{m['same_screen_max_changed_fraction']}")
    else:
        print("verdict metric: mean grayscale diff <=", v["same_screen_threshold"],
              "(run `rejudge` for the calibrated metric)")
    miss = sorted({r["screen"] for r in v["rows"] if r.get("env_missing")})
    if miss:
        print("environment audit flagged unsatisfied dependencies on:", ", ".join(miss))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fidelity").set_defaults(fn=cmd_fidelity)

    t = sub.add_parser("truth")
    t.add_argument("--settle-ms", type=int, default=4000)
    t.add_argument("--kind", default="layer")
    t.set_defaults(fn=cmd_truth)

    g = sub.add_parser("signals")
    g.add_argument("--budget-ms", type=int, default=5000)
    g.add_argument("--stable-threshold", type=float, default=0.004)
    g.add_argument("--stable-quiet-ms", type=int, default=250)
    g.add_argument("--idle-quiet-ms", type=int, default=150)
    g.set_defaults(fn=cmd_signals)

    vd = sub.add_parser("verdict")
    vd.add_argument("--budget-ms", type=int, default=5000)
    vd.add_argument("--kind", default="layer")
    vd.set_defaults(fn=cmd_verdict)

    sw = sub.add_parser("sweep")
    sw.add_argument("--budget-ms", type=int, default=4000)
    sw.add_argument("--stable-quiet-ms", type=int, default=250)
    sw.set_defaults(fn=cmd_sweep)

    sub.add_parser("calibrate").set_defaults(fn=cmd_calibrate)

    rj = sub.add_parser("rejudge")
    rj.add_argument("--threshold", type=float, default=0.004)
    rj.set_defaults(fn=cmd_rejudge)

    sub.add_parser("leak").set_defaults(fn=cmd_leak)

    rl = sub.add_parser("relaunch")
    rl.add_argument("-n", type=int, default=5)
    rl.set_defaults(fn=cmd_relaunch)

    sub.add_parser("table").set_defaults(fn=cmd_table)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
