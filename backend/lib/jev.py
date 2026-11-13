"""Jev (TypeSafe) fast decisions: mutasi category + sender→donor match + anomaly flag (one call per mutation),
uploaded document type, and duplicate-donor pair check. Calls are sequential (free plan: one in flight)."""

import asyncio
import logging
import os
import re
from functools import lru_cache

from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, RetryPolicy, TypeSafeAPIError, TypeSafeError

from lib.common import norm
from lib.db import db

log = logging.getLogger(__name__)

CATEGORIES = {
    "donasi": "Donasi umum/program masuk dari donatur",
    "cicilan": "Setoran cicilan rutin bulanan (grup FU / FU HUI) dari anggota",
    "pengeluaran_operasional": "Pembayaran operasional: belanja, listrik, sewa, penyaluran bantuan",
    "gaji": "Pembayaran gaji, honor, atau upah karyawan",
    "biaya_bank": "Transaksi dari bank sendiri: biaya administrasi, pajak bunga, bunga/jasa giro masuk, biaya transfer",
    "transfer_internal": "Pemindahan dana antar rekening yayasan sendiri atau setor/tarik tunai kas",
    "lainnya": "Tidak jelas atau tidak termasuk kategori di atas",
}
MUTASI_DOC_TYPES = {
    "bukti_transfer": "Bukti transfer / screenshot m-banking",
    "nota": "Nota atau struk belanja",
    "kuitansi": "Kuitansi pembayaran bertanda tangan",
    "proposal": "Proposal atau permohonan dana",
    "lainnya": "Dokumen lain",
}
DONOR_DOC_TYPES = {
    "ktp": "Kartu Tanda Penduduk / identitas",
    "npwp": "Kartu atau surat NPWP",
    "kartu_keluarga": "Kartu Keluarga",
    "surat_pernyataan": "Surat pernyataan / formulir donatur",
    "lainnya": "Dokumen lain",
}
MATCH_THRESHOLD = 0.8
ANOMALY_THRESHOLD = 0.75
DUP_THRESHOLD = 0.6
NONE = "tidak_ada"
_lock = asyncio.Semaphore(1)


@lru_cache(maxsize=1)
def client() -> AsyncTypeSafeClient:
    proxy = (os.getenv("INTEGRATION_PROXY_URL") or "https://integrations.emergentagent.com").rstrip("/")
    return AsyncTypeSafeClient(api_key=os.environ["EMERGENT_LLM_KEY"], base_url=f"{proxy}/llm/typesafe", retry=RetryPolicy(max_retries=2, respect_retry_after=False))


async def _ask(state, questions):
    """Returns the response, or None on any Jev failure (caller falls back)."""
    try:
        async with _lock:
            return await client().system_one(model="jev-latest", state=state, questions=questions)
    except (TypeSafeAPIError, TypeSafeError) as exc:
        log.warning("Jev call failed: %s", exc)
        return None


STOP = {"bpk", "ibu", "bapak", "sdr", "trsf", "ny", "tn", "transfer", "dari", "e-banking", "bca", "switching"}


def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9\u3400-\u9fff]+", norm(text)) if len(t) >= 3 and t not in STOP]


async def candidates(sender: str) -> list[dict]:
    tokens = _tokens(sender)
    if not tokens:
        return []
    q = {"$or": [{"search_text": {"$regex": re.escape(t)}} for t in tokens[:4]]}
    return await db.donors.find(q, {"_id": 0, "id": 1, "name_latin": 1, "name_mandarin": 1, "name_pinyin": 1, "alias": 1, "bank_accounts": 1}).to_list(5)


def describe(d: dict) -> str:
    parts = [d.get("name_latin", ""), d.get("name_mandarin", ""), d.get("name_pinyin", "") and f"pinyin {d['name_pinyin']}",
             d.get("alias", "") and f"alias {d['alias']}", d.get("bank_accounts") and f"rekening pengirim: {', '.join(d['bank_accounts'][:3])}"]
    return "; ".join(p for p in parts if p)


