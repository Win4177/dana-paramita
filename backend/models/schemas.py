"""Pydantic v2 models. Mirrored by hand in frontend/src/lib/types.ts — keep in sync."""

from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "staf", "rekan", "auditor"]
MutasiStatus = Literal["belum", "ok", "perlu"]
Jenis = Literal["donasi", "cicilan", "lainnya"]


# ---------- Auth / users ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PinLoginIn(BaseModel):
    pin: str = Field(min_length=4, max_length=12)


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: Role
    modules: list[str]
    active: bool
    has_pin: bool = False
    pin_expires_at: Optional[str] = None
    last_login_at: Optional[str] = None


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1)
    role: Role
    password: Optional[str] = Field(default=None, min_length=8)
    modules: Optional[list[str]] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    modules: Optional[list[str]] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class PinIssueIn(BaseModel):
    expires_days: Optional[int] = Field(default=None, ge=1, le=365)


class PinIssueOut(BaseModel):
    pin: str
    pin_expires_at: Optional[str] = None


class Attachment(BaseModel):
    id: str
    filename: str
    content_type: str
    size: int
    uploaded_at: str = ""
    uploaded_by: str = ""
    doc_type: str = ""
    doc_type_confidence: Optional[float] = None


# ---------- Donors ----------
class DonorIn(BaseModel):
    name_latin: str = ""
    name_mandarin: str = ""
    alias: str = ""
    phone: str = ""
    address: str = ""
    npwp: str = ""
    email: str = ""
    bank_accounts: list[str] = []
    pic: str = ""
    notes: str = ""


class Donor(DonorIn):
    id: str
    name_pinyin: str = ""
    total_donasi: float = 0
    donation_count: int = 0
    created_at: str = ""
    documents: list[Attachment] = []


class DonorHistoryItem(BaseModel):
    mutasi_id: str
    date: str
    description: str
    sender_name: str
    program_id: Optional[str] = None
    program_name: str = ""
    jenis: str
    amount: float
    status: str


class DonorProfile(BaseModel):
    donor: Donor
    history: list[DonorHistoryItem]
    per_program: list[dict]


class DuplicateGroup(BaseModel):
    key: str
    donors: list[Donor]
    ai_score: Optional[float] = None


class MergeIn(BaseModel):
    target_id: str
    source_ids: list[str] = Field(min_length=1)


# ---------- Programs ----------
class ProgramIn(BaseModel):
    name: str = Field(min_length=1)
    name_mandarin: str = ""
    description: str = ""
    kind: Literal["donasi", "cicilan"] = "donasi"
    target: float = 0
    start_date: str = ""
    end_date: str = ""
    status: Literal["aktif", "selesai"] = "aktif"
    pic: str = ""
    monthly_amount: float = 0


class Program(ProgramIn):
    id: str
    collected: float = 0
    disbursed: float = 0
    remaining: float = 0
    donor_count: int = 0


class MonthPoint(BaseModel):
    month: str
    masuk: float
    keluar: float


class ProgramDetail(BaseModel):
    program: Program
    monthly: list[MonthPoint]
    top_donors: list[dict]


# ---------- Mutasi ----------
class Allocation(BaseModel):
    donor_id: Optional[str] = None
    donor_name: str = ""
    program_id: Optional[str] = None
    program_name: str = ""
    jenis: Jenis = "donasi"
    amount: float
    notes: str = ""
    receipt_id: Optional[str] = None
    receipt_number: str = ""


class Mutasi(BaseModel):
    id: str
    hash: str
    date: str
    description: str
    sender_name: str
    direction: Literal["CR", "DB"]
    amount: float
    balance: Optional[float] = None
    channel: Literal["bank", "kas"] = "bank"
    voucher_type: str = ""
    status: MutasiStatus = "belum"
    notes: str = ""
    allocations: list[Allocation] = []
    suggested: bool = False
    import_id: str = ""
    created_at: str = ""
    attachments: list[Attachment] = []
    ai_status: Literal["", "ok", "fallback"] = ""
    ai_category: str = ""
    ai_confidence: Optional[float] = None
    ai_match_score: Optional[float] = None
    ai_anomaly: Optional[float] = None


