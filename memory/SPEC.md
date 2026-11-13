SPEC — Sistem Keuangan & Operasional Yayasan Dana Paramita Guang Ji Indonesia
Stack: FastAPI + Mongo (motor) backend under /api, React/Vite/TS frontend. UI language: Bahasa Indonesia, with Mandarin (Hanzi) + pinyin support.

Phase 1 (built)
Auth & roles (routers/auth.py, lib/auth.py): email+password login, PIN login for "rekan" (cicilan checker). Roles: admin, ketua, bendahara (all modules), staf (no delete/lock), rekan (cicilan only), auditor (read-only). Per-user module whitelist. Users page issues/revokes PINs (optional expiry).

Mutasi rekening (routers/mutasi.py, lib/bank_parser.py): upload BCA CSV/XLSX via parser templates; dedupe key = date+amount+description+balance; auto-suggest donor/program from learned sender_map; categorize, verify status (belum_cek / perlu_cek / terverifikasi), split one mutation to many donors/programs (sum must equal amount), Excel export & re-import round trip without duplicates, reconciliation vs opening balance.

Donatur (routers/donors.py): Latin/Mandarin/pinyin names, alias, NPWP, bank accounts (N:N), profile with history & per-program totals, duplicate detection, pinyin-insensitive search.

Program (routers/programs.py): donasi/cicilan programs with target, collected, disbursed, remaining, monthly chart, top donors.

Dashboard, Audit log, Settings, Backup (routers/admin.py): every write records an audit entry; settings hold kop surat, bank, opening balances, receipt numbering format, approval threshold (Rp20.000.000).

File storage (routers/files.py, lib/storage.py, Emergent object storage): mutasi attachments (bukti/nota, ≤10 MB, jpg/png/webp/heic/pdf), donor documents (KTP/NPWP…), logo & signature (/settings/branding/{logo|signature}, ≤2 MB images → settings.logo_data_url/signature_data_url = /api/files/{id}), original bank import file archived per import (/mutasi/imports). Download GET /api/files/{id} checks the user has the file's module (branding = any logged-in user). Soft delete only.

Jev AI decisions (lib/jev.py, EMERGENT_LLM_KEY, sequential calls): per mutasi one call → ai_category (donasi/cicilan/operasional/gaji/biaya_bank/transfer_internal/lainnya), ai_anomaly (≥0.75 sets status belum→perlu), donor match among text candidates (≥0.8 fills allocation as suggestion, never overwrites user allocations). Runs in background after each import + POST /mutasi/ai-analyze button. Uploaded files get doc_type. POST /donors/duplicates/ai-check scores spelling-variant pairs (≥0.6). Failures → ai_status="fallback".

Bukti pembayaran (routers/receipts.py, lib/receipt_pdf.py, module bukti): eligible = mutasi status ok, CR, allocation with donor and no receipt. Issue one or many (POST /receipts/issue); same donor+same day merged when receipt_merge_same_day. Each allocation is claimed with a conditional $expr update (no double receipts), then the number comes from atomic counters.receipt (pipeline $max with receipt_digital_from), formatted with receipt_number_format. Receipted allocations are locked (patch/split/delete/roundtrip refuse). Cancel (/receipts/{id}/cancel, admin) keeps the old number as DIBATALKAN, frees allocations, optional reissue with a new number (replaces/replaced_by). PDF A5 landscape, bundled CJK font backend/fonts/wqy-zenhei.ttc, logo + signature from settings.

Cicilan matrix (routers/cicilan.py): program kind cicilan has members[] {donor_id, monthly_amount, start_month, end_month}; unregistered payers are shown as "tidak terdaftar"; members/from-payers bootstraps. Cell status lunas/lebih/kurang/tunggak/kosong/mendatang by payment month (mutasi date). Arrears = expected through current month − paid in year. Two-step check in cicilan_checks: stage rekan (any cicilan writer incl. PIN rekan) → stage admin (role admin only, requires rekan first).

Janggal filter: GET /mutasi?janggal=true (ai_anomaly ≥ 0.75), dashboard task links there.

Foto nota (routers/ocr.py): POST /nota/read → vision LLM (gemini-3-flash-preview → gpt-5.2 → claude-sonnet-5-5 fallback) returns date/amount/description/vendor/direction + matching bank mutasi (same amount ±10 days); photo stored (owner nota-pending). Then POST /mutasi/kas (new BKK/BKM with photo attached) or POST /mutasi/{id}/attachments/link.

Data (Mongo collections)
settings, users, donors (documents[]), programs, mutasi (allocations[], attachments[], ai_* fields), sender_map, parser_templates, imports (file_id), files, audit_logs.

Pending phases
Cicilan matrix FU/FU HUI with two-stage verification; tax payment receipts (atomic numbering, CJK PDF); BKM/BKK/BBM/BBK vouchers; expense/proposal/RPJ; payroll; accounting (CoA, journal, ISAK 35); reports.

Credentials: see memory/test_credentials.md.