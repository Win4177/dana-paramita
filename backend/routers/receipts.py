"""Bukti pembayaran donasi: atomic sequence numbering, per-row or bulk issue, cancel/replace, CJK PDF."""

import time
from html import escape

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pymongo import ReturnDocument

from lib.auth import SECRET, require
from lib.email import send_email
from lib.common import audit, decrypt, new_id, now_iso
from lib.dates import today_iso
from lib.db import db
from lib.receipt_pdf import render_receipt
from lib.storage import get_object
from lib.terbilang import terbilang
from models.schemas import CancelIn, EligibleItem, EmailResult, IssueIn, IssueResult, Receipt, ReceiptItemRef, ReceiptPage, ShareLink

router = APIRouter()

ELIGIBLE_Q = {"status": "ok", "direction": "CR", "allocations": {"$elemMatch": {"donor_id": {"$ne": None}, "receipt_id": None}}}


async def next_seq(start: int) -> int:
    """Atomic: one findOneAndUpdate per number, so concurrent issues never share or skip a number.
    Raising receipt_digital_from in settings jumps the counter forward, never back."""
    doc = await db.counters.find_one_and_update(
        {"_id": "receipt"},
        [{"$set": {"seq": {"$add": [{"$max": [{"$ifNull": ["$seq", 0]}, start - 1]}, 1]}}}],
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    return int(doc["seq"])


def format_number(fmt: str, seq: int, issued: str, code: str) -> str:
    y, m, _ = issued.split("-")
    try:
        return fmt.format(seq=seq, month=int(m), year=int(y), code=code)
    except (KeyError, ValueError, IndexError):
        return f"{seq:06d} {m} {y} {code}"


@router.get("/receipts/eligible", response_model=list[EligibleItem])
async def eligible(_: dict = Depends(require("bukti"))):
    out = []
    async for d in db.mutasi.find(ELIGIBLE_Q, {"_id": 0}).sort([("date", -1), ("ord", -1)]).limit(500):
        for i, a in enumerate(d["allocations"]):
            if a.get("donor_id") and not a.get("receipt_id"):
                out.append(EligibleItem(mutasi_id=d["id"], alloc_index=i, date=d["date"], sender_name=d.get("sender_name", ""), donor_id=a["donor_id"],
                                        donor_name=a.get("donor_name", ""), program_name=a.get("program_name", ""), jenis=a.get("jenis", "donasi"), amount=a["amount"]))
    return out


@router.get("/receipts", response_model=ReceiptPage)
async def list_receipts(q: str = "", status: str = "", donor_id: str = "", skip: int = 0, limit: int = 50, _: dict = Depends(require("bukti"))):
    f: dict = {}
    if q.strip():
        import re
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f["$or"] = [{"number": rx}, {"donor_name": rx}]
    if status:
        f["status"] = status
    if donor_id:
        f["donor_id"] = donor_id
    total = await db.receipts.count_documents(f)
    docs = await db.receipts.find(f, {"_id": 0}).sort("seq", -1).skip(skip).limit(min(limit, 200)).to_list(200)
    return ReceiptPage(items=[Receipt(**d) for d in docs], total=total)


async def _issue_group(refs: list[dict], user: dict, settings: dict, replaces: str | None = None) -> Receipt | None:
    """Claim each allocation (conditional update, so a double click or a parallel bulk run can't receipt it twice),
    then take the next number."""
    rid, claimed, docs = new_id(), [], {}
    for ref in refs:
        mid, idx = ref["mutasi_id"], ref["alloc_index"]
        res = await db.mutasi.update_one(
            # $expr on the exact element: dotted "allocations.N.field": null also matches when the field is set
            {"id": mid, "status": "ok", "direction": "CR", "$expr": {"$let": {"vars": {"a": {"$arrayElemAt": ["$allocations", idx]}}, "in": {"$and": [
                {"$eq": [{"$type": "$$a.donor_id"}, "string"]}, {"$in": [{"$ifNull": ["$$a.receipt_id", None]}, [None, ""]]}]}}}},
            {"$set": {f"allocations.{idx}.receipt_id": rid}},
        )
        if res.modified_count:
            claimed.append(ref)
            docs[mid] = docs.get(mid) or await db.mutasi.find_one({"id": mid}, {"_id": 0})
    if not claimed:
        return None
    allocs = [docs[r["mutasi_id"]]["allocations"][r["alloc_index"]] for r in claimed]
    donor = await db.donors.find_one({"id": allocs[0]["donor_id"]}, {"_id": 0}) or {}
    issued = today_iso()
    seq = await next_seq(int(settings.get("receipt_digital_from", 1)))
    number = format_number(settings.get("receipt_number_format", "{seq:06d}"), seq, issued, settings.get("receipt_code", ""))
    amount = round(sum(a["amount"] for a in allocs), 2)
    rec = {
        "id": rid, "number": number, "seq": seq, "issued_date": issued,
        "donation_date": min(docs[r["mutasi_id"]]["date"] for r in claimed),
        "donor_id": allocs[0]["donor_id"],
        "donor_name": " ".join(x for x in [donor.get("name_latin", ""), donor.get("name_mandarin", "")] if x) or allocs[0].get("donor_name", ""),
        "npwp": decrypt(donor.get("npwp")) or "", "donor_address": donor.get("address", ""), "program_names": sorted({a.get("program_name") or "Donasi umum" for a in allocs}),
        "amount": amount, "terbilang": terbilang(amount), "items": claimed, "status": "aktif", "replaces": replaces,
        "issued_by": user["name"], "issued_at": now_iso(),
    }
    await db.receipts.insert_one(dict(rec))
    for r in claimed:
        await db.mutasi.update_one({"id": r["mutasi_id"]}, {"$set": {f"allocations.{r['alloc_index']}.receipt_number": number}})
    await audit(user, "terbit_bukti", "bukti", rid, f"Menerbitkan bukti {number} untuk {rec['donor_name']} Rp {amount:,.0f}" + (" (pengganti)" if replaces else ""))
    return Receipt(**rec)


def _group(items: list[dict], meta: dict[tuple, dict], merge: bool) -> list[list[dict]]:
    if not merge:
        return [[i] for i in items]
    groups: dict[tuple, list[dict]] = {}
    for i in items:
        m = meta[(i["mutasi_id"], i["alloc_index"])]
        groups.setdefault((m["donor_id"], m["date"]), []).append(i)
    return list(groups.values())


@router.post("/receipts/issue", response_model=IssueResult)
async def issue(body: IssueIn, user: dict = Depends(require("bukti", "write"))):
    settings = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    items = [r.model_dump() for r in body.items]
    meta = {}
    for d in await db.mutasi.find({"id": {"$in": list({i["mutasi_id"] for i in items})}}, {"_id": 0}).to_list(None):
        for idx, a in enumerate(d["allocations"]):
            meta[(d["id"], idx)] = {"donor_id": a.get("donor_id"), "date": d["date"]}
    valid = [i for i in items if meta.get((i["mutasi_id"], i["alloc_index"]), {}).get("donor_id")]
    issued = []
    for g in _group(valid, meta, bool(settings.get("receipt_merge_same_day"))):
        r = await _issue_group(g, user, settings)
        if r:
            issued.append(r)
    covered = sum(len(r.items) for r in issued)
    return IssueResult(issued=issued, skipped=len(items) - covered)


@router.post("/receipts/{rid}/cancel", response_model=IssueResult)
async def cancel(rid: str, body: CancelIn, user: dict = Depends(require("bukti", "delete"))):
    r = await db.receipts.find_one_and_update(
        {"id": rid, "status": "aktif"},
        {"$set": {"status": "batal", "cancel_reason": body.reason.strip(), "cancelled_by": user["name"], "cancelled_at": now_iso()}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not r:
        raise HTTPException(400, "Bukti tidak ditemukan atau sudah dibatalkan")
    for it in r["items"]:
        await db.mutasi.update_one({"id": it["mutasi_id"], f"allocations.{it['alloc_index']}.receipt_id": rid},
                                   {"$set": {f"allocations.{it['alloc_index']}.receipt_id": None, f"allocations.{it['alloc_index']}.receipt_number": ""}})
    await audit(user, "batal_bukti", "bukti", rid, f"Membatalkan bukti {r['number']}: {body.reason.strip()}")
    issued = []
    if body.reissue:
        settings = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
        new = await _issue_group(r["items"], user, settings, replaces=rid)
        if new:
            await db.receipts.update_one({"id": rid}, {"$set": {"replaced_by": new.id}})
            issued.append(new)
    return IssueResult(issued=issued, skipped=0 if issued or not body.reissue else len(r["items"]))


async def _image(url: str) -> bytes | None:
    if not url.startswith("/api/files/"):
        return None
    rec = await db.files.find_one({"id": url.rsplit("/", 1)[-1], "is_deleted": False}, {"_id": 0})
    if not rec:
        return None
    try:
        return (await get_object(rec["storage_path"]))[0]
    except Exception:
        return None


async def _pdf_response(rid: str) -> Response:
    r = await db.receipts.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bukti tidak ditemukan")
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    pdf = render_receipt(r, s, await _image(s.get("logo_data_url", "")), await _image(s.get("signature_data_url", "")))
    fname = "bukti_" + "".join(ch if ch.isalnum() else "_" for ch in r["number"]) + ".pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.get("/receipts/{rid}/pdf")
async def receipt_pdf(rid: str, _: dict = Depends(require("bukti"))):
    return await _pdf_response(rid)


LINK_DAYS = 30


@router.get("/receipts/public/{token}")
async def public_pdf(token: str):
    """Donor download link from the email: signed, receipt-scoped, expires after 30 days."""
    try:
        p = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(404, "Tautan tidak valid atau kedaluwarsa")
    if p.get("typ") != "receipt":
        raise HTTPException(404, "Tautan tidak valid")
    return await _pdf_response(p["rid"])


def _base_url(request: Request) -> str:
    origin = request.headers.get("origin") or ""
    if not origin.startswith("https://"):
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
        origin = f"https://{host}"
    return origin.rstrip("/")


async def _share(rid: str, request: Request) -> tuple[dict, dict, str, dict]:
    r = await db.receipts.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Bukti tidak ditemukan")
    if r["status"] != "aktif":
        raise HTTPException(400, "Bukti sudah dibatalkan")
    donor = await db.donors.find_one({"id": r["donor_id"]}, {"_id": 0}) or {}
    token = jwt.encode({"rid": rid, "typ": "receipt", "exp": int(time.time()) + LINK_DAYS * 86400}, SECRET, algorithm="HS256")
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    return r, donor, f"{_base_url(request)}/api/receipts/public/{token}", s


def _rp(n: float) -> str:
    return "Rp " + f"{n:,.0f}".replace(",", ".")


@router.post("/receipts/{rid}/share-link", response_model=ShareLink)
async def share_link(rid: str, request: Request, _: dict = Depends(require("bukti", "write"))):
    r, donor, url, s = await _share(rid, request)
    subject = f"Bukti Pembayaran Donasi No. {r['number']} - {s.get('name', '')}"
    body = (f"Yth. {r['donor_name']},\n\nTerima kasih atas donasi Anda sebesar {_rp(r['amount'])} ({r['terbilang']}).\n"
            f"Bukti pembayaran No. {r['number']} beserta lampiran PER-3/PJ/2023 dapat diunduh di:\n{url}\n(berlaku {LINK_DAYS} hari)\n\n"
            f"Salam,\n{s.get('signer_name') or 'Bendahara'}\n{s.get('name', '')}\n{s.get('phone', '')}")
    return ShareLink(url=url, email=donor.get("email", ""), subject=subject, body=body)


@router.post("/receipts/{rid}/email", response_model=EmailResult)
async def email_receipt(rid: str, request: Request, user: dict = Depends(require("bukti", "write"))):
    r, donor, url, s = await _share(rid, request)
    to = (donor.get("email") or "").strip()
    if "@" not in to:
        raise HTTPException(400, "Donatur belum punya alamat email. Isi di profil donatur.")
    e = escape
    subject = f"Bukti Pembayaran Donasi No. {r['number']}"
    html = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">'
            f'<p style="font-size:18px;font-weight:bold;margin:0 0 4px">{e(s.get("name", ""))}</p>'
            f'<p style="margin:0 0 20px;color:#555;font-size:12px">{e(s.get("address", ""))}</p>'
            f'<p>Yth. {e(r["donor_name"])},</p>'
            f'<p>Terima kasih atas donasi Anda sebesar <strong>{e(_rp(r["amount"]))}</strong> ({e(r["terbilang"])}) '
            f'untuk {e(", ".join(r.get("program_names") or ["Donasi umum"]))}.</p>'
            f'<p>Bukti pembayaran Dana Sosial Keagamaan Buddha Wajib <strong>No. {e(r["number"])}</strong> beserta lampiran PER-3/PJ/2023 '
            f'dapat diunduh di tautan berikut (berlaku {LINK_DAYS} hari):</p>'
            f'<p><a href="{e(url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px">Unduh Bukti Pembayaran (PDF)</a></p>'
            f'<p style="margin-top:24px">Salam,<br>{e(s.get("signer_name") or "Bendahara")}<br>{e(s.get("name", ""))}</p>'
            f'<p style="font-size:11px;color:#888;border-top:1px solid #eee;padding-top:10px">Dikirim oleh {e(s.get("name", ""))}. '
            f'Kami tidak pernah meminta kata sandi atau data kartu melalui email.</p></td></tr></table>')
    await send_email(to=to, subject=subject, html=html, reply_to=s.get("email") or None)
    await db.receipts.update_one({"id": rid}, {"$push": {"emails": {"to": to, "at": now_iso(), "by": user["name"]}}})
    await audit(user, "email_bukti", "bukti", rid, f"Mengirim bukti {r['number']} ke {to}")
    return EmailResult(sent_to=to)
