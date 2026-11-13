"""Mutasi rekening: import (bank file or round-trip export), inline categorize, split,
suggestions learned from history, export xlsx, reconciliation."""

import io
import re
import time
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from lib.auth import require
from lib.bank_parser import find_header, parse_date, parse_number, parse_statement, read_rows, row_hash
from lib.common import audit, new_id, norm, now_iso
from lib.db import db
from lib.jev import analyze_in_background, analyze_many
from routers.files import store_bytes
from lib.stats import channel_totals
from models.schemas import (
    AiAnalyzeIn, AiAnalyzeResult, Allocation, BulkStatusIn, ImportRecord, ImportResult, Mutasi, MutasiPage, MutasiPatch, Reconciliation, SplitIn,
)

router = APIRouter()

VOUCHER = {("bank", "CR"): "BBM", ("bank", "DB"): "BBK", ("kas", "CR"): "BKM", ("kas", "DB"): "BKK"}
STATUS_LABEL = {"belum": "Belum cek", "ok": "Sudah OK", "perlu": "Perlu cek"}
LABEL_STATUS = {norm(v): k for k, v in STATUS_LABEL.items()} | {"ok": "ok", "belum": "belum", "perlu": "perlu"}
JENIS = {"donasi", "cicilan", "lainnya"}


def to_model(d: dict) -> Mutasi:
    return Mutasi(**{**d, "voucher_type": VOUCHER[(d.get("channel", "bank"), d["direction"])]})


def donor_label(d: dict) -> str:
    return " ".join(x for x in [d.get("name_latin", ""), d.get("name_mandarin", "")] if x).strip()


async def resolve_allocation(a: dict) -> dict:
    """Fill donor/program names from ids (authoritative)."""
    if a.get("donor_id"):
        d = await db.donors.find_one({"id": a["donor_id"]}, {"_id": 0, "name_latin": 1, "name_mandarin": 1})
        if not d:
            raise HTTPException(400, "Donatur tidak ditemukan")
        a["donor_name"] = donor_label(d)
    else:
        a["donor_id"], a["donor_name"] = None, a.get("donor_name", "") if not a.get("donor_id") else ""
    if a.get("program_id"):
        p = await db.programs.find_one({"id": a["program_id"]}, {"_id": 0, "name": 1})
        if not p:
            raise HTTPException(400, "Program tidak ditemukan")
        a["program_name"] = p["name"]
    else:
        a["program_id"], a["program_name"] = None, ""
    return a


def scale(template: list[dict], amount: float) -> list[dict]:
    total = sum(a["amount"] for a in template) or 1
    if abs(total - amount) < 0.01:
        return [dict(a) for a in template]
    out, used = [], 0.0
    for i, a in enumerate(template):
        amt = round(amount - used, 2) if i == len(template) - 1 else round(amount * a["amount"] / total)
        used += amt
        out.append({**a, "amount": amt})
    return out


async def suggest(sender: str, amount: float, direction: str) -> list[dict]:
    if direction != "CR" or not sender:
        return []
    key = norm(sender)
    m = await db.sender_map.find_one({"key": key}, {"_id": 0})
    if m and m.get("allocations"):
        return scale(m["allocations"], amount)
    donors = await db.donors.find({"bank_accounts_norm": key}, {"_id": 0}).to_list(2)
    if len(donors) == 1:
        return [{"donor_id": donors[0]["id"], "donor_name": donor_label(donors[0]), "program_id": None, "program_name": "", "jenis": "donasi", "amount": amount, "notes": ""}]
    return []


