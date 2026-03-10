# PBS Mail

Aplikasi temp mail berbasis Next.js (App Router) dengan UI publik dan dashboard admin.

## Fitur utama
- Alias email sementara, inbox menampilkan pesan terbaru (dibatasi 3 pada UI publik).
- Dashboard admin: statistik alias/domain/log, tambah/hapus domain & alias, clear logs, token revoke.
- Dashboard super admin berada di project terpisah folder `super-admin/`: kelola site/tenant SaaS, konfigurasi Google OAuth per tenant, sinkron domain tenant, provisioning DNS Cloudflare (opsional via API).
- Keamanan: Supabase Auth (email/password) untuk admin + allowlist email (`ADMIN_EMAILS`), validasi input (Zod), optional token encryption AES-128, audit log admin actions.
- Observabilitas: health checks (`/health`, `/health/token`), structured logging, cache metrics.
- Deploy-ready: Next.js 14, API routes, migrasi Supabase untuk storage.

## Stack singkat
- Frontend/Backend: Next.js 14 (App Router)
- Auth admin UI: Supabase Auth (email/password)
- Gmail access: Google APIs (read-only)
- Storage: Supabase (table KV) untuk token & data runtime

## Prasyarat
- Node.js 18+
- Akun Supabase
- Akun Google Cloud (untuk Gmail API)
- Domain + Cloudflare (Email Routing)

## Variabel lingkungan (root .env.local)
```
PORT=3000
ADMIN_EMAILS=admin@domain.com,owner@domain.com
ADMIN_API_KEY=  # optional (legacy fallback, kosongkan jika tidak dipakai)
SUPER_ADMIN_API_KEY=  # optional fallback key untuk super admin
SUPER_ADMIN_EMAILS=owner@domain.com

# Cloudflare API (opsional, untuk provisioning DNS dari super admin)
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

DEFAULT_PROJECT_KEY=default

# Multi project config (opsional tapi direkomendasikan)
# Format: JSON array. Jika tidak diisi, sistem pakai single project (legacy) dari GOOGLE_*.
PROJECTS_JSON=[{"key":"default","label":"Default Project"},{"key":"client-a","label":"Client A","google":{"clientId":"<id>","clientSecret":"<secret>","redirectUri":"http://localhost:3000/oauth2callback"},"adminEmails":["admin@clienta.com"]}]

ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8080

GOOGLE_CLIENT_ID=<client-id-google>
GOOGLE_CLIENT_SECRET=<client-secret-google>
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
MAX_MESSAGES=20

TOKEN_ENCRYPTION_KEY=<opsional-32-hex-untuk-AES-128>
TOKEN_PATH=

# Supabase (client)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>

# Supabase (server storage)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
SUPABASE_KV_TABLE=app_kv
SUPABASE_TABLE_ALIASES=app_aliases
SUPABASE_TABLE_DOMAINS=app_domains
SUPABASE_TABLE_LOGS=app_logs
SUPABASE_TABLE_AUDIT=app_audit
```

## Konsep multi-project (reusable)
- Satu instance aplikasi bisa melayani banyak project/domain/Gmail dengan parameter `project`.
- Data dipisah per project: token OAuth, aliases, domains, logs, audit.
- Setup project baru bisa lewat `PROJECTS_JSON` atau langsung dari app super admin terpisah (`super-admin/`) tanpa edit kode.

### Alur kerja
1. Definisikan semua project di `PROJECTS_JSON`.
2. Buka UI user/admin, pilih project dari dropdown.
3. Jalankan OAuth per project (admin tab Dashboard -> Start OAuth).
4. Tambahkan domain per project di admin tab Domains.

### Contoh `PROJECTS_JSON`
```json
[
  {
    "key": "default",
    "label": "Main Project"
  },
  {
    "key": "project-b",
    "label": "Project B",
    "google": {
      "clientId": "<google-client-id-b>",
      "clientSecret": "<google-client-secret-b>",
      "redirectUri": "https://your-domain.com/oauth2callback"
    },
    "adminEmails": ["admin-b@domain.com"]
  }
]
```

Catatan:
- Jika project tidak punya field `google`, otomatis fallback ke `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` global.
- `adminEmails` per project akan override `ADMIN_EMAILS` global.

## Instalasi lokal (ringkas)
```bash
npm install
npm run dev
# Buka http://localhost:3000 untuk user UI
# Buka http://localhost:3000/admin/login untuk login admin
```

## Menjalankan mode monorepo (core + super-admin)
```bash
# install dependency app super-admin sekali
cd super-admin
npm install
cd ..

# jalankan dua app bersamaan
npm run dev:all
```
- Core app: `http://localhost:3000`
- Super admin app standalone: `http://localhost:3010`

