from fastapi import APIRouter, Depends, Query

from .. import ledger
from ..db import get_db
from ..security import current_user

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


@router.get("")
def blocks(limit: int = Query(300, ge=1, le=2000), user=Depends(current_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM ledger ORDER BY idx DESC LIMIT ?", (limit + 1,)).fetchall()
    # Отдаём на один блок больше: браузеру нужен хэш предыдущего, чтобы проверить первую ссылку.
    total = db.execute("SELECT COUNT(*) FROM ledger").fetchone()[0]
    return {"total": total, "blocks": [ledger.as_dict(r) for r in rows]}


@router.get("/verify")
def verify(user=Depends(current_user), db=Depends(get_db)):
    return {"broken_at": ledger.verify(db)}
