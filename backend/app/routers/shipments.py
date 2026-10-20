from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import services, sim
from ..db import UPLOAD_DIR, get_db
from ..schemas import DecisionIn, JoinIn, ShipmentIn
from ..security import current_user, optional_user

router = APIRouter(prefix="/api", tags=["shipments"])


@router.get("/shipments")
def my_shipments(user=Depends(current_user), db=Depends(get_db)):
    sim.advance_all(db)
    if user["role"] == "customs":
        rows = db.execute("SELECT * FROM shipments ORDER BY created_at DESC").fetchall()
    else:
        rows = db.execute("SELECT s.* FROM shipments s JOIN participants p ON p.shipment_id = s.id "
                          "WHERE p.user_id = ? ORDER BY s.created_at DESC", (user["id"],)).fetchall()
    return [services.serialize(db, s, user) for s in rows]


@router.post("/shipments", status_code=201)
def create(body: ShipmentIn, user=Depends(current_user), db=Depends(get_db)):
    number = services.create_shipment(db, user, body.model_dump())
    return services.serialize(db, services.get_shipment(db, number), user)


@router.get("/shipments/{number}")
def track(number: str, user=Depends(optional_user), db=Depends(get_db)):
    """Отслеживание по номеру доступно всем; объём сведений зависит от роли."""
    s = services.get_shipment(db, number)
    sim.advance(db, s)
    return services.serialize(db, services.get_shipment(db, number), user)


@router.post("/shipments/{number}/join")
def join(number: str, body: JoinIn, user=Depends(current_user), db=Depends(get_db)):
    s = services.get_shipment(db, number)
    services.join_shipment(db, s, user, body.role)
    return services.serialize(db, s, user)


@router.post("/shipments/{number}/start")
def start(number: str, user=Depends(current_user), db=Depends(get_db)):
    s = services.get_shipment(db, number)
    services.start_shipment(db, s, user)
    return services.serialize(db, services.get_shipment(db, number), user)


@router.post("/shipments/{number}/documents", status_code=201)
def upload(number: str, doc_type: str = Form(...), file: UploadFile = File(...),
           user=Depends(current_user), db=Depends(get_db)):
    s = services.get_shipment(db, number)
    services.save_document(db, s, user, doc_type, file.filename, file.file)
    return services.serialize(db, s, user)


@router.get("/documents/{doc_id}")
def download(doc_id: int, user=Depends(current_user), db=Depends(get_db)):
    d = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Документ не найден")
    s = db.execute("SELECT * FROM shipments WHERE id = ?", (d["shipment_id"],)).fetchone()
    services.require_full_access(db, s, user)
    return FileResponse(UPLOAD_DIR / d["stored_name"], filename=d["filename"])


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int, user=Depends(current_user), db=Depends(get_db)):
    d = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Документ не найден")
    decl = services.declaration_of(db, d["shipment_id"])
    if d["uploaded_by"] != user["id"]:
        raise HTTPException(403, "Удалить документ может только тот, кто его загрузил")
    if decl and decl["status"] in ("submitted", "released"):
        raise HTTPException(409, "Документ уже включён в поданную декларацию")
    db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    (UPLOAD_DIR / d["stored_name"]).unlink(missing_ok=True)
    return {"ok": True}


@router.post("/shipments/{number}/declaration", status_code=201)
def declare(number: str, user=Depends(current_user), db=Depends(get_db)):
    s = services.get_shipment(db, number)
    services.submit_declaration(db, s, user)
    return services.serialize(db, s, user)


@router.get("/declarations")
def declarations(user=Depends(current_user), db=Depends(get_db)):
    if user["role"] == "customs":
        rows = db.execute("SELECT * FROM declarations ORDER BY submitted_at DESC").fetchall()
    else:
        rows = db.execute("SELECT d.* FROM declarations d JOIN participants p ON p.shipment_id = d.shipment_id "
                          "WHERE p.user_id = ? ORDER BY d.submitted_at DESC", (user["id"],)).fetchall()
    return [services.declaration_dict(db, d) for d in rows]


@router.get("/declarations/{decl_id}")
def declaration(decl_id: int, user=Depends(current_user), db=Depends(get_db)):
    d = db.execute("SELECT * FROM declarations WHERE id = ?", (decl_id,)).fetchone()
    if not d:
        raise HTTPException(404, "Декларация не найдена")
    s = db.execute("SELECT * FROM shipments WHERE id = ?", (d["shipment_id"],)).fetchone()
    services.require_full_access(db, s, user)
    return services.declaration_dict(db, d, with_payload=True)


@router.post("/declarations/{decl_id}/decision")
def decide(decl_id: int, body: DecisionIn, user=Depends(current_user), db=Depends(get_db)):
    services.decide_declaration(db, decl_id, user, body.decision, body.comment)
    d = db.execute("SELECT * FROM declarations WHERE id = ?", (decl_id,)).fetchone()
    return services.declaration_dict(db, d)
