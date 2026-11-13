import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, ensure_indexes
from lib.storage import startup_init
from routers import admin, auth, cicilan, cron, donors, files, mutasi, ocr, programs, receipts, reports, vouchers


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    asyncio.create_task(startup_init())
    yield
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()


app = FastAPI(lifespan=lifespan, title="Dana Paramita Guang Ji")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Sistem Keuangan Yayasan Dana Paramita Guang Ji Indonesia"}


for r in (auth.router, donors.router, programs.router, mutasi.router, files.router, ocr.router, receipts.router, cicilan.router, vouchers.router, reports.router, cron.router, admin.router):
    api_router.include_router(r)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