async def analyze(doc: dict) -> dict:
    """$set updates for one mutasi. Failures are flagged ai_status='fallback', never raised."""
    cands = await candidates(doc.get("sender_name", "")) if doc["direction"] == "CR" and not doc.get("allocations") else []
    questions = {
        "kategori": Choice(instructions="Kategori transaksi rekening yayasan ini berdasarkan keterangan, arah (CR=masuk, DB=keluar), dan nominal.", criteria=CATEGORIES),
        "janggal": Noul(instructions="Apakah transaksi ini janggal dan perlu dicek manual oleh bendahara (keterangan tidak wajar, nominal sangat tidak biasa, pengirim tidak jelas, kemungkinan salah transfer)?"),
    }
    if cands:
        crit = {c["id"]: describe(c) for c in cands} | {NONE: "Bukan salah satu donatur di atas"}
        questions["donatur"] = Choice(instructions="Nama pengirim transfer ini orang yang sama dengan donatur mana? Pertimbangkan singkatan, ejaan pinyin, dan alias.", criteria=crit)
    state = {"keterangan": doc.get("description", "")[:300], "pengirim": doc.get("sender_name", ""), "arah": doc["direction"], "nominal_rupiah": doc["amount"]}
    r = await _ask(state, questions)
    if r is None:
        return {"ai_status": "fallback"}
    cat = r.choices["kategori"]
    anomaly = round(float(r.nouls["janggal"].noul), 3)
    upd: dict = {"ai_status": "ok", "ai_category": cat.choice, "ai_confidence": round(float(cat.confidence), 3), "ai_anomaly": anomaly}
    if anomaly >= ANOMALY_THRESHOLD and doc.get("status") == "belum":
        upd["status"] = "perlu"
    if cands:
        m = r.choices["donatur"]
        if m.choice != NONE:
            upd["ai_match_score"] = round(float(m.probabilities.get(m.choice, m.confidence)), 3)
            if upd["ai_match_score"] >= MATCH_THRESHOLD:
                d = next(c for c in cands if c["id"] == m.choice)
                upd["allocations"] = [{
                    "donor_id": d["id"], "donor_name": " ".join(x for x in [d.get("name_latin", ""), d.get("name_mandarin", "")] if x),
                    "program_id": None, "program_name": "", "jenis": "cicilan" if cat.choice == "cicilan" else "donasi", "amount": doc["amount"], "notes": "",
                }]
                upd["suggested"] = True
    return upd


async def analyze_many(ids: list[str]) -> dict:
    res = {"processed": 0, "classified": 0, "matched": 0, "flagged": 0, "failed": 0}
    async for doc in db.mutasi.find({"id": {"$in": ids}}, {"_id": 0}):
        upd = await analyze(doc)
        res["processed"] += 1
        if upd["ai_status"] == "fallback":
            res["failed"] += 1
            await db.mutasi.update_one({"id": doc["id"]}, {"$set": upd})
            continue
        res["classified"] += 1
        res["flagged"] += upd.get("status") == "perlu"
        alloc = upd.pop("allocations", None)
        status = upd.pop("status", None)
        sug = upd.pop("suggested", None)
        await db.mutasi.update_one({"id": doc["id"]}, {"$set": upd})
        if status:  # don't override a status the user set meanwhile
            await db.mutasi.update_one({"id": doc["id"], "status": "belum"}, {"$set": {"status": status}})
        if alloc:  # never overwrite allocations the user set meanwhile
            r = await db.mutasi.update_one({"id": doc["id"], "allocations": {"$size": 0}}, {"$set": {"allocations": alloc, "suggested": sug}})
            res["matched"] += r.modified_count
    return res


_tasks: set[asyncio.Task] = set()


def analyze_in_background(ids: list[str]) -> None:
    if not ids:
        return
    t = asyncio.create_task(analyze_many(ids))
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def classify_document(filename: str, context: str, types: dict[str, str]) -> tuple[str, float | None]:
    r = await _ask({"nama_file": filename, "konteks": context[:300]}, {"jenis": Choice(instructions="Jenis dokumen yang diunggah ini, berdasarkan nama file dan konteksnya.", criteria=types)})
    if r is None:
        return "", None
    c = r.choices["jenis"]
    return c.choice, round(float(c.confidence), 3)


async def same_person(a: dict, b: dict) -> float | None:
    r = await _ask({"donatur_a": describe(a), "donatur_b": describe(b)},
                   {"sama": Noul(instructions="Apakah donatur A dan donatur B kemungkinan besar orang yang sama (ejaan Latin berbeda, pinyin, alias, nama Mandarin tradisional/sederhana)?")})
    return None if r is None else round(float(r.nouls["sama"].noul), 3)


def candidate_pairs(donors: list[dict], exclude: set[tuple[str, str]], limit: int = 30) -> list[tuple[dict, dict]]:
    """Cheap pre-filter: pairs sharing a name token (latin/pinyin) or a Mandarin character pair."""
    keys: dict[str, list[dict]] = {}
    for d in donors:
        toks = set(_tokens(" ".join([d.get("name_latin", ""), d.get("name_pinyin", ""), d.get("alias", "")])))
        m = (d.get("name_mandarin") or "").strip()
        toks |= {m[i:i + 2] for i in range(max(len(m) - 1, 0))}
        for t in toks:
            keys.setdefault(t, []).append(d)
    pairs, seen = [], set(exclude)
    for group in sorted(keys.values(), key=len):
        if len(group) > 6:  # too common (e.g. a surname) to be meaningful alone
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                k = tuple(sorted((group[i]["id"], group[j]["id"])))
                if k not in seen:
                    seen.add(k)
                    pairs.append((group[i], group[j]))
                    if len(pairs) >= limit:
                        return pairs
    return pairs
