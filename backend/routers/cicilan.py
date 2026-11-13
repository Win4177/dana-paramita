"""Cicilan FU / FU HUI: member list per cicilan program, donor × month matrix with arrears,
and two-step verification (rekan checks → admin confirms)."""

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require
from lib.common import audit, now_iso
from lib.dates import today_iso
from lib.db import db
from models.schemas import CheckIn, CicilanCell, CicilanMatrix, CicilanMember, CicilanRow, MembersIn, Program, Reminder
from routers.programs import all_programs

router = APIRouter()


def _label(d: dict) -> str:
    return " ".join(x for x in [d.get("name_latin", ""), d.get("name_mandarin", "")] if x)


async def _program(pid: str) -> dict:
    p = await db.programs.find_one({"id": pid, "kind": "cicilan"}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program cicilan tidak ditemukan")
    return p


@router.get("/cicilan/programs", response_model=list[Program])
async def cicilan_programs(_: dict = Depends(require("cicilan"))):
    return [p for p in await all_programs() if p.kind == "cicilan"]


@router.get("/cicilan/{pid}/members", response_model=list[CicilanMember])
async def get_members(pid: str, _: dict = Depends(require("cicilan"))):
    return [CicilanMember(**m) for m in (await _program(pid)).get("members", [])]


@router.put("/cicilan/{pid}/members", response_model=list[CicilanMember])
async def put_members(pid: str, body: MembersIn, user: dict = Depends(require("program", "write"))):
    p = await _program(pid)
    ids = [m.donor_id for m in body.members]
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "Donatur yang sama tercantum lebih dari sekali")
    donors = {d["id"]: d async for d in db.donors.find({"id": {"$in": ids}}, {"_id": 0})}
    out = []
    for m in body.members:
        if m.donor_id not in donors:
            raise HTTPException(400, f"Donatur {m.donor_id} tidak ditemukan")
        if m.end_month and m.end_month < m.start_month:
            raise HTTPException(400, f"Bulan selesai sebelum bulan mulai untuk {_label(donors[m.donor_id])}")
        out.append({**m.model_dump(), "donor_name": _label(donors[m.donor_id])})
    await db.programs.update_one({"id": pid}, {"$set": {"members": out}})
    await audit(user, "ubah", "cicilan", pid, f"Mengubah daftar anggota {p['name']}: {len(out)} anggota")
    return [CicilanMember(**m) for m in out]


@router.post("/cicilan/{pid}/members/from-payers", response_model=list[CicilanMember])
async def members_from_payers(pid: str, user: dict = Depends(require("program", "write"))):
    """Bootstrap: register every donor who ever paid into this program, using their most frequent amount."""
    p = await _program(pid)
    existing = {m["donor_id"] for m in p.get("members", [])}
    pays: dict[str, dict] = {}
    async for r in db.mutasi.aggregate([
        {"$unwind": "$allocations"}, {"$match": {"allocations.program_id": pid, "allocations.donor_id": {"$ne": None}}},
        {"$project": {"d": "$allocations.donor_id", "a": "$allocations.amount", "m": {"$substr": ["$date", 0, 7]}}},
    ]):
        e = pays.setdefault(r["d"], {"amounts": {}, "first": r["m"]})
        e["amounts"][r["a"]] = e["amounts"].get(r["a"], 0) + 1
        e["first"] = min(e["first"], r["m"])
    new = [d for d in pays if d not in existing]
    donors = {d["id"]: d async for d in db.donors.find({"id": {"$in": new}}, {"_id": 0})}
    members = list(p.get("members", []))
    for did in new:
        if did in donors:
            amt = max(pays[did]["amounts"].items(), key=lambda kv: kv[1])[0]
            members.append({"donor_id": did, "donor_name": _label(donors[did]), "monthly_amount": amt, "start_month": pays[did]["first"], "end_month": ""})
    await db.programs.update_one({"id": pid}, {"$set": {"members": members}})
    await audit(user, "ubah", "cicilan", pid, f"Mendaftarkan {len(members) - len(existing)} penyetor sebagai anggota {p['name']}")
    return [CicilanMember(**m) for m in members]


