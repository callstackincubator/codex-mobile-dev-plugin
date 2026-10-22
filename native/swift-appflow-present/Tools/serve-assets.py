#!/usr/bin/env python3
"""Serve a PNG on 127.0.0.1:8766 with an artificial delay.

RemoteAvatarView needs a real URLSession fetch with real latency; the simulator
shares the host's loopback, so this is reachable from inside the app as
http://127.0.0.1:8766/avatar.png?delay=900 (delay in milliseconds).
"""
import struct
import sys
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


def make_png(w=400, h=400):
    """A deterministic gradient PNG, built without any image library."""
    rows = []
    for y in range(h):
        row = bytearray([0])  # filter type 0
        for x in range(w):
            row += bytes((255 - (x * 255) // w, (y * 255) // h, 160))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))


PNG = make_png()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        delay_ms = float(q.get("delay", ["0"])[0])
        if delay_ms > 0:
            time.sleep(delay_ms / 1000.0)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(PNG)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(PNG)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"serving avatar.png on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
