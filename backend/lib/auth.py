"""Auth helpers: password/PIN hashing, JWT session cookie, module-based access control."""

import os
import time
from collections import defaultdict

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from lib.db import db

SECRET = os.environ["JWT_SECRET"]
COOKIE = "paramita_session"
SESSION_SECONDS = 12 * 3600

ROLES = ["admin", "staf", "rekan", "auditor"]
ALL_MODULES = ["dashboard", "mutasi", "donatur", "program", "cicilan", "bukti", "voucher", "laporan", "pengguna", "audit", "pengaturan"]
ROLE_DEFAULT_MODULES = {
    "admin": ALL_MODULES,
    "staf": ["dashboard", "mutasi", "donatur", "program", "cicilan", "bukti", "voucher", "laporan"],
    "rekan": ["cicilan"],
    "auditor": ["dashboard", "bukti", "voucher", "laporan", "audit"],
}


def hash_secret(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_secret(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


def make_token(user_id: str, via: str) -> str:
    return jwt.encode({"sub": user_id, "via": via, "exp": int(time.time()) + SESSION_SECONDS}, SECRET, algorithm="HS256")


async def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Belum login")
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesi tidak valid atau kedaluwarsa")
    user = await db.users.find_one({"id": payload["sub"], "active": True}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Akun tidak aktif")
    if payload.get("via") == "pin":
        if not user.get("pin_hash"):
            raise HTTPException(401, "PIN sudah dicabut")
        exp = user.get("pin_expires_at")
        if exp and exp < time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()):
            raise HTTPException(401, "Akses PIN sudah kedaluwarsa")
    return user


def require(module: str, action: str = "read"):
    """action: read | write | delete. Staf cannot delete/lock; auditor is read-only; rekan only cicilan."""

    async def dep(user: dict = Depends(current_user)) -> dict:
        role = user["role"]
        if module not in user.get("modules", []):
            raise HTTPException(403, "Anda tidak punya akses ke modul ini")
        if action != "read":
            if role == "auditor":
                raise HTTPException(403, "Auditor hanya dapat melihat")
            if role == "rekan" and module != "cicilan":
                raise HTTPException(403, "Akses rekan terbatas")
            if action == "delete" and role != "admin":
                raise HTTPException(403, "Hanya Admin/Ketua/Bendahara yang dapat menghapus")
        return user

    return dep


# Simple in-memory rate limit for PIN / password attempts (per client IP).
_failures: dict[str, list[float]] = defaultdict(list)
MAX_FAILS = 5
WINDOW = 15 * 60


def check_rate(key: str) -> None:
    now = time.time()
    _failures[key] = [t for t in _failures[key] if now - t < WINDOW]
    if len(_failures[key]) >= MAX_FAILS:
        raise HTTPException(429, "Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.")


def record_fail(key: str) -> None:
    _failures[key].append(time.time())


def clear_fails(key: str) -> None:
    _failures.pop(key, None)
