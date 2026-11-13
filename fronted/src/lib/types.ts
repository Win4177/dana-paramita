// Hand-written mirrors of backend/models/schemas.py — keep in sync.

export type Role = "admin" | "staf" | "rekan" | "auditor";
export type MutasiStatus = "belum" | "ok" | "perlu";
export type Jenis = "donasi" | "cicilan" | "lainnya";

export interface UserOut {
  id: string;
  email: string;
  name: string;
  role: Role;
  modules: string[];
  active: boolean;
  has_pin: boolean;
  pin_expires_at: string | null;
  last_login_at: string | null;
}

export interface UserCreate {
  email: string;
  name: string;
  role: Role;
  password?: string | null;
  modules?: string[] | null;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  modules?: string[];
  active?: boolean;
  password?: string;
}

export interface PinIssueOut {
  pin: string;
  pin_expires_at: string | null;
}

export interface DonorIn {
  name_latin: string;
  name_mandarin: string;
  alias: string;
  phone: string;
  address: string;
  npwp: string;
  email: string;
  bank_accounts: string[];
  pic: string;
  notes: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string;
  doc_type: string;
  doc_type_confidence: number | null;
}

export interface Donor extends DonorIn {
  id: string;
  name_pinyin: string;
  total_donasi: number;
  donation_count: number;
  created_at: string;
  documents: Attachment[];
}

export interface DonorHistoryItem {
  mutasi_id: string;
  date: string;
  description: string;
  sender_name: string;
  program_id: string | null;
  program_name: string;
  jenis: string;
  amount: number;
  status: string;
}

export interface DonorProfile {
  donor: Donor;
  history: DonorHistoryItem[];
  per_program: { program: string; jenis: string; total: number; count: number }[];
}

export interface DuplicateGroup {
  key: string;
  donors: Donor[];
  ai_score: number | null;
}

export interface ProgramIn {
  name: string;
  name_mandarin: string;
  description: string;
  kind: "donasi" | "cicilan";
  target: number;
  start_date: string;
  end_date: string;
  status: "aktif" | "selesai";
  pic: string;
  monthly_amount: number;
}

export interface Program extends ProgramIn {
  id: string;
  collected: number;
  disbursed: number;
  remaining: number;
  donor_count: number;
}

export interface MonthPoint {
  month: string;
  masuk: number;
  keluar: number;
}

export interface ProgramDetail {
  program: Program;
  monthly: MonthPoint[];
  top_donors: { donor_id: string; name: string; total: number; count: number }[];
}

export interface Allocation {
  donor_id: string | null;
  donor_name: string;
  program_id: string | null;
  program_name: string;
  jenis: Jenis;
  amount: number;
  notes: string;
  // always present in responses; optional so split rows can be built client-side
  receipt_id?: string | null;
  receipt_number?: string;
}

export interface Mutasi {
  id: string;
  hash: string;
  date: string;
  description: string;
  sender_name: string;
  direction: "CR" | "DB";
  amount: number;
  balance: number | null;
  channel: "bank" | "kas";
  voucher_type: string;
  status: MutasiStatus;
  notes: string;
  allocations: Allocation[];
  suggested: boolean;
  import_id: string;
  created_at: string;
  attachments: Attachment[];
  ai_status: "" | "ok" | "fallback";
  ai_category: string;
  ai_confidence: number | null;
  ai_match_score: number | null;
  ai_anomaly: number | null;
}

export interface AiAnalyzeIn {
  ids: string[];
  only_new: boolean;
}

export interface AiAnalyzeResult {
  processed: number;
  classified: number;
  matched: number;
  flagged: number;
  failed: number;
}

export interface ImportRecord {
  id: string;
  filename: string;
  at: string;
  user: string;
  mode: string;
  inserted: number;
  duplicates: number;
  updated: number;
  file_id: string | null;
}

export interface MutasiPage {
  items: Mutasi[];
  total: number;
  sum_cr: number;
  sum_db: number;
}

export interface MutasiPatch {
  status?: MutasiStatus;
  channel?: "bank" | "kas";
  notes?: string;
  sender_name?: string;
  donor_id?: string;
  program_id?: string;
  jenis?: Jenis;
  clear_allocation?: boolean;
}

export interface ImportResult {
  import_id: string;
  mode: "bank" | "roundtrip";
  total_rows: number;
  inserted: number;
  duplicates: number;
  updated: number;
  suggested: number;
  errors: string[];
}

export interface Reconciliation {
  channel: string;
  last_date: string | null;
  bank_balance: number | null;
  opening_balance: number;
  total_cr: number;
  total_db: number;
  book_balance: number;
  difference: number | null;
}

export interface Settings {
  name: string;
  name_mandarin: string;
  address: string;
  phone: string;
  email: string;
  register_no: string;
  bank_name: string;
  bank_account: string;
  bank_account_holder: string;
  logo_data_url: string;
  accounting_standard: "ISAK35" | "SAK_EMKM";
  fiscal_year: number;
  opening_bank_balance: number;
  opening_cash_balance: number;
  receipt_number_format: string;
  receipt_code: string;
  receipt_digital_from: number;
  receipt_merge_same_day: boolean;
  signer_name: string;
  signer_title: string;
  signature_data_url: string;
  approval_threshold: number;
  footer_quote: string;
}

