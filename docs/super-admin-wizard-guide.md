# Super Admin Wizard Guide

Panduan ini fokus pada penggunaan dashboard super admin standalone (`super-admin/`) untuk membuat tenant baru secara cepat, aman, dan konsisten.

## 1. Jalankan Sistem

## 1.1 Jalankan core app
```bash
cd ..
npm run dev:core
```
Core API berjalan di `http://localhost:3000`.

## 1.2 Jalankan super admin app
```bash
cd super-admin
npm install
npm run dev
```
Dashboard berjalan di `http://localhost:3010`.

## 1.3 Hubungkan dashboard ke core
- Isi `Core API URL`: `http://localhost:3000`
- Isi `x-super-admin-key`: sesuai `SUPER_ADMIN_API_KEY` pada core `.env.local`
- Klik `Connect`

## 2. Struktur Menu Dashboard
- `Overview`: ringkasan jumlah tenant, domain, readiness OAuth.
- `Tenant Wizard`: onboarding tenant step-by-step.
- `Sites`: registry tenant + edit + delete + export env.
- `Domains`: provisioning DNS Cloudflare per domain.
- `API & Keys`: daftar env key-value semua tenant.
- `Activity`: audit stream semua aksi.
- `How To Use`: ringkasan usage cepat di dalam app.

## 3. Cara Isi Form Tenant Wizard

## Step 1: Identity
- `tenant key`: identifier unik, lowercase (contoh `acme`)
- `tenant label`: nama tenant yang tampil di dashboard
- `admin emails csv`: email admin tenant, pisahkan dengan koma

Catatan:
- Key akan digunakan sebagai `projectKey` internal.
- Hindari spasi dan karakter aneh.

## Step 2: Domain
- `primary domain`: domain utama tenant (contoh `acme-mail.com`)
- `extra domains csv`: domain tambahan (opsional)
- `Auto provision DNS Cloudflare`: centang jika ingin setup DNS otomatis via API

Catatan:
- Auto-provision butuh `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` di core app.
- Jika tidak dicentang, provisioning bisa dijalankan manual dari menu `Domains`.

## Step 3: OAuth + Env
- `Google Client ID`
- `Google Client Secret`
- `Google Redirect URI` (contoh `https://tenant-domain.com/oauth2callback`)
- `Custom env JSON`: key-value tambahan tenant

Contoh `Custom env JSON`:
```json
{
  "NEXT_PUBLIC_BRAND_NAME": "Acme Mail",
  "NEXT_PUBLIC_SUPPORT_URL": "https://acme-mail.com/support"
}
```

## Step 4: Export
- Wizard akan membuat tenant.
- Jika aktif, DNS Cloudflare diprovision otomatis.
- Sistem menghasilkan template `.env` tenant otomatis.
- Klik `Copy Env Template` untuk langsung digunakan saat deploy.

## 4. Cara Deploy Tenant Custom Domain
1. Buat tenant via wizard.
2. Pastikan DNS domain sudah benar (auto/manual).
3. Jalankan OAuth tenant dari admin app (project tenant yang benar).
4. Gunakan template env hasil export.
5. Deploy core app dengan env tenant sesuai strategi deployment Anda.

## 5. Checklist Setelah Tenant Dibuat
- Tenant muncul di menu `Sites`
- Status OAuth: `Needs OAuth` (normal sebelum connect)
- Domain tercatat pada tenant
- `Export Env` berhasil
- Aktivitas tercatat di menu `Activity`

## 6. Troubleshooting
- `Unauthorized`: periksa `x-super-admin-key`.
- `Cloudflare API token not configured`: isi env Cloudflare di core app.
- `Invalid project key`: gunakan key lowercase alfanumerik + `-`/`_`.
- `OAuth mismatch`: pastikan redirect URI sama dengan Google Console.
