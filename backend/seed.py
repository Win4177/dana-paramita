"""Seed demo data: settings, users, programs, donors (incl. Mandarin), BCA parser template and
three months of BCA mutasi (generated as a real BCA CSV and imported through the parser).
Also writes the full statement to frontend/public/contoh/ so it can be uploaded from the UI
(overlapping rows are skipped as duplicates, new rows get auto-suggestions).
Run: cd /app/backend && python seed.py   (resets demo data)"""

import asyncio
import csv
import io
from datetime import date, timedelta
from pathlib import Path

from lib.auth import ROLE_DEFAULT_MODULES, hash_secret
from lib.bank_parser import read_rows
from lib.common import new_id, now_iso
from lib.dates import today_iso
from lib.db import db, ensure_indexes
from models.schemas import DonorIn, Settings
from routers.donors import build_doc
from routers.mutasi import import_bank, learn, resolve_allocation

ADMIN_EMAIL = "danaparamitaguangji.indonesia@gmail.com"
ADMIN_PASSWORD = "Guangjiyuanchuan668"
REKAN_PIN = "246810"

PROGRAMS = [
    ("pembangunan", "Pembangunan Sekolah", "建校", "donasi", 1_500_000_000, "Pembangunan gedung sekolah & ruang kelas PG"),
    ("akupuntur", "Akupuntur", "針灸", "donasi", 120_000_000, "Bakti sosial akupuntur gratis"),
    ("donordarah", "Donor Darah", "捐血", "donasi", 30_000_000, "Kegiatan donor darah rutin"),
    ("olimpiade", "Olimpiade", "奧林匹克", "donasi", 75_000_000, "Beasiswa & pembinaan olimpiade sains"),
    ("umum", "Umum", "一般", "donasi", 0, "Dana umum/operasional yayasan"),
    ("fu", "Grup FU 福 (桂花班)", "福", "cicilan", 600_000_000, "Cicilan pembangunan ruang kelas PG - kelas 桂花班"),
    ("fuhui", "Grup FU HUI 福慧 (蘭花班)", "福慧", "cicilan", 300_000_000, "Cicilan pembangunan ruang kelas PG - kelas 蘭花班"),
]

FU_250 = [("Mariati", "瑪麗亞"), ("Lie Siu Lan", "李秀蘭"), ("Tjhin Ah Moy", "陳阿妹"), ("Ong Bun Hwa", "王文華"), ("Lim Mei Hua", "林美華"),
          ("Ng Kim Lian", "黃金蓮"), ("Tan Siok Hoa", "陳淑華"), ("Kwee Lie Ching", "郭麗清"), ("Oei Swie Hong", "黃瑞鳳"), ("Liem Giok Nio", "林玉娘"),
          ("Gouw Hong Lie", "吳鳳麗"), ("The Ai Ling", "鄭愛玲"), ("Tio Siu Ing", "張秀英"), ("Sie Bie Lan", "施美蘭")]
FU_125 = [("Wong Li Fen", "黃麗芬"), ("Chen Xiu Mei", "陈秀梅"), ("Lauw Ay Nio", "劉愛娘"), ("Yap Mei Ling", "葉美玲"),
          ("Kho Siu Hwa", "許秀華"), ("Phang Lie Hoa", "彭麗華"), ("Thung Sioe Lan", "湯秀蘭"), ("Hioe Mei Fong", "邱美鳳")]
FU_HUI = [("Lie Kim Hwa", "李金花", 500_000), ("Tan Bie Hoa", "陳美華", 500_000), ("Ong Siu Mei", "王秀美", 200_000), ("Chang Li Hua", "张丽华", 200_000),
          ("Kang Mei Yin", "江美音", 50_000), ("Liong Fung Ying", "梁鳳英", 50_000), ("Su Hui Lan", "蘇惠蘭", 50_000), ("Ho Ai Chu", "何愛珠", 50_000)]
