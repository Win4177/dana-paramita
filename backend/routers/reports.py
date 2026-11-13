"""Laporan keuangan lengkap: ISAK 35 (posisi keuangan, penghasilan komprehensif, perubahan aset neto, arus kas),
buku kas/bank, per program, rekap donatur & bukti, rekap cicilan. Same data as JSON, Excel, or PDF."""

import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from lib.auth import require
from lib.dates import today_iso
from lib.db import db
from lib.jev import CATEGORIES
from lib.receipt_pdf import FONT, _bold
from models.schemas import Report, ReportSection
from routers.cicilan import matrix
from routers.mutasi import VOUCHER

router = APIRouter()
CAT_LABEL = {"pengeluaran_operasional": "Beban operasional & penyaluran", "gaji": "Beban gaji & honor", "biaya_bank": "Beban administrasi bank",
             "transfer_internal": "Transfer internal / setor-tarik tunai", "lainnya": "Beban lain-lain", "donasi": "Beban lain-lain", "cicilan": "Beban lain-lain", "": "Beban lain-lain"}
REPORTS = {"isak35": "Laporan Keuangan ISAK 35", "kasbank": "Buku Kas & Bank", "program": "Laporan per Program", "donatur": "Rekap Donatur & Bukti Pembayaran", "cicilan": "Rekap Cicilan FU / FU HUI"}


async def _opening(before: str) -> tuple[float, float]:
    s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
    bal = {"bank": float(s.get("opening_bank_balance", 0)), "kas": float(s.get("opening_cash_balance", 0))}
    async for r in db.mutasi.aggregate([{"$match": {"date": {"$lt": before}}}, {"$group": {"_id": {"c": "$channel", "d": "$direction"}, "s": {"$sum": "$amount"}}}]):
        bal[r["_id"].get("c") or "bank"] += r["s"] if r["_id"]["d"] == "CR" else -r["s"]
    return bal["bank"], bal["kas"]


