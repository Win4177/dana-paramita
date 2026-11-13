"""Platform cron webhooks (see /app/.emergent/crons.yml)."""

import asyncio
import hmac
import logging
import os

from fastapi import APIRouter, HTTPException, Request

from lib.common import now_iso
from lib.db import db
from routers.cicilan import build_reminder

router = APIRouter()
log = logging.getLogger(__name__)
_tasks: set[asyncio.Task] = set()


async def _all_reminders() -> None:
    async for p in db.programs.find({"kind": "cicilan", "status": "aktif"}, {"_id": 0, "id": 1}):
        try:
            await build_reminder(p["id"])
        except Exception as exc:
            log.error("Reminder for %s failed: %s", p["id"], exc)


@router.post("/cron/cicilan-reminders")
async def cron_reminders(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not secret or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], secret):
        raise HTTPException(401, "Unauthorized")
    try:
        env = await request.json()
    except Exception:
        env = {}
    if not isinstance(env, dict):
        raise HTTPException(400, "Invalid body")
    run_id = request.headers.get("x-webhook-id") or env.get("run_id") or now_iso()
    if await db.cron_runs.find_one({"_id": run_id}):
        return {"ok": True, "duplicate": True}
    await db.cron_runs.insert_one({"_id": run_id, "job": "cicilan-reminders", "at": now_iso()})
    t = asyncio.create_task(_all_reminders())
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    return {"ok": True}
