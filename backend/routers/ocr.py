"""Foto nota → AI reads date/amount/description (Gemini 3 Flash, falls back to GPT-5.2, then Claude Sonnet).
Result becomes a new kas transaction or is attached to a matching bank mutation."""

import base64
import json
import logging
import os
import re
from datetime import date, timedelta

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from lib.auth import require
from lib.common import audit, new_id, now_iso
from lib.db import db
from lib.jev import analyze_in_background
from models.schemas import Attachment, KasIn, LinkFileIn, Mutasi, NotaRead
from routers.files import IMAGE_EXT, MAX_ATTACH, MIME, store_bytes
from routers.mutasi import to_model

router = APIRouter()
log = logging.getLogger(__name__)

MODELS = [("gemini", "gemini-3-flash-preview", "Gemini 3 Flash"), ("openai", "gpt-5.2", "GPT-5.2"), ("anthropic", "claude-sonnet-5-5", "Claude Sonnet")]
PROMPT = """Baca foto nota/kuitansi/struk/bukti transfer ini (Indonesia). Balas HANYA JSON satu baris tanpa penjelasan:
{"date":"YYYY-MM-DD atau kosong","amount":angka total akhir yang dibayar tanpa titik ribuan,"vendor":"nama toko/penerima/pengirim","description":"ringkas isi transaksi, maks 80 karakter","direction":"DB jika yayasan membayar/belanja, CR jika yayasan menerima uang","kind":"nota|kuitansi|bukti_transfer|lainnya"}"""


def _parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON")
    d = json.loads(m.group(0))
    amt = d.get("amount")
    if isinstance(amt, str):
        amt = float(re.sub(r"[^\d.]", "", amt.replace(",", ".")) or 0)
    dt = str(d.get("date") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dt):
        dt = ""
    return {"date": dt, "amount": float(amt or 0), "vendor": str(d.get("vendor") or "")[:80], "description": str(d.get("description") or "")[:120],
            "direction": "CR" if d.get("direction") == "CR" else "DB", "kind": d.get("kind") if d.get("kind") in ("nota", "kuitansi", "bukti_transfer") else "lainnya"}


async def read_image(b64: str) -> tuple[dict, str]:
    last = None
    for provider, model, label in MODELS:
        try:
            chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"nota-{new_id()}", system_message="Anda asisten pembukuan yang teliti.").with_model(provider, model)
            reply = await chat.send_message(UserMessage(text=PROMPT, file_contents=[ImageContent(image_base64=b64)]))
            return _parse(reply if isinstance(reply, str) else str(reply)), label
        except Exception as exc:  # try next model
            last = exc
            log.warning("Nota read with %s failed: %s", model, exc)
    raise HTTPException(503, f"AI tidak dapat membaca foto saat ini. Coba lagi atau isi manual. ({last})")


async def _candidates(amount: float, dt: str) -> list[Mutasi]:
    if amount <= 0:
        return []
    f: dict = {"amount": {"$gte": amount - 1, "$lte": amount + 1}}
    if dt:
        d0 = date.fromisoformat(dt)
        f["date"] = {"$gte": (d0 - timedelta(days=10)).isoformat(), "$lte": (d0 + timedelta(days=10)).isoformat()}
    return [to_model(d) for d in await db.mutasi.find(f, {"_id": 0}).sort("date", -1).limit(5).to_list(5)]


@router.post("/nota/read", response_model=NotaRead)
async def read_nota(file: UploadFile = File(...), user: dict = Depends(require("mutasi", "write"))):
    name = file.filename or "nota.jpg"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in IMAGE_EXT:
        raise HTTPException(400, "Foto harus JPG, PNG, atau WEBP")
    data = await file.read()
    if not data or len(data) > MAX_ATTACH:
        raise HTTPException(400, "Ukuran foto 1 byte – 10 MB")
    info, model = await read_image(base64.b64encode(data).decode())
    rec = await store_bytes(data, name, ext, MIME[ext], "mutasi", "nota-pending", user, {"doc_type": info["kind"], "doc_type_confidence": None})
    await audit(user, "baca_nota", "mutasi", rec["id"], f"AI ({model}) membaca nota {name}: {info['date'] or '?'} Rp {info['amount']:,.0f}")
    return NotaRead(file_id=rec["id"], date=info["date"], amount=info["amount"], description=info["description"], vendor=info["vendor"],
                    direction=info["direction"], model=model, candidates=await _candidates(info["amount"], info["date"]))


@router.get("/nota/candidates", response_model=list[Mutasi])
async def nota_candidates(amount: float, date: str = "", _: dict = Depends(require("mutasi"))):
    return await _candidates(amount, date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else "")


async def _attach(file_id: str, mid: str) -> dict:
    rec = await db.files.find_one({"id": file_id, "module": "mutasi", "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Foto tidak ditemukan")
    if rec["owner_id"] not in ("nota-pending", mid):
        raise HTTPException(400, "Foto ini sudah terlampir di transaksi lain")
    await db.files.update_one({"id": file_id}, {"$set": {"owner_id": mid}})
    att = Attachment(**rec).model_dump()
    await db.mutasi.update_one({"id": mid, "attachments.id": {"$ne": file_id}}, {"$push": {"attachments": att}})
    return rec


@router.post("/mutasi/kas", response_model=Mutasi)
async def create_kas(body: KasIn, user: dict = Depends(require("mutasi", "write"))):
    mid = new_id()
    doc = {
        "id": mid, "hash": f"kas-{mid}", "date": body.date, "description": body.description.strip(), "sender_name": body.sender_name.strip().upper(),
        "direction": body.direction, "amount": round(body.amount, 2), "balance": None, "channel": "kas", "status": "belum", "notes": body.notes,
        "allocations": [], "attachments": [], "suggested": False, "import_id": "", "ord": int(date.fromisoformat(body.date).strftime("%Y%m%d")) * 10000, "created_at": now_iso(),
    }
    await db.mutasi.insert_one(dict(doc))
    if body.file_id:
        await _attach(body.file_id, mid)
    await audit(user, "buat", "mutasi", mid, f"Transaksi kas {'BKM' if body.direction == 'CR' else 'BKK'} {body.date} Rp {body.amount:,.0f}: {body.description}")
    analyze_in_background([mid])
    return to_model(await db.mutasi.find_one({"id": mid}, {"_id": 0}))


@router.post("/mutasi/{mid}/attachments/link", response_model=Mutasi)
async def link_file(mid: str, body: LinkFileIn, user: dict = Depends(require("mutasi", "write"))):
    d = await db.mutasi.find_one({"id": mid}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mutasi tidak ditemukan")
    rec = await _attach(body.file_id, mid)
    await audit(user, "lampiran", "mutasi", mid, f"Melampirkan foto nota {rec['filename']} ke mutasi {d['date']} Rp {d['amount']:,.0f}")
    return to_model(await db.mutasi.find_one({"id": mid}, {"_id": 0}))