async def isak35(year: int) -> Report:
    start, end = f"{year}-01-01", f"{year}-12-31"
    bank0, kas0 = await _opening(start)
    programs = {p["id"]: p async for p in db.programs.find({}, {"_id": 0, "id": 1, "name": 1})}
    unrestricted_in, restricted_in, restricted_out, expenses, internal = 0.0, {}, {}, {}, 0.0
    bank1, kas1 = bank0, kas0
    async for d in db.mutasi.find({"date": {"$gte": start, "$lte": end}}, {"_id": 0}):
        sign = 1 if d["direction"] == "CR" else -1
        if d.get("channel") == "kas":
            kas1 += sign * d["amount"]
        else:
            bank1 += sign * d["amount"]
        if d.get("ai_category") == "transfer_internal":
            internal += sign * d["amount"]
            continue
        allocs = d.get("allocations") or [{"program_id": None, "amount": d["amount"]}]
        rest = d["amount"] - sum(a["amount"] for a in allocs)
        for a in allocs + ([{"program_id": None, "amount": rest}] if abs(rest) > 0.01 else []):
            pname = programs.get(a.get("program_id") or "", {}).get("name", "")
            restricted = bool(pname) and pname.lower() != "umum"
            if d["direction"] == "CR":
                if restricted:
                    restricted_in[pname] = restricted_in.get(pname, 0) + a["amount"]
                else:
                    unrestricted_in += a["amount"]
            elif restricted:
                restricted_out[pname] = restricted_out.get(pname, 0) + a["amount"]
            else:
                k = CAT_LABEL.get(d.get("ai_category", ""), "Beban lain-lain")
                expenses[k] = expenses.get(k, 0) + a["amount"]
    tot_exp = sum(expenses.values())
    r_in, r_out = sum(restricted_in.values()), sum(restricted_out.values())
    surplus_u = unrestricted_in - tot_exp
    surplus_r = r_in - r_out
    net0 = bank0 + kas0
    # Restricted opening = cumulative restricted net before the year (from program collected/disbursed history)
    r0 = 0.0
    async for d in db.mutasi.aggregate([{"$match": {"date": {"$lt": start}}}, {"$unwind": "$allocations"}, {"$match": {"allocations.program_id": {"$in": [k for k, p in programs.items() if p["name"].lower() != "umum"]}}},
                                         {"$group": {"_id": "$direction", "s": {"$sum": "$allocations.amount"}}}]):
        r0 += d["s"] if d["_id"] == "CR" else -d["s"]
    u0 = net0 - r0
    posisi = ReportSection(title=f"Laporan Posisi Keuangan per 31 Desember {year}", columns=["Pos", "Jumlah (Rp)"], rows=[
        ["ASET", None], ["  Kas", kas1], ["  Bank", bank1], ["  Jumlah aset", kas1 + bank1], ["LIABILITAS", None], ["  Jumlah liabilitas", 0.0],
        ["ASET NETO", None], ["  Tanpa pembatasan dari pemberi sumber daya", u0 + surplus_u + internal], ["  Dengan pembatasan dari pemberi sumber daya", r0 + surplus_r],
    ], total=["JUMLAH LIABILITAS DAN ASET NETO", kas1 + bank1])
    rows = [["PENDAPATAN TANPA PEMBATASAN", None], ["  Donasi umum / sumbangan keagamaan", unrestricted_in], ["BEBAN", None]]
    rows += [[f"  {k}", -v] for k, v in sorted(expenses.items())]
    rows += [["Surplus (defisit) tanpa pembatasan", surplus_u], ["PENDAPATAN DENGAN PEMBATASAN", None]]
    rows += [[f"  {k}", v] for k, v in sorted(restricted_in.items())]
    rows += [["  Aset neto dibebaskan dari pembatasan (penyaluran program)", -r_out], ["Surplus (defisit) dengan pembatasan", surplus_r], ["Penghasilan komprehensif lain", 0.0]]
    penghasilan = ReportSection(title=f"Laporan Penghasilan Komprehensif {year}", columns=["Pos", "Jumlah (Rp)"], rows=rows, total=["TOTAL PENGHASILAN KOMPREHENSIF", surplus_u + surplus_r])
    perubahan = ReportSection(title=f"Laporan Perubahan Aset Neto {year}", columns=["Pos", "Tanpa pembatasan", "Dengan pembatasan", "Jumlah"], rows=[
        ["Saldo awal", u0, r0, net0], ["Surplus (defisit) tahun berjalan", surplus_u, surplus_r, surplus_u + surplus_r], ["Transfer internal (netto)", internal, 0.0, internal],
    ], total=["Saldo akhir", u0 + surplus_u + internal, r0 + surplus_r, kas1 + bank1])
    arus = ReportSection(title=f"Laporan Arus Kas {year} (metode langsung)", columns=["Pos", "Jumlah (Rp)"], rows=[
        ["Penerimaan donasi tanpa pembatasan", unrestricted_in], ["Penerimaan donasi dengan pembatasan", r_in], ["Pembayaran beban", -tot_exp], ["Penyaluran program", -r_out],
        ["Kas bersih dari aktivitas operasi", unrestricted_in + r_in - tot_exp - r_out], ["Transfer internal (netto)", internal], ["Kenaikan (penurunan) kas & bank", kas1 + bank1 - net0],
        ["Kas & bank awal tahun", net0],
    ], total=["Kas & bank akhir tahun", kas1 + bank1])
    return Report(key="isak35", title=REPORTS["isak35"], period=str(year), sections=[posisi, penghasilan, perubahan, arus],
                  notes=["Disusun dari mutasi kas & bank berbasis kas. Pembatasan = donasi ke program selain 'Umum'. Beban dikelompokkan dari kategori AI mutasi; periksa sebelum disahkan."])


async def kasbank(year: int, month: str) -> Report:
    prefix = month or str(year)
    start = f"{month}-01" if month else f"{year}-01-01"
    bank0, kas0 = await _opening(start)
    sections = []
    for ch, opening in (("bank", bank0), ("kas", kas0)):
        bal, rows, cr, dbt = opening, [["", "", "Saldo awal", None, None, opening]], 0.0, 0.0
        async for d in db.mutasi.find({"channel": ch, "date": {"$regex": f"^{prefix}"}}, {"_id": 0}).sort([("date", 1), ("ord", 1)]):
            bal += d["amount"] if d["direction"] == "CR" else -d["amount"]
            cr += d["amount"] if d["direction"] == "CR" else 0
            dbt += d["amount"] if d["direction"] == "DB" else 0
            rows.append([d["date"], d.get("voucher_number") or VOUCHER[(ch, d["direction"])], (d.get("sender_name") or "") + " · " + d["description"][:60],
                         d["amount"] if d["direction"] == "CR" else None, d["amount"] if d["direction"] == "DB" else None, bal])
        sections.append(ReportSection(title=f"Buku {'Bank' if ch == 'bank' else 'Kas'} {prefix}", columns=["Tanggal", "Voucher", "Keterangan", "Masuk", "Keluar", "Saldo"], rows=rows, total=["", "", "Jumlah / saldo akhir", cr, dbt, bal]))
    return Report(key="kasbank", title=REPORTS["kasbank"], period=prefix, sections=sections)


