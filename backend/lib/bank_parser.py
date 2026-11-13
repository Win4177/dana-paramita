"""Configurable bank-statement parser (BCA default). Handles xlsx/csv, Indonesian & English
number formats (1.000.000,00 / 1,000,000.00), local date formats and CR/DB suffixes."""

import csv
import hashlib
import io
import re
from datetime import date, datetime

from openpyxl import load_workbook

from lib.common import norm


def read_rows(content: bytes, filename: str) -> list[list]:
    if filename.lower().endswith((".xlsx", ".xlsm")):
        wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    text = None
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            text = content.decode(enc)
            if enc == "utf-16" and "\x00" in text:
                continue
            break
        except UnicodeDecodeError:
            continue
    text = text or ""
    sample = text[:4000]
    delim = ","
    try:
        delim = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        if sample.count(";") > sample.count(","):
            delim = ";"
    return [row for row in csv.reader(io.StringIO(text), delimiter=delim)]


def parse_number(value, fmt: str = "auto") -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().upper().replace("RP", "").replace("IDR", "")
    s = re.sub(r"\b(CR|DB|D|K)\b", "", s).replace(" ", "").replace("'", "")
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.strip("-()+")
    if not s or not re.search(r"\d", s):
        return None
    if fmt == "id":
        s = s.replace(".", "").replace(",", ".")
    elif fmt == "en":
        s = s.replace(",", "")
    else:
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):
                s = s.replace(".", "").replace(",", ".")
            else:
                s = s.replace(",", "")
        elif "," in s:
            parts = s.split(",")
            if len(parts) == 2 and len(parts[1]) <= 2:
                s = s.replace(",", ".")
            else:
                s = s.replace(",", "")
        elif "." in s:
            parts = s.split(".")
            if len(parts) > 2 or len(parts[1]) == 3:
                s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def parse_date(value, default_year: int) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip().strip("'").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.match(r"^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$", s.split(" ")[0])
        if not m:
            return None
        d, mo = int(m[1]), int(m[2])
        y = int(m[3]) if m[3] else default_year
        if y < 100:
            y += 2000
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


_NOISE = {"TRSF", "E-BANKING", "CR", "DB", "TRANSFER", "DR", "KE", "DARI", "SWITCHING", "BI-FAST", "BIF", "KR", "OTOMATIS", "LLG-ANTAR", "BANK", "SETORAN", "TUNAI", "MYBCA", "-"}


def extract_sender(desc: str) -> str:
    """Heuristic for BCA keterangan: name = words after the last token containing a digit."""
    tokens = (desc or "").split()
    last_digit = -1
    for i, t in enumerate(tokens):
        if re.search(r"\d", t):
            last_digit = i
    tail = [t for t in tokens[last_digit + 1:] if t.upper() not in _NOISE]
    return " ".join(tail).strip().upper()


def row_hash(d: str, amount: float, direction: str, desc: str, balance: float | None) -> str:
    raw = f"{d}|{amount:.2f}|{direction}|{norm(desc)}|{(balance or 0):.2f}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _find_col(header: list[str], name: str | None) -> int | None:
    if not name:
        return None
    key = norm(name)
    for i, h in enumerate(header):
        if norm(h) == key:
            return i
    for i, h in enumerate(header):
        if key and key in norm(h):
            return i
    return None


def find_header(rows: list[list], keys: list[str]) -> int | None:
    for idx, row in enumerate(rows[:60]):
        cells = [norm(str(c)) for c in row if c is not None]
        if all(any(norm(k) in c for c in cells) for k in keys if k):
            return idx
    return None


def detect_year(rows: list[list], header_idx: int) -> int:
    for row in rows[:header_idx]:
        text = " ".join(str(c) for c in row if c is not None)
        m = re.search(r"\d{1,2}/\d{1,2}/(\d{4})", text)
        if m:
            return int(m[1])
    return date.today().year


def parse_statement(rows: list[list], tpl: dict) -> tuple[list[dict], list[str]]:
    """Returns (transactions, errors). Each tx: date, description, sender_name, direction, amount, balance, hash."""
    header_idx = find_header(rows, [tpl.get("col_date"), tpl.get("col_description")])
    if header_idx is None:
        return [], [f"Header kolom '{tpl.get('col_date')}' / '{tpl.get('col_description')}' tidak ditemukan. Periksa template parser."]
    header = [str(c) if c is not None else "" for c in rows[header_idx]]
    col = {k: _find_col(header, tpl.get(k)) for k in ("col_date", "col_description", "col_amount", "col_dbcr", "col_debit", "col_credit", "col_balance", "col_sender")}
    # BCA CSV puts the CR/DB marker in an unnamed column right after "Jumlah".
    if col["col_amount"] is not None and col["col_dbcr"] is None and col["col_debit"] is None:
        nxt = col["col_amount"] + 1
        if nxt < len(header) and header[nxt].strip() == "":
            col["col_dbcr"] = nxt
    year = detect_year(rows, header_idx)
    fmt = tpl.get("number_format", "auto")
    out, errors, last_date = [], [], None

    def cell(row, key):
        i = col[key]
        return row[i] if i is not None and i < len(row) else None

    for n, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
        if not row or all(c in (None, "") for c in row):
            continue
        raw_date = cell(row, "col_date")
        desc = str(cell(row, "col_description") or "").strip()
        d = parse_date(raw_date, year)
        if d is None:
            if str(raw_date or "").strip().upper().strip("'") == "PEND" and last_date:
                d = last_date
            else:
                continue  # footer rows (Saldo Awal, Mutasi Debet, ...) or blank
        last_date = d
        direction, amount = None, None
        if col["col_debit"] is not None or col["col_credit"] is not None:
            deb = parse_number(cell(row, "col_debit"), fmt) or 0
            cre = parse_number(cell(row, "col_credit"), fmt) or 0
            direction, amount = ("CR", cre) if cre else ("DB", deb)
        else:
            raw_amt = cell(row, "col_amount")
            amount = parse_number(raw_amt, fmt)
            marker = str(cell(row, "col_dbcr") or "").upper() + " " + str(raw_amt or "").upper()
            if re.search(r"\bDB\b|\bD\b", marker):
                direction = "DB"
            elif re.search(r"\bCR\b|\bK\b", marker):
                direction = "CR"
            elif amount is not None:
                direction = "DB" if amount < 0 else "CR"
            if amount is not None:
                amount = abs(amount)
        if not amount:
            errors.append(f"Baris {n}: nominal tidak terbaca ({desc[:40]})")
            continue
        balance = parse_number(cell(row, "col_balance"), fmt)
        sender = str(cell(row, "col_sender") or "").strip().upper() or extract_sender(desc)
        out.append({
            "date": d, "description": desc, "sender_name": sender, "direction": direction,
            "amount": round(amount, 2), "balance": round(balance, 2) if balance is not None else None,
            "hash": row_hash(d, amount, direction, desc, balance),
        })
    return out, errors
