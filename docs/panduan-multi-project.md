# Panduan Lengkap Multi-Project PBS Mail

Dokumen ini menjelaskan:
1. Apa yang berbeda dari versi sebelumnya.
2. Cara penggunaan project yang sekarang (multi-project, multi-domain, multi-Gmail).
3. Cara setup detail dari nol sampai siap dipakai berulang.

## 1. Apa Yang Berbeda Dari Sebelumnya

### Sebelumnya (single project)
- Konfigurasi cenderung global (satu set domain, alias, token OAuth, logs).
- Menambah project baru sering berujung:
  - clone/deploy app baru, atau
  - ubah env manual berulang-ulang.
- Risiko tinggi terjadi data tercampur antar project.

### Sekarang (multi-project/tenant)
- Satu instance app bisa melayani banyak project dengan `projectKey`.
- Data terpisah per project:
  - token OAuth Gmail
  - domains
  - aliases
  - logs
  - audit
- Pemilihan project tersedia di UI publik dan admin (dropdown).
- Status kesiapan OAuth per project terlihat langsung (`[ready]` / `[oauth needed]`).
- Project aktif disimpan ke cookie `tmail_project`, jadi tidak perlu kirim query `project` terus.
- Menambah project baru cukup tambah 1 entry di `PROJECTS_JSON`.

## 2. Arsitektur Konsep Baru

### Inti konsep
- Identitas tenant: `projectKey` (contoh: `default`, `client-a`, `client-b`).
- Resolusi project dari request (urutan prioritas):
1. query `?project=<key>`
2. header `x-project-key`
3. cookie `tmail_project`
4. `DEFAULT_PROJECT_KEY`

### Endpoint pendukung multi-project
- `GET /api/projects`
  - Mengembalikan daftar project + `hasToken`.
- `POST /api/projects/select`
  - Menyimpan project aktif ke cookie `tmail_project`.
  - Body: `{ "project": "<project-key>" }`

### Kompatibilitas lama
- Jika `PROJECTS_JSON` tidak diisi, sistem tetap bisa jalan dengan mode default/global lama (backward-compatible).

## 3. Cara Penggunaan Harian (Setelah Setup)

### A0. Dari UI super admin (app terpisah `super-admin/`)
1. Login menggunakan akun yang ada di `SUPER_ADMIN_EMAILS`.
2. Tambah site baru (key, label, Google OAuth config, adminEmails, domains).
3. Simpan site, lalu tenant langsung tersedia di dropdown user/admin.
4. Jika Cloudflare API diaktifkan, klik `Provision DNS` untuk domain tenant.

Panel ini menjadi template pusat pengelolaan SaaS multi-tenant.
Jalankan di `http://localhost:3010` (default), bukan route di app core.

### A. Dari UI publik (`/`)
1. Pilih project di dropdown.
2. Buat/acak alias temp mail.
3. Copy alamat email.
4. Pantau inbox.

Catatan:
- Label project di dropdown menampilkan status OAuth:
  - `[ready]` = token sudah ada, bisa dipakai.
  - `[oauth needed]` = belum OAuth untuk project tersebut.

### B. Dari UI admin (`/admin`)
1. Login admin (Supabase email/password).
2. Pilih project pada panel admin.
3. Jika status `[oauth needed]`, klik `Start OAuth`.
4. Tambahkan domain di tab `Domains`.
5. Kelola alias/log sesuai project terpilih.

### C. Dari API (opsional)
- Anda bisa pakai query `project` secara eksplisit:
  - `GET /api/domains?project=client-a`
  - `GET /api/messages?alias=user@domain.com&project=client-a`

## 4. Setup Detail Dari Nol

## 4.1 Prasyarat
- Node.js 18+
- Project Supabase
- Project Google Cloud (Gmail API)
- Domain + Cloudflare Email Routing

## 4.2 Install aplikasi
```bash
npm install
npm run dev
```

Akses:
- User UI: `http://localhost:3000`
- Admin login: `http://localhost:3000/admin/login`

## 4.3 Setup Supabase
1. Buat project Supabase.
2. Aktifkan Auth Email/Password.
3. Buat user admin dan auto-confirm.
4. Jalankan SQL migration KV:
   - `supabase/migrations/20260204_0001_app_kv.sql`
5. (Opsional kompatibilitas/legacy) migration table structured:
   - `supabase/migrations/20260206_0001_app_tables.sql`

## 4.4 Setup Google OAuth (Gmail API)
Untuk setiap project Gmail yang ingin dipisah:
1. Enable Gmail API.
2. Buat OAuth Client (Web Application).
3. Tambahkan redirect URI:
   - local: `http://localhost:3000/oauth2callback`
   - prod: `https://<domain-anda>/oauth2callback`
