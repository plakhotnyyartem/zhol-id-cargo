from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .calc import capacity_error
from .data import CARGO_TYPES, ROUTES, TRANSPORT_MODES

Role = Literal["shipper", "consignee", "forwarder", "carrier", "customs"]


class RegisterIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=2, max_length=80)
    company: str = Field(min_length=2, max_length=120)
    bin: str | None = Field(default=None, pattern=r"^\d{12}$")
    role: Role

    @field_validator("email")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("bin", mode="before")
    @classmethod
    def empty_bin(cls, v):
        return v or None


class LoginIn(BaseModel):
    email: str
    password: str


class DemoLoginIn(BaseModel):
    role: Role


class QuoteOptions(BaseModel):
    """Услуги: стоимость вводит пользователь; пустое поле — ориентир по типовому тарифу."""
    insurance: bool = False
    insurance_pct: float = Field(default=0.3, ge=0, le=10)
    forwarding: bool = False
    forwarding_usd: float | None = Field(default=None, ge=0, le=10_000_000)
    escort: bool = False
    escort_usd: float | None = Field(default=None, ge=0, le=10_000_000)
    loading: bool = False
    loading_usd: float | None = Field(default=None, ge=0, le=10_000_000)


class QuoteIn(BaseModel):
    mode: str
    equipment: str
    cargo_type: str
    danger_class: int | None = Field(default=None, ge=1, le=9)
    weight: float = Field(gt=0, le=100_000, description="Масса, т")
    volume: float | None = Field(default=None, ge=0, le=500_000, description="Объём, м³")
    units: int = Field(default=1, ge=1, le=1000, description="Количество единиц оборудования")
    value: float = Field(default=0, ge=0)
    origin: str
    destination: str
    options: QuoteOptions = QuoteOptions()


class CostIn(BaseModel):
    """Стоимость перевозки: либо пересчёт по параметрам калькулятора, либо сумма фрахта вручную."""
    origin: str | None = None
    destination: str | None = None
    options: QuoteOptions | None = None
    freight_usd: float | None = Field(default=None, ge=0, le=100_000_000)
    forwarding_usd: float | None = Field(default=None, ge=0, le=10_000_000)


class ShipmentIn(BaseModel):
    shipper: str = Field(min_length=2, max_length=120)
    consignee: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=2, max_length=200)
    hs: str = Field(pattern=r"^\d{10}$")
    cargo_type: str
    danger_class: int | None = Field(default=None, ge=1, le=9)
    mode: str
    equipment: str
    weight: float = Field(gt=0, le=100_000)
    volume: float | None = Field(default=None, ge=0, le=500_000)
    units: int = Field(ge=1, le=10_000)
    value: float = Field(gt=0)
    route_id: str
    cert: str | None = Field(default=None, max_length=60)
    cost: CostIn | None = None

    @model_validator(mode="after")
    def check_refs(self):
        if self.cargo_type not in CARGO_TYPES:
            raise ValueError("Неизвестный тип груза")
        if self.route_id not in ROUTES:
            raise ValueError("Неизвестный маршрут")
        mode = TRANSPORT_MODES.get(self.mode)
        if not mode or self.equipment not in mode["equipment"]:
            raise ValueError("Неверный вид транспорта или оборудование")
        if self.cargo_type == "dangerous" and not self.danger_class:
            raise ValueError("Для опасного груза укажите класс опасности")
        if self.cargo_type != "dangerous":
            self.danger_class = None
        if err := capacity_error(mode["equipment"][self.equipment], self.units, self.weight, self.volume):
            raise ValueError(err)
        return self


class JoinIn(BaseModel):
    role: Literal["shipper", "consignee", "forwarder", "carrier"] | None = None


class DecisionIn(BaseModel):
    decision: Literal["release", "reject"]
    comment: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def need_comment(self):
        if self.decision == "reject" and not (self.comment or "").strip():
            raise ValueError("Укажите причину отказа")
        return self