@router.get("/cicilan/{pid}/matrix", response_model=CicilanMatrix)
async def matrix(pid: str, year: int = 0, _: dict = Depends(require("cicilan"))):
    p = await _program(pid)
    today_m = today_iso()[:7]
    year = year or int(today_m[:4])
    months = [f"{year}-{i:02d}" for i in range(1, 13)]
    paid: dict[tuple[str, str], float] = {}
    names: dict[str, str] = {}
    years = {int(today_m[:4])}
    async for r in db.mutasi.aggregate([
        {"$unwind": "$allocations"}, {"$match": {"allocations.program_id": pid, "allocations.donor_id": {"$ne": None}}},
        {"$group": {"_id": {"d": "$allocations.donor_id", "m": {"$substr": ["$date", 0, 7]}}, "s": {"$sum": "$allocations.amount"}, "n": {"$first": "$allocations.donor_name"}}},
    ]):
        years.add(int(r["_id"]["m"][:4]))
        names[r["_id"]["d"]] = r["n"]
        if r["_id"]["m"][:4] == str(year):
            paid[(r["_id"]["d"], r["_id"]["m"])] = r["s"]
    checks = {(c["donor_id"], c["month"]): c async for c in db.cicilan_checks.find({"program_id": pid, "month": {"$regex": f"^{year}-"}}, {"_id": 0})}
    members = p.get("members", [])
    for m in members:
        years.add(int(m["start_month"][:4]))
    rows = []
    member_ids = {m["donor_id"] for m in members}
    extra = sorted({d for d, _ in paid if d not in member_ids}, key=lambda d: names.get(d, ""))
    for m in members + [{"donor_id": d, "donor_name": names.get(d, ""), "monthly_amount": 0, "start_month": "", "end_month": "", "_unreg": True} for d in extra]:
        cells, exp_due, total = [], 0.0, 0.0
        for mo in months:
            active = not m.get("_unreg") and m["start_month"] <= mo and (not m.get("end_month") or mo <= m["end_month"])
            expected = float(m["monthly_amount"]) if active else 0.0
            amt = paid.get((m["donor_id"], mo), 0.0)
            total += amt
            if mo <= today_m:
                exp_due += expected
            if mo > today_m and amt == 0:
                st = "mendatang"
            elif expected == 0:
                st = "lebih" if amt > 0 else "kosong"
            elif amt >= expected:
                st = "lebih" if amt > expected else "lunas"
            elif amt > 0:
                st = "kurang"
            else:
                st = "tunggak"
            c = checks.get((m["donor_id"], mo), {})
            check = "admin" if c.get("admin_by") else "rekan" if c.get("rekan_by") else "belum"
            cells.append(CicilanCell(month=mo, expected=expected, paid=amt, status=st, check=check, rekan_by=c.get("rekan_by", ""), admin_by=c.get("admin_by", "")))
        rows.append(CicilanRow(donor_id=m["donor_id"], donor_name=m.get("donor_name") or names.get(m["donor_id"], ""), registered=not m.get("_unreg"),
                               monthly_amount=float(m["monthly_amount"]), start_month=m.get("start_month", ""), end_month=m.get("end_month", ""),
                               cells=cells, total_paid=total, arrears=max(0.0, exp_due - total)))
    return CicilanMatrix(
        program_id=pid, program_name=p["name"], year=year, years=sorted(years), months=months, today_month=today_m, rows=rows,
        total_expected=sum(c.expected for r in rows for c in r.cells if c.month <= today_m),
        total_paid=sum(r.total_paid for r in rows), total_arrears=sum(r.arrears for r in rows),
    )


