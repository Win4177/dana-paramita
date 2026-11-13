"""Voucher BKM/BKK/BBM/BBK per mutasi. Number = TYPE/seq/MM/YYYY, seq atomic per type per month of the
transaction. Expenses above settings.approval_threshold wait for Admin approval before they are final."""

import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pymongo import ReturnDocument
from reportlab.lib.pagesizes import A5, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from lib.auth import require
from lib.common import audit, new_id, now_iso
from lib.db import db
from lib.receipt_pdf import FONT, _bold
from lib.terbilang import terbilang
from models.schemas import CancelIn, Mutasi, Voucher, VoucherIssueIn, VoucherIssueResult
from routers.mutasi import VOUCHER, to_model

router = APIRouter()
TITLES = {"BKM": "BUKTI KAS MASUK", "BKK": "BUKTI KAS KELUAR", "BBM": "BUKTI BANK MASUK", "BBK": "BUKTI BANK KELUAR"}


async def _seq(vtype: str, month: str) -> int:
    doc = await db.counters.find_one_and_update({"_id": f"voucher-{vtype}-{month}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return int(doc["seq"])


@router.get("/vouchers", response_model=list[Voucher])
async def list_vouchers(type: str = "", month: str = "", status: str = "", _: dict = Depends(require("voucher"))):
    f = {k: v for k, v in (("type", type), ("month", month), ("status", status)) if v}
    return [Voucher(**v) for v in await db.vouchers.find(f, {"_id": 0}).sort([("month", -1), ("type", 1), ("seq", -1)]).to_list(1000)]


@router.get("/vouchers/pending-mutasi", response_model=list[Mutasi])
async def pending(month: str = "", _: dict = Depends(require("voucher"))):
    f: dict = {"voucher_id": None}
    if month:
        f["date"] = {"$regex": f"^{month}"}
    return [to_model(d) for d in await db.mutasi.find(f, {"_id": 0}).sort([("date", -1), ("ord", -1)]).limit(300).to_list(300)]


@router.post("/vouchers/issue", response_model=VoucherIssueResult)
async def issue(body: VoucherIssueIn, user: dict = Depends(require("voucher", "write"))):
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    threshold = float(s.get("approval_threshold", 20_000_000))
    out = []
    for mid in dict.fromkeys(body.mutasi_ids):
        vid = new_id()
        d = await db.mutasi.find_one_and_update({"id": mid, "voucher_id": None}, {"$set": {"voucher_id": vid}}, projection={"_id": 0})
        if not d:
            continue  # unknown or already has a voucher (double click / parallel run)
        vtype = VOUCHER[(d.get("channel", "bank"), d["direction"])]
        month = d["date"][:7]
        seq = await _seq(vtype, month)
        needs = d["direction"] == "DB" and d["amount"] > threshold
        allocs = d.get("allocations") or []
        v = {"id": vid, "number": f"{vtype}/{seq:03d}/{month[5:]}/{month[:4]}", "type": vtype, "seq": seq, "month": month, "mutasi_id": mid,
             "date": d["date"], "description": d["description"], "party": ", ".join(a.get("donor_name") or a.get("program_name", "") for a in allocs if a.get("donor_name") or a.get("program_name")) or d.get("sender_name", ""),
             "amount": d["amount"], "status": "menunggu" if needs else "disetujui", "needs_approval": needs, "created_by": user["name"], "created_at": now_iso()}
        await db.vouchers.insert_one(dict(v))
        await db.mutasi.update_one({"id": mid}, {"$set": {"voucher_number": v["number"]}})
        await audit(user, "buat_voucher", "voucher", vid, f"Voucher {v['number']} Rp {d['amount']:,.0f}" + (" (menunggu persetujuan)" if needs else ""))
        out.append(Voucher(**v))
    return VoucherIssueResult(issued=out, skipped=len(set(body.mutasi_ids)) - len(out))


@router.post("/vouchers/{vid}/approve", response_model=Voucher)
async def approve(vid: str, user: dict = Depends(require("voucher", "write"))):
    if user["role"] != "admin":
        raise HTTPException(403, "Persetujuan hanya oleh Admin/Ketua/Bendahara")
    v = await db.vouchers.find_one_and_update({"id": vid, "status": "menunggu"}, {"$set": {"status": "disetujui", "approved_by": user["name"], "approved_at": now_iso()}},
                                              projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not v:
        raise HTTPException(400, "Voucher tidak menunggu persetujuan")
    await audit(user, "setujui_voucher", "voucher", vid, f"Menyetujui voucher {v['number']} Rp {v['amount']:,.0f}")
    return Voucher(**v)


@router.post("/vouchers/{vid}/cancel", response_model=Voucher)
async def cancel(vid: str, body: CancelIn, user: dict = Depends(require("voucher", "delete"))):
    v = await db.vouchers.find_one_and_update({"id": vid, "status": {"$ne": "batal"}}, {"$set": {"status": "batal", "cancel_reason": body.reason.strip()}},
                                              projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not v:
        raise HTTPException(400, "Voucher tidak ditemukan atau sudah batal")
    await db.mutasi.update_one({"id": v["mutasi_id"], "voucher_id": vid}, {"$set": {"voucher_id": None, "voucher_number": ""}})
    await audit(user, "batal_voucher", "voucher", vid, f"Membatalkan voucher {v['number']}: {body.reason.strip()}")
    return Voucher(**v)


@router.get("/vouchers/{vid}/pdf")
async def voucher_pdf(vid: str, _: dict = Depends(require("voucher"))):
    v = await db.vouchers.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Voucher tidak ditemukan")
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    buf = io.BytesIO()
    W, H = landscape(A5)
    c = canvas.Canvas(buf, pagesize=(W, H))
    L, R = 12 * mm, W - 12 * mm
    _bold(c, L, H - 14 * mm, (s.get("name") or "").upper(), 12)
    c.setFont(FONT, 8)
    c.drawString(L, H - 19 * mm, s.get("address", "")[:110])
    c.line(L, H - 22 * mm, R, H - 22 * mm)
    _bold(c, W / 2, H - 32 * mm, TITLES[v["type"]], 15, centered=True)
    c.setFont(FONT, 10)
    c.drawCentredString(W / 2, H - 38 * mm, f"No. {v['number']}   ·   Tanggal {v['date'][8:]}/{v['date'][5:7]}/{v['date'][:4]}")
    y = H - 50 * mm
    rows = [("Dibayar kepada / Diterima dari" if v["type"] in ("BKK", "BBK") else "Diterima dari", v["party"] or "-"), ("Keterangan", v["description"]),
            ("Jumlah", "Rp " + f"{v['amount']:,.0f}".replace(",", ".")), ("Terbilang", "# " + terbilang(v["amount"]).title() + " #")]
    for label, val in rows:
        c.setFont(FONT, 9)
        c.drawString(L, y, label)
        c.setFont(FONT, 10.5)
        c.drawString(L + 50 * mm, y, ": " + val[:80])
        y -= 8 * mm
    y -= 8 * mm
    for i, (role, name) in enumerate((("Dibuat oleh", v["created_by"]), ("Disetujui oleh", v["approved_by"] if v["needs_approval"] else s.get("signer_name", "")), ("Penerima", ""))):
        x = L + 20 * mm + i * 62 * mm
        c.setFont(FONT, 9)
        c.drawCentredString(x, y, role)
        c.drawCentredString(x, y - 22 * mm, f"( {name or '.' * 26} )")
    if v["status"] != "disetujui":
        c.setFillColorRGB(0.85, 0.1, 0.1)
        _bold(c, R - 40 * mm, H - 32 * mm, "BATAL" if v["status"] == "batal" else "MENUNGGU PERSETUJUAN", 9, c._fillColorObj)
    c.showPage()
    c.save()
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{v["number"].replace("/", "_")}.pdf"'})
