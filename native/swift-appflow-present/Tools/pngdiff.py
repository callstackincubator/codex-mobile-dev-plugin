#!/usr/bin/env python3
"""Minimal dependency-free PNG reader plus a perceptual-ish diff.

The measurement rig has to decide, mechanically, whether a screenshot taken at
a candidate readiness signal is the same screen as the known-good settled
screenshot. There is no Pillow or numpy on this machine, so: decode 8-bit
non-interlaced PNG, box-downscale to a small grayscale grid, and compare.

Downscaling is not cosmetic. At full resolution, text antialiasing and the
status-bar clock make every pair of screenshots differ; at 64x139 those vanish
while a spinner-vs-list difference does not.
"""
import struct
import sys
import zlib

BYTES_PER_PIXEL = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    """-> (width, height, bytes_per_pixel, raw bytes row-major)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\x1a"[:8] and data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos = 8
    idat = bytearray()
    w = h = depth = ctype = None
    palette = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            w, h, depth, ctype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", body)
            # `drawHierarchy` hands back a wide-gamut (16-bit) image, so 16 bpc
            # has to be handled: the high byte is taken as the sample.
            if depth not in (8, 16) or interlace != 0:
                raise ValueError(f"{path}: need 8/16-bit non-interlaced, got depth={depth} interlace={interlace}")
        elif tag == b"PLTE":
            palette = body
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break

    sample_bytes = depth // 8
    bpp = BYTES_PER_PIXEL[ctype] * sample_bytes
    raw = zlib.decompress(bytes(idat))
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ft != 0:
            raise ValueError(f"{path}: bad filter {ft}")
        out[y * stride:(y + 1) * stride] = line
        prev = line

    if ctype == 3:
        if palette is None:
            raise ValueError(f"{path}: indexed PNG without PLTE")
        expanded = bytearray(w * h * 3)
        for i, idx in enumerate(out):
            expanded[i * 3:i * 3 + 3] = palette[idx * 3:idx * 3 + 3]
        return w, h, 3, bytes(expanded), 1
    return w, h, bpp, bytes(out), sample_bytes


def gray_grid(path, gw=64, gh=139, crop_top_frac=0.0):
    """Box-average into a gw x gh grayscale grid of floats 0..1.

    `crop_top_frac` drops the top of the image -- the status-bar clock changes
    between any two captures and is not part of the screen under test.
    """
    w, h, bpp, px, sb = read_png(path)
    y0 = int(h * crop_top_frac)
    eff_h = h - y0
    stride = w * bpp
    grid = [0.0] * (gw * gh)
    counts = [0] * (gw * gh)
    # Sample rather than fully average: full averaging in pure Python over a
    # 1206x2622 image is seconds per image. A 4px stride keeps it honest and
    # fast, and the grid cells are ~19x19 source pixels wide.
    step = 4
    for y in range(y0, h, step):
        gy = ((y - y0) * gh) // eff_h
        if gy >= gh:
            continue
        rowbase = y * stride
        for x in range(0, w, step):
            gx = (x * gw) // w
            if gx >= gw:
                continue
            o = rowbase + x * bpp
            # Channels are `sb` bytes apart; the high byte is the sample.
            if bpp >= 3 * sb:
                v = (px[o] * 299 + px[o + sb] * 587 + px[o + 2 * sb] * 114) // 1000
            else:
                v = px[o]
            i = gy * gw + gx
            grid[i] += v
            counts[i] += 1
    for i in range(len(grid)):
        if counts[i]:
            grid[i] = grid[i] / counts[i] / 255.0
    return grid


def diff(a, b):
    """Mean absolute grayscale difference, 0..1."""
    if len(a) != len(b):
        return 1.0
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def changed_fraction(a, b, cell=0.06):
    """Fraction of grid cells that changed by more than `cell`.

    A mean difference is the wrong statistic for this job: "Loading order..."
    becoming "Order A-1042 - $48.50" is thin dark text on white over a few
    percent of the screen, so the mean barely moves while the screen is plainly
    a different screen. Counting changed cells is sensitive to small-area,
    high-contrast changes, which is exactly what a wrong capture looks like.
    """
    if len(a) != len(b):
        return 1.0
    n = sum(1 for x, y in zip(a, b) if abs(x - y) > cell)
    return n / len(a)


if __name__ == "__main__":
    g1 = gray_grid(sys.argv[1], crop_top_frac=0.05)
    g2 = gray_grid(sys.argv[2], crop_top_frac=0.05)
    print(f"{diff(g1, g2):.5f}")
