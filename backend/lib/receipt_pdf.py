"""Receipt PDF in the foundation's official format (A4: kop, black title bar, Tanggal/No boxes, underlined
fields, Uang/Barang checkboxes, # terbilang #, two signature blocks, bank footer, yellow quote band),
with a bundled CJK font, followed by the PER-3/PJ/2023 regulation pages."""

import io
from pathlib import Path

import pymupdf
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).parent.parent
FONT = "CJK"
pdfmetrics.registerFont(TTFont(FONT, str(ROOT / "fonts" / "wqy-zenhei.ttc"), subfontIndex=0))
REGULATION = ROOT / "assets" / "per-3-pj-2023.pdf"

INK = colors.HexColor("#111111")
MUTED = colors.HexColor("#555555")
GOLD = colors.HexColor("#C9B037")


def rupiah(n: float) -> str:
    return "Rp " + f"{n:,.0f}".replace(",", ".") + ",-"


def _bold(c: canvas.Canvas, x: float, y: float, text: str, size: float, color=INK, centered: bool = False) -> None:
    t = c.beginText()
    t.setFont(FONT, size)
    t.setTextRenderMode(2)  # fill + stroke = faux bold (CJK font has one weight)
    c.setFillColor(color)
    c.setStrokeColor(color)
    c.setLineWidth(0.35)
    w = c.stringWidth(text, FONT, size)
    t.setTextOrigin(x - (w / 2 if centered else 0), y)
    t.textLine(text)
    t.setTextRenderMode(0)  # reset so later plain text isn't stroked
    c.drawText(t)


def _fit(c, text, size, max_w):
    while size > 6 and c.stringWidth(text, FONT, size) > max_w:
        size -= 0.5
    return size


