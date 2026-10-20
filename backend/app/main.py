from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import transaction
from .routers import auth, ledger, meta, shipments
from .seed import seed_if_empty

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    with transaction() as db:
        seed_if_empty(db)
    yield


app = FastAPI(title="Жол-ID Карго", version="2.0", lifespan=lifespan,
              description="Единое окно для грузовых перевозок: регистрация участников, отслеживание, "
                          "документы, электронные декларации, расчёт стоимости.")


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Pydantic по умолчанию отвечает по-английски. Отдаём фронтенду одну понятную строку.
    labels = {"email": "Email", "password": "Пароль (минимум 8 символов)", "name": "Имя", "company": "Компания",
              "bin": "БИН (12 цифр)", "hs": "Код ТН ВЭД (10 цифр)", "weight": "Масса", "volume": "Объём",
              "units": "Количество единиц", "value": "Стоимость", "shipper": "Отправитель",
              "consignee": "Получатель", "description": "Наименование груза", "danger_class": "Класс опасности",
              "insurance_pct": "Процент страховки (0–10%)", "forwarding_usd": "Стоимость экспедирования",
              "escort_usd": "Стоимость сопровождения", "loading_usd": "Стоимость погрузки",
              "freight_usd": "Сумма фрахта"}
    messages = []
    for err in exc.errors():
        field = next((str(p) for p in reversed(err["loc"]) if isinstance(p, str) and p != "body"), None)
        if field in labels:
            messages.append(f"Проверьте поле «{labels[field]}»")
        else:
            messages.append(str(err.get("msg", "")).removeprefix("Value error, "))
    return JSONResponse(status_code=422, content={"detail": "; ".join(dict.fromkeys(messages))})


for r in (auth.router, meta.router, shipments.router, ledger.router):
    app.include_router(r)

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