export interface ParserTemplateIn {
  name: string;
  bank: string;
  col_date: string;
  col_description: string;
  col_amount: string;
  col_dbcr: string;
  col_debit: string;
  col_credit: string;
  col_balance: string;
  col_sender: string;
  number_format: "auto" | "id" | "en";
  is_default: boolean;
}

export interface ParserTemplate extends ParserTemplateIn {
  id: string;
}

export interface TaskItem {
  key: string;
  label: string;
  count: number;
  link: string;
  severity: "info" | "warning" | "danger";
}

export interface Dashboard {
  today: string;
  bank_balance: number;
  cash_balance: number;
  donasi_bulan_ini: number;
  pengeluaran_bulan_ini: number;
  total_donatur: number;
  mutasi_belum_kategori: number;
  mutasi_perlu_cek: number;
  mutasi_belum_cek: number;
  programs: Program[];
  tasks: TaskItem[];
  monthly: MonthPoint[];
}

export interface AuditEntry {
  id: string;
  at: string;
  user_name: string;
  action: string;
  entity: string;
  entity_id: string;
  summary: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
}

export interface ReceiptItemRef {
  mutasi_id: string;
  alloc_index: number;
}

export interface EligibleItem {
  mutasi_id: string;
  alloc_index: number;
  date: string;
  sender_name: string;
  donor_id: string;
  donor_name: string;
  program_name: string;
  jenis: string;
  amount: number;
}

export interface IssueIn {
  items: ReceiptItemRef[];
}

export interface Receipt {
  id: string;
  number: string;
  seq: number;
  issued_date: string;
  donation_date: string;
  donor_id: string;
  donor_name: string;
  npwp: string;
  donor_address: string;
  program_names: string[];
  amount: number;
  terbilang: string;
  items: ReceiptItemRef[];
  status: "aktif" | "batal";
  cancel_reason: string;
  replaces: string | null;
  replaced_by: string | null;
  issued_by: string;
  issued_at: string;
  cancelled_by: string;
  cancelled_at: string;
}

export interface ReceiptPage {
  items: Receipt[];
  total: number;
}

export interface IssueResult {
  issued: Receipt[];
  skipped: number;
}

export interface CancelIn {
  reason: string;
  reissue: boolean;
}

export interface CicilanMember {
  donor_id: string;
  donor_name: string;
  monthly_amount: number;
  start_month: string;
  end_month: string;
}

export interface MembersIn {
  members: CicilanMember[];
}

export type CicilanCellStatus = "lunas" | "lebih" | "kurang" | "tunggak" | "kosong" | "mendatang";

export interface CicilanCell {
  month: string;
  expected: number;
  paid: number;
  status: CicilanCellStatus;
  check: "belum" | "rekan" | "admin";
  rekan_by: string;
  admin_by: string;
}

export interface CicilanRow {
  donor_id: string;
  donor_name: string;
  registered: boolean;
  monthly_amount: number;
  start_month: string;
  end_month: string;
  cells: CicilanCell[];
  total_paid: number;
  arrears: number;
}

export interface CicilanMatrix {
  program_id: string;
  program_name: string;
  year: number;
  years: number[];
  months: string[];
  today_month: string;
  rows: CicilanRow[];
  total_expected: number;
  total_paid: number;
  total_arrears: number;
}

export interface CheckIn {
  donor_id: string;
  month: string;
  stage: "rekan" | "admin";
  undo: boolean;
}

export interface NotaRead {
  file_id: string;
  date: string;
  amount: number;
  description: string;
  vendor: string;
  direction: "CR" | "DB";
  model: string;
  candidates: Mutasi[];
}

export interface KasIn {
  date: string;
  description: string;
  amount: number;
  direction: "CR" | "DB";
  sender_name: string;
  notes: string;
  file_id: string | null;
}

export interface LinkFileIn {
  file_id: string;
}

export interface ShareLink {
  url: string;
  email: string;
  subject: string;
  body: string;
}

export interface EmailResult {
  sent_to: string;
}

export interface Reminder {
  program_id: string;
  program_name: string;
  month: string;
  text: string;
  overdue_count: number;
  total_arrears: number;
  created_at: string;
}

export type VoucherType = "BKM" | "BKK" | "BBM" | "BBK";

export interface Voucher {
  id: string;
  number: string;
  type: VoucherType;
  seq: number;
  month: string;
  mutasi_id: string;
  date: string;
  description: string;
  party: string;
  amount: number;
  status: "menunggu" | "disetujui" | "batal";
  needs_approval: boolean;
  approved_by: string;
  approved_at: string;
  created_by: string;
  created_at: string;
  cancel_reason: string;
}

export interface VoucherIssueIn {
  mutasi_ids: string[];
}

export interface VoucherIssueResult {
  issued: Voucher[];
  skipped: number;
}

export type ReportCell = string | number | null;

export interface ReportSection {
  title: string;
  columns: string[];
  rows: ReportCell[][];
  total: ReportCell[] | null;
}

export interface Report {
  key: string;
  title: string;
  period: string;
  sections: ReportSection[];
  notes: string[];
}
