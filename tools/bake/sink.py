"""
Frame sink for the three.js bake.

The bake page renders each frame on the GPU and POSTs it here; this writes it
straight into assets/sequence/hero/. Run it alongside the static server:

    python tools/bake/sink.py
    python -m http.server 5173

then open http://localhost:5173/tools/bake/
"""

import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEQ = os.path.join(ROOT, "assets", "sequence")
DIRS = {name: os.path.join(SEQ, name) for name in ("hero", "holo", "turn", "turnholo")}
PORT = 5200


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8"))

        name = os.path.basename(body["name"])
        target = DIRS.get(body.get("dir", "hero"))
        if not name.startswith("frame_") or not name.endswith(".webp") or target is None:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(b"bad request")
            return

        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, name), "wb") as fh:
            fh.write(base64.b64decode(body["data"]))

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    for d in DIRS.values():
        os.makedirs(d, exist_ok=True)
    print(f"sink -> {SEQ}\nlistening on http://127.0.0.1:{PORT}", flush=True)
    try:
        # threaded: a single-threaded server drops a connection under a fast
        # bake, and one dropped frame aborts the whole run
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
