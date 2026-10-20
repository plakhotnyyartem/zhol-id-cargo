from fastapi import APIRouter, HTTPException

from .. import calc, sim
from ..data import (CARGO_TYPES, CITIES, DANGER_CLASSES, DOC_TYPES, KZT_PER_USD, NODES, PARTY_ROLES, ROLES,
                    ROUTES, TRANSPORT_MODES, required_docs)
from ..schemas import QuoteIn

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/meta")
def meta():
    """Справочники для интерфейса: одна точка правды на сервере."""
    return {
        "roles": ROLES,
        "party_roles": PARTY_ROLES,
        "nodes": NODES,
        "routes": {rid: {**{k: v for k, v in r.items() if k != "legs"},
                         "legs": [{"mode": m, "hours": h} for m, h in r["legs"]],
                         "plan": sim.plan(rid), "compare": sim.compare(rid)}
                   for rid, r in ROUTES.items()},
        "cargo_types": {k: {"name": v["name"], "needs_ref": v.get("needs_ref", False)} for k, v in CARGO_TYPES.items()},
        "danger_classes": {k: {"name": v["name"], "no_air": v.get("no_air", False), "escort": v.get("escort", False)}
                           for k, v in DANGER_CLASSES.items()},
        "transport_modes": TRANSPORT_MODES,
        "cities": CITIES,
        "doc_types": DOC_TYPES,
        "required_docs": {k: required_docs(k) for k in CARGO_TYPES},
        "kzt_rate": KZT_PER_USD,
        "sim_hours_per_sec": sim.SIM_HOURS_PER_SEC,
    }


@router.post("/calc/quote")
def quote(body: QuoteIn):
    try:
        return calc.quote(body.model_dump())
    except calc.QuoteError as e:
        raise HTTPException(422, str(e))
