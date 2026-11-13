import re

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require
from lib.common import audit, decrypt, encrypt, new_id, norm, now_iso, pinyin_of, search_terms
from lib.db import db
from lib.stats import donor_stats
from models.schemas import Donor, DonorHistoryItem, DonorIn, DonorProfile, DuplicateGroup, MergeIn

router = APIRouter()


def display_name(d: dict) -> str:
    return " ".join(x for x in [d.get("name_latin", ""), d.get("name_mandarin", "")] if x).strip()


def build_doc(body: DonorIn) -> dict:
    data = body.model_dump()
    if not (data["name_latin"].strip() or data["name_mandarin"].strip()):
        raise HTTPException(400, "Isi minimal nama Latin atau nama Mandarin")
    data["bank_accounts"] = sorted({a.strip().upper() for a in data["bank_accounts"] if a.strip()})
    data["bank_accounts_norm"] = [norm(a) for a in data["bank_accounts"]]
    data["name_pinyin"] = pinyin_of(data["name_mandarin"])
    py = data["name_pinyin"]
    data["search_text"] = norm(" ".join([data["name_latin"], data["name_mandarin"], data["alias"], py, py.replace(" ", ""), " ".join(data["bank_accounts"]), data["phone"]]))
    data["npwp"] = encrypt(data["npwp"].strip())
    return data


def to_model(d: dict, stats: dict | None = None) -> Donor:
    return Donor(**{**d, "npwp": decrypt(d.get("npwp")) or "", **(stats or {})})


@router.get("/donors", response_model=list[Donor])
async def list_donors(q: str = "", limit: int = 500, _: dict = Depends(require("donatur"))):
    query: dict = {}
    if q.strip():
        query = {"$or": [{"search_text": {"$regex": re.escape(t)}} for t in search_terms(q)]}
    docs = await db.donors.find(query, {"_id": 0}).sort("name_latin", 1).to_list(limit)
    stats = await donor_stats([d["id"] for d in docs])
    return [to_model(d, stats.get(d["id"])) for d in docs]


@router.post("/donors", response_model=Donor)
async def create_donor(body: DonorIn, user: dict = Depends(require("donatur", "write"))):
    doc = {"id": new_id(), "created_at": now_iso(), **build_doc(body)}
    await db.donors.insert_one(doc)
    await audit(user, "buat", "donatur", doc["id"], f"Menambah donatur {display_name(doc)}")
    return to_model(doc)


@router.get("/donors/duplicates", response_model=list[DuplicateGroup])
async def duplicates(_: dict = Depends(require("donatur"))):
    groups: dict[str, list[dict]] = {}
    async for d in db.donors.find({}, {"_id": 0}):
        keys = set()
        if d.get("name_latin"):
            keys.add("L:" + re.sub(r"[^a-z]", "", d["name_latin"].lower()))
        if d.get("name_mandarin"):
            keys.add("M:" + d["name_mandarin"].strip())
        for k in keys:
            groups.setdefault(k, []).append(d)
    seen, out = set(), []
    for k, ds in groups.items():
        ids = tuple(sorted(x["id"] for x in ds))
        if len(ds) > 1 and ids not in seen:
            seen.add(ids)
            out.append(DuplicateGroup(key=k[2:], donors=[to_model(x) for x in ds]))
    return out


@router.post("/donors/duplicates/ai-check", response_model=list[DuplicateGroup])
async def ai_duplicates(_: dict = Depends(require("donatur"))):
    """Jev scores likely-same-person pairs that exact-name matching misses (spelling/pinyin/alias variants)."""
    from lib.jev import DUP_THRESHOLD, candidate_pairs, same_person
    exact = {tuple(sorted(d.id for d in g.donors[:2])) for g in await duplicates(_)}
    donors = await db.donors.find({}, {"_id": 0}).to_list(None)
    out = []
    for a, b in candidate_pairs(donors, exact):
        score = await same_person(a, b)
        if score is not None and score >= DUP_THRESHOLD:
            out.append(DuplicateGroup(key=f"{a.get('name_latin') or a.get('name_mandarin')} ≈ {b.get('name_latin') or b.get('name_mandarin')}", donors=[to_model(a), to_model(b)], ai_score=score))
    return sorted(out, key=lambda g: -(g.ai_score or 0))


