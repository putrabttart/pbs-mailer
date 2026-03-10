# Super Admin (Standalone Project)

Project ini adalah dashboard super admin terpisah untuk monorepo TMAIL.

## Tujuan
- Mengelola banyak site/tenant dari satu panel.
- Menjadi control plane SaaS (bukan route di app user/admin email).
- Menyediakan template dashboard umum: sidebar, navbar, cards, tabel tenant, provisioning domain.

## Jalankan Lokal

```bash
cd super-admin
npm install
npm run dev
```

Default berjalan di: `http://localhost:3010`

## Konfigurasi
Buat `.env.local` di folder `super-admin/` berdasarkan `.env.example`.

```env
NEXT_PUBLIC_CORE_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_DEFAULT_SUPER_ADMIN_KEY=<opsional>
```

## Integrasi Core App
Dashboard ini mengakses API berikut dari core app:
- `GET /api/super-admin/sites`
- `POST /api/super-admin/sites`
- `DELETE /api/super-admin/sites/:key`
- `POST /api/super-admin/cloudflare/provision`
- `GET /api/super-admin/activity`
- `GET /api/super-admin/sites/:key/env-template`

Autentikasi default memakai header `x-super-admin-key` dari input dashboard.

## Workflow SaaS
1. Connect ke core API + isi super admin key.
2. Create/Update tenant site (key, label, Google OAuth, admins, domains, env key-value JSON).
3. Provision DNS domain tenant (opsional Cloudflare API).
4. Tenant siap digunakan di app utama (user/admin mail).

## Tenant Wizard (Step-by-step)
1. Buka menu `Tenant Wizard`.
2. Step 1 (`Identity`): isi `key`, `label`, `admin emails`.
3. Step 2 (`Domain`): isi primary domain, optional extra domains, tentukan auto-provision DNS.
4. Step 3 (`OAuth + Env`): isi Google OAuth dan custom env JSON tenant.
5. Step 4 (`Export`): copy template env otomatis untuk deploy tenant.

## Export Env Otomatis
- Dari menu `Sites`, klik `Export Env` pada tenant.
- Atau melalui wizard step terakhir.
- Hasil template sudah menyertakan konfigurasi penting tenant untuk deployment custom domain.