## Setup Supabase (Auth + Storage KV)
1) Buat project Supabase.
2) Aktifkan Email/Password Auth.
3) Buat user admin (Auth → Users) dan auto-confirm.
4) Jalankan SQL storage KV (lihat file supabase/schema.template.sql atau supabase/migrations/20260204_0001_app_kv.sql).
5) Set env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KV_TABLE`.
6) Isi `ADMIN_EMAILS` dengan email admin yang diizinkan.

## Setup Google OAuth (Gmail API)
1) Buat project di Google Cloud.
2) Enable Gmail API.
3) Buat OAuth Client (Web Application).
4) Set Authorized redirect URIs:
   - Local: http://localhost:3000/oauth2callback
   - Production: https://<domain-anda>/oauth2callback
5) Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

## Setup Cloudflare Email Routing + DNS
> Tujuan: semua email ke domain kamu diarahkan ke 1 inbox Gmail (yang juga dipakai oleh Gmail API).

### 1) Tambahkan domain ke Cloudflare
- Pastikan nameserver domain sudah menunjuk ke Cloudflare.

### 2) Aktifkan Email Routing
- Cloudflare Dashboard → Email → Email Routing → Enable.
- Tambahkan Destination Address (email tujuan), lalu verifikasi lewat email.

### 3) DNS Records wajib
Hapus MX record lama jika ada, lalu tambahkan record berikut:

**MX**
- Name: @
- Value: route1.mx.cloudflare.net, Priority: 49
- Name: @
- Value: route2.mx.cloudflare.net, Priority: 50
- Name: @
- Value: route3.mx.cloudflare.net, Priority: 50

**TXT (SPF)**
- Name: @
- Value: v=spf1 include:_spf.mx.cloudflare.net ~all

**(Opsional, disarankan) TXT (DMARC)**
- Name: _dmarc
- Value: v=DMARC1; p=none; rua=mailto:postmaster@yourdomain.com

### 4) Buat Route
- Tambahkan Route: `*@domain.com` → destination email yang sudah diverifikasi.

### 5) Tambahkan domain ke aplikasi
- Buka `/admin` → tab Domains → Add domain (misal: domain.com).
- Pastikan domain `active`.

## Alur login admin
1) Buat user admin di Supabase Auth (email & password).
2) Buka `/admin/login`, login dengan email/password.
3) Akses `/admin` dan data akan terbuka jika email termasuk `ADMIN_EMAILS`.

## Endpoint utama
- Publik: `/api/messages?alias=...`, `/api/messages/:id`, `/api/aliases`.
- Admin: `/api/admin/stats`, `/api/admin/aliases`, `/api/admin/domains`, `/api/admin/logs`, `/auth/revoke`.
- Health: `/health`, `/health/token`.

### Endpoint multi-project
- Tambahkan query `?project=<project-key>` ke endpoint publik/admin untuk scope project tertentu.
- Daftar project tersedia di `/api/projects` (termasuk status `hasToken` untuk indikator siap pakai).
- Simpan project aktif ke cookie via `POST /api/projects/select` dengan body `{ "project": "<project-key>" }`.

### Endpoint super admin
- `GET /api/super-admin/sites`: list semua tenant/site (super admin only).
- `POST /api/super-admin/sites`: create/update tenant/site beserta konfigurasi.
- `PUT /api/super-admin/sites/:key`: update tenant tertentu.
- `DELETE /api/super-admin/sites/:key`: hapus tenant (default project tidak bisa dihapus).
- `POST /api/super-admin/cloudflare/provision`: provisioning DNS dasar email routing di Cloudflare.
- `GET /api/super-admin/activity`: stream aktivitas tenant (audit aggregation).
- `GET /api/super-admin/sites/:key/env-template`: generate template `.env` tenant siap deploy custom domain.

### Menjalankan app super admin terpisah
```bash
cd super-admin
npm install
npm run dev
```
- Default URL app super admin: `http://localhost:3010`.
- Set `NEXT_PUBLIC_CORE_API_BASE_URL` di `super-admin/.env.local` ke URL app core (contoh `http://localhost:3000`).
- Gunakan menu `Tenant Wizard` untuk onboarding tenant step-by-step + export env otomatis.

## Deploy ke Vercel
1) Set semua ENV di Vercel (Production).
2) Pastikan `GOOGLE_REDIRECT_URI` sudah pakai domain produksi.
3) Deploy.

## Catatan keamanan
- **Jangan** taruh `SUPABASE_SERVICE_ROLE_KEY` di client.
- Isi `ADMIN_EMAILS` agar hanya email tertentu yang boleh akses admin.
- Rotasi secret jika pernah terpublikasi.
- Gunakan `TOKEN_ENCRYPTION_KEY` agar token Gmail tersimpan terenkripsi.

## Struktur ringkas
```
app/
  page.jsx          (UI publik PBS Mail)
  admin/page.jsx    (Dashboard admin, protected Supabase session)
  admin/login/      (Halaman login admin email/password)
  api/...           (API routes Next.js)
lib/server/...      (Runtime, Gmail, validation, logging)
lib/supabaseClient.js
supabase/           (SQL schema & migrations)
.env.local
```

## Troubleshooting singkat
- 401 / admin API: pastikan login admin sukses dan email ada di `ADMIN_EMAILS`.
- OAuth error redirect_uri_mismatch: samakan `GOOGLE_REDIRECT_URI` dengan Google Console.
- Tidak bisa login admin: user belum dibuat/confirm di Supabase Auth.
- Email tidak masuk: cek MX, SPF, dan route di Cloudflare Email Routing.

#   m a i l e r - p b s  
 