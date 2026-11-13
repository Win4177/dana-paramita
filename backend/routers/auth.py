import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib.auth import (
    ALL_MODULES, COOKIE, ROLE_DEFAULT_MODULES, SESSION_SECONDS, check_rate, clear_fails, current_user,
    hash_secret, make_token, record_fail, require, verify_secret,
)
from lib.common import audit, new_id, now_iso
from lib.db import db
from models.schemas import LoginIn, PinIssueIn, PinIssueOut, PinLoginIn, UserCreate, UserOut, UserUpdate

router = APIRouter()


def user_out(u: dict) -> UserOut:
    return UserOut(**{**u, "has_pin": bool(u.get("pin_hash"))})


def _set_cookie(request: Request, response: Response, token: str) -> None:
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite="lax", secure=secure, path="/")


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()


@router.post("/auth/login", response_model=UserOut)
async def login(body: LoginIn, request: Request, response: Response):
    key = f"pw:{body.email.lower()}:{_ip(request)}"
    check_rate(key)
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not user.get("active") or not verify_secret(body.password, user.get("password_hash")):
        record_fail(key)
        await audit(None, "login_gagal", "auth", body.email.lower(), f"Login gagal untuk {body.email}")
        raise HTTPException(401, "Email atau password salah")
    clear_fails(key)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    _set_cookie(request, response, make_token(user["id"], "password"))
    await audit(user, "login", "auth", user["id"], f"{user['email']} login")
    return user_out(user)


@router.post("/auth/pin", response_model=UserOut)
async def pin_login(body: PinLoginIn, request: Request, response: Response):
    key = f"pin:{_ip(request)}"
    check_rate(key)
    now = now_iso()
    async for user in db.users.find({"active": True, "pin_hash": {"$ne": None}}, {"_id": 0}):
        if verify_secret(body.pin, user["pin_hash"]):
            if user.get("pin_expires_at") and user["pin_expires_at"] < now:
                raise HTTPException(401, "Akses PIN sudah kedaluwarsa")
            clear_fails(key)
            await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now}})
            _set_cookie(request, response, make_token(user["id"], "pin"))
            await audit(user, "login_pin", "auth", user["id"], f"{user['name']} login dengan PIN")
            return user_out(user)
    record_fail(key)
    await audit(None, "login_pin_gagal", "auth", _ip(request), "PIN salah")
    raise HTTPException(401, "PIN salah")


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return user_out(user)


@router.get("/users", response_model=list[UserOut])
async def list_users(_: dict = Depends(require("pengguna"))):
    return [user_out(u) for u in await db.users.find({}, {"_id": 0}).sort("name", 1).to_list(500)]


@router.post("/users", response_model=UserOut)
async def create_user(body: UserCreate, user: dict = Depends(require("pengguna", "write"))):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email sudah terdaftar")
    if body.role != "rekan" and not body.password:
        raise HTTPException(400, "Password wajib untuk peran selain Rekan")
    modules = [m for m in (body.modules or ROLE_DEFAULT_MODULES[body.role]) if m in ALL_MODULES]
    doc = {
        "id": new_id(), "email": email, "name": body.name, "role": body.role, "modules": modules, "active": True,
        "password_hash": hash_secret(body.password) if body.password else None, "pin_hash": None,
        "pin_expires_at": None, "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await audit(user, "buat", "pengguna", doc["id"], f"Membuat pengguna {email} ({body.role})")
    return user_out(doc)


@router.put("/users/{uid}", response_model=UserOut)
async def update_user(uid: str, body: UserUpdate, user: dict = Depends(require("pengguna", "write"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    patch = body.model_dump(exclude_none=True)
    if uid == user["id"] and (patch.get("active") is False or ("role" in patch and patch["role"] != "admin")):
        raise HTTPException(400, "Tidak dapat menonaktifkan/menurunkan peran akun sendiri")
    if "password" in patch:
        patch["password_hash"] = hash_secret(patch.pop("password"))
    if "modules" in patch:
        patch["modules"] = [m for m in patch["modules"] if m in ALL_MODULES]
    elif "role" in patch and patch["role"] != target["role"]:
        patch["modules"] = ROLE_DEFAULT_MODULES[patch["role"]]
    await db.users.update_one({"id": uid}, {"$set": patch})
    changed = sorted(k for k in patch if k != "password_hash") + (["password"] if "password_hash" in patch else [])
    await audit(user, "ubah", "pengguna", uid, f"Mengubah pengguna {target['email']}: {', '.join(changed)}")
    return user_out(await db.users.find_one({"id": uid}, {"_id": 0}))


@router.post("/users/{uid}/pin", response_model=PinIssueOut)
async def issue_pin(uid: str, body: PinIssueIn, user: dict = Depends(require("pengguna", "write"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    others = await db.users.find({"pin_hash": {"$ne": None}, "id": {"$ne": uid}}, {"pin_hash": 1}).to_list(500)
    for _ in range(20):
        pin = f"{secrets.randbelow(1_000_000):06d}"
        if not any(verify_secret(pin, o["pin_hash"]) for o in others):
            break
    expires = None
    if body.expires_days:
        from datetime import datetime, timedelta, timezone
        expires = (datetime.now(timezone.utc) + timedelta(days=body.expires_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    await db.users.update_one({"id": uid}, {"$set": {"pin_hash": hash_secret(pin), "pin_expires_at": expires}})
    await audit(user, "buat_pin", "pengguna", uid, f"Menerbitkan PIN untuk {target['name']}" + (f" (berlaku s/d {expires[:10]})" if expires else ""))
    return PinIssueOut(pin=pin, pin_expires_at=expires)


@router.delete("/users/{uid}/pin", response_model=UserOut)
async def revoke_pin(uid: str, user: dict = Depends(require("pengguna", "write"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Pengguna tidak ditemukan")
    await db.users.update_one({"id": uid}, {"$set": {"pin_hash": None, "pin_expires_at": None}})
    await audit(user, "cabut_pin", "pengguna", uid, f"Mencabut PIN {target['name']}")
    return user_out(await db.users.find_one({"id": uid}, {"_id": 0}))
