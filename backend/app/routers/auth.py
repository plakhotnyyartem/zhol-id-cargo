import os
import time

from fastapi import APIRouter, Depends, Header, HTTPException

from ..db import get_db
from ..schemas import DemoLoginIn, LoginIn, RegisterIn
from ..security import (create_session, current_user, drop_session, hash_password, public_user,
                        verify_password, bearer_token)

router = APIRouter(prefix="/api/auth", tags=["auth"])
DEMO_ENABLED = os.environ.get("ZHOL_DEMO", "1") == "1"


@router.post("/register")
def register(body: RegisterIn, db=Depends(get_db)):
    if db.execute("SELECT 1 FROM users WHERE email = ?", (body.email,)).fetchone():
        raise HTTPException(409, "Пользователь с таким email уже зарегистрирован")
    cur = db.execute(
        "INSERT INTO users (email, name, company, bin, role, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.email, body.name.strip(), body.company.strip(), body.bin, body.role,
         hash_password(body.password), time.time()))
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"token": create_session(db, user["id"]), "user": public_user(user)}


@router.post("/login")
def login(body: LoginIn, db=Depends(get_db)):
    user = db.execute("SELECT * FROM users WHERE email = ? AND is_demo = 0",
                      (body.email.strip().lower(),)).fetchone()
    if not user or not verify_password(body.password, user["pw_hash"]):
        raise HTTPException(401, "Неверный email или пароль")
    return {"token": create_session(db, user["id"]), "user": public_user(user)}


@router.post("/demo")
def demo_login(body: DemoLoginIn, db=Depends(get_db)):
    """Быстрый вход в демо-аккаунт выбранной роли — для показа на защите."""
    if not DEMO_ENABLED:
        raise HTTPException(404, "Демо-режим отключён")
    user = db.execute("SELECT * FROM users WHERE role = ? AND is_demo = 1", (body.role,)).fetchone()
    if not user:
        raise HTTPException(404, "Демо-аккаунт не найден")
    return {"token": create_session(db, user["id"]), "user": public_user(user)}


@router.post("/logout")
def logout(authorization: str | None = Header(None), db=Depends(get_db)):
    token = bearer_token(authorization)
    if token:
        drop_session(db, token)
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)