class MutasiPage(BaseModel):
    items: list[Mutasi]
    total: int
    sum_cr: float
    sum_db: float


class MutasiPatch(BaseModel):
    status: Optional[MutasiStatus] = None
    channel: Optional[Literal["bank", "kas"]] = None
    notes: Optional[str] = None
    sender_name: Optional[str] = None
    # single-allocation inline edit (only when not split)
    donor_id: Optional[str] = None
    program_id: Optional[str] = None
    jenis: Optional[Jenis] = None
    clear_allocation: bool = False


class SplitIn(BaseModel):
    allocations: list[Allocation] = Field(min_length=1)


class BulkStatusIn(BaseModel):
    ids: list[str] = Field(min_length=1)
    status: MutasiStatus


class ImportResult(BaseModel):
    import_id: str
    mode: Literal["bank", "roundtrip"]
    total_rows: int
    inserted: int
    duplicates: int
    updated: int
    suggested: int
    errors: list[str]


class AiAnalyzeIn(BaseModel):
    ids: list[str] = []
    only_new: bool = True


class AiAnalyzeResult(BaseModel):
    processed: int
    classified: int
    matched: int
    flagged: int
    failed: int


class ImportRecord(BaseModel):
    id: str
    filename: str
    at: str
    user: str
    mode: str
    inserted: int = 0
    duplicates: int = 0
    updated: int = 0
    file_id: Optional[str] = None


class Reconciliation(BaseModel):
    channel: str
    last_date: Optional[str] = None
    bank_balance: Optional[float] = None
    opening_balance: float
    total_cr: float
    total_db: float
    book_balance: float
    difference: Optional[float] = None


# ---------- Settings ----------
class Settings(BaseModel):
    name: str = ""
    name_mandarin: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    register_no: str = ""
    bank_name: str = ""
    bank_account: str = ""
    bank_account_holder: str = ""
    logo_data_url: str = ""
    accounting_standard: Literal["ISAK35", "SAK_EMKM"] = "ISAK35"
    fiscal_year: int = 2026
    opening_bank_balance: float = 0
    opening_cash_balance: float = 0
    receipt_number_format: str = "{seq:06d} {month:02d} {year} {code}"
    receipt_code: str = "035"
    receipt_digital_from: int = 1001
    receipt_merge_same_day: bool = True
    signer_name: str = ""
    signer_title: str = ""
    signature_data_url: str = ""
    approval_threshold: float = 20000000
    footer_quote: str = ""


class ParserTemplateIn(BaseModel):
    name: str = Field(min_length=1)
    bank: str = "BCA"
    col_date: str = "Tanggal"
    col_description: str = "Keterangan"
    col_amount: str = ""
    col_dbcr: str = ""
    col_debit: str = ""
    col_credit: str = ""
    col_balance: str = "Saldo"
    col_sender: str = ""
    number_format: Literal["auto", "id", "en"] = "auto"
    is_default: bool = False


class ParserTemplate(ParserTemplateIn):
    id: str


# ---------- Dashboard / audit ----------
class TaskItem(BaseModel):
    key: str
    label: str
    count: int
    link: str
    severity: Literal["info", "warning", "danger"]


class Dashboard(BaseModel):
    today: str
    bank_balance: float
    cash_balance: float
    donasi_bulan_ini: float
    pengeluaran_bulan_ini: float
    total_donatur: int
    mutasi_belum_kategori: int
    mutasi_perlu_cek: int
    mutasi_belum_cek: int
    programs: list[Program]
    tasks: list[TaskItem]
    monthly: list[MonthPoint]


class AuditEntry(BaseModel):
    id: str
    at: str
    user_name: str
    action: str
    entity: str
    entity_id: str
    summary: str


class AuditPage(BaseModel):
    items: list[AuditEntry]
    total: int


# ---------- Bukti pembayaran (tanda terima donasi) ----------
class ReceiptItemRef(BaseModel):
    mutasi_id: str
    alloc_index: int = Field(ge=0)


