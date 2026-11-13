from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require
from lib.common import audit, new_id, now_iso
from lib.db import db
from lib.stats import monthly, program_stats
from models.schemas import Program, ProgramDetail, ProgramIn

router = APIRouter()


def to_model(p: dict, stats: dict | None) -> Program:
    s = stats or {}
    collected, disbursed = s.get("collected", 0.0), s.get("disbursed", 0.0)
    return Program(**{**p, "collected": collected, "disbursed": disbursed, "remaining": collected - disbursed, "donor_count": s.get("donor_count", 0)})


async def all_programs() -> list[Program]:
    stats = await program_stats()
    docs = await db.programs.find({}, {"_id": 0}).sort([("kind", 1), ("name", 1)]).to_list(500)
    return [to_model(p, stats.get(p["id"])) for p in docs]


@router.get("/programs", response_model=list[Program])
async def list_programs(_: dict = Depends(require("program"))):
    return await all_programs()


@router.get("/programs/options", response_model=list[Program])
async def program_options(_: dict = Depends(require("mutasi"))):
    """Lightweight list for pickers (accessible to anyone with Mutasi access)."""
    return [Program(**p) for p in await db.programs.find({}, {"_id": 0}).sort("name", 1).to_list(500)]


@router.post("/programs", response_model=Program)
async def create_program(body: ProgramIn, user: dict = Depends(require("program", "write"))):
    doc = {"id": new_id(), "created_at": now_iso(), **body.model_dump()}
    await db.programs.insert_one(doc)
    await audit(user, "buat", "program", doc["id"], f"Membuat program {body.name}")
    return to_model(doc, None)


@router.get("/programs/{pid}", response_model=ProgramDetail)
async def program_detail(pid: str, _: dict = Depends(require("program"))):
    p = await db.programs.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program tidak ditemukan")
    stats = (await program_stats()).get(pid)
    pipeline = [
        {"$unwind": "$allocations"},
        {"$match": {"allocations.program_id": pid, "direction": "CR", "allocations.donor_id": {"$ne": None}}},
        {"$group": {"_id": "$allocations.donor_id", "name": {"$first": "$allocations.donor_name"}, "total": {"$sum": "$allocations.amount"}, "count": {"$sum": 1}}},
        {"$sort": {"total": -1}}, {"$limit": 10},
    ]
    top = [{"donor_id": r["_id"], "name": r["name"], "total": r["total"], "count": r["count"]} async for r in db.mutasi.aggregate(pipeline)]
    return ProgramDetail(program=to_model(p, stats), monthly=await monthly(program_id=pid, months=12), top_donors=top)


@router.put("/programs/{pid}", response_model=Program)
async def update_program(pid: str, body: ProgramIn, user: dict = Depends(require("program", "write"))):
    old = await db.programs.find_one({"id": pid}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Program tidak ditemukan")
    await db.programs.update_one({"id": pid}, {"$set": body.model_dump()})
    if old["name"] != body.name:
        await db.mutasi.update_many({"allocations.program_id": pid}, {"$set": {"allocations.$[a].program_name": body.name}}, array_filters=[{"a.program_id": pid}])
    changed = [k for k, v in body.model_dump().items() if old.get(k) != v]
    await audit(user, "ubah", "program", pid, f"Mengubah program {body.name}: {', '.join(changed) or '-'}")
    doc = await db.programs.find_one({"id": pid}, {"_id": 0})
    return to_model(doc, (await program_stats()).get(pid))


@router.delete("/programs/{pid}")
async def delete_program(pid: str, user: dict = Depends(require("program", "delete"))):
    p = await db.programs.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Program tidak ditemukan")
    if await db.mutasi.count_documents({"allocations.program_id": pid}, limit=1):
        raise HTTPException(400, "Program sudah dipakai di mutasi. Ubah status menjadi 'selesai' saja.")
    await db.programs.delete_one({"id": pid})
    await audit(user, "hapus", "program", pid, f"Menghapus program {p['name']}")
    return {"ok": True}
