import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.auth import current_user, require
from lib.common import audit, new_id, now_iso
from lib.db import db
from lib.dates import today_iso
from lib.stats import channel_totals, monthly
from models.schemas import AuditEntry, AuditPage, Dashboard, ParserTemplate, ParserTemplateIn, Settings, TaskItem
from routers.programs import all_programs

router = APIRouter()


@router.get("/settings", response_model=Settings)
async def get_settings(_: dict = Depends(current_user)):
    return Settings(**(await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}))


@router.put("/settings", response_model=Settings)
async def put_settings(body: Settings, user: dict = Depends(require("pengaturan", "write"))):
    old = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    data = body.model_dump()
    await db.settings.update_one({"id": "foundation"}, {"$set": data}, upsert=True)
    changed = [k for k, v in data.items() if old.get(k) != v]
    await audit(user, "ubah", "pengaturan", "foundation", f"Mengubah pengaturan: {', '.join(changed) or '-'}")
    return body


@router.get("/parser-templates", response_model=list[ParserTemplate])
async def list_templates(_: dict = Depends(require("mutasi"))):
    return [ParserTemplate(**t) for t in await db.parser_templates.find({}, {"_id": 0}).sort("name", 1).to_list(100)]


async def _save_template(tid: str, body: ParserTemplateIn, user: dict, action: str) -> ParserTemplate:
    if not body.col_amount and not (body.col_debit or body.col_credit):
        raise HTTPException(400, "Isi kolom Jumlah, atau kolom Debit/Kredit")
    if body.is_default:
        await db.parser_templates.update_many({}, {"$set": {"is_default": False}})
    await db.parser_templates.update_one({"id": tid}, {"$set": {"id": tid, **body.model_dump()}}, upsert=True)
    await audit(user, action, "parser_bank", tid, f"{action.capitalize()} template parser {body.name}")
    return ParserTemplate(id=tid, **body.model_dump())


@router.post("/parser-templates", response_model=ParserTemplate)
async def create_template(body: ParserTemplateIn, user: dict = Depends(require("pengaturan", "write"))):
    return await _save_template(new_id(), body, user, "buat")


@router.put("/parser-templates/{tid}", response_model=ParserTemplate)
async def update_template(tid: str, body: ParserTemplateIn, user: dict = Depends(require("pengaturan", "write"))):
    if not await db.parser_templates.find_one({"id": tid}):
        raise HTTPException(404, "Template tidak ditemukan")
    return await _save_template(tid, body, user, "ubah")


@router.delete("/parser-templates/{tid}")
async def delete_template(tid: str, user: dict = Depends(require("pengaturan", "delete"))):
    t = await db.parser_templates.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Template tidak ditemukan")
    if t.get("is_default"):
        raise HTTPException(400, "Template default tidak dapat dihapus")
    await db.parser_templates.delete_one({"id": tid})
    await audit(user, "hapus", "parser_bank", tid, f"Menghapus template parser {t['name']}")
    return {"ok": True}


@router.get("/settings/backup")
async def backup(user: dict = Depends(require("pengaturan", "delete"))):
    out = {"exported_at": now_iso()}
    for col in ("settings", "users", "donors", "programs", "mutasi", "sender_map", "parser_templates", "imports", "audit_logs"):
        proj = {"_id": 0, "password_hash": 0, "pin_hash": 0} if col == "users" else {"_id": 0}
        out[col] = await db[col].find({}, proj).to_list(None)
    await audit(user, "backup", "pengaturan", "backup", "Mengunduh backup seluruh data")
    body = json.dumps(out, ensure_ascii=False, indent=1, default=str)
    return Response(body, media_type="application/json; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="backup_paramita_{today_iso()}.json"'})


@router.get("/dashboard", response_model=Dashboard)
async def dashboard(_: dict = Depends(require("dashboard"))):
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    today = today_iso()
    month = today[:7]
    bcr, bdb = await channel_totals("bank")
    kcr, kdb = await channel_totals("kas")
    sums = {r["_id"]: r["s"] async for r in db.mutasi.aggregate([
        {"$match": {"date": {"$regex": f"^{month}"}}}, {"$group": {"_id": "$direction", "s": {"$sum": "$amount"}}}])}
    uncategorized = await db.mutasi.count_documents({"direction": "CR", "allocations": {"$size": 0}})
    perlu = await db.mutasi.count_documents({"status": "perlu"})
    belum = await db.mutasi.count_documents({"status": "belum"})
    suggested = await db.mutasi.count_documents({"suggested": True})
    janggal = await db.mutasi.count_documents({"ai_anomaly": {"$gte": 0.75}, "status": {"$ne": "ok"}})
    from routers.receipts import ELIGIBLE_Q
    bukti = await db.mutasi.count_documents(ELIGIBLE_Q)
    tasks = [
        TaskItem(key="uncategorized", label="Mutasi masuk belum dikategorikan", count=uncategorized, link="/mutasi?uncategorized=1", severity="danger"),
        TaskItem(key="suggested", label="Saran otomatis menunggu konfirmasi", count=suggested, link="/mutasi?suggested=1", severity="info"),
        TaskItem(key="janggal", label="Transaksi janggal menurut AI belum dicek", count=janggal, link="/mutasi?janggal=1", severity="danger"),
        TaskItem(key="bukti", label="Donasi Sudah OK belum diterbitkan bukti", count=bukti, link="/bukti", severity="info"),
        TaskItem(key="perlu", label="Mutasi berstatus Perlu cek", count=perlu, link="/mutasi?status=perlu", severity="warning"),
        TaskItem(key="belum", label="Mutasi belum dicek (OK)", count=belum, link="/mutasi?status=belum", severity="warning"),
    ]
    return Dashboard(
        today=today,
        bank_balance=float(s.get("opening_bank_balance", 0)) + bcr - bdb,
        cash_balance=float(s.get("opening_cash_balance", 0)) + kcr - kdb,
        donasi_bulan_ini=sums.get("CR", 0), pengeluaran_bulan_ini=sums.get("DB", 0),
        total_donatur=await db.donors.count_documents({}),
        mutasi_belum_kategori=uncategorized, mutasi_perlu_cek=perlu, mutasi_belum_cek=belum,
        programs=await all_programs(), tasks=[t for t in tasks if t.count], monthly=await monthly(months=6),
    )


@router.get("/audit", response_model=AuditPage)
async def audit_log(q: str = "", entity: str = "", skip: int = 0, limit: int = 50, _: dict = Depends(require("audit"))):
    f: dict = {}
    if entity:
        f["entity"] = entity
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        f["$or"] = [{"summary": rx}, {"user_name": rx}, {"action": rx}]
    total = await db.audit_logs.count_documents(f)
    items = await db.audit_logs.find(f, {"_id": 0}).sort("at", -1).skip(skip).limit(min(limit, 200)).to_list(200)
    return AuditPage(items=[AuditEntry(**i) for i in items], total=total)
