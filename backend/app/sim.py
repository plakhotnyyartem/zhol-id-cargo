"""Модель движения груза по коридору.

Перевозка — это фазы «движение по плечу» и «стоянка на узле». Модельное время t
сдвигается при каждом обращении к API пропорционально прошедшему реальному времени.
На узлах с таможней (customs=True) груз стоит, пока декларация не выпущена."""
import os
import time
from functools import cache

from . import ledger
from .data import NODES, PAPERWORK, ROUTES

SIM_HOURS_PER_SEC = float(os.environ.get("ZHOL_SIM_SPEED", "0.5"))


@cache
def plan(route_id: str) -> dict:
    route = ROUTES[route_id]
    phases, t = [], 0.0
    for i, node_id in enumerate(route["nodes"]):
        if i > 0:
            mode, hours = route["legs"][i - 1]
            phases.append({"kind": "move", "from": route["nodes"][i - 1], "to": node_id,
                           "mode": mode, "start": t, "end": t + hours})
            t += hours
        node = NODES[node_id]
        if 0 < i < len(route["nodes"]) - 1 and "dwell" in node:
            phases.append({"kind": "dwell", "node": node_id, "start": t, "end": t + node["dwell"]["zhol"]})
            t += node["dwell"]["zhol"]
    return {"phases": phases, "total": t}


def compare(route_id: str) -> dict:
    route = ROUTES[route_id]
    move = sum(h for _, h in route["legs"])
    dwells = [NODES[n]["dwell"] for n in route["nodes"][1:-1] if "dwell" in NODES[n]]
    trad = sum(d["trad"] for d in dwells)
    zhol = sum(d["zhol"] for d in dwells)
    return {
        "move": move,
        "trad": {"paper": PAPERWORK["trad"], "dwell": trad, "total": move + trad + PAPERWORK["trad"]},
        "zhol": {"paper": PAPERWORK["zhol"], "dwell": zhol, "total": move + zhol + PAPERWORK["zhol"]},
    }


def _blocked(ph: dict, released: bool) -> bool:
    return ph["kind"] == "dwell" and NODES[ph["node"]].get("customs") and not released


def _log_phase(db, number: str, ph: dict, route_id: str, decl_number: str | None) -> None:
    if ph["kind"] == "move":
        node = NODES[ph["to"]]
        if ph["to"] == ROUTES[route_id]["nodes"][-1]:
            ledger.append(db, number, "DELIVERED", {"text": f"Доставлен: {node['name']}. Пломба цела"})
        else:
            ledger.append(db, number, "ARRIVED", {"text": f"Прибыл: {node['name']}, пломба цела"})
        return
    node = NODES[ph["node"]]
    saved = f"{node['dwell']['zhol']} ч вместо {node['dwell']['trad']} ч"
    if node.get("customs"):
        text = f"Таможенный контроль пройден: {node['name']} по ЭД {decl_number} ({saved})"
        ledger.append(db, number, "BORDER_CLEARED", {"text": text})
    elif node["type"] == "port":
        ledger.append(db, number, "DEPARTED", {"text": f"Отгружен из порта {node['name']} ({saved})"})
    elif node["type"] == "border":
        ledger.append(db, number, "BORDER_CLEARED", {"text": f"Граница пройдена: {node['name']} ({saved})"})
    else:
        ledger.append(db, number, "DEPARTED", {"text": f"Убыл из узла {node['name']} ({saved})"})


def advance(db, s, hours: float | None = None) -> None:
    """Сдвигает перевозку на hours модельных часов (по умолчанию — по реальным часам)."""
    if not s["started"] or s["delivered"]:
        return
    now = time.time()
    budget = hours if hours is not None else (now - s["last_tick"]) * SIM_HOURS_PER_SEC
    decl = db.execute("SELECT number, status FROM declarations WHERE shipment_id = ?", (s["id"],)).fetchone()
    released = bool(decl and decl["status"] == "released")
    phases = plan(s["route_id"])["phases"]
    t, cursor, hold = s["t"], s["cursor"], s["hold_cursor"]

    while cursor < len(phases) and budget > 0:
        ph = phases[cursor]
        if _blocked(ph, released):
            # Время ожидания на таможне сгорает: груз стоит, пока ЭД не выпущена.
            if hold != cursor:
                ledger.append(db, s["number"], "HELD", {
                    "text": f"Ожидает выпуска электронной декларации: {NODES[ph['node']]['name']}"})
                hold = cursor
            break
        need = ph["end"] - t
        if budget >= need:
            t, budget = ph["end"], budget - need
            _log_phase(db, s["number"], ph, s["route_id"], decl["number"] if decl else None)
            cursor += 1
        else:
            t, budget = t + budget, 0

    delivered = int(cursor >= len(phases))
    db.execute("UPDATE shipments SET t = ?, cursor = ?, hold_cursor = ?, delivered = ?, last_tick = ? WHERE id = ?",
               (t, cursor, hold, delivered, now, s["id"]))


def advance_all(db) -> None:
    for s in db.execute("SELECT * FROM shipments WHERE started = 1 AND delivered = 0").fetchall():
        advance(db, s)


def state_of(db, s) -> dict:
    """Статус для отображения."""
    phases = plan(s["route_id"])["phases"]
    total = plan(s["route_id"])["total"]
    if not s["started"]:
        return {"code": "registered", "label": "Оформление документов", "progress": 0}
    if s["delivered"]:
        return {"code": "delivered", "label": "Доставлен", "progress": 1}
    ph = phases[s["cursor"]]
    if s["hold_cursor"] == s["cursor"]:
        decl = db.execute("SELECT status FROM declarations WHERE shipment_id = ?", (s["id"],)).fetchone()
        if not decl or decl["status"] != "released":
            return {"code": "held", "label": f"Ожидает ЭД: {NODES[ph['node']]['name']}", "progress": s["t"] / total}
    if ph["kind"] == "dwell":
        return {"code": "dwell", "label": f"На узле: {NODES[ph['node']]['name']}", "progress": s["t"] / total}
    verb = "Паром" if ph["mode"] == "ferry" else "В пути"
    return {"code": "move", "label": f"{verb} → {NODES[ph['to']]['name']}", "progress": s["t"] / total}
