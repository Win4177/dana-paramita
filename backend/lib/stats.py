"""Aggregations over mutasi allocations shared by dashboard, programs and donors."""

from lib.db import db


async def program_stats() -> dict[str, dict]:
    pipeline = [
        {"$unwind": "$allocations"},
        {"$match": {"allocations.program_id": {"$ne": None}}},
        {"$group": {
            "_id": {"p": "$allocations.program_id", "d": "$direction"},
            "sum": {"$sum": "$allocations.amount"},
            "donors": {"$addToSet": "$allocations.donor_id"},
        }},
    ]
    out: dict[str, dict] = {}
    async for row in db.mutasi.aggregate(pipeline):
        pid, direction = row["_id"]["p"], row["_id"]["d"]
        s = out.setdefault(pid, {"collected": 0.0, "disbursed": 0.0, "donor_count": 0})
        if direction == "CR":
            s["collected"] += row["sum"]
            s["donor_count"] = len([d for d in row["donors"] if d])
        else:
            s["disbursed"] += row["sum"]
    return out


async def donor_stats(donor_ids: list[str] | None = None) -> dict[str, dict]:
    match: dict = {"allocations.donor_id": {"$ne": None}, "direction": "CR"}
    if donor_ids is not None:
        match["allocations.donor_id"] = {"$in": donor_ids}
    pipeline = [
        {"$unwind": "$allocations"},
        {"$match": match},
        {"$group": {"_id": "$allocations.donor_id", "sum": {"$sum": "$allocations.amount"}, "count": {"$sum": 1}}},
    ]
    return {r["_id"]: {"total_donasi": r["sum"], "donation_count": r["count"]} async for r in db.mutasi.aggregate(pipeline)}


async def monthly(match: dict | None = None, program_id: str | None = None, months: int = 6) -> list[dict]:
    pipeline: list[dict] = []
    if program_id:
        pipeline += [{"$unwind": "$allocations"}, {"$match": {"allocations.program_id": program_id}}]
        amount = "$allocations.amount"
    else:
        amount = "$amount"
    if match:
        pipeline.append({"$match": match})
    pipeline += [
        {"$group": {"_id": {"m": {"$substr": ["$date", 0, 7]}, "d": "$direction"}, "sum": {"$sum": amount}}},
    ]
    data: dict[str, dict] = {}
    async for r in db.mutasi.aggregate(pipeline):
        m = data.setdefault(r["_id"]["m"], {"month": r["_id"]["m"], "masuk": 0.0, "keluar": 0.0})
        m["masuk" if r["_id"]["d"] == "CR" else "keluar"] += r["sum"]
    return sorted(data.values(), key=lambda x: x["month"])[-months:]


async def channel_totals(channel: str) -> tuple[float, float]:
    pipeline = [{"$match": {"channel": channel}}, {"$group": {"_id": "$direction", "sum": {"$sum": "$amount"}}}]
    sums = {r["_id"]: r["sum"] async for r in db.mutasi.aggregate(pipeline)}
    return sums.get("CR", 0.0), sums.get("DB", 0.0)