async def per_program(year: int) -> Report:
    rows = []
    async for p in db.programs.find({}, {"_id": 0}).sort("name", 1):
        agg = {r["_id"]: r async for r in db.mutasi.aggregate([
            {"$match": {"date": {"$regex": f"^{year}"}}}, {"$unwind": "$allocations"}, {"$match": {"allocations.program_id": p["id"]}},
            {"$group": {"_id": "$direction", "s": {"$sum": "$allocations.amount"}, "donors": {"$addToSet": "$allocations.donor_id"}}}])}
        cr, dbt = agg.get("CR", {}).get("s", 0), agg.get("DB", {}).get("s", 0)
        rows.append([p["name"], p.get("kind", "donasi"), p.get("target", 0) or None, cr, dbt, cr - dbt, len([x for x in agg.get("CR", {}).get("donors", []) if x])])
    tot = ["Jumlah", "", None, sum(r[3] for r in rows), sum(r[4] for r in rows), sum(r[5] for r in rows), None]
    return Report(key="program", title=REPORTS["program"], period=str(year), sections=[ReportSection(title=f"Program {year}", columns=["Program", "Jenis", "Target", "Terkumpul", "Tersalurkan", "Sisa", "Donatur"], rows=rows, total=tot)])


async def donatur(year: int) -> Report:
    receipts: dict[str, list[str]] = {}
    async for r in db.receipts.find({"status": "aktif", "issued_date": {"$regex": f"^{year}"}}, {"_id": 0, "donor_id": 1, "number": 1}):
        receipts.setdefault(r["donor_id"], []).append(r["number"])
    rows = []
    async for r in db.mutasi.aggregate([{"$match": {"direction": "CR", "date": {"$regex": f"^{year}"}}}, {"$unwind": "$allocations"}, {"$match": {"allocations.donor_id": {"$ne": None}}},
                                         {"$group": {"_id": "$allocations.donor_id", "n": {"$first": "$allocations.donor_name"}, "s": {"$sum": "$allocations.amount"}, "c": {"$sum": 1}}}, {"$sort": {"s": -1}}]):
        d = await db.donors.find_one({"id": r["_id"]}, {"_id": 0, "npwp": 1}) or {}
        rows.append([r["n"], "ya" if d.get("npwp") else "-", r["c"], r["s"], len(receipts.get(r["_id"], [])), ", ".join(receipts.get(r["_id"], [])[:6])])
    return Report(key="donatur", title=REPORTS["donatur"], period=str(year), sections=[ReportSection(
        title=f"Donasi per donatur {year}", columns=["Donatur", "NPWP", "Kali donasi", "Total donasi", "Bukti terbit", "Nomor bukti"], rows=rows,
        total=["Jumlah", "", sum(r[2] for r in rows), sum(r[3] for r in rows), sum(r[4] for r in rows), ""])])


async def cicilan_recap(year: int) -> Report:
    sections = []
    async for p in db.programs.find({"kind": "cicilan"}, {"_id": 0, "id": 1}):
        m = await matrix(p["id"], year, {})
        rows = [[r.donor_name, "terdaftar" if r.registered else "tidak terdaftar", r.monthly_amount or None, r.total_paid, r.arrears,
                 ", ".join(c.month[5:] for c in r.cells if c.status in ("tunggak", "kurang")), sum(1 for c in r.cells if c.check == "admin")] for r in m.rows]
        sections.append(ReportSection(title=m.program_name, columns=["Anggota", "Status", "Per bulan", "Disetor", "Tunggakan", "Bulan tunggak", "Dikonfirmasi"], rows=rows,
                                      total=["Jumlah", "", None, m.total_paid, m.total_arrears, "", None]))
    return Report(key="cicilan", title=REPORTS["cicilan"], period=str(year), sections=sections)


async def build(key: str, year: int, month: str) -> Report:
    year = year or int(today_iso()[:4])
    if key == "isak35":
        return await isak35(year)
    if key == "kasbank":
        return await kasbank(year, month)
    if key == "program":
        return await per_program(year)
    if key == "donatur":
        return await donatur(year)
    if key == "cicilan":
        return await cicilan_recap(year)
    raise HTTPException(404, "Laporan tidak dikenal")


