#!/usr/bin/env python3
"""Lay several PNG captures side by side into one evidence image.

Dependency-free: decodes with pngdiff.read_png, nearest-neighbour downscales,
and writes a plain RGB PNG. Used to produce the paired before/after evidence
the report points at.

Usage: montage.py out.png in1.png in2.png [...]  [--height 520] [--gap 8]
"""
import argparse
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngdiff  # noqa: E402


def load_rgb(path, target_h):
    w, h, bpp, px, sb = pngdiff.read_png(path)
    tw = max(1, (w * target_h) // h)
    out = bytearray(tw * target_h * 3)
    stride = w * bpp
    for y in range(target_h):
        sy = (y * h) // target_h
        rowbase = sy * stride
        for x in range(tw):
            sx = (x * w) // tw
            o = rowbase + sx * bpp
            d = (y * tw + x) * 3
            if bpp >= 3 * sb:
                out[d] = px[o]
                out[d + 1] = px[o + sb]
                out[d + 2] = px[o + 2 * sb]
            else:
                out[d] = out[d + 1] = out[d + 2] = px[o]
    return tw, target_h, bytes(out)


def write_png(path, w, h, rgb):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        rows += rgb[y * w * 3:(y + 1) * w * 3]

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(rows), 6)))
        f.write(chunk(b"IEND", b""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--height", type=int, default=520)
    ap.add_argument("--gap", type=int, default=10)
    a = ap.parse_args()

    tiles = [load_rgb(p, a.height) for p in a.inputs]
    total_w = sum(t[0] for t in tiles) + a.gap * (len(tiles) - 1)
    canvas = bytearray(b"\x20" * (total_w * a.height * 3))
    x0 = 0
    for tw, th, px in tiles:
        for y in range(th):
            d = (y * total_w + x0) * 3
            canvas[d:d + tw * 3] = px[y * tw * 3:(y + 1) * tw * 3]
        x0 += tw + a.gap
    write_png(a.out, total_w, a.height, bytes(canvas))
    print(f"wrote {a.out} ({total_w}x{a.height}) from {len(tiles)} tiles")


if __name__ == "__main__":
    main()