def _wrap(c, text, size, max_w):
    lines, cur = [], ""
    for w in (text or "").split():
        trial = f"{cur} {w}".strip()
        if c.stringWidth(trial, FONT, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    return lines + ([cur] if cur else [])


def _receipt_page(r: dict, s: dict, logo: bytes | None, signature: bytes | None) -> bytes:
    buf = io.BytesIO()
    W, H = A4
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Bukti Pembayaran {r['number']}")
    L, R = 16 * mm, W - 16 * mm

    # Kop
    top = H - 14 * mm
    x = L
    if logo:
        try:
            c.drawImage(ImageReader(io.BytesIO(logo)), L, top - 26 * mm, 26 * mm, 26 * mm, preserveAspectRatio=True, mask="auto")
            x = L + 30 * mm
        except Exception:
            pass
    name = (s.get("name") or "").upper()
    _bold(c, x, top - 7 * mm, name, _fit(c, name, 17, R - x))
    c.setFillColor(INK)
    c.setFont(FONT, 9)
    c.drawString(x, top - 12.5 * mm, s.get("address", "")[:120])
    c.drawString(x, top - 17 * mm, f"Telp. {s.get('phone', '')}   Email : {s.get('email', '')}")
    c.drawString(x, top - 21.5 * mm, f"No. Register : {s.get('register_no', '')}")
    c.setStrokeColor(INK)
    c.setLineWidth(1.2)
    c.line(L - 4 * mm, top - 29 * mm, R + 4 * mm, top - 29 * mm)

    # Title bar: black "BUKTI PEMBAYARAN" + outlined subtitle
    y = top - 44 * mm
    bw = 52 * mm
    c.setFillColor(INK)
    c.rect(L, y, bw, 11 * mm, stroke=0, fill=1)
    _bold(c, L + bw / 2, y + 3.4 * mm, "BUKTI PEMBAYARAN", 14, colors.white, centered=True)
    c.setLineWidth(1)
    c.rect(L + bw, y, R - L - bw, 11 * mm, stroke=1, fill=0)
    _bold(c, L + bw + (R - L - bw) / 2, y + 3.4 * mm, "DANA SOSIAL KEAGAMAAN BUDDHA WAJIB", 14, centered=True)

    # Tanggal / No boxes
    y -= 17 * mm
    yy, mo, dd = r["issued_date"].split("-")
    c.roundRect(L, y, 70 * mm, 10 * mm, 2.5 * mm, stroke=1, fill=0)
    c.setFillColor(INK)
    c.setFont(FONT, 12)
    c.drawString(L + 4 * mm, y + 3.2 * mm, f"Tanggal :  {dd} / {mo} / {yy}")
    nx = L + 80 * mm
    c.roundRect(nx, y, R - nx, 10 * mm, 2.5 * mm, stroke=1, fill=0)
    c.drawString(nx + 4 * mm, y + 3.2 * mm, f"No. :  {r['number']}")

    # Fields
    lx, vx = L + 4 * mm, L + 38 * mm
    y -= 16 * mm

    def field(label: str, values: list[str], size: float = 12.5):
        nonlocal y
        c.setFillColor(INK)
        c.setFont(FONT, 12)
        c.drawString(lx, y, label)
        c.drawString(vx - 6 * mm, y, ":")
        for i, v in enumerate(values or [""]):
            c.setFont(FONT, _fit(c, v, size, R - vx - 8 * mm))
            c.drawString(vx, y, v)
            c.setLineWidth(0.6)
            c.line(vx - 1 * mm, y - 1.8 * mm, R - 8 * mm, y - 1.8 * mm)
            if i < len(values) - 1:
                y -= 9 * mm
        y -= 11 * mm

    field("Nama Donatur", [r["donor_name"]])
    field("NPWP", [r.get("npwp") or "-"])
    addr = _wrap(c, r.get("donor_address") or "-", 12, R - vx - 10 * mm)[:2]
    field("Alamat", addr + ([""] if len(addr) < 2 else []))
    # Donasi: Uang / Barang
    c.setFont(FONT, 12)
    c.drawString(lx, y, "Donasi")
    c.drawString(vx - 6 * mm, y, ":")
    for i, (lbl, on) in enumerate((("Uang", True), ("Barang", False))):
        bx = vx + i * 45 * mm
        c.setLineWidth(0.8)
        c.rect(bx, y - 0.6 * mm, 4.2 * mm, 4.2 * mm, stroke=1, fill=0)
        if on:
            c.setLineWidth(1.4)
            c.line(bx + 0.8 * mm, y + 1.6 * mm, bx + 1.9 * mm, y + 0.2 * mm)
            c.line(bx + 1.9 * mm, y + 0.2 * mm, bx + 3.8 * mm, y + 3.6 * mm)
        c.drawString(bx + 6 * mm, y, lbl)
    y -= 11 * mm
    field("Nominal", [rupiah(r["amount"])], 14)
    terb = "# " + r["terbilang"].title() + " #"
    tl = _wrap(c, terb, 12.5, R - vx - 10 * mm)[:2]
    field("Terbilang", tl + ([""] if len(tl) < 2 else []))
    if r.get("program_names"):
        c.setFillColor(MUTED)
        c.setFont(FONT, 9)
        c.drawString(vx, y + 4 * mm, "Untuk: " + ", ".join(r["program_names"]) + f"  ·  tanggal donasi {r['donation_date'][8:10]}/{r['donation_date'][5:7]}/{r['donation_date'][:4]}")

    # Signatures
    y -= 12 * mm
    c.setFillColor(INK)
    c.setFont(FONT, 12)
    c.drawCentredString(L + 42 * mm, y, "Diterima oleh")
    c.drawCentredString(R - 42 * mm, y, "Donatur")
    sy = y - 36 * mm
    if signature:
        try:
            c.drawImage(ImageReader(io.BytesIO(signature)), L + 22 * mm, sy + 4 * mm, 40 * mm, 24 * mm, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    signer = s.get("signer_name") or ""
    c.drawCentredString(L + 42 * mm, sy, f"( {signer.center(28, '.') if signer else '.' * 40} )")
    c.drawCentredString(R - 42 * mm, sy, f"( {'.' * 44} )")

    # Bank footer + lembar
    fy = sy - 18 * mm
    for i, t in enumerate([f"NO. REKENING : {s.get('bank_account', '').replace(' ', '-')}", (s.get("bank_account_holder") or "").upper(), (s.get("bank_name") or "").upper()]):
        _bold(c, L + 50 * mm, fy - i * 6 * mm, t, 11.5, centered=True)
    c.setFont(FONT, 11)
    for i, t in enumerate(["Lembar 1 : Donatur", "Lembar 2 : Administrasi", "Lembar 3 : Rekap"]):
        c.drawString(R - 52 * mm, fy - i * 5.5 * mm, t)

    # Yellow quote band
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 24 * mm, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#FFF6C8"))
    c.rect(0, 23 * mm, W, 1.2 * mm, stroke=0, fill=1)
    c.setFillColor(INK)
    lines = _wrap(c, s.get("footer_quote", ""), 11.5, W - 30 * mm)[:3]
    for i, line in enumerate(lines):
        c.setFont(FONT, 11.5)
        c.drawString(15 * mm, 15 * mm - i * 6 * mm, line)

    if r.get("status") == "batal":
        c.saveState()
        c.setFillColor(colors.Color(0.85, 0.1, 0.1, alpha=0.22))
        c.setFont(FONT, 80)
        c.translate(W / 2, H / 2)
        c.rotate(30)
        c.drawCentredString(0, 0, "DIBATALKAN")
        c.restoreState()
        c.setFillColor(colors.HexColor("#B91C1C"))
        c.setFont(FONT, 9)
        c.drawString(L, top - 50 * mm + 3 * mm, f"Dibatalkan: {r.get('cancel_reason', '')}")
    c.showPage()
    c.save()
    return buf.getvalue()


def render_receipt(r: dict, s: dict, logo: bytes | None, signature: bytes | None, with_regulation: bool = True) -> bytes:
    page = _receipt_page(r, s, logo, signature)
    if not with_regulation or not REGULATION.exists():
        return page
    out = pymupdf.open(stream=page, filetype="pdf")
    out.insert_pdf(pymupdf.open(REGULATION))
    return out.tobytes(garbage=3, deflate=True)
