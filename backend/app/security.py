import hashlib
import hmac
import secrets
import time

from fastapi import Depends, Header, HTTPException

from .db import get_db

PBKDF2_ROUNDS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
    return hmac.compare_digest(check, digest)


def _token_hash(token: str) -> str:
    # В базе лежит только хэш токена: утечка таблицы sessions не даёт войти в чужой аккаунт.
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
               (_token_hash(token), user_id, time.time()))
    return token


def drop_session(db, token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def bearer_token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def optional_user(authorization: str | None = Header(None), db=Depends(get_db)):
    token = bearer_token(authorization)
    if not token:
        return None
    return db.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
        (_token_hash(token),),
    ).fetchone()


def current_user(user=Depends(optional_user)):
    if user is None:
        raise HTTPException(401, "Требуется вход в систему")
    return user


def public_user(u) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u["name"], "company": u["company"],
            "bin": u["bin"], "role": u["role"], "is_demo": bool(u["is_demo"])}