FANG = [("Fang Edy", "方德義"), ("Fang Lily", "方麗麗"), ("Fang Kevin", "方凱文"), ("Fang Jessica", "方潔西"), ("Fang Ah Kiong", "方亞強")]
SINGLES = [("Susanto", "蘇善道", "SUSANTO", "akupuntur", 1_000_000), ("Lim Hok Liang", "林福良", "LIM HOK LIANG", "olimpiade", 500_000),
           ("Tan Mei Ling", "陳美玲", "TAN MEI LING", "donordarah", 250_000), ("Hendra Wijaya", "黃漢德", "HENDRA WIJAYA", "umum", 750_000),
           ("Budi Santoso", "許文強", "BUDI SANTOSO", "pembangunan", 2_000_000)]


def month_start(d: date, back: int) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def fmt(n: float) -> str:
    return f"{n:,.2f}"


def build_transactions(today: date) -> list[tuple[date, str, float, str]]:
    txs: list[tuple[date, str, float, str]] = []
    for back in (2, 1, 0):
        s = month_start(today, back)
        last_day = today if back == 0 else (month_start(today, back - 1) - timedelta(days=1))
        def day(n: int) -> date:
            return min(s + timedelta(days=n - 1), last_day)
        ref = f"{s.month:02d}"
        txs += [
            (day(2), f"TRSF E-BANKING CR {ref}02/FTSCY/WS95031 6100000.00 MARIATI", 6_100_000, "CR"),
            (day(3), f"BI-FAST CR BIF TRANSFER DR 014 {ref}03 EDY", 2_500_000, "CR"),
            (day(5), f"TRSF E-BANKING CR {ref}05/FTSCY/WS95051 1000000.00 SUSANTO", 1_000_000, "CR"),
            (day(6), f"SWITCHING CR TRANSFER DR 013 {ref}06 LIM HOK LIANG", 500_000, "CR"),
            (day(8), f"TRSF E-BANKING DB {ref}08/FTFVA/WS95011 GAJI KARYAWAN", 8_500_000, "DB"),
            (day(9), f"TRSF E-BANKING CR {ref}09/FTSCY/WS95091 250000.00 TAN MEI LING", 250_000, "CR"),
            (day(10), f"KARTU DEBIT PLN PASCABAYAR {ref}10 LISTRIK", 1_250_000, "DB"),
            (day(12), f"TRSF E-BANKING CR {ref}12/FTSCY/WS95121 750000.00 HENDRA WIJAYA", 750_000, "CR"),
            (day(14), f"BI-FAST CR BIF TRANSFER DR 008 {ref}14 BUDI SANTOSO", 2_000_000, "CR"),
            (day(15), f"SETORAN TUNAI {ref}15 HAMBA BUDDHA", 300_000, "CR"),
            (day(28), "BUNGA", 125_400, "CR"),
            (day(28), "PAJAK BUNGA", 25_080, "DB"),
            (day(28), "BIAYA ADM", 15_000, "DB"),
        ]
    return [t for t in txs if t[0] <= today]


def to_csv(txs: list[tuple[date, str, float, str]], opening: float, period: tuple[date, date]) -> tuple[str, list[float]]:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["No. rekening : 8650810199"])
    w.writerow(["Nama : YAY. DANA PARAMITA GUANG JI INDONESIA"])
    w.writerow([f"Periode : {period[0]:%d/%m/%Y} - {period[1]:%d/%m/%Y}"])
    w.writerow(["Kode Mata Uang : Rp"])
    w.writerow([])
    w.writerow(["Tanggal Transaksi", "Keterangan", "Cabang", "Jumlah", "", "Saldo"])
    bal, balances = opening, []
    for d, desc, amt, dc in txs:
        bal += amt if dc == "CR" else -amt
        balances.append(bal)
        w.writerow([f"'{d:%d/%m/%Y}", desc, "0000", fmt(amt), dc, fmt(bal)])
    w.writerow([])
    w.writerow(["Saldo Awal", fmt(opening)])
    w.writerow(["Mutasi Kredit", fmt(sum(a for _, _, a, c in txs if c == "CR"))])
    w.writerow(["Mutasi Debet", fmt(sum(a for _, _, a, c in txs if c == "DB"))])
    w.writerow(["Saldo Akhir", fmt(bal)])
    return buf.getvalue(), balances