@router.post("/cicilan/{pid}/check", response_model=CicilanCell)
async def check(pid: str, body: CheckIn, user: dict = Depends(require("cicilan", "write"))):
    p = await _program(pid)
    key = {"program_id": pid, "donor_id": body.donor_id, "month": body.month}
    c = await db.cicilan_checks.find_one(key, {"_id": 0}) or {}
    if body.stage == "admin" and user["role"] != "admin":
        raise HTTPException(403, "Konfirmasi tahap 2 hanya oleh Admin/Ketua/Bendahara")
    if body.stage == "rekan":
        if c.get("admin_by"):
            raise HTTPException(400, "Sudah dikonfirmasi admin; batalkan konfirmasi admin terlebih dahulu")
        upd = {"rekan_by": "", "rekan_at": ""} if body.undo else {"rekan_by": user["name"], "rekan_at": now_iso()}
    else:
        if not body.undo and not c.get("rekan_by"):
            raise HTTPException(400, "Belum dicek rekan. Tahap 1 (cek rekan) wajib sebelum konfirmasi admin")
        upd = {"admin_by": "", "admin_at": ""} if body.undo else {"admin_by": user["name"], "admin_at": now_iso()}
    await db.cicilan_checks.update_one(key, {"$set": {**key, **upd}}, upsert=True)
    action = ("batal " if body.undo else "") + ("cek rekan" if body.stage == "rekan" else "konfirmasi admin")
    await audit(user, "cek_cicilan", "cicilan", pid, f"{p['name']} · {body.donor_id[:8]} · {body.month}: {action}")
    c = {**c, **upd}
    return CicilanCell(month=body.month, expected=0, paid=0, status="kosong",
                       check="admin" if c.get("admin_by") else "rekan" if c.get("rekan_by") else "belum", rekan_by=c.get("rekan_by", ""), admin_by=c.get("admin_by", ""))


BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def _rp(n: float) -> str:
    return "Rp " + f"{n:,.0f}".replace(",", ".")


async def build_reminder(pid: str) -> dict:
    """WhatsApp-ready text: members with arrears through the current month."""
    m = await matrix(pid, 0, {})
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    y, mo = m.today_month.split("-")
    overdue = [r for r in m.rows if r.registered and r.arrears > 0]
    lines = [f"*Pengingat Cicilan {m.program_name}*", f"Per {BULAN_ID[int(mo) - 1]} {y}", ""]
    if overdue:
        lines.append("Anggota dengan tunggakan:")
        for i, r in enumerate(sorted(overdue, key=lambda r: -r.arrears), 1):
            months = ", ".join(BULAN_ID[int(c.month[5:]) - 1][:3] for c in r.cells if c.status in ("tunggak", "kurang"))
            lines.append(f"{i}. {r.donor_name} — {_rp(r.arrears)} ({months})")
        lines += ["", f"Total tunggakan: *{_rp(sum(r.arrears for r in overdue))}*"]
    else:
        lines.append("Semua anggota sudah lunas sampai bulan ini. Terima kasih atas ketekunannya.")
    lines += ["", f"Setoran ke {s.get('bank_name', '')} {s.get('bank_account', '')} a.n. {s.get('bank_account_holder', '')}.",
              "Mohon abaikan bila sudah menyetor. Terima kasih, semoga berlimpah berkah."]
    doc = {"program_id": pid, "program_name": m.program_name, "month": m.today_month, "text": "\n".join(lines),
           "overdue_count": len(overdue), "total_arrears": sum(r.arrears for r in overdue), "created_at": now_iso()}
    await db.reminders.update_one({"program_id": pid, "month": m.today_month}, {"$set": doc}, upsert=True)
    return doc


@router.post("/cicilan/{pid}/reminder", response_model=Reminder)
async def make_reminder(pid: str, _: dict = Depends(require("cicilan"))):
    await _program(pid)
    return Reminder(**await build_reminder(pid))


@router.get("/cicilan/{pid}/reminder", response_model=Reminder | None)
async def latest_reminder(pid: str, _: dict = Depends(require("cicilan"))):
    d = await db.reminders.find_one({"program_id": pid}, {"_id": 0}, sort=[("month", -1)])
    return Reminder(**d) if d else None