async def learn(doc: dict) -> None:
    """Remember sender → donors/programs, and link sender account to each donor (N:N)."""
    allocs = [a for a in doc.get("allocations", []) if a.get("donor_id") or a.get("program_id")]
    if doc["direction"] != "CR" or not doc.get("sender_name") or not allocs:
        return
    key = norm(doc["sender_name"])
    tmpl = [{k: a.get(k) for k in ("donor_id", "donor_name", "program_id", "program_name", "jenis", "amount")} | {"notes": ""} for a in allocs]
    await db.sender_map.update_one({"key": key}, {"$set": {"key": key, "sender_name": doc["sender_name"], "allocations": tmpl, "updated_at": now_iso()}}, upsert=True)
    for a in allocs:
        if a.get("donor_id"):
            await db.donors.update_one({"id": a["donor_id"]}, {"$addToSet": {"bank_accounts": doc["sender_name"], "bank_accounts_norm": key}})


ANOMALY = 0.75


def locked(d: dict) -> bool:
    return any(a.get("receipt_id") for a in d.get("allocations", []))


def ensure_unlocked(d: dict) -> None:
    if locked(d):
        nums = ", ".join(a.get("receipt_number", "") for a in d["allocations"] if a.get("receipt_id"))
        raise HTTPException(400, f"Alokasi sudah diterbitkan bukti pembayaran ({nums}). Batalkan bukti terlebih dahulu.")


