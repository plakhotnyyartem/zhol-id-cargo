"""Демо-данные: по одному аккаунту на роль и три перевозки на разных стадиях."""
import io
import secrets
import time

from . import ledger, services, sim
from .data import DOC_TYPES
from .security import hash_password

DEMO_USERS = [
    ("shipper", "Айгерим Сапарова", "ТОО «Шёлковый путь Трейд» (демо)", "260140012345"),
    ("consignee", "Георгий Бериашвили", "Black Sea Distribution LLC (демо)", None),
    ("forwarder", "Данияр Ахметов", "ТОО «Евразия Экспедиция» (демо)", "250840067890"),
    ("carrier", "Ерлан Жумабеков", "ТОО «Степь Рейл» (демо)", "240540054321"),
    ("customs", "Марат Есенов", "Таможенный пост «Хоргос» (демо)", None),
]

DEMO_SHIPMENTS = [
    {   # В пути, декларация выпущена. Оформил экспедитор: получатель видит только общий фрахт.
        "by": "forwarder", "join": ["shipper", "consignee", "carrier"],
        "docs": ["invoice", "packing_list", "contract", "waybill", "origin_cert"],
        "declare": "forwarder", "release": True, "start": "carrier", "hours": 95,
        "form": {"shipper": "ТОО «Шёлковый путь Трейд» (демо)", "consignee": "Black Sea Distribution LLC (демо)",
                 "description": "Бытовая электроника", "hs": "8528720000", "cargo_type": "general",
                 "danger_class": None, "mode": "multimodal", "equipment": "container_40", "weight": 410,
                 "volume": 1300, "units": 20, "value": 1850000, "route_id": "tmtm-khorgos", "cert": None,
                 "cost": {"origin": "urumqi", "destination": "poti", "forwarding_usd": 4500,
                          "options": {"insurance": True, "insurance_pct": 0.25, "loading": True, "loading_usd": 1800}}},
    },
    {   # Декларация подана и ждёт таможню: груз скоро встанет в порту Актау.
        "by": "shipper", "join": ["carrier"],
        "docs": ["invoice", "packing_list", "contract", "waybill", "phyto_cert"],
        "declare": "shipper", "release": False, "start": "carrier", "hours": 30,
        "form": {"shipper": "ТОО «Шёлковый путь Трейд» (демо)", "consignee": "Caspian Food Import (демо)",
                 "description": "Пшеница мягкая 3 класса", "hs": "1001990000", "cargo_type": "agro",
                 "danger_class": None, "mode": "rail", "equipment": "covered", "weight": 1300,
                 "volume": None, "units": 20, "value": 310000, "route_id": "aktau-export", "cert": "ФС-2026-04417",
                 "cost": {"origin": "almaty", "destination": "aktau", "options": {"insurance": True, "insurance_pct": 0.3}}},
    },
    {   # Только зарегистрирована: не хватает накладной и паспорта опасного груза.
        "by": "forwarder", "join": ["shipper"],
        "docs": ["invoice", "packing_list", "contract"],
        "declare": None, "release": False, "start": None, "hours": 0,
        "form": {"shipper": "ТОО «Шёлковый путь Трейд» (демо)", "consignee": "Poti Agro Terminal (демо)",
                 "description": "Аммиачная селитра (удобрение)", "hs": "3102300000", "cargo_type": "dangerous",
                 "danger_class": 5, "mode": "rail", "equipment": "covered", "weight": 520,
                 "volume": None, "units": 8, "value": 240000, "route_id": "tmtm-dostyk", "cert": "5.1",
                 "cost": {"freight_usd": 38000, "forwarding_usd": 2600}},
    },
]


def seed_if_empty(db) -> None:
    ledger.ensure_genesis(db)
    if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        return
    users = {}
    for role, name, company, bin_ in DEMO_USERS:
        # Пароль случайный и нигде не хранится: в демо-аккаунты входят только кнопкой «Демо-вход».
        cur = db.execute("INSERT INTO users (email, name, company, bin, role, pw_hash, is_demo, created_at) "
                         "VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                         (f"{role}@demo.zhol.kz", name, company, bin_, role,
                          hash_password(secrets.token_urlsafe(16)), time.time()))
        users[role] = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()

    for demo in DEMO_SHIPMENTS:
        number = services.create_shipment(db, users[demo["by"]], demo["form"])
        s = services.get_shipment(db, number)
        for role in demo["join"]:
            services.join_shipment(db, s, users[role], role)
        for doc_type in demo["docs"]:
            uploader = "carrier" if doc_type == "waybill" and "carrier" in demo["join"] else demo["by"]
            text = (f"Демонстрационный документ\n{DOC_TYPES[doc_type]['name']}\nПеревозка {number}\n"
                    f"Груз: {demo['form']['description']}\n").encode()
            services.save_document(db, s, users[uploader], doc_type, f"{doc_type}_{number}.txt", io.BytesIO(text))
        if demo["declare"]:
            services.submit_declaration(db, s, users[demo["declare"]])
        if demo["release"]:
            decl = services.declaration_of(db, s["id"])
            services.decide_declaration(db, decl["id"], users["customs"], "release", None)
        if demo["start"]:
            services.start_shipment(db, s, users[demo["start"]])
            sim.advance(db, services.get_shipment(db, number), hours=demo["hours"])