4. Simpan `clientId`, `clientSecret`, `redirectUri`.

## 4.5 Setup Cloudflare Email Routing
Untuk setiap domain project:
1. Aktifkan Email Routing.
2. Verifikasi destination Gmail.
3. Set MX + SPF (+ DMARC opsional).
4. Buat route `*@domain.com -> destination Gmail`.

## 4.6 Konfigurasi `.env.local`
Contoh minimal reusable:

```env
PORT=3000
DEFAULT_PROJECT_KEY=default

# fallback global (dipakai jika project tertentu tidak override)
GOOGLE_CLIENT_ID=<global-client-id>
GOOGLE_CLIENT_SECRET=<global-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# multi-project utama
PROJECTS_JSON=[{"key":"default","label":"Main"},{"key":"client-a","label":"Client A","google":{"clientId":"<id-a>","clientSecret":"<secret-a>","redirectUri":"http://localhost:3000/oauth2callback"},"adminEmails":["admin-a@domain.com"]},{"key":"client-b","label":"Client B","google":{"clientId":"<id-b>","clientSecret":"<secret-b>","redirectUri":"http://localhost:3000/oauth2callback"}}]

ADMIN_EMAILS=owner@domain.com
SUPER_ADMIN_EMAILS=owner@domain.com
SUPER_ADMIN_API_KEY=

# Optional Cloudflare API integration
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

ALLOWED_ORIGINS=http://localhost:3000
MAX_MESSAGES=20
TOKEN_ENCRYPTION_KEY=<32-hex-chars>

NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_KV_TABLE=app_kv
SUPABASE_TABLE_ALIASES=app_aliases
SUPABASE_TABLE_DOMAINS=app_domains
SUPABASE_TABLE_LOGS=app_logs
SUPABASE_TABLE_AUDIT=app_audit
```

Catatan:
- `adminEmails` di level project akan override `ADMIN_EMAILS` global.
- Jika project tidak punya object `google`, dia pakai fallback `GOOGLE_*` global.

## 4.7 Aktivasi tiap project pertama kali
Lakukan per project:
1. Pilih project dari dropdown admin.
2. Klik `Start OAuth`.
3. Pastikan status jadi `[ready]`.
4. Tambahkan domain di tab `Domains` untuk project tersebut.
5. Uji inbox dari UI publik dengan project yang sama.

## 5. SOP Menambah Project Baru (Tanpa Setup Ulang Besar)

1. Tambah object project baru di `PROJECTS_JSON`.
  Alternatif: tambah langsung dari app `super-admin/`.
2. Restart app (`npm run dev` ulang jika local).
3. Login admin, pilih project baru.
4. Jalankan OAuth satu kali.
5. Tambahkan domain project baru.
6. Selesai, project siap digunakan berulang.

Tidak perlu:
- clone repo baru
- deploy app baru
- duplikasi flow setup penuh

## 6. Migrasi Dari Instalasi Lama

Jika sebelumnya sudah jalan single project:
1. Tetap biarkan config lama (`GOOGLE_*`, tabel lama) sebagai `default`.
2. Tambahkan `DEFAULT_PROJECT_KEY=default`.
3. Tambahkan `PROJECTS_JSON` secara bertahap.
4. Lakukan OAuth per project baru.
5. Verifikasi data tidak tercampur dengan cek:
   - domain/alias/log pada setiap project di admin.

## 7. Troubleshooting

- `401 Unauthorized` admin API:
  - pastikan login admin valid dan email termasuk allowlist project.
- `OAuth redirect_uri_mismatch`:
  - samakan redirect URI di Google Console dengan env.
- Project tampil `[oauth needed]` terus:
  - OAuth belum sukses untuk project itu, ulangi `Start OAuth`.
- Domain ditolak saat register alias:
  - domain belum ditambahkan/aktif pada project yang dipilih.
- Data terlihat "hilang":
  - kemungkinan sedang melihat project berbeda, cek dropdown project.

## 8. Checklist Operasional Cepat

Saat onboarding client baru:
1. Tambah entry `PROJECTS_JSON`.
2. OAuth project.
3. Tambah domain.
4. Tes kirim email ke alias.
5. Cek inbox/log di project yang sama.

Selesai.

## 9. Catatan Keamanan Penting

- Jangan expose `SUPABASE_SERVICE_ROLE_KEY` ke client.
- Gunakan `TOKEN_ENCRYPTION_KEY`.
- Rotasi secret jika pernah terpublikasi.
- Batasi admin dengan `adminEmails` per project jika memungkinkan.