class EligibleItem(BaseModel):
    mutasi_id: str
    alloc_index: int
    date: str
    sender_name: str
    donor_id: str
    donor_name: str
    program_name: str = ""
    jenis: str
    amount: float


class IssueIn(BaseModel):
    items: list[ReceiptItemRef] = Field(min_length=1)


class Receipt(BaseModel):
    id: str
    number: str
    seq: int
    issued_date: str
    donation_date: str
    donor_id: str
    donor_name: str
    npwp: str = ""
    donor_address: str = ""
    program_names: list[str] = []
    amount: float
    terbilang: str
    items: list[ReceiptItemRef]
    status: Literal["aktif", "batal"] = "aktif"
    cancel_reason: str = ""
    replaces: Optional[str] = None
    replaced_by: Optional[str] = None
    issued_by: str = ""
    issued_at: str = ""
    cancelled_by: str = ""
    cancelled_at: str = ""


class ReceiptPage(BaseModel):
    items: list[Receipt]
    total: int


class IssueResult(BaseModel):
    issued: list[Receipt]
    skipped: int


class CancelIn(BaseModel):
    reason: str = Field(min_length=3)
    reissue: bool = False


# ---------- Cicilan ----------
class CicilanMember(BaseModel):
    donor_id: str
    donor_name: str = ""
    monthly_amount: float = Field(gt=0)
    start_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    end_month: str = ""


class MembersIn(BaseModel):
    members: list[CicilanMember]


class CicilanCell(BaseModel):
    month: str
    expected: float
    paid: float
    status: Literal["lunas", "lebih", "kurang", "tunggak", "kosong", "mendatang"]
    check: Literal["belum", "rekan", "admin"] = "belum"
    rekan_by: str = ""
    admin_by: str = ""


class CicilanRow(BaseModel):
    donor_id: str
    donor_name: str
    registered: bool
    monthly_amount: float
    start_month: str = ""
    end_month: str = ""
    cells: list[CicilanCell]
    total_paid: float
    arrears: float


class CicilanMatrix(BaseModel):
    program_id: str
    program_name: str
    year: int
    years: list[int]
    months: list[str]
    today_month: str
    rows: list[CicilanRow]
    total_expected: float
    total_paid: float
    total_arrears: float


class CheckIn(BaseModel):
    donor_id: str
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    stage: Literal["rekan", "admin"]
    undo: bool = False


# ---------- Foto nota ----------
class NotaRead(BaseModel):
    file_id: str
    date: str = ""
    amount: float = 0
    description: str = ""
    vendor: str = ""
    direction: Literal["CR", "DB"] = "DB"
    model: str = ""
    candidates: list[Mutasi] = []


class KasIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    direction: Literal["CR", "DB"] = "DB"
    sender_name: str = ""
    notes: str = ""
    file_id: Optional[str] = None


class LinkFileIn(BaseModel):
    file_id: str


class ShareLink(BaseModel):
    url: str
    email: str
    subject: str
    body: str


class EmailResult(BaseModel):
    sent_to: str


class Reminder(BaseModel):
    program_id: str
    program_name: str
    month: str
    text: str
    overdue_count: int
    total_arrears: float
    created_at: str = ""


# ---------- Voucher ----------
VoucherType = Literal["BKM", "BKK", "BBM", "BBK"]


class Voucher(BaseModel):
    id: str
    number: str
    type: VoucherType
    seq: int
    month: str
    mutasi_id: str
    date: str
    description: str
    party: str = ""
    amount: float
    status: Literal["menunggu", "disetujui", "batal"]
    needs_approval: bool = False
    approved_by: str = ""
    approved_at: str = ""
    created_by: str = ""
    created_at: str = ""
    cancel_reason: str = ""


class VoucherIssueIn(BaseModel):
    mutasi_ids: list[str] = Field(min_length=1)


class VoucherIssueResult(BaseModel):
    issued: list[Voucher]
    skipped: int


# ---------- Laporan ----------
class ReportSection(BaseModel):
    title: str
    columns: list[str]
    rows: list[list]
    total: Optional[list] = None


class Report(BaseModel):
    key: str
    title: str
    period: str
    sections: list[ReportSection]
    notes: list[str] = []
