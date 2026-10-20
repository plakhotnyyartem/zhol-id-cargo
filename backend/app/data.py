"""Справочники платформы. Время и тарифы — модельные оценки для прототипа,
а не официальная статистика или прайс перевозчиков."""

# ---------------------------------------------------------------- Роли

ROLES = {
    "shipper": {"name": "Грузоотправитель", "desc": "Регистрирует перевозку, загружает инвойс, контракт, упаковочный лист"},
    "consignee": {"name": "Грузополучатель", "desc": "Отслеживает груз, загружает контракт и документы получателя"},
    "forwarder": {"name": "Экспедитор", "desc": "Организует перевозку и подаёт электронную декларацию за клиента"},
    "carrier": {"name": "Перевозчик", "desc": "Загружает транспортную накладную и отправляет груз в путь"},
    "customs": {"name": "Таможня", "desc": "Проверяет документы и выпускает электронные декларации"},
}
PARTY_ROLES = ["shipper", "consignee", "forwarder", "carrier"]
DECLARANT_ROLES = ["shipper", "forwarder"]
STARTER_ROLES = ["shipper", "forwarder", "carrier"]

# ---------------------------------------------------------------- Коридор

NODES = {
    "urumqi":    {"name": "Урумчи", "country": "КНР", "type": "origin", "lon": 87.6, "lat": 43.8, "label": [-24, 22]},
    "khorgos":   {"name": "Хоргос", "country": "КЗ", "type": "border", "lon": 80.4, "lat": 44.2, "label": [8, -10],
                  "dwell": {"trad": 36, "zhol": 6}, "customs": True},
    "dostyk":    {"name": "Достык", "country": "КЗ", "type": "border", "lon": 82.5, "lat": 45.2, "label": [8, -10],
                  "dwell": {"trad": 40, "zhol": 6}, "customs": True},
    "aktogay":   {"name": "Актогай", "country": "КЗ", "type": "hub", "lon": 79.6, "lat": 46.9, "label": [8, -10],
                  "dwell": {"trad": 6, "zhol": 3}},
    "almaty":    {"name": "Алматы", "country": "КЗ", "type": "hub", "lon": 76.9, "lat": 43.25, "label": [6, 22],
                  "dwell": {"trad": 10, "zhol": 4}},
    "shu":       {"name": "Шу", "country": "КЗ", "type": "transit", "lon": 73.6, "lat": 43.6, "label": [-6, 22]},
    "kyzylorda": {"name": "Кызылорда", "country": "КЗ", "type": "transit", "lon": 65.5, "lat": 44.85, "label": [-30, -12]},
    "beyneu":    {"name": "Бейнеу", "country": "КЗ", "type": "transit", "lon": 55.2, "lat": 45.3, "label": [8, -10]},
    "aktau":     {"name": "Актау", "country": "КЗ", "type": "port", "lon": 51.2, "lat": 43.65, "label": [10, 4],
                  "dwell": {"trad": 72, "zhol": 18}, "customs": True},
    "baku":      {"name": "Баку (Алят)", "country": "АЗ", "type": "port", "lon": 49.9, "lat": 40.4, "label": [10, 16],
                  "dwell": {"trad": 30, "zhol": 10}},
    "tbilisi":   {"name": "Тбилиси", "country": "ГР", "type": "border", "lon": 44.8, "lat": 41.7, "label": [-20, -12],
                  "dwell": {"trad": 14, "zhol": 5}},
    "poti":      {"name": "Поти", "country": "ГР", "type": "dest", "lon": 41.67, "lat": 42.15, "label": [-44, 4]},
}

