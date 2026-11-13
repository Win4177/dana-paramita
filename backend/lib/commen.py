"""Shared helpers: audit trail, encryption of sensitive fields, timestamps, name search text."""

import os
import re
import uuid
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken
from pypinyin import lazy_pinyin

from lib.db import db

_fernet = Fernet(os.environ["FERNET_KEY"].encode())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id() -> str:
    return str(uuid.uuid4())


def encrypt(value: str | None) -> str | None:
    if not value:
        return value
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value:
        return value
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        return value


_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")


def has_cjk(text: str) -> bool:
    return bool(_CJK.search(text or ""))


def pinyin_of(text: str) -> str:
    """Toneless pinyin for any Hanzi (traditional or simplified) in text, space separated."""
    if not has_cjk(text):
        return ""
    return " ".join(p for p in lazy_pinyin(text) if p.strip())


def norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def search_terms(q: str) -> list[str]:
    """Search variants: raw query + its pinyin (spaced and joined) so 许/許 match 'xu'."""
    terms = [norm(q)]
    py = pinyin_of(q)
    if py:
        terms += [py, py.replace(" ", "")]
    return [t for t in terms if t]


async def audit(user: dict | None, action: str, entity: str, entity_id: str, summary: str, detail: dict | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(),
        "at": now_iso(),
        "user_id": user["id"] if user else None,
        "user_name": (user.get("name") or user.get("email")) if user else "sistem",
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "summary": summary,
        "detail": detail or {},
    })