def _fmt(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return f"{v:,.0f}".replace(",", ".") if v >= 0 else "(" + f"{-v:,.0f}".replace(",", ".") + ")"
    return str(v)


def to_xlsx(r: Report) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for i, s in enumerate(r.sections):
        ws = wb.create_sheet(("".join(ch for ch in s.title if ch not in "[]:*?/\\")[:28] or "Sheet") + (f" {i}" if i else ""))
        ws.append([f"{r.title} — {s.title}"])
        ws["A1"].font = Font(bold=True, size=12)
        ws.append([])
        ws.append(s.columns)
        for c in ws[3]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="141D24")
        for row in s.rows:
            ws.append(row)
        if s.total:
            ws.append(s.total)
            for c in ws[ws.max_row]:
                c.font = Font(bold=True)
        for col in ws.iter_cols(min_row=4):
            for c in col:
                if isinstance(c.value, (int, float)):
                    c.number_format = "#,##0;(#,##0)"
        for idx, _ in enumerate(s.columns):
            ws.column_dimensions[chr(65 + idx)].width = 48 if idx == 0 or s.columns[idx] in ("Keterangan", "Nomor bukti") else 16
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_pdf(r: Report, org: str) -> bytes:
    buf = io.BytesIO()
    W, H = landscape(A4)
    c = canvas.Canvas(buf, pagesize=(W, H))
    L, R = 14 * mm, W - 14 * mm
    y = 0.0

    def header():
        nonlocal y
        _bold(c, L, H - 14 * mm, org.upper(), 11)
        c.setFont(FONT, 9)
        c.drawRightString(R, H - 14 * mm, f"{r.title} · {r.period} · dicetak {datetime.now().strftime('%d/%m/%Y')}")
        y = H - 24 * mm

    header()
    for s in r.sections:
        n = len(s.columns)
        widths = [0.4] + [0.6 / (n - 1)] * (n - 1) if n > 1 else [1.0]
        if s.columns[0] == "Tanggal":
            widths = [0.09, 0.12, 0.43, 0.12, 0.12, 0.12]
        xs = [L]
        for w in widths:
            xs.append(xs[-1] + w * (R - L))
        if y < 40 * mm:
            c.showPage()
            header()
        _bold(c, L, y, s.title, 11)
        y -= 7 * mm

        def line(vals, bold=False, head=False):
            nonlocal y
            if y < 16 * mm:
                c.showPage()
                header()
            if head:
                c.setFillColorRGB(0.08, 0.11, 0.14)
                c.rect(L, y - 1.8 * mm, R - L, 6 * mm, stroke=0, fill=1)
            for i, v in enumerate(vals):
                t = _fmt(v)
                size = 8.5
                while c.stringWidth(t, FONT, size) > (xs[i + 1] - xs[i] - 2 * mm) and len(t) > 3:
                    t = t[:-2]
                if head:
                    c.setFillColorRGB(1, 1, 1)
                elif isinstance(v, (int, float)) and v < 0:
                    c.setFillColorRGB(0.7, 0.1, 0.1)
                else:
                    c.setFillColorRGB(0.07, 0.07, 0.07)
                if bold or head:
                    _bold(c, xs[i] + 1 * mm if i == 0 or not isinstance(v, (int, float)) else xs[i + 1] - 1 * mm - c.stringWidth(t, FONT, size), y, t, size, c._fillColorObj)
                else:
                    c.setFont(FONT, size)
                    if isinstance(v, (int, float)) and i > 0:
                        c.drawRightString(xs[i + 1] - 1 * mm, y, t)
                    else:
                        c.drawString(xs[i] + 1 * mm, y, t)
            y -= 5.5 * mm

        line(s.columns, head=True)
        for row in s.rows:
            line(row, bold=all(v is None for v in row[1:]))
        if s.total:
            c.setLineWidth(0.6)
            c.line(L, y + 4 * mm, R, y + 4 * mm)
            line(s.total, bold=True)
        y -= 6 * mm
    c.setFont(FONT, 8)
    for note in r.notes:
        c.drawString(L, max(y, 10 * mm), note[:180])
        y -= 4 * mm
    c.showPage()
    c.save()
    return buf.getvalue()


@router.get("/reports/{key}", response_model=Report)
async def get_report(key: str, year: int = 0, month: str = "", _: dict = Depends(require("laporan"))):
    return await build(key, year, month)


@router.get("/reports/{key}/export")
async def export_report(key: str, format: str = "xlsx", year: int = 0, month: str = "", _: dict = Depends(require("laporan"))):
    r = await build(key, year, month)
    name = f"laporan_{key}_{r.period}"
    if format == "pdf":
        s = await db.settings.find_one({"id": "foundation"}, {"_id": 0}) or {}
        return Response(to_pdf(r, s.get("name", "")), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return Response(to_xlsx(r), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