ROUTES = {
    "tmtm-khorgos": {
        "name": "Средний коридор через Хоргос",
        "short": "Урумчи → Хоргос → Актау → Баку → Поти",
        "nodes": ["urumqi", "khorgos", "almaty", "shu", "kyzylorda", "beyneu", "aktau", "baku", "tbilisi", "poti"],
        "legs": [("rail", 14), ("rail", 10), ("rail", 6), ("rail", 22), ("rail", 26), ("rail", 10),
                 ("ferry", 20), ("rail", 16), ("rail", 8)],
    },
    "tmtm-dostyk": {
        "name": "Средний коридор через Достык",
        "short": "Урумчи → Достык → Алматы → Актау → Баку → Поти",
        "nodes": ["urumqi", "dostyk", "aktogay", "almaty", "shu", "kyzylorda", "beyneu", "aktau", "baku", "tbilisi", "poti"],
        "legs": [("rail", 12), ("rail", 8), ("rail", 14), ("rail", 6), ("rail", 22), ("rail", 26),
                 ("rail", 10), ("ferry", 20), ("rail", 16), ("rail", 8)],
    },
    "aktau-export": {
        "name": "Экспорт через порт Актау",
        "short": "Алматы → Актау → Баку",
        "nodes": ["almaty", "shu", "kyzylorda", "beyneu", "aktau", "baku"],
        "legs": [("rail", 6), ("rail", 22), ("rail", 26), ("rail", 10), ("ferry", 20)],
    },
}

PAPERWORK = {"trad": 48, "zhol": 2}

# ---------------------------------------------------------------- Груз

CARGO_TYPES = {
    "general":    {"name": "Генеральный груз", "coef": 1.0},
    "agro":       {"name": "Сельхозпродукция", "coef": 1.0},
    "perishable": {"name": "Скоропортящийся груз", "coef": 1.15, "needs_ref": True},
    "animal":     {"name": "Продукция животного происхождения", "coef": 1.1, "needs_ref": True},
    "dangerous":  {"name": "Опасный груз", "coef": 1.0},
}

DANGER_CLASSES = {
    1: {"name": "Взрывчатые вещества", "coef": 2.0, "no_air": True, "escort": True},
    2: {"name": "Газы", "coef": 1.6},
    3: {"name": "Легковоспламеняющиеся жидкости", "coef": 1.5},
    4: {"name": "Легковоспламеняющиеся твёрдые вещества", "coef": 1.45},
    5: {"name": "Окисляющие вещества и органические пероксиды", "coef": 1.4},
    6: {"name": "Токсичные и инфекционные вещества", "coef": 1.6},
    7: {"name": "Радиоактивные материалы", "coef": 2.5, "no_air": True, "escort": True},
    8: {"name": "Коррозионные вещества", "coef": 1.4},
    9: {"name": "Прочие опасные вещества", "coef": 1.2},
}

# ---------------------------------------------------------------- Транспорт и тарифы
# rate — USD за км на единицу оборудования, fixed — USD за единицу (терминал, погрузка в состав).
# Для авиа и навалочного груза тариф считается от массы, см. calc.py.

