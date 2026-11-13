"""Indonesian number-to-words for receipts: 6100000 -> 'enam juta seratus ribu rupiah'."""

_ONES = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]


def _words(n: int) -> str:
    if n < 12:
        return _ONES[n]
    if n < 20:
        return f"{_ONES[n - 10]} belas"
    if n < 100:
        return f"{_ONES[n // 10]} puluh {_words(n % 10)}".strip()
    if n < 200:
        return f"seratus {_words(n - 100)}".strip()
    if n < 1000:
        return f"{_ONES[n // 100]} ratus {_words(n % 100)}".strip()
    if n < 2000:
        return f"seribu {_words(n - 1000)}".strip()
    for size, name in ((10**12, "triliun"), (10**9, "miliar"), (10**6, "juta"), (10**3, "ribu")):
        if n >= size:
            return f"{_words(n // size)} {name} {_words(n % size)}".strip()
    return ""


def terbilang(amount: float) -> str:
    n = int(round(amount))
    if n == 0:
        return "nol rupiah"
    return " ".join(_words(n).split()) + " rupiah"
