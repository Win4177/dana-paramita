"""File storage: mutasi attachments (bukti transfer, nota) and foundation logo/signature. Downloads are
authorized per module: a file is readable only by users who can open the module it belongs to."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from lib.auth import current_user, require
from lib.common import audit, new_id, now_iso
from lib.db import db
from lib.jev import DONOR_DOC_TYPES, MUTASI_DOC_TYPES, classify_document
from lib.storage import APP_NAME, get_object, put_object
from models.schemas import Attachment, Settings

router = APIRouter()

MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic", "pdf": "application/pdf"}
IMAGE_EXT = {"jpg", "jpeg", "png", "webp"}
MAX_ATTACH = 10 * 1024 * 1024
MAX_BRAND = 2 * 1024 * 1024


async def store_bytes(data: bytes, name: str, ext: str, content_type: str, module: str, owner_id: str, user: dict, extra: dict | None = None) -> dict:
    fid = new_id()
    try:
        res = await put_object(f"{APP_NAME}/{module}/{owner_id}/{fid}.{ext}", data, content_type)
    except Exception as exc:
        raise HTTPException(502, f"Penyimpanan file gagal: {exc}")
    rec = {"id": fid, "storage_path": res["path"], "filename": name, "content_type": content_type, "size": len(data), "module": module,
           "owner_id": owner_id, "is_deleted": False, "uploaded_at": now_iso(), "uploaded_by": user["name"], **(extra or {})}
    await db.files.insert_one(dict(rec))
    return rec


async def _store(file: UploadFile, module: str, owner_id: str, user: dict, allowed: set[str], max_size: int, classify: tuple[str, dict] | None = None) -> dict:
    name = file.filename or "file"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in allowed:
        raise HTTPException(400, f"Jenis file tidak didukung. Gunakan: {', '.join(sorted(allowed))}")
    data = await file.read()
    if not data:
        raise HTTPException(400, "File kosong")
    if len(data) > max_size:
        raise HTTPException(400, f"Ukuran file maksimal {max_size // (1024 * 1024)} MB")
    extra = {}
    if classify:
        doc_type, conf = await classify_document(name, classify[0], classify[1])
        extra = {"doc_type": doc_type, "doc_type_confidence": conf}
    return await store_bytes(data, name, ext, MIME[ext], module, owner_id, user, extra)


def _att(rec: dict) -> dict:
    return Attachment(**rec).model_dump()


@router.post("/mutasi/{mid}/attachments", response_model=Attachment)
async def upload_attachment(mid: str, file: UploadFile = File(...), user: dict = Depends(require("mutasi", "write"))):
    m = await db.mutasi.find_one({"id": mid}, {"_id": 0, "date": 1, "amount": 1, "description": 1, "direction": 1})
    if not m:
        raise HTTPException(404, "Mutasi tidak ditemukan")
    ctx = f"Lampiran mutasi {'masuk' if m['direction'] == 'CR' else 'keluar'} Rp {m['amount']:,.0f}: {m['description']}"
    rec = await _store(file, "mutasi", mid, user, set(MIME), MAX_ATTACH, (ctx, MUTASI_DOC_TYPES))
    await db.mutasi.update_one({"id": mid}, {"$push": {"attachments": _att(rec)}})
    await audit(user, "lampiran", "mutasi", mid, f"Melampirkan {rec['filename']} ke mutasi {m['date']} Rp {m['amount']:,.0f}")
    return Attachment(**rec)


@router.delete("/mutasi/{mid}/attachments/{fid}")
async def delete_attachment(mid: str, fid: str, user: dict = Depends(require("mutasi", "write"))):
    rec = await db.files.find_one({"id": fid, "owner_id": mid, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Lampiran tidak ditemukan")
    await db.files.update_one({"id": fid}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": user["name"]}})
    await db.mutasi.update_one({"id": mid}, {"$pull": {"attachments": {"id": fid}}})
    await audit(user, "hapus_lampiran", "mutasi", mid, f"Menghapus lampiran {rec['filename']}")
    return {"ok": True}


@router.post("/donors/{did}/documents", response_model=Attachment)
async def upload_donor_document(did: str, file: UploadFile = File(...), user: dict = Depends(require("donatur", "write"))):
    d = await db.donors.find_one({"id": did}, {"_id": 0, "name_latin": 1, "name_mandarin": 1})
    if not d:
        raise HTTPException(404, "Donatur tidak ditemukan")
    rec = await _store(file, "donatur", did, user, set(MIME), MAX_ATTACH, (f"Dokumen pendukung profil donatur {d.get('name_latin', '')}", DONOR_DOC_TYPES))
    await db.donors.update_one({"id": did}, {"$push": {"documents": _att(rec)}})
    await audit(user, "lampiran", "donatur", did, f"Mengunggah dokumen {rec['filename']} untuk donatur {d.get('name_latin', '')}")
    return Attachment(**rec)


@router.delete("/donors/{did}/documents/{fid}")
async def delete_donor_document(did: str, fid: str, user: dict = Depends(require("donatur", "write"))):
    rec = await db.files.find_one({"id": fid, "owner_id": did, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Dokumen tidak ditemukan")
    await db.files.update_one({"id": fid}, {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": user["name"]}})
    await db.donors.update_one({"id": did}, {"$pull": {"documents": {"id": fid}}})
    await audit(user, "hapus_lampiran", "donatur", did, f"Menghapus dokumen {rec['filename']}")
    return {"ok": True}


@router.post("/settings/branding/{kind}", response_model=Settings)
async def upload_branding(kind: str, file: UploadFile = File(...), user: dict = Depends(require("pengaturan", "write"))):
    if kind not in ("logo", "signature"):
        raise HTTPException(404, "Jenis tidak dikenal")
    rec = await _store(file, "branding", kind, user, IMAGE_EXT, MAX_BRAND)
    field = "logo_data_url" if kind == "logo" else "signature_data_url"
    await db.settings.update_one({"id": "foundation"}, {"$set": {field: f"/api/files/{rec['id']}"}}, upsert=True)
    await audit(user, "ubah", "pengaturan", kind, f"Mengunggah {'logo' if kind == 'logo' else 'tanda tangan'} baru ({rec['filename']})")
    return Settings(**(await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}))


@router.get("/files/{fid}")
async def download(fid: str, user: dict = Depends(current_user)):
    rec = await db.files.find_one({"id": fid, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File tidak ditemukan")
    if rec["module"] != "branding" and rec["module"] not in user.get("modules", []):
        raise HTTPException(403, "Anda tidak punya akses ke file ini")
    try:
        data, _ = await get_object(rec["storage_path"])
    except Exception as exc:
        raise HTTPException(502, f"File tidak dapat diambil: {exc}")
    safe = rec["filename"].encode("ascii", "ignore").decode().replace('"', "") or "file"
    return Response(data, media_type=rec["content_type"], headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "private, max-age=3600"})