def build_filter(q: str, status: str, direction: str, channel: str, uncategorized: bool, date_from: str, date_to: str, suggested: bool = False, janggal: bool = False) -> dict:
    f: dict = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f["$or"] = [{"description": rx}, {"sender_name": rx}, {"allocations.donor_name": rx}, {"allocations.program_name": rx}, {"notes": rx}]
        num = parse_number(q, "auto")
        if num and re.fullmatch(r"[\d.,]+", q.strip()):
            f["$or"].append({"amount": num})
    if status:
        f["status"] = status
    if direction:
        f["direction"] = direction
    if channel:
        f["channel"] = channel
    if uncategorized:
        f["allocations"] = {"$size": 0}
    if suggested:
        f["suggested"] = True
    if janggal:
        f["ai_anomaly"] = {"$gte": ANOMALY}
    if date_from or date_to:
        f["date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    return f


@router.get("/mutasi", response_model=MutasiPage)
async def list_mutasi(
    q: str = "", status: str = "", direction: str = "", channel: str = "", uncategorized: bool = False,
    suggested: bool = False, janggal: bool = False, date_from: str = "", date_to: str = "", skip: int = 0, limit: int = 50,
    _: dict = Depends(require("mutasi")),
):
    f = build_filter(q, status, direction, channel, uncategorized, date_from, date_to, suggested, janggal)
    total = await db.mutasi.count_documents(f)
    docs = await db.mutasi.find(f, {"_id": 0}).sort([("date", -1), ("ord", -1)]).skip(skip).limit(min(limit, 500)).to_list(500)
    sums = {r["_id"]: r["s"] async for r in db.mutasi.aggregate([{"$match": f}, {"$group": {"_id": "$direction", "s": {"$sum": "$amount"}}}])}
    return MutasiPage(items=[to_model(d) for d in docs], total=total, sum_cr=sums.get("CR", 0), sum_db=sums.get("DB", 0))


@router.get("/mutasi/reconciliation", response_model=Reconciliation)
async def reconciliation(channel: str = "bank", _: dict = Depends(require("mutasi"))):
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    opening = float(s.get("opening_bank_balance" if channel == "bank" else "opening_cash_balance", 0))
    cr, dbt = await channel_totals(channel)
    book = opening + cr - dbt
    last = await db.mutasi.find_one({"channel": channel, "balance": {"$ne": None}}, {"_id": 0}, sort=[("date", -1), ("ord", -1)])
    bank_bal = last["balance"] if last else None
    return Reconciliation(
        channel=channel, last_date=last["date"] if last else None, bank_balance=bank_bal, opening_balance=opening,
        total_cr=cr, total_db=dbt, book_balance=book, difference=(round(bank_bal - book, 2) if bank_bal is not None else None),
    )


async def import_bank(rows: list[list], template_id: str | None, import_id: str, user: dict) -> ImportResult:
    tpl = None
    if template_id:
        tpl = await db.parser_templates.find_one({"id": template_id}, {"_id": 0})
    tpl = tpl or await db.parser_templates.find_one({"is_default": True}, {"_id": 0})
    if not tpl:
        raise HTTPException(400, "Belum ada template parser. Atur di Pengaturan → Parser Bank.")
    txs, errors = parse_statement(rows, tpl)
    hashes = [t["hash"] for t in txs]
    existing = {d["hash"] async for d in db.mutasi.find({"hash": {"$in": hashes}}, {"hash": 1})}
    base, docs, dup, sug, seen = int(time.time() * 1000) * 10000, [], 0, 0, set()
    for i, t in enumerate(txs):
        if t["hash"] in existing or t["hash"] in seen:
            dup += 1
            continue
        seen.add(t["hash"])
        allocs = await suggest(t["sender_name"], t["amount"], t["direction"])
        sug += bool(allocs)
        docs.append({
            "id": new_id(), **t, "channel": "bank", "status": "belum", "notes": "", "allocations": allocs,
            "suggested": bool(allocs), "import_id": import_id, "ord": base + i, "created_at": now_iso(),
        })
    if docs:
        await db.mutasi.insert_many(docs)
        analyze_in_background([d["id"] for d in docs])
    return ImportResult(import_id=import_id, mode="bank", total_rows=len(txs), inserted=len(docs), duplicates=dup, updated=0, suggested=sug, errors=errors)


async def _lookup_donor(donor_id: str, name: str) -> dict | None:
    if donor_id:
        d = await db.donors.find_one({"id": donor_id}, {"_id": 0})
        if d:
            return d
    if name:
        n = name.strip()
        return await db.donors.find_one({"$or": [{"name_latin": {"$regex": f"^{re.escape(n)}$", "$options": "i"}}, {"name_mandarin": n}, {"search_text": norm(n)}]}, {"_id": 0})
    return None


async def _lookup_program(pid: str, name: str) -> dict | None:
    if pid:
        p = await db.programs.find_one({"id": pid}, {"_id": 0})
        if p:
            return p
    if name:
        return await db.programs.find_one({"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}, {"_id": 0})
    return None


async def import_roundtrip(rows: list[list], header_idx: int, import_id: str, user: dict) -> ImportResult:
    header = [norm(str(c or "")) for c in rows[header_idx]]

    def get(row, name):
        k = norm(name)
        return row[header.index(k)] if k in header and header.index(k) < len(row) else None

    groups: dict[str, list] = {}
    for row in rows[header_idx + 1:]:
        h = str(get(row, "ID Mutasi") or "").strip()
        if h:
            groups.setdefault(h, []).append(row)
    errors, inserted, updated, base = [], 0, 0, int(time.time() * 1000) * 10000
    for i, (h, grp) in enumerate(groups.items()):
        first = grp[0]
        allocs = []
        for r in grp:
            amt = parse_number(get(r, "Nominal Alokasi"))
            dname, pname = str(get(r, "Donatur") or "").strip(), str(get(r, "Program") or "").strip()
            if not amt and not dname and not pname:
                continue
            donor = await _lookup_donor(str(get(r, "ID Donatur") or ""), dname)
            prog = await _lookup_program(str(get(r, "ID Program") or ""), pname)
            if dname and not donor:
                errors.append(f"{h[:8]}: donatur '{dname}' tidak ditemukan (disimpan sebagai teks)")
            jenis = norm(str(get(r, "Jenis") or "donasi"))
            allocs.append({
                "donor_id": donor["id"] if donor else None, "donor_name": donor_label(donor) if donor else dname,
                "program_id": prog["id"] if prog else None, "program_name": prog["name"] if prog else "",
                "jenis": jenis if jenis in JENIS else "donasi", "amount": amt or 0, "notes": str(get(r, "Catatan Alokasi") or ""),
            })
        status = LABEL_STATUS.get(norm(str(get(first, "Status") or "")), "belum")
        channel = "kas" if norm(str(get(first, "Kanal") or "")) == "kas" else "bank"
        notes = str(get(first, "Catatan") or "")
        existing = await db.mutasi.find_one({"hash": h}, {"_id": 0})
        if existing and locked(existing):
            errors.append(f"{h[:8]}: sudah ada bukti pembayaran, alokasi tidak diubah")
            continue
        if existing:
            await db.mutasi.update_one({"hash": h}, {"$set": {"allocations": allocs, "status": status, "channel": channel, "notes": notes, "suggested": False}})
            updated += 1
            doc = {**existing, "allocations": allocs}
        else:
            d = parse_date(get(first, "Tanggal"), datetime.now().year)
            amount = parse_number(get(first, "Nominal"))
            direction = "DB" if norm(str(get(first, "Mutasi") or "")) in ("db", "debit", "keluar") else "CR"
            if not d or not amount:
                errors.append(f"{h[:8]}: tanggal/nominal tidak valid, dilewati")
                continue
            doc = {
                "id": new_id(), "hash": h, "date": d, "description": str(get(first, "Keterangan") or ""),
                "sender_name": str(get(first, "Pengirim") or ""), "direction": direction, "amount": amount,
                "balance": parse_number(get(first, "Saldo")), "channel": channel, "status": status, "notes": notes,
                "allocations": allocs, "suggested": False, "import_id": import_id, "ord": base + i, "created_at": now_iso(),
            }
            await db.mutasi.insert_one(doc)
            inserted += 1
        await learn(doc)
    return ImportResult(import_id=import_id, mode="roundtrip", total_rows=len(groups), inserted=inserted, duplicates=0, updated=updated, suggested=0, errors=errors)


@router.post("/mutasi/import", response_model=ImportResult)
async def import_file(file: UploadFile = File(...), template_id: str = Form(""), user: dict = Depends(require("mutasi", "write"))):
    name = file.filename or "upload"
    if not name.lower().endswith((".xlsx", ".xlsm", ".csv", ".txt")):
        raise HTTPException(400, "Format file harus .xlsx atau .csv")
    content = await file.read()
    try:
        rows = read_rows(content, name)
    except Exception as exc:  # corrupt workbook etc.
        raise HTTPException(400, f"File tidak dapat dibaca: {exc}")
    import_id = new_id()
    rt_header = find_header(rows, ["ID Mutasi", "Nominal Alokasi"])
    if rt_header is not None:
        res = await import_roundtrip(rows, rt_header, import_id, user)
    else:
        res = await import_bank(rows, template_id or None, import_id, user)

    ext = name.rsplit(".", 1)[-1].lower()
    ctype = {"csv": "text/csv", "txt": "text/plain"}.get(ext, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    try:
        file_id = (await store_bytes(content, name, ext, ctype, "mutasi", import_id, user))["id"]
    except HTTPException:  # archiving the original must never block the import itself
        file_id = None
    await db.imports.insert_one({"id": import_id, "filename": name, "at": now_iso(), "user": user["name"], "file_id": file_id, **res.model_dump(exclude={"import_id"})})
    await audit(user, "impor", "mutasi", import_id, f"Impor {name} ({res.mode}): {res.inserted} baru, {res.updated} diperbarui, {res.duplicates} duplikat dilewati")
    return res


@router.get("/mutasi/imports", response_model=list[ImportRecord])
async def list_imports(_: dict = Depends(require("mutasi"))):
    return [ImportRecord(**d) for d in await db.imports.find({}, {"_id": 0}).sort("at", -1).to_list(100)]


@router.post("/mutasi/ai-analyze", response_model=AiAnalyzeResult)
async def ai_analyze(body: AiAnalyzeIn, user: dict = Depends(require("mutasi", "write"))):
    f: dict = {"id": {"$in": body.ids}} if body.ids else {}
    if body.only_new:
        f["ai_status"] = {"$in": [None, "", "fallback"]}
    ids = [d["id"] async for d in db.mutasi.find(f, {"id": 1}).sort([("date", -1)]).limit(60)]
    res = await analyze_many(ids)
    await audit(user, "analisis_ai", "mutasi", ",".join(ids[:20]), f"Analisis AI {res['processed']} mutasi: {res['matched']} donatur dicocokkan, {res['flagged']} ditandai perlu cek, {res['failed']} gagal")
    return AiAnalyzeResult(**res)


@router.get("/mutasi/export")
async def export_mutasi(
    q: str = "", status: str = "", direction: str = "", channel: str = "", uncategorized: bool = False,
    date_from: str = "", date_to: str = "", _: dict = Depends(require("mutasi")),
):
    f = build_filter(q, status, direction, channel, uncategorized, date_from, date_to)
    wb = Workbook()
    ws = wb.active
    ws.title = "Mutasi"
    headers = ["ID Mutasi", "Tanggal", "Keterangan", "Pengirim", "Mutasi", "Nominal", "Saldo", "Kanal", "Voucher", "Status",
               "Catatan", "Program", "Donatur", "Jenis", "Nominal Alokasi", "Catatan Alokasi", "ID Program", "ID Donatur"]
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="141D24")
    async for d in db.mutasi.find(f, {"_id": 0}).sort([("date", 1), ("ord", 1)]):
        y, m, dd = d["date"].split("-")
        base = [d["hash"], f"{dd}/{m}/{y}", d["description"], d["sender_name"], d["direction"], d["amount"], d.get("balance"),
                d.get("channel", "bank"), VOUCHER[(d.get("channel", "bank"), d["direction"])], STATUS_LABEL[d["status"]], d.get("notes", "")]
        allocs = d.get("allocations") or [None]
        for a in allocs:
            if a:
                ws.append(base + [a.get("program_name", ""), a.get("donor_name", ""), a.get("jenis", ""), a["amount"], a.get("notes", ""), a.get("program_id") or "", a.get("donor_id") or ""])
            else:
                ws.append(base + ["", "", "", None, "", "", ""])
    for col, w in zip("ABCDEFGHIJKLMNOPQR", [14, 12, 48, 24, 8, 16, 16, 8, 9, 11, 20, 24, 28, 10, 16, 20, 14, 14]):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2):
        for idx in (5, 6, 14):
            row[idx].number_format = "#,##0.00"
    ws.freeze_panes = "B2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"mutasi_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/mutasi/bulk-status")
async def bulk_status(body: BulkStatusIn, user: dict = Depends(require("mutasi", "write"))):
    upd: dict = {"status": body.status}
    if body.status == "ok":
        upd["suggested"] = False
    res = await db.mutasi.update_many({"id": {"$in": body.ids}}, {"$set": upd})
    if body.status == "ok":
        async for d in db.mutasi.find({"id": {"$in": body.ids}}, {"_id": 0}):
            await learn(d)
    await audit(user, "status_massal", "mutasi", ",".join(body.ids[:20]), f"Ubah status {res.modified_count} mutasi → {STATUS_LABEL[body.status]}")
    return {"updated": res.modified_count}


async def _get(mid: str) -> dict:
    d = await db.mutasi.find_one({"id": mid}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mutasi tidak ditemukan")
    return d


@router.patch("/mutasi/{mid}", response_model=Mutasi)
async def patch_mutasi(mid: str, body: MutasiPatch, user: dict = Depends(require("mutasi", "write"))):
    d = await _get(mid)
    upd: dict = {}
    changes = []
    for k in ("status", "channel", "notes", "sender_name"):
        v = getattr(body, k)
        if v is not None and v != d.get(k):
            upd[k] = v.strip().upper() if k == "sender_name" else v
            changes.append(f"{k}: {d.get(k)!s} → {v}")
    if body.clear_allocation or body.donor_id is not None or body.program_id is not None or body.jenis is not None:
        ensure_unlocked(d)
    if body.clear_allocation:
        upd["allocations"], upd["suggested"] = [], False
        changes.append("alokasi dikosongkan")
    elif body.donor_id is not None or body.program_id is not None or body.jenis is not None:
        if len(d["allocations"]) > 1:
            raise HTTPException(400, "Mutasi ini sudah di-split. Ubah alokasi lewat tombol Split.")
        a = dict(d["allocations"][0]) if d["allocations"] else {"donor_id": None, "program_id": None, "jenis": "donasi", "amount": d["amount"], "notes": ""}
        a["amount"] = d["amount"]
        if body.donor_id is not None:
            a["donor_id"] = body.donor_id or None
            if not body.donor_id:
                a["donor_name"] = ""
        if body.program_id is not None:
            a["program_id"] = body.program_id or None
        if body.jenis is not None:
            a["jenis"] = body.jenis
        a = await resolve_allocation(a)
        upd["allocations"], upd["suggested"] = [a], False
        changes.append(f"alokasi: {a['donor_name'] or '-'} / {a['program_name'] or '-'} / {a['jenis']}")
    if body.status == "ok":
        upd["suggested"] = False
    if upd:
        await db.mutasi.update_one({"id": mid}, {"$set": upd})
        d = {**d, **upd}
        if "allocations" in upd or body.status == "ok":
            await learn(d)
        await audit(user, "ubah", "mutasi", mid, f"Mutasi {d['date']} Rp {d['amount']:,.0f}: " + "; ".join(changes), {"changes": changes})
    return to_model(d)


@router.post("/mutasi/{mid}/split", response_model=Mutasi)
async def split_mutasi(mid: str, body: SplitIn, user: dict = Depends(require("mutasi", "write"))):
    d = await _get(mid)
    ensure_unlocked(d)
    total = round(sum(a.amount for a in body.allocations), 2)
    if abs(total - d["amount"]) > 0.005:
        raise HTTPException(400, f"Jumlah split Rp {total:,.2f} tidak sama dengan nominal mutasi Rp {d['amount']:,.2f} (selisih Rp {d['amount'] - total:,.2f})")
    if any(a.amount <= 0 for a in body.allocations):
        raise HTTPException(400, "Setiap baris split harus bernilai lebih dari 0")
    allocs = [await resolve_allocation(a.model_dump()) for a in body.allocations]
    await db.mutasi.update_one({"id": mid}, {"$set": {"allocations": allocs, "suggested": False}})
    d = {**d, "allocations": allocs, "suggested": False}
    await learn(d)
    await audit(user, "split", "mutasi", mid, f"Split mutasi {d['date']} Rp {d['amount']:,.0f} ke {len(allocs)} alokasi", {"allocations": allocs})
    return to_model(d)


@router.post("/mutasi/{mid}/confirm", response_model=Mutasi)
async def confirm_suggestion(mid: str, user: dict = Depends(require("mutasi", "write"))):
    d = await _get(mid)
    await db.mutasi.update_one({"id": mid}, {"$set": {"suggested": False}})
    d["suggested"] = False
    await learn(d)
    await audit(user, "konfirmasi_saran", "mutasi", mid, f"Konfirmasi saran untuk {d['sender_name']} Rp {d['amount']:,.0f}")
    return to_model(d)


@router.delete("/mutasi/{mid}")
async def delete_mutasi(mid: str, user: dict = Depends(require("mutasi", "delete"))):
    d = await _get(mid)
    ensure_unlocked(d)
    await db.mutasi.delete_one({"id": mid})
    await audit(user, "hapus", "mutasi", mid, f"Menghapus mutasi {d['date']} {d['description'][:40]} Rp {d['amount']:,.0f}", {"before": {k: v for k, v in d.items() if k != "ord"}})
    return {"ok": True}
