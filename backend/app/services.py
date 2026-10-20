import hashlib
import json
import secrets
import time
import uuid
from pathlib import Path

from fastapi import HTTPException

from . import calc, ledger, sim
from .data import (ALLOWED_EXT, CARGO_TYPES, DANGER_CLASSES, DECLARANT_ROLES, DOC_TYPES, MAX_UPLOAD,
                   NODES, PARTY_ROLES, ROLES, ROUTES, STARTER_ROLES, TRANSPORT_MODES, agencies_for, required_docs)
from .db import UPLOAD_DIR

NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # без 0/O и 1/I, чтобы номер легко диктовать


# ---------------------------------------------------------------- Выборки и права

def get_shipment(db, number: str):
    s = db.execute("SELECT * FROM shipments WHERE number = ?", (number.strip().upper(),)).fetchone()
    if not s:
        raise HTTPException(404, "Перевозка с таким номером не найдена")
    return s


def participants(db, shipment_id: int) -> dict:
    rows = db.execute(
        "SELECT p.role, u.id, u.name, u.company FROM participants p JOIN users u ON u.id = p.user_id "
        "WHERE p.shipment_id = ?", (shipment_id,)).fetchall()
    return {r["role"]: r for r in rows}


def access(db, s, user) -> tuple[str, str | None]:
    """Уровень доступа: participant / customs / viewer (вошёл, но не участник) / public."""
    if user is None:
        return "public", None
    if user["role"] == "customs":
        return "customs", None
    for role, p in participants(db, s["id"]).items():
        if p["id"] == user["id"]:
            return "participant", role
    return "viewer", None


def require_full_access(db, s, user) -> str | None:
    level, my_role = access(db, s, user)
    if level not in ("participant", "customs"):
        raise HTTPException(403, "Документы доступны только участникам перевозки и таможне")
    return my_role


def declaration_of(db, shipment_id: int):
    return db.execute("SELECT * FROM declarations WHERE shipment_id = ?", (shipment_id,)).fetchone()


