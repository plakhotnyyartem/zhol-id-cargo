"""Реестр событий: цепочка блоков, где каждый хранит хэш предыдущего.

Поле data хранится строкой ровно в том виде, в каком его хэшировали, поэтому
браузер может пересчитать хэши самостоятельно и проверить сервер."""
import hashlib
import json
import time


def block_hash(idx: int, ts: int, shipment: str, type_: str, data: str, prev_hash: str) -> str:
    raw = f"{idx}|{ts}|{shipment}|{type_}|{data}|{prev_hash}"
    return hashlib.sha256(raw.encode()).hexdigest()


def append(db, shipment: str, type_: str, payload: dict) -> dict:
    last = db.execute("SELECT idx, hash FROM ledger ORDER BY idx DESC LIMIT 1").fetchone()
    idx = last["idx"] + 1 if last else 0
    prev = last["hash"] if last else "0" * 64
    ts = int(time.time() * 1000)
    data = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    h = block_hash(idx, ts, shipment, type_, data, prev)
    db.execute("INSERT INTO ledger (idx, ts, shipment, type, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
               (idx, ts, shipment, type_, data, prev, h))
    return {"idx": idx, "hash": h}


def ensure_genesis(db) -> None:
    if not db.execute("SELECT 1 FROM ledger LIMIT 1").fetchone():
        append(db, "—", "GENESIS", {"text": "Запуск реестра Жол-ID"})


def verify(db) -> int:
    """Индекс первого испорченного блока или -1."""
    prev = None
    for b in db.execute("SELECT * FROM ledger ORDER BY idx"):
        if block_hash(b["idx"], b["ts"], b["shipment"], b["type"], b["data"], b["prev_hash"]) != b["hash"]:
            return b["idx"]
        if prev is not None and b["prev_hash"] != prev:
            return b["idx"]
        prev = b["hash"]
    return -1


def as_dict(row) -> dict:
    return {"idx": row["idx"], "ts": row["ts"], "shipment": row["shipment"], "type": row["type"],
            "data": row["data"], "prev_hash": row["prev_hash"], "hash": row["hash"]}
