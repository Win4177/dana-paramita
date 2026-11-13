"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "donors": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("bank_accounts_norm", ASCENDING)], name="accounts"), IndexModel([("name_latin", ASCENDING)], name="name")],
    "programs": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "mutasi": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("hash", ASCENDING)], name="hash", unique=True),
        IndexModel([("date", DESCENDING), ("ord", DESCENDING)], name="date_ord"),
        IndexModel([("status", ASCENDING)], name="status"),
        IndexModel([("allocations.donor_id", ASCENDING)], name="alloc_donor"),
        IndexModel([("allocations.program_id", ASCENDING)], name="alloc_program"),
    ],
    "receipts": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("number", ASCENDING)], name="number", unique=True), IndexModel([("seq", DESCENDING)], name="seq")],
    "cicilan_checks": [IndexModel([("program_id", ASCENDING), ("donor_id", ASCENDING), ("month", ASCENDING)], name="cell", unique=True)],
    "vouchers": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("number", ASCENDING)], name="number", unique=True), IndexModel([("mutasi_id", ASCENDING)], name="mutasi")],
    "files": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "sender_map": [IndexModel([("key", ASCENDING)], name="key", unique=True)],
    "parser_templates": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "audit_logs": [IndexModel([("at", DESCENDING)], name="at_desc"), IndexModel([("entity", ASCENDING), ("at", DESCENDING)], name="entity_at")],
}


async def migrate() -> None:
    """One-off data migrations, each recorded so a later admin choice is never overridden."""
    if not await db.migrations.find_one({"_id": "bukti_module_v1"}):
        await db.users.update_many({"role": {"$in": ["admin", "staf", "auditor"]}}, {"$addToSet": {"modules": "bukti"}})
        await db.migrations.insert_one({"_id": "bukti_module_v1"})
    if not await db.migrations.find_one({"_id": "voucher_laporan_v1"}):
        await db.users.update_many({"role": {"$in": ["admin", "staf", "auditor"]}}, {"$addToSet": {"modules": {"$each": ["voucher", "laporan"]}}})
        await db.settings.update_one({"id": "foundation", "footer_quote": {"$regex": "^Berdana dengan tulus"}}, {"$set": {"footer_quote": "Menanam satu bibit menghasilkan ratusan butir. Berdana satu menerima puluhan ribu. Amal tercatat di rekening surga, Penderma dan Anak Cucu menuai berkah tak terhingga."}})
        await db.migrations.insert_one({"_id": "voucher_laporan_v1"})


async def ensure_indexes() -> None:
    await migrate()
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