TRANSPORT_MODES = {
    "rail": {
        "name": "Железная дорога", "speed": 650, "winding": 1.25, "waybill": "СМГС",
        "equipment": {
            "container_20": {"name": "Контейнер 20′", "cap_t": 24, "cap_m3": 33, "rate": 0.55, "fixed": 120},
            "container_40": {"name": "Контейнер 40′", "cap_t": 26.5, "cap_m3": 67, "rate": 0.85, "fixed": 160},
            "ref_40":       {"name": "Рефконтейнер 40′", "cap_t": 26, "cap_m3": 59, "rate": 1.15, "fixed": 220, "ref": True},
            "covered":      {"name": "Крытый вагон", "cap_t": 68, "cap_m3": 120, "rate": 1.30, "fixed": 200},
            "gondola":      {"name": "Полувагон", "cap_t": 69, "cap_m3": 76, "rate": 1.10, "fixed": 180},
            "tank":         {"name": "Вагон-цистерна", "cap_t": 60, "cap_m3": 73, "rate": 1.35, "fixed": 220},
        },
    },
    "road": {
        "name": "Автомобильный", "speed": 550, "winding": 1.2, "waybill": "CMR",
        "equipment": {
            "tent":         {"name": "Тентованный полуприцеп", "cap_t": 20, "cap_m3": 82, "rate": 1.05, "fixed": 80},
            "ref_truck":    {"name": "Рефрижератор", "cap_t": 20, "cap_m3": 76, "rate": 1.30, "fixed": 100, "ref": True},
            "tank_truck":   {"name": "Автоцистерна", "cap_t": 22, "cap_m3": 30, "rate": 1.25, "fixed": 100},
            "container_40": {"name": "Контейнеровоз 40′", "cap_t": 26, "cap_m3": 67, "rate": 1.15, "fixed": 90},
        },
    },
    "sea": {
        "name": "Море / паром (Каспий)", "speed": 550, "winding": 1.15, "waybill": "Коносамент",
        "equipment": {
            "container_20": {"name": "Контейнер 20′", "cap_t": 24, "cap_m3": 33, "rate": 0.9, "fixed": 450},
            "container_40": {"name": "Контейнер 40′", "cap_t": 26.5, "cap_m3": 67, "rate": 1.4, "fixed": 700},
            "ref_40":       {"name": "Рефконтейнер 40′", "cap_t": 26, "cap_m3": 59, "rate": 1.8, "fixed": 900, "ref": True},
            "rail_ferry":   {"name": "Ж/д вагон на пароме", "cap_t": 68, "cap_m3": 120, "rate": 1.8, "fixed": 900},
            "bulk":         {"name": "Навалом (сухогруз)", "per_ton": True, "rate": 0.03, "fixed": 6},
        },
    },
    "air": {
        "name": "Авиа", "speed": 5000, "winding": 1.05, "waybill": "AWB",
        "equipment": {
            "general": {"name": "Генеральный груз на паллетах", "per_kg": True, "rate": 2.6, "fixed": 120},
            "express": {"name": "Экспресс-доставка", "per_kg": True, "rate": 4.2, "fixed": 150},
            "ref_air": {"name": "Термоконтейнер (cool chain)", "per_kg": True, "rate": 3.4, "fixed": 180, "ref": True},
        },
    },
    "multimodal": {
        "name": "Мультимодальный (ж/д + паром)", "speed": 450, "winding": 1.3, "waybill": "СМГС + коносамент",
        "equipment": {
            "container_20": {"name": "Контейнер 20′", "cap_t": 24, "cap_m3": 33, "rate": 0.7, "fixed": 400},
            "container_40": {"name": "Контейнер 40′", "cap_t": 26.5, "cap_m3": 67, "rate": 1.05, "fixed": 600},
            "ref_40":       {"name": "Рефконтейнер 40′", "cap_t": 26, "cap_m3": 59, "rate": 1.4, "fixed": 800, "ref": True},
        },
    },
}

# Города для калькулятора. port — каспийский порт, air — есть грузовой аэропорт.
CITIES = {
    "almaty":     {"name": "Алматы", "country": "KZ", "lon": 76.9, "lat": 43.25, "air": True},
    "astana":     {"name": "Астана", "country": "KZ", "lon": 71.45, "lat": 51.17, "air": True},
    "shymkent":   {"name": "Шымкент", "country": "KZ", "lon": 69.6, "lat": 42.32, "air": True},
    "karaganda":  {"name": "Караганда", "country": "KZ", "lon": 73.1, "lat": 49.8, "air": True},
    "aktobe":     {"name": "Актобе", "country": "KZ", "lon": 57.2, "lat": 50.28, "air": True},
    "atyrau":     {"name": "Атырау", "country": "KZ", "lon": 51.9, "lat": 47.1, "air": True},
    "aktau":      {"name": "Актау", "country": "KZ", "lon": 51.2, "lat": 43.65, "air": True, "port": True},
    "kuryk":      {"name": "Курык", "country": "KZ", "lon": 51.68, "lat": 43.17, "port": True},
    "pavlodar":   {"name": "Павлодар", "country": "KZ", "lon": 76.95, "lat": 52.29, "air": True},
    "oskemen":    {"name": "Усть-Каменогорск", "country": "KZ", "lon": 82.6, "lat": 49.95, "air": True},
    "kostanay":   {"name": "Костанай", "country": "KZ", "lon": 63.62, "lat": 53.21, "air": True},
    "khorgos":    {"name": "Хоргос", "country": "KZ", "lon": 80.4, "lat": 44.2},
    "dostyk":     {"name": "Достык", "country": "KZ", "lon": 82.5, "lat": 45.2},
    "urumqi":     {"name": "Урумчи", "country": "CN", "lon": 87.6, "lat": 43.8, "air": True},
    "xian":       {"name": "Сиань", "country": "CN", "lon": 108.9, "lat": 34.3, "air": True},
    "tashkent":   {"name": "Ташкент", "country": "UZ", "lon": 69.24, "lat": 41.3, "air": True},
    "bishkek":    {"name": "Бишкек", "country": "KG", "lon": 74.6, "lat": 42.87, "air": True},
    "moscow":     {"name": "Москва", "country": "RU", "lon": 37.6, "lat": 55.75, "air": True},
    "baku":       {"name": "Баку", "country": "AZ", "lon": 49.87, "lat": 40.41, "air": True, "port": True},
    "turkmenbashi": {"name": "Туркменбаши", "country": "TM", "lon": 52.97, "lat": 40.02, "port": True},
    "tbilisi":    {"name": "Тбилиси", "country": "GE", "lon": 44.8, "lat": 41.7, "air": True},
    "poti":       {"name": "Поти", "country": "GE", "lon": 41.67, "lat": 42.15},
    "istanbul":   {"name": "Стамбул", "country": "TR", "lon": 28.98, "lat": 41.0, "air": True},
}

