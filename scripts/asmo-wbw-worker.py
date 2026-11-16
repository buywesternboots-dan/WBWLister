#!/usr/bin/env python3
"""Tiny HTTP wrapper around asmoWBW. Stdlib plus the vendored asmo_wbw package.

Bind to loopback by default. Do not expose this on the public internet without a token.

    ASMO_WBW_ROOT=/path/to/vendor/asmo-wbw
    ASMO_WBW_PORT=8787
    ASMO_WBW_HOST=127.0.0.1
    ASMO_WBW_TOKEN=  # optional shared secret (Authorization: Bearer ...)

    python3 scripts/asmo-wbw-worker.py

POST /run   JSON listing (or { "listing": {...}, "fetch": false })
POST /undo  { "token": "<op-id>", "store": "<store dir>" }
GET  /health
"""

from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
VENDOR = Path(os.environ.get("ASMO_WBW_ROOT") or (ROOT / "vendor" / "asmo-wbw")).resolve()
sys.path.insert(0, str(VENDOR))

from asmo_wbw.contract import ContractError  # noqa: E402
from asmo_wbw.pipeline import undo_target  # noqa: E402
from asmo_wbw.run import process_payload  # noqa: E402

HOST = os.environ.get("ASMO_WBW_HOST", "127.0.0.1")
PORT = int(os.environ.get("ASMO_WBW_PORT", "8787"))
TOKEN = os.environ.get("ASMO_WBW_TOKEN", "")
MAX_BODY = 32 * 1024 * 1024


def _collect_files(out_dir: Path) -> list[dict]:
    files: list[dict] = []
    if not out_dir.is_dir():
        return files
    for path in out_dir.rglob("*"):
        if not path.is_file():
            continue
        if ".asmo-wbw" in path.parts:
            continue
        rel = path.relative_to(out_dir).as_posix()
        suffix = path.suffix.lower()
        if suffix == ".webp":
            ctype = "image/webp"
        elif suffix in {".jpg", ".jpeg"}:
            ctype = "image/jpeg"
        else:
            ctype = "application/octet-stream"
        files.append(
            {
                "path": rel,
                "content_type": ctype,
                "base64": base64.b64encode(path.read_bytes()).decode("ascii"),
            }
        )
    return files


def _authorized(handler: BaseHTTPRequestHandler) -> bool:
    if not TOKEN:
        return True
    got = handler.headers.get("Authorization", "")
    return got == f"Bearer {TOKEN}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in {"/", "/health"}:
            self._send(200, {"ok": True, "tool": "asmoWBW", "service": "asmo-wbw-worker"})
            return
        self._send(404, {"ok": False, "error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if not _authorized(self):
            self._send(401, {"ok": False, "error": "Unauthorized."})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self._send(413, {"ok": False, "error": "Body too large."})
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": f"Invalid JSON: {exc}"})
            return
        path = urlparse(self.path).path.rstrip("/")
        if path == "/run":
            self._run(data)
            return
        if path == "/undo":
            self._undo(data)
            return
        self._send(404, {"ok": False, "error": "Not found."})

    def _run(self, data: object) -> None:
        fetch = False
        payload = data
        if isinstance(data, dict) and "listing" in data:
            payload = data["listing"]
            fetch = bool(data.get("fetch"))
        with tempfile.TemporaryDirectory(prefix="asmo-wbw-worker-") as tmp:
            out_dir = Path(tmp) / "out"
            store_dir = Path(tmp) / "store"
            out_dir.mkdir()
            store_dir.mkdir()
            try:
                result = process_payload(payload, out_dir=out_dir, store_dir=store_dir, fetch=fetch)
            except ContractError as exc:
                self._send(400, {"ok": False, "error": str(exc)})
                return
            except Exception as exc:  # noqa: BLE001 — return the message, keep the worker up
                self._send(500, {"ok": False, "error": str(exc) or "asmoWBW failed."})
                return
            files = _collect_files(out_dir)
            self._send(200, {"ok": result.get("ok", True), "result": result, "files": files})

    def _undo(self, data: object) -> None:
        if not isinstance(data, dict):
            self._send(400, {"ok": False, "error": "Undo requires a JSON object."})
            return
        token = data.get("token") or data.get("op_id")
        store = data.get("store")
        if not token or not store:
            self._send(400, {"ok": False, "error": "undo requires token and store."})
            return
        result = undo_target(str(token), store, force=bool(data.get("force")))
        self._send(200 if result.get("ok") else 400, result)


def main() -> int:
    if not (VENDOR / "asmo_wbw").is_dir():
        print(f"asmo_wbw not found under {VENDOR}", file=sys.stderr)
        return 1
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"asmoWBW worker listening on http://{HOST}:{PORT} (vendor={VENDOR})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