def declaration_dict(db, d, with_payload: bool = False) -> dict:
    user = lambda uid: db.execute("SELECT name, company FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    sub, dec = user(d["submitted_by"]), user(d["decided_by"])
    s = db.execute("SELECT number FROM shipments WHERE id = ?", (d["shipment_id"],)).fetchone()
    out = {
        "id": d["id"], "number": d["number"], "shipment": s["number"], "status": d["status"],
        "hash": d["hash"], "submitted_at": d["submitted_at"], "decided_at": d["decided_at"],
        "comment": d["comment"],
        "submitted_by": f"{sub['name']}, {sub['company']}" if sub else None,
        "decided_by": f"{dec['name']}, {dec['company']}" if dec else None,
    }
    if with_payload:
        out["payload"] = json.loads(d["payload"])
    return out


def serialize(db, s, user) -> dict:
    level, my_role = access(db, s, user)
    form = json.loads(s["form"])
    parts = participants(db, s["id"])
    mode = TRANSPORT_MODES[form["mode"]]
    full = level in ("participant", "customs")
    decl = declaration_of(db, s["id"])

    out = {
        "number": s["number"],
        "created_at": s["created_at"],
        "route_id": s["route_id"],
        "started": bool(s["started"]),
        "delivered": bool(s["delivered"]),
        "t": s["t"],
        "cursor": s["cursor"],
        "status": sim.state_of(db, s),
        "cargo": {
            "description": form["description"],
            "cargo_type": CARGO_TYPES[form["cargo_type"]]["name"],
            "danger_class": form.get("danger_class"),
            "mode": mode["name"],
            "equipment": f"{form['units']} × {mode['equipment'][form['equipment']]['name']}",
        },
        "access": level,
        "my_role": my_role,
        "participants": [
            {"role": r, "role_name": ROLES[r]["name"], "filled": r in parts,
             **({"name": parts[r]["name"], "company": parts[r]["company"]} if r in parts and level != "public" else {})}
            for r in PARTY_ROLES
        ],
        "declaration_status": decl["status"] if decl else None,
        "events": [{"ts": b["ts"], "type": b["type"], "text": json.loads(b["data"]).get("text"), "hash": b["hash"]}
                   for b in db.execute("SELECT * FROM ledger WHERE shipment = ? ORDER BY idx DESC", (s["number"],))],
        "can_join": [],
    }
    if level == "viewer" and user["role"] in PARTY_ROLES and user["role"] not in parts:
        out["can_join"] = [user["role"]]
    if not full:
        return out

    docs = db.execute(
        "SELECT d.*, u.name AS uploader, u.company AS uploader_company FROM documents d "
        "JOIN users u ON u.id = d.uploaded_by WHERE d.shipment_id = ? ORDER BY d.uploaded_at", (s["id"],)).fetchall()
    present = {d["doc_type"] for d in docs}
    required = required_docs(form["cargo_type"])
    locked = bool(decl and decl["status"] in ("submitted", "released"))
    out.update({
        "form": form,
        "seal": form.get("seal"),
        "agencies": agencies_for(form),
        "documents": [{
            "id": d["id"], "type": d["doc_type"], "type_name": DOC_TYPES[d["doc_type"]]["name"],
            "filename": d["filename"], "size": d["size"], "sha256": d["sha256"],
            "uploaded_at": d["uploaded_at"], "uploaded_role": ROLES[d["uploaded_role"]]["name"],
            "uploader": f"{d['uploader']}, {d['uploader_company']}",
            "can_delete": bool(user and d["uploaded_by"] == user["id"] and not locked),
        } for d in docs],
        "required_docs": [{"type": t, "name": DOC_TYPES[t]["name"], "present": t in present} for t in required],
        "declaration": declaration_dict(db, decl) if decl else None,
        "cost": cost_view(s, json.loads(s["cost"]) if s["cost"] else None, my_role, user),
        "can_upload": level == "participant",
        "can_start": level == "participant" and my_role in STARTER_ROLES and not s["started"],
        "can_declare": (level == "participant" and my_role in DECLARANT_ROLES
                        and all(t in present for t in required)
                        and (decl is None or decl["status"] == "rejected")),
        "can_decide": level == "customs" and bool(decl and decl["status"] == "submitted"),
    })
    return out


# ---------------------------------------------------------------- Действия

def _new_number(db, year: int) -> str:
    while True:
        number = f"ZH-{year}-" + "".join(secrets.choice(NUMBER_ALPHABET) for _ in range(6))
        if not db.execute("SELECT 1 FROM shipments WHERE number = ?", (number,)).fetchone():
            return number


def build_cost(form: dict, cost_in: dict | None) -> dict | None:
    """Стоимость перевозки. Параметры груза всегда берутся из формы, поэтому расчёт
    калькулятора не может разойтись с тем, что реально зарегистрировано."""
    if not cost_in:
        return None
    if cost_in.get("origin") and cost_in.get("destination"):
        options = dict(cost_in.get("options") or {})
        if cost_in.get("forwarding_usd") is not None:
            options.update(forwarding=True, forwarding_usd=cost_in["forwarding_usd"])
        try:
            q = calc.quote({**{k: form[k] for k in ("mode", "equipment", "cargo_type", "danger_class", "weight",
                                                     "volume", "units", "value")},
                            "origin": cost_in["origin"], "destination": cost_in["destination"], "options": options})
        except calc.QuoteError as e:
            raise HTTPException(422, str(e))
        lines = q["lines"]
        route = f"{calc.CITIES[cost_in['origin']]['name']} → {calc.CITIES[cost_in['destination']]['name']}"
    else:
        lines, route = [], None
        if cost_in.get("freight_usd"):
            lines.append({"label": "Фрахт", "usd": round(cost_in["freight_usd"], 2), "kind": "freight"})
        if cost_in.get("forwarding_usd"):
            lines.append({"label": "Экспедирование", "usd": round(cost_in["forwarding_usd"], 2), "kind": "forwarding"})
    if not lines:
        return None
    return {"lines": lines, "total": round(sum(x["usd"] for x in lines), 2), "route": route}


def cost_view(s, cost: dict | None, my_role: str | None, user) -> dict | None:
    """Экспедитор и автор расчёта видят разбивку. Остальные участники, если в цене есть
    вознаграждение экспедитора, видят одну сумму — общий фрахт."""
    if not cost:
        return None
    owner = my_role == "forwarder" or bool(user and user["id"] == s["created_by"])
    has_forwarding = any(x["kind"] == "forwarding" for x in cost["lines"])
    if owner or not has_forwarding:
        return {**cost, "view": "full", "hidden_note": has_forwarding}
    return {"lines": [{"label": "Общий фрахт (все услуги включены)", "usd": cost["total"], "kind": "freight"}],
            "total": cost["total"], "route": cost.get("route"), "view": "all_in", "hidden_note": False}


def create_shipment(db, user, form: dict) -> str:
    if user["role"] not in PARTY_ROLES:
        raise HTTPException(403, "Регистрировать перевозки могут участники перевозки, а не таможня")
    form = dict(form)
    cost_in = form.pop("cost", None)
    if cost_in and cost_in.get("forwarding_usd") and user["role"] != "forwarder":
        raise HTTPException(403, "Стоимость экспедирования указывает экспедитор")
    cost = build_cost(form, cost_in)
    now = time.time()
    number = _new_number(db, time.localtime(now).tm_year)
    form = {**form, "seal": "ЭНП-" + secrets.token_hex(4).upper()}
    cur = db.execute("INSERT INTO shipments (number, created_by, created_at, form, cost, route_id) "
                     "VALUES (?, ?, ?, ?, ?, ?)",
                     (number, user["id"], now, json.dumps(form, ensure_ascii=False),
                      json.dumps(cost, ensure_ascii=False) if cost else None, form["route_id"]))
    db.execute("INSERT INTO participants (shipment_id, role, user_id, joined_at) VALUES (?, ?, ?, ?)",
               (cur.lastrowid, user["role"], user["id"], now))
    # В реестр — отпечаток сведений, а не сами коммерческие данные.
    ledger.append(db, number, "REGISTERED", {
        "text": f"Перевозка зарегистрирована ({ROLES[user['role']]['name'].lower()} {user['company']}): "
                f"{form['description']}, {form['weight']:g} т",
        "weight": form["weight"],
        "fingerprint": hashlib.sha256(json.dumps(form, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16],
    })
    return number


def join_shipment(db, s, user, role: str | None) -> None:
    role = role or user["role"]
    if role != user["role"]:
        raise HTTPException(403, "Присоединиться можно только в роли, указанной при регистрации")
    if role not in PARTY_ROLES:
        raise HTTPException(403, "Таможня видит все перевозки без присоединения")
    parts = participants(db, s["id"])
    if any(p["id"] == user["id"] for p in parts.values()):
        raise HTTPException(409, "Вы уже участник этой перевозки")
    if role in parts:
        raise HTTPException(409, f"Роль «{ROLES[role]['name']}» в этой перевозке уже занята")
    db.execute("INSERT INTO participants (shipment_id, role, user_id, joined_at) VALUES (?, ?, ?, ?)",
               (s["id"], role, user["id"], time.time()))
    ledger.append(db, s["number"], "JOINED", {"text": f"{ROLES[role]['name']} присоединился: {user['company']}"})


def start_shipment(db, s, user) -> None:
    level, my_role = access(db, s, user)
    if level != "participant" or my_role not in STARTER_ROLES:
        raise HTTPException(403, "Отправить груз может грузоотправитель, экспедитор или перевозчик")
    if s["started"]:
        raise HTTPException(409, "Груз уже в пути")
    db.execute("UPDATE shipments SET started = 1, last_tick = ? WHERE id = ?", (time.time(), s["id"]))
    form = json.loads(s["form"])
    origin = NODES[ROUTES[s["route_id"]]["nodes"][0]]["name"]
    ledger.append(db, s["number"], "DEPARTED", {"text": f"Отправлен из узла {origin}, наложена пломба {form['seal']}"})


def save_document(db, s, user, doc_type: str, filename: str, stream) -> None:
    level, my_role = access(db, s, user)
    if level != "participant":
        raise HTTPException(403, "Загружать документы могут только участники перевозки")
    if doc_type not in DOC_TYPES:
        raise HTTPException(422, "Неизвестный тип документа")
    safe_name = Path(filename or "document").name[:150]
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, f"Недопустимый формат файла. Разрешены: {', '.join(sorted(ALLOWED_EXT))}")

    stored = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / stored
    digest, size = hashlib.sha256(), 0
    try:
        with open(path, "wb") as out:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "Файл больше 10 МБ")
                digest.update(chunk)
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if size == 0:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "Файл пустой")

    db.execute("INSERT INTO documents (shipment_id, doc_type, filename, stored_name, size, sha256, uploaded_by, "
               "uploaded_role, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (s["id"], doc_type, safe_name, stored, size, digest.hexdigest(), user["id"], my_role, time.time()))
    ledger.append(db, s["number"], "DOC_UPLOADED", {
        "text": f"{ROLES[my_role]['name']} загрузил документ: {DOC_TYPES[doc_type]['name']}",
        "sha256": digest.hexdigest()[:16],
    })


def submit_declaration(db, s, user) -> None:
    level, my_role = access(db, s, user)
    if level != "participant" or my_role not in DECLARANT_ROLES:
        raise HTTPException(403, "Декларацию подаёт грузоотправитель или экспедитор")
    decl = declaration_of(db, s["id"])
    if decl and decl["status"] in ("submitted", "released"):
        raise HTTPException(409, "Декларация уже подана")
    form = json.loads(s["form"])
    docs = db.execute("SELECT * FROM documents WHERE shipment_id = ? ORDER BY uploaded_at", (s["id"],)).fetchall()
    missing = [DOC_TYPES[t]["name"] for t in required_docs(form["cargo_type"]) if t not in {d["doc_type"] for d in docs}]
    if missing:
        raise HTTPException(422, "Не хватает документов: " + ", ".join(missing))

    now = time.time()
    route = ROUTES[s["route_id"]]
    mode = TRANSPORT_MODES[form["mode"]]
    danger = DANGER_CLASSES.get(form.get("danger_class") or 0)
    payload = {
        "shipment": s["number"],
        "procedure": "Таможенный транзит" if NODES[route["nodes"][0]]["country"] != "КЗ" else "Экспорт",
        "declarant": {"name": user["name"], "company": user["company"], "bin": user["bin"],
                      "role": ROLES[my_role]["name"]},
        "shipper": form["shipper"],
        "consignee": form["consignee"],
        "goods": {
            "description": form["description"], "hs": form["hs"],
            "cargo_type": CARGO_TYPES[form["cargo_type"]]["name"],
            "danger": f"Класс {form['danger_class']} — {danger['name']}" if danger else None,
            "weight_t": form["weight"], "volume_m3": form.get("volume"), "value_usd": form["value"],
            "cert": form.get("cert"),
        },
        "transport": {"mode": mode["name"], "equipment": f"{form['units']} × {mode['equipment'][form['equipment']]['name']}",
                      "route": route["short"], "seal": form["seal"]},
        "documents": [{"type": DOC_TYPES[d["doc_type"]]["name"], "filename": d["filename"], "sha256": d["sha256"]}
                      for d in docs],
        "recipients": agencies_for(form),
        "submitted_at": now,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    if decl:
        db.execute("UPDATE declarations SET status = 'submitted', payload = ?, hash = ?, submitted_by = ?, "
                   "submitted_at = ?, decided_by = NULL, decided_at = NULL, comment = NULL WHERE id = ?",
                   (raw, digest, user["id"], now, decl["id"]))
        number = decl["number"]
    else:
        cur = db.execute("INSERT INTO declarations (number, shipment_id, status, payload, hash, submitted_by, "
                         "submitted_at) VALUES ('', ?, 'submitted', ?, ?, ?, ?)",
                         (s["id"], raw, digest, user["id"], now))
        number = f"ЭД-{time.localtime(now).tm_year}-{cur.lastrowid:06d}"
        db.execute("UPDATE declarations SET number = ? WHERE id = ?", (number, cur.lastrowid))
    ledger.append(db, s["number"], "DECL_SUBMITTED", {
        "text": f"Подана электронная декларация {number} ({len(docs)} док.)", "hash": digest[:16]})


def decide_declaration(db, decl_id: int, user, decision: str, comment: str | None) -> None:
    if user["role"] != "customs":
        raise HTTPException(403, "Решение по декларации принимает таможня")
    d = db.execute("SELECT * FROM declarations WHERE id = ?", (decl_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Декларация не найдена")
    if d["status"] != "submitted":
        raise HTTPException(409, "Решение по этой декларации уже принято")
    s = db.execute("SELECT * FROM shipments WHERE id = ?", (d["shipment_id"],)).fetchone()
    status = "released" if decision == "release" else "rejected"
    db.execute("UPDATE declarations SET status = ?, decided_by = ?, decided_at = ?, comment = ? WHERE id = ?",
               (status, user["id"], time.time(), (comment or "").strip() or None, decl_id))
    if status == "released":
        ledger.append(db, s["number"], "DECL_RELEASED", {"text": f"Таможня выпустила декларацию {d['number']}"})
        ledger.append(db, s["number"], "DISTRIBUTED", {
            "text": "Сведения направлены одновременно: " + ", ".join(json.loads(d["payload"])["recipients"])})
    else:
        ledger.append(db, s["number"], "DECL_REJECTED", {"text": f"Декларация {d['number']} отклонена: {comment}"})
