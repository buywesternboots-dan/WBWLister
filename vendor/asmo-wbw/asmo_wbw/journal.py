"""Rename journal with blob backups and crash recovery.

Port of the safety contract in /workspace/asmo-agent/src/journal.ts and
the recover/undo flow in pipeline.ts. The ASMO tree is not imported or
edited; this is a standalone Python port so asmoWBW can live in its own
folder without putting Western Boot World names into ASMO's denylist.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .hashutil import sha256_file

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
CREATE TABLE IF NOT EXISTS ops (
  op_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  original_path TEXT NOT NULL,
  original_hash TEXT NOT NULL,
  new_path TEXT,
  new_hash TEXT,
  paired_op_id TEXT,
  actions_json TEXT NOT NULL,
  blob_hash TEXT,
  profile TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  provider_used TEXT NOT NULL,
  skip_reason TEXT
);
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  refcount INTEGER NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Journal:
    def __init__(self, store_dir: str | Path) -> None:
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.store_dir / "journal.sqlite"
        self.blobs_dir = self.store_dir / "blobs"
        self.blobs_dir.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.db_path))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def flush(self) -> None:
        try:
            self.db.execute("PRAGMA wal_checkpoint(FULL);")
        except sqlite3.Error:
            pass

    def close(self) -> None:
        self.flush()
        self.db.close()

    def begin_op(
        self,
        *,
        batch_id: str,
        original_path: str,
        original_hash: str,
        profile: str,
        profile_version: str,
        provider_used: str,
        actions: Any,
    ) -> dict[str, Any]:
        row = {
            "op_id": str(uuid.uuid4()),
            "batch_id": batch_id,
            "ts": _now(),
            "status": "pending",
            "original_path": original_path,
            "original_hash": original_hash,
            "new_path": None,
            "new_hash": None,
            "paired_op_id": None,
            "actions_json": json.dumps(actions),
            "blob_hash": None,
            "profile": profile,
            "profile_version": profile_version,
            "provider_used": provider_used,
            "skip_reason": None,
        }
        self.db.execute(
            """INSERT INTO ops (op_id, batch_id, ts, status, original_path, original_hash,
               new_path, new_hash, paired_op_id, actions_json, blob_hash, profile,
               profile_version, provider_used, skip_reason)
               VALUES (:op_id, :batch_id, :ts, :status, :original_path, :original_hash,
               :new_path, :new_hash, :paired_op_id, :actions_json, :blob_hash, :profile,
               :profile_version, :provider_used, :skip_reason)""",
            row,
        )
        self.db.commit()
        return row

    def commit_op(self, op_id: str, **fields: Any) -> None:
        current = self.get_op(op_id)
        if current is None:
            raise KeyError(f"Unknown op {op_id}")
        if "actions" in fields:
            fields = dict(fields)
            fields["actions_json"] = json.dumps(fields.pop("actions"))
        merged = {**current, **{k: v for k, v in fields.items() if v is not None or k in fields}}
        # Allow explicit None for skip_reason etc. via fields keys.
        for k, v in fields.items():
            merged[k] = v
        self.db.execute(
            """UPDATE ops SET status=:status, new_path=:new_path, new_hash=:new_hash,
               blob_hash=:blob_hash, paired_op_id=:paired_op_id, skip_reason=:skip_reason,
               actions_json=:actions_json WHERE op_id=:op_id""",
            merged,
        )
        self.db.commit()

    def get_op(self, op_id: str) -> dict[str, Any] | None:
        row = self.db.execute("SELECT * FROM ops WHERE op_id = ?", (op_id,)).fetchone()
        return dict(row) if row else None

    def find_by_path_or_id(self, token: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """SELECT * FROM ops
               WHERE op_id = ? OR new_path = ? OR original_path = ?
               ORDER BY ts DESC""",
            (token, token, token),
        ).fetchall()
        return [dict(r) for r in rows]

    def latest_done_by_new_path(self, file_path: str) -> dict[str, Any] | None:
        row = self.db.execute(
            """SELECT * FROM ops WHERE new_path = ? AND status = 'done'
               ORDER BY ts DESC LIMIT 1""",
            (file_path,),
        ).fetchone()
        return dict(row) if row else None

    def list_pending(self) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM ops WHERE status = 'pending' ORDER BY ts"
        ).fetchall()
        return [dict(r) for r in rows]

    def list_done(self) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM ops WHERE status = 'done' ORDER BY ts"
        ).fetchall()
        return [dict(r) for r in rows]

    def store_blob(self, digest: str, source_path: str | Path) -> str:
        dest = self.blobs_dir / digest
        existing = self.db.execute(
            "SELECT hash, path, refcount FROM blobs WHERE hash = ?", (digest,)
        ).fetchone()
        if existing:
            self.db.execute(
                "UPDATE blobs SET refcount = refcount + 1 WHERE hash = ?", (digest,)
            )
            self.db.commit()
            return existing["path"]
        Path(dest).write_bytes(Path(source_path).read_bytes())
        self.db.execute(
            "INSERT INTO blobs (hash, path, refcount) VALUES (?, ?, 1)",
            (digest, str(dest)),
        )
        self.db.commit()
        return str(dest)

    def release_blob(self, digest: str) -> None:
        existing = self.db.execute(
            "SELECT hash, path, refcount FROM blobs WHERE hash = ?", (digest,)
        ).fetchone()
        if not existing:
            return
        if existing["refcount"] <= 1:
            self.db.execute("DELETE FROM blobs WHERE hash = ?", (digest,))
            Path(existing["path"]).unlink(missing_ok=True)
        else:
            self.db.execute(
                "UPDATE blobs SET refcount = refcount - 1 WHERE hash = ?", (digest,)
            )
        self.db.commit()

    def blob_path(self, digest: str) -> Path:
        return self.blobs_dir / digest


def recover_pending(store_dir: str | Path) -> list[str]:
    """Roll back any in-flight rename if the process crashed mid-batch."""
    journal = Journal(store_dir)
    notes: list[str] = []
    try:
        for row in journal.list_pending():
            actions = json.loads(row["actions_json"] or "{}")
            dirs = {str(Path(row["original_path"]).parent)}
            if row.get("new_path"):
                dirs.add(str(Path(row["new_path"]).parent))
            plan = actions.get("plan") or {}
            if plan.get("proposed_path"):
                dirs.add(str(Path(plan["proposed_path"]).parent))
            if actions.get("tmp"):
                dirs.add(str(Path(actions["tmp"]).parent))
            marker = row["op_id"]
            for d in dirs:
                p = Path(d)
                if not p.is_dir():
                    continue
                for name in p.iterdir():
                    if f".wbw-tmp-{marker}" in name.name or f".wbw-undo-{marker}" in name.name:
                        name.unlink(missing_ok=True)
                        notes.append(f"removed leftover {name.name}")
            if row.get("blob_hash") and journal.blob_path(row["blob_hash"]).is_file():
                orig = Path(row["original_path"])
                orig_ok = orig.is_file() and sha256_file(orig) == row["original_hash"]
                if not orig_ok:
                    orig.parent.mkdir(parents=True, exist_ok=True)
                    tmp = Path(str(orig) + f".wbw-recover-{marker}")
                    tmp.write_bytes(journal.blob_path(row["blob_hash"]).read_bytes())
                    tmp.replace(orig)
                    notes.append(f"restored original for pending {row['op_id']}")
            for out in (row.get("new_path"), plan.get("proposed_path"), actions.get("confirm_path")):
                if (
                    out
                    and Path(out).exists()
                    and Path(out).resolve() != Path(row["original_path"]).resolve()
                ):
                    Path(out).unlink(missing_ok=True)
                    notes.append(f"removed incomplete output {out}")
            journal.commit_op(row["op_id"], status="failed", skip_reason="recovered at startup; rolled back")
            if row.get("blob_hash"):
                journal.release_blob(row["blob_hash"])
            notes.append(f"marked {row['op_id']} failed and rolled back")
    finally:
        journal.close()
    return notes
