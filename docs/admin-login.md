# Admin Login + Google OAuth (Supabase)

## Ringkasan
- Halaman login admin: `/admin/login`
- Proteksi admin: `/admin` akan redirect ke `/admin/login` jika belum login Supabase
- Login dengan **email & password Supabase Auth** (bukan Google)
- Supabase yang dipakai (publishable):
  - URL: `https://xkacsdvkpniafudevwvq.supabase.co`
  - ANON/PUBLISHABLE KEY: `sb_publishable_BpsbHQApiJVo41bccRj3-g_MgL6Ck2X`

## Environment Variables (Railway)
Set di Railway → Variables:
```
NEXT_PUBLIC_SUPABASE_URL=https://xkacsdvkpniafudevwvq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_BpsbHQApiJVo41bccRj3-g_MgL6Ck2X
```

> Catatan: Kunci ini publishable (anon) sehingga aman di client. Jangan taruh service_role di frontend.

## Alur Login
1) Buka `/admin/login`
2) Isi email & password Supabase (Auth password) → klik **Login Admin**
3) Setelah sukses, diarahkan ke `/admin`
4) Admin page cek session Supabase, jika ada → lanjut load data; jika tidak → redirect ke `/admin/login`

## File Baru/Diubah
- `lib/supabaseClient.js`
  - Singleton Supabase client (browser) memakai publishable key
- `app/admin/login/page.jsx`
  - UI login + tombol "Login dengan Google"
  - Redirect ke `/admin` jika session sudah ada
- `app/admin/page.jsx`
  - Proteksi: cek session Supabase; jika tidak ada → `router.replace('/admin/login')`
  - Load data admin hanya setelah session valid

## Cara Uji Lokal
```bash
# Pastikan env di .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xkacsdvkpniafudevwvq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_BpsbHQApiJVo41bccRj3-g_MgL6Ck2X

npm run dev
# Buka http://localhost:3000/admin/login
```

## Catatan Security
- Admin API tetap memakai header `x-admin-key` (input di halaman admin) sebagai lapisan tambahan
- Supabase session hanya memproteksi akses UI admin; backend tetap memverifikasi `x-admin-key`