async def main() -> None:
    for col in ("settings", "donors", "programs", "mutasi", "sender_map", "imports", "parser_templates", "audit_logs", "users"):
        await db[col].drop()
    await ensure_indexes()
    today = date.fromisoformat(today_iso())
    opening = 250_000_000.0

    await db.settings.insert_one({"id": "foundation", **Settings(
        name="Yayasan Dana Paramita Guang Ji Indonesia", name_mandarin="印尼廣吉慈善功德基金會",
        address="Blok C4pp, Jl. Mirinda No.19 Blok C4, RT.5/RW.7, Tegal Alur, Kalideres, Jakarta Barat, 11820",
        phone="0852 1791 3623", email="danaparamitaguangji.indonesia@gmail.com", register_no="08.20.31.73.01401",
        bank_name="BCA Cabang PIK", bank_account="8650 810 199", bank_account_holder="Yay. Dana Paramita Guang Ji Indonesia",
        fiscal_year=today.year, opening_bank_balance=opening, opening_cash_balance=2_000_000,
        signer_name="", signer_title="Bendahara", footer_quote="Berdana dengan tulus, berbahagia selamanya. 隨喜功德，福慧雙修。",
    ).model_dump()})

    users = [
        (ADMIN_EMAIL, "Admin Yayasan", "admin", ADMIN_PASSWORD, None),
        ("staf@paramita.demo", "Staf Admin (Demo)", "staf", "StafDemo123", None),
        ("auditor@paramita.demo", "Auditor (Demo)", "auditor", "AuditorDemo123", None),
        ("rekan@paramita.demo", "Rekan Pengecek (Demo)", "rekan", None, REKAN_PIN),
    ]
    for email, name, role, pw, pin in users:
        await db.users.insert_one({
            "id": new_id(), "email": email, "name": name, "role": role, "modules": ROLE_DEFAULT_MODULES[role], "active": True,
            "password_hash": hash_secret(pw) if pw else None, "pin_hash": hash_secret(pin) if pin else None,
            "pin_expires_at": None, "created_at": now_iso(),
        })

    pid: dict[str, str] = {}
    for key, name, zh, kind, target, desc in PROGRAMS:
        pid[key] = new_id()
        await db.programs.insert_one({
            "id": pid[key], "name": name, "name_mandarin": zh, "description": desc, "kind": kind, "target": target,
            "start_date": f"{today.year}-01-01", "end_date": "", "status": "aktif", "pic": "Bendahara",
            "monthly_amount": 250_000 if key == "fu" else (100_000 if key == "fuhui" else 0), "created_at": now_iso(),
        })

    async def add_donor(latin: str, zh: str, accounts: list[str], notes: str = "", npwp: str = "", pic: str = "") -> str:
        doc = {"id": new_id(), "created_at": now_iso(), **build_doc(DonorIn(name_latin=latin, name_mandarin=zh, bank_accounts=accounts, notes=notes, npwp=npwp, pic=pic))}
        await db.donors.insert_one(doc)
        return doc["id"]

    mariati_split = []
    for latin, zh in FU_250:
        did = await add_donor(latin, zh, ["MARIATI"], "Anggota Grup FU 福 (桂花班), titipan via Mariati", pic="Mariati")
        mariati_split.append({"donor_id": did, "program_id": pid["fu"], "jenis": "cicilan", "amount": 250_000, "notes": ""})
    for latin, zh in FU_125:
        did = await add_donor(latin, zh, ["MARIATI"], "Anggota Grup FU 福 (桂花班), titipan via Mariati", pic="Mariati")
        mariati_split.append({"donor_id": did, "program_id": pid["fu"], "jenis": "cicilan", "amount": 125_000, "notes": ""})
    for latin, zh, amt in FU_HUI:
        did = await add_donor(latin, zh, ["MARIATI"], "Anggota Grup FU HUI 福慧 (蘭花班), titipan via Mariati", pic="Mariati")
        mariati_split.append({"donor_id": did, "program_id": pid["fuhui"], "jenis": "cicilan", "amount": amt, "notes": ""})
    fang_split = []
    for latin, zh in FANG:
        did = await add_donor(latin, zh, ["EDY"], "Keluarga Fang, transfer via Edy", pic="Edy")
        fang_split.append({"donor_id": did, "program_id": pid["pembangunan"], "jenis": "donasi", "amount": 500_000, "notes": ""})
    single_map: dict[str, list[dict]] = {}
    for latin, zh, acct, prog, amt in SINGLES:
        did = await add_donor(latin, zh, [acct], npwp="09.254.294.3-407.000" if latin == "Budi Santoso" else "")
        single_map[acct] = [{"donor_id": did, "program_id": pid[prog], "jenis": "donasi", "amount": amt, "notes": ""}]
    await add_donor("Budi Santosa", "", [], "Kemungkinan duplikat dari Budi Santoso")  # for merge demo
    plans = {"MARIATI": mariati_split, "EDY": fang_split, **single_map}
    assert abs(sum(a["amount"] for a in mariati_split) - 6_100_000) < 1

    await db.parser_templates.insert_one({
        "id": new_id(), "name": "BCA (KlikBCA CSV/Excel)", "bank": "BCA", "col_date": "Tanggal", "col_description": "Keterangan",
        "col_amount": "Jumlah", "col_dbcr": "", "col_debit": "", "col_credit": "", "col_balance": "Saldo", "col_sender": "",
        "number_format": "auto", "is_default": True,
    })

    txs = build_transactions(today)
    full_csv, balances = to_csv(txs, opening, (month_start(today, 2), today))
    out_dir = Path(__file__).parent.parent / "frontend" / "public" / "contoh"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "mutasi_bca_contoh.csv").write_text(full_csv, encoding="utf-8")

    # Seed: everything except the last 4 current-month rows (left for the user's demo upload).
    cutoff = month_start(today, 0)
    seed_txs = [t for t in txs if t[0] < cutoff] + [t for t in txs if t[0] >= cutoff][:3]
    bal = opening
    for phase, subset in (("old", [t for t in seed_txs if t[0] < month_start(today, 1)]), ("recent", [t for t in seed_txs if t[0] >= month_start(today, 1)])):
        start_bal = opening + sum((a if c == "CR" else -a) for d, _, a, c in txs[: txs.index(subset[0])]) if subset else bal
        text, _ = to_csv(subset, start_bal, (subset[0][0], subset[-1][0]))
        res = await import_bank(read_rows(text.encode(), "seed.csv"), None, new_id(), {"name": "seed"})
        print(phase, res.model_dump())
        async for m in db.mutasi.find({"import_id": res.import_id}, {"_id": 0}):
            if phase == "old" and m["direction"] == "CR":
                plan = plans.get(m["sender_name"])
                allocs = [await resolve_allocation(dict(a)) for a in plan] if plan else (
                    [await resolve_allocation({"donor_id": None, "program_id": pid["umum"], "jenis": "lainnya", "amount": m["amount"], "notes": "Pendapatan bunga" if m["description"] == "BUNGA" else ""})])
                await db.mutasi.update_one({"id": m["id"]}, {"$set": {"allocations": allocs, "status": "ok", "suggested": False}})
                await learn({**m, "allocations": allocs})
            elif phase == "old":
                await db.mutasi.update_one({"id": m["id"]}, {"$set": {"status": "ok"}})
            elif m["date"] < cutoff.isoformat() and m["allocations"]:
                await db.mutasi.update_one({"id": m["id"]}, {"$set": {"status": "ok", "suggested": False}})
            elif m["date"] < cutoff.isoformat() and m["direction"] == "DB":
                await db.mutasi.update_one({"id": m["id"]}, {"$set": {"status": "ok"}})
    await db.mutasi.update_one({"sender_name": "HAMBA BUDDHA", "status": "belum"}, {"$set": {"status": "perlu", "notes": "Setoran tunai tanpa nama, konfirmasi ke pengurus"}})
    print("Seed selesai. Mutasi:", await db.mutasi.count_documents({}), "Donatur:", await db.donors.count_documents({}))


if __name__ == "__main__":
    asyncio.run(main())