KZT_PER_USD = 510  # условный курс для оценки

# ---------------------------------------------------------------- Документы

DOC_TYPES = {
    "invoice":          {"name": "Инвойс (счёт-фактура)", "hint": ["shipper", "forwarder"]},
    "packing_list":     {"name": "Упаковочный лист", "hint": ["shipper", "forwarder"]},
    "contract":         {"name": "Внешнеторговый контракт", "hint": ["shipper", "consignee"]},
    "waybill":          {"name": "Транспортная накладная", "hint": ["carrier", "forwarder"]},
    "origin_cert":      {"name": "Сертификат происхождения", "hint": ["shipper"]},
    "phyto_cert":       {"name": "Фитосанитарный сертификат", "hint": ["shipper"]},
    "vet_cert":         {"name": "Ветеринарный сертификат", "hint": ["shipper"]},
    "dg_doc":           {"name": "Декларация опасного груза (MSDS)", "hint": ["shipper", "carrier"]},
    "forwarding_order": {"name": "Поручение экспедитору", "hint": ["shipper", "forwarder"]},
    "other":            {"name": "Прочий документ", "hint": PARTY_ROLES},
}
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx", ".txt"}
MAX_UPLOAD = 10 * 1024 * 1024


def required_docs(cargo_type: str) -> list[str]:
    docs = ["invoice", "packing_list", "contract", "waybill"]
    if cargo_type == "agro":
        docs.append("phyto_cert")
    if cargo_type == "animal":
        docs.append("vet_cert")
    if cargo_type == "dangerous":
        docs.append("dg_doc")
    return docs


# Органы, которым платформа автоматически рассылает сведения выпущенной декларации.
AGENCIES = [
    {"id": "ktj", "name": "КТЖ", "applies": lambda f, r: True},
    {"id": "customs", "name": "КГД МФ РК («Астана-1»)", "applies": lambda f, r: True},
    {"id": "phyto", "name": "Фитосанитарный контроль", "applies": lambda f, r: f["cargo_type"] == "agro"},
    {"id": "vet", "name": "Ветеринарный контроль", "applies": lambda f, r: f["cargo_type"] == "animal"},
    {"id": "danger", "name": "Надзор за опасными грузами", "applies": lambda f, r: f["cargo_type"] == "dangerous"},
    {"id": "port", "name": "Порт Актау", "applies": lambda f, r: "aktau" in r["nodes"]},
    {"id": "partners", "name": "Партнёры коридора (АЗ, ГР)", "applies": lambda f, r: "baku" in r["nodes"]},
]


def agencies_for(form: dict) -> list[str]:
    route = ROUTES[form["route_id"]]
    return [a["name"] for a in AGENCIES if a["applies"](form, route)]