@router.post("/donors/merge", response_model=Donor)
async def merge(body: MergeIn, user: dict = Depends(require("donatur", "delete"))):
    target = await db.donors.find_one({"id": body.target_id}, {"_id": 0})
    sources = await db.donors.find({"id": {"$in": [s for s in body.source_ids if s != body.target_id]}}, {"_id": 0}).to_list(100)
    if not target or not sources:
        raise HTTPException(400, "Donatur target/sumber tidak valid")
    accounts = set(target.get("bank_accounts", []))
    for s in sources:
        accounts |= set(s.get("bank_accounts", []))
        for f in ("name_mandarin", "alias", "phone", "address", "pic"):
            if not target.get(f) and s.get(f):
                target[f] = s[f]
        if not decrypt(target.get("npwp")) and decrypt(s.get("npwp")):
            target["npwp"] = s["npwp"]
    target["npwp"] = decrypt(target.get("npwp")) or ""
    body_in = DonorIn(**{k: target.get(k, "") for k in DonorIn.model_fields if k != "bank_accounts"}, bank_accounts=list(accounts))
    await db.donors.update_one({"id": target["id"]}, {"$set": build_doc(body_in)})
    name = display_name(target)
    for s in sources:
        await db.mutasi.update_many(
            {"allocations.donor_id": s["id"]},
            {"$set": {"allocations.$[a].donor_id": target["id"], "allocations.$[a].donor_name": name}},
            array_filters=[{"a.donor_id": s["id"]}],
        )
        await db.sender_map.update_many(
            {"allocations.donor_id": s["id"]},
            {"$set": {"allocations.$[a].donor_id": target["id"], "allocations.$[a].donor_name": name}},
            array_filters=[{"a.donor_id": s["id"]}],
        )
    await db.donors.delete_many({"id": {"$in": [s["id"] for s in sources]}})
    await audit(user, "gabung", "donatur", target["id"], f"Menggabungkan {', '.join(display_name(s) for s in sources)} ke {name}")
    doc = await db.donors.find_one({"id": target["id"]}, {"_id": 0})
    return to_model(doc, (await donor_stats([target["id"]])).get(target["id"]))


@router.get("/donors/{did}", response_model=DonorProfile)
async def donor_profile(did: str, _: dict = Depends(require("donatur"))):
    d = await db.donors.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Donatur tidak ditemukan")
    history: list[DonorHistoryItem] = []
    per_program: dict[str, dict] = {}
    async for m in db.mutasi.find({"allocations.donor_id": did}, {"_id": 0}).sort("date", -1):
        for a in m["allocations"]:
            if a.get("donor_id") != did:
                continue
            history.append(DonorHistoryItem(
                mutasi_id=m["id"], date=m["date"], description=m["description"], sender_name=m["sender_name"],
                program_id=a.get("program_id"), program_name=a.get("program_name", ""), jenis=a.get("jenis", "donasi"),
                amount=a["amount"], status=m["status"],
            ))
            key = a.get("program_name") or "(Tanpa program)"
            p = per_program.setdefault(key, {"program": key, "jenis": a.get("jenis", "donasi"), "total": 0.0, "count": 0})
            p["total"] += a["amount"]
            p["count"] += 1
    stats = (await donor_stats([did])).get(did)
    return DonorProfile(donor=to_model(d, stats), history=history, per_program=list(per_program.values()))


@router.put("/donors/{did}", response_model=Donor)
async def update_donor(did: str, body: DonorIn, user: dict = Depends(require("donatur", "write"))):
    old = await db.donors.find_one({"id": did}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Donatur tidak ditemukan")
    data = build_doc(body)
    await db.donors.update_one({"id": did}, {"$set": data})
    name = display_name(data)
    if name != display_name(old):
        await db.mutasi.update_many({"allocations.donor_id": did}, {"$set": {"allocations.$[a].donor_name": name}}, array_filters=[{"a.donor_id": did}])
    changed = [k for k in ("name_latin", "name_mandarin", "alias", "phone", "address", "bank_accounts", "pic", "notes") if old.get(k) != data.get(k)]
    if decrypt(old.get("npwp")) != body.npwp.strip():
        changed.append("npwp")
    await audit(user, "ubah", "donatur", did, f"Mengubah donatur {name}: {', '.join(changed) or 'tanpa perubahan'}")
    doc = await db.donors.find_one({"id": did}, {"_id": 0})
    return to_model(doc, (await donor_stats([did])).get(did))


@router.delete("/donors/{did}")
async def delete_donor(did: str, user: dict = Depends(require("donatur", "delete"))):
    d = await db.donors.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Donatur tidak ditemukan")
    if await db.mutasi.count_documents({"allocations.donor_id": did}, limit=1):
        raise HTTPException(400, "Donatur sudah punya riwayat donasi. Gunakan fitur gabung (merge) bila duplikat.")
    await db.donors.delete_one({"id": did})
    await audit(user, "hapus", "donatur", did, f"Menghapus donatur {display_name(d)}")
    return {"ok": True}
