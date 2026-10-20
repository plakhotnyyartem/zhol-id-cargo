"""Ориентировочный расчёт стоимости перевозки. Тарифы модельные (см. data.py)."""
import math

from .data import CARGO_TYPES, CITIES, DANGER_CLASSES, KZT_PER_USD, TRANSPORT_MODES

BORDER_FEE = 90          # USD за единицу оборудования на каждую смену страны
CUSTOMS_TRAD = 250       # услуги брокера и бумажное оформление
CUSTOMS_ZHOL = 60        # электронная декларация через Жол-ID
LOADING_PER_UNIT = 60
LOADING_PER_TON = 4
INSURANCE_RATE = 0.003
FORWARDING_RATE = 0.07
ESCORT_PER_KM = 0.25
BORDER_DAYS = {"trad": 2.5, "zhol": 0.5}


class QuoteError(ValueError):
    pass


def distance_km(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat = lat2 - lat1
    dlon = math.radians(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def quote(q: dict) -> dict:
    mode = TRANSPORT_MODES.get(q["mode"])
    if not mode:
        raise QuoteError("Неизвестный вид транспорта")
    eq = mode["equipment"].get(q["equipment"])
    if not eq:
        raise QuoteError("Это оборудование недоступно для выбранного вида транспорта")
    cargo = CARGO_TYPES.get(q["cargo_type"])
    if not cargo:
        raise QuoteError("Неизвестный тип груза")
    origin, dest = CITIES.get(q["origin"]), CITIES.get(q["destination"])
    if not origin or not dest:
        raise QuoteError("Выберите пункты отправления и назначения")
    if q["origin"] == q["destination"]:
        raise QuoteError("Пункты отправления и назначения совпадают")
    if q["mode"] == "sea" and not (origin.get("port") and dest.get("port")):
        raise QuoteError("Морем можно везти только между каспийскими портами")
    if q["mode"] == "air" and not (origin.get("air") and dest.get("air")):
        raise QuoteError("В одном из городов нет грузового аэропорта")

    danger = None
    coef = cargo["coef"]
    if q["cargo_type"] == "dangerous":
        danger = DANGER_CLASSES.get(q.get("danger_class") or 0)
        if not danger:
            raise QuoteError("Укажите класс опасности груза")
        if q["mode"] == "air" and danger.get("no_air"):
            raise QuoteError(f"Класс {q['danger_class']} ({danger['name']}) запрещён к перевозке авиатранспортом")
        coef = danger["coef"]
    if cargo.get("needs_ref") and not eq.get("ref"):
        raise QuoteError(f"Для груза «{cargo['name']}» нужно рефрижераторное оборудование")

    weight_t, volume = q["weight"], q.get("volume") or 0
    units = q.get("units") or 1
    if err := capacity_error(eq, units, weight_t, volume):
        raise QuoteError(err)
    km = round(distance_km(origin, dest) * mode["winding"])
    international = origin["country"] != dest["country"]
    lines, warnings = [], []

    # ---- базовый фрахт
    if eq.get("per_kg"):
        chargeable = max(weight_t * 1000, volume * 167)  # объёмный вес IATA: 1 м³ = 167 кг
        freight = chargeable * eq["rate"] * (0.5 + km / 4000) + eq["fixed"]
        units, unit_label = 1, f"{round(chargeable):,} кг к оплате".replace(",", " ")
        if volume * 167 > weight_t * 1000:
            warnings.append("Груз лёгкий и объёмный: оплата считается по объёмному весу")
    elif eq.get("per_ton"):
        freight = weight_t * (eq["rate"] * km + eq["fixed"])
        units, unit_label = 1, f"{weight_t:g} т навалом"
    else:
        freight = units * (eq["rate"] * km + eq["fixed"])
        load = weight_t / (units * eq["cap_t"])
        unit_label = f"{units} × {eq['name']} (загрузка по массе {round(load * 100)}%)"
        needed = min_units(eq, weight_t, volume)
        if needed < units:
            warnings.append(f"Груз поместится в {needed} ед. — лишние {units - needed} ед. увеличивают стоимость")
        elif load < 0.5:
            warnings.append("Оборудование загружено меньше чем наполовину — выгоднее выбрать меньший тип или сборный груз")
    km_text = f"{km:,}".replace(",", " ")
    lines.append({"label": f"Фрахт: {mode['name'].lower()}, {km_text} км", "usd": freight, "kind": "freight"})

    if coef != 1:
        what = f"класс {q['danger_class']} — {danger['name']}" if danger else cargo["name"]
        lines.append({"label": f"Надбавка за груз ({what}), ×{coef}", "usd": freight * (coef - 1), "kind": "surcharge"})

    if international:
        lines.append({"label": f"Пограничные сборы ({origin['country']} → {dest['country']})",
                      "usd": BORDER_FEE * units, "kind": "border"})

    # Стоимость услуг вводит пользователь. Если поле пустое, берём ориентир по типовому тарифу.
    opts = q.get("options") or {}
    suggested = {
        "loading": LOADING_PER_TON * weight_t if eq.get("per_ton") or eq.get("per_kg") else LOADING_PER_UNIT * units,
        "escort": ESCORT_PER_KM * km,
        "forwarding": freight * FORWARDING_RATE,
    }
    escort_required = bool(danger and danger.get("escort"))
    if escort_required and not opts.get("escort"):
        warnings.append("Для этого класса опасности сопровождение обязательно — добавлено автоматически")
    service = lambda key: opts.get(f"{key}_usd") if opts.get(f"{key}_usd") is not None else suggested[key]
    if opts.get("loading"):
        lines.append({"label": "Погрузка и выгрузка", "usd": service("loading"), "kind": "service"})
    if opts.get("escort") or escort_required:
        lines.append({"label": "Охрана и сопровождение", "usd": service("escort"), "kind": "service"})
    if opts.get("insurance"):
        pct = opts.get("insurance_pct", INSURANCE_RATE * 100)
        lines.append({"label": f"Страхование груза ({pct:g}% стоимости)",
                      "usd": q.get("value", 0) * pct / 100, "kind": "insurance"})
    if opts.get("forwarding"):
        lines.append({"label": "Экспедирование", "usd": service("forwarding"), "kind": "forwarding"})
    saving = 0
    if international:
        lines.append({"label": "Таможенное оформление: электронная декларация Жол-ID", "usd": CUSTOMS_ZHOL,
                      "kind": "customs"})
        saving = CUSTOMS_TRAD - CUSTOMS_ZHOL

    total = sum(line["usd"] for line in lines)
    move_days = km / mode["speed"] + (1 if q["mode"] in ("sea", "air", "multimodal") else 0)
    border = BORDER_DAYS if international else {"trad": 0, "zhol": 0}

    for line in lines:
        line["usd"] = round(line["usd"], 2)
    return {
        "distance_km": km,
        "units": units,
        "unit_label": unit_label,
        "lines": lines,
        "total_usd": round(total, 2),
        "total_kzt": round(total * KZT_PER_USD),
        "kzt_rate": KZT_PER_USD,
        "saving_usd": saving,
        "suggested": {k: round(v, 2) for k, v in suggested.items()},
        "escort_required": escort_required,
        "days": {"trad": round(move_days + border["trad"] + 2, 1), "zhol": round(move_days + border["zhol"], 1)},
        "international": international,
        "warnings": warnings,
    }


def min_units(eq: dict, weight_t: float, volume: float) -> int:
    return max(1, math.ceil(weight_t / eq["cap_t"] - 1e-9), math.ceil(volume / eq["cap_m3"] - 1e-9) if volume else 1)


def capacity_error(eq: dict, units: int, weight_t: float, volume: float | None) -> str | None:
    """Груз не должен превышать грузоподъёмность и объём выбранного количества единиц."""
    if eq.get("per_kg") or eq.get("per_ton"):
        return None
    max_t, max_m3 = eq["cap_t"] * units, eq["cap_m3"] * units
    what = f"{units} × {eq['name']}"
    need = min_units(eq, weight_t, volume or 0)
    if weight_t > max_t + 1e-9:
        return f"Масса {weight_t:g} т больше допустимой для {what}: максимум {max_t:g} т. Нужно не меньше {need} ед."
    if volume and volume > max_m3 + 1e-9:
        return f"Объём {volume:g} м³ больше допустимого для {what}: максимум {max_m3:g} м³. Нужно не меньше {need} ед."
    return None
