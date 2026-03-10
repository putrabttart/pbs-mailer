"use client";

import { useCallback, useMemo, useState } from 'react';

const MENU = [
  { id: 'overview', label: 'Ringkasan' },
  { id: 'wizard', label: 'Wizard Tenant' },
  { id: 'sites', label: 'Data Tenant' },
  { id: 'domains', label: 'Kelola Domain' },
  { id: 'keys', label: 'Env Tenant' },
  { id: 'activity', label: 'Riwayat Aktivitas' }
];

const DEFAULT_FORM = {
  key: '',
  label: '',
  googleClientId: '',
  googleClientSecret: '',
  googleRedirectUri: '',
  adminEmailsCsv: '',
  domainsCsv: '',
  envValuesJson: '{}'
};

const DEFAULT_WIZARD = {
  key: '',
  label: '',
  adminEmailsCsv: '',
  primaryDomain: '',
  extraDomainsCsv: '',
  googleClientId: '',
  googleClientSecret: '',
  googleRedirectUri: '',
  envValuesJson: '{\n  "NEXT_PUBLIC_BRAND_NAME": "Tenant Name"\n}',
  autoProvisionCloudflare: true,
  exportCustomDomain: ''
};

function csvFromArray(list) {
  return Array.isArray(list) ? list.join(',') : '';
}

function parseCsv(input) {
  return String(input || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function tryParseJson(input, fallback = {}) {
  try {
    const parsed = JSON.parse(input || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
      {children}
      {hint && <span className="muted">{hint}</span>}
    </label>
  );
}

function HelpBox({ title, lines }) {
  return (
    <div className="help-box">
      <div className="help-title">{title}</div>
      {lines.map((line, idx) => (
        <div key={idx} className="muted">{idx + 1}. {line}</div>
      ))}
    </div>
  );
}

export default function SuperAdminStandalonePage() {
  const [activeMenu, setActiveMenu] = useState('overview');
  const [coreBaseUrl, setCoreBaseUrl] = useState(
    process.env.NEXT_PUBLIC_CORE_API_BASE_URL || 'http://localhost:3000'
  );
  const [superAdminKey, setSuperAdminKey] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_SUPER_ADMIN_KEY || ''
  );
  const [sites, setSites] = useState([]);
  const [activities, setActivities] = useState([]);
  const [defaultProject, setDefaultProject] = useState('default');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('Isi Core API URL, isi Key Super Admin, lalu klik Sambungkan');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [wizard, setWizard] = useState(DEFAULT_WIZARD);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardEnv, setWizardEnv] = useState('');

  const headers = useMemo(() => {
    const next = { 'Content-Type': 'application/json' };
    if (superAdminKey) next['x-super-admin-key'] = superAdminKey;
    return next;
  }, [superAdminKey]);

  const api = useCallback(
    async (path, options = {}) => {
      const url = `${coreBaseUrl.replace(/\/$/, '')}${path}`;
      const res = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {})
        },
        cache: 'no-store'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed: ${res.status}`);
      return body;
    },
    [coreBaseUrl, headers]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sitesData, activityData] = await Promise.all([
        api('/api/super-admin/sites'),
        api('/api/super-admin/activity?limit=200')
      ]);
      setSites(sitesData.projects || []);
      setDefaultProject(sitesData.defaultProject || 'default');
      setActivities(activityData.activities || []);
      setNotice('Connected to core API');
    } catch (error) {
      setNotice(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const upsertSite = useCallback(async () => {
    try {
      const payload = {
        key: form.key.toLowerCase(),
        label: form.label || form.key,
        googleClientId: form.googleClientId,
        googleClientSecret: form.googleClientSecret,
        googleRedirectUri: form.googleRedirectUri,
        adminEmails: parseCsv(form.adminEmailsCsv),
        domains: parseCsv(form.domainsCsv).map((v) => v.toLowerCase()),
        envValues: tryParseJson(form.envValuesJson, {})
      };
      await api('/api/super-admin/sites', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setNotice('Site saved');
      setForm((prev) => ({ ...prev, googleClientSecret: '' }));
      await loadData();
      setActiveMenu('sites');
    } catch (error) {
      setNotice(`Error: ${error.message}`);
    }
  }, [api, form, loadData]);

  const exportTenantEnv = useCallback(
    async (projectKey, customDomain = '') => {
      const path = `/api/super-admin/sites/${encodeURIComponent(projectKey)}/env-template`;
      const suffix = customDomain ? `?customDomain=${encodeURIComponent(customDomain)}` : '';
      const payload = await api(`${path}${suffix}`);
      return payload.envContent || '';
    },
    [api]
  );

  const deleteSite = useCallback(
    async (key) => {
      if (!window.confirm(`Delete site ${key}?`)) return;
      try {
        await api(`/api/super-admin/sites/${encodeURIComponent(key)}`, { method: 'DELETE' });
        setNotice('Site deleted');
        await loadData();
      } catch (error) {
        setNotice(`Error: ${error.message}`);
      }
    },
    [api, loadData]
  );

  const provisionDns = useCallback(
    async (projectKey, domain) => {
      try {
        await api('/api/super-admin/cloudflare/provision', {
          method: 'POST',
          body: JSON.stringify({ projectKey, domain })
        });
        setNotice(`Provisioned ${domain}`);
        await loadData();
      } catch (error) {
        setNotice(`Error: ${error.message}`);
      }
    },
    [api, loadData]
  );

  const runWizardCreate = useCallback(async () => {
    setWizardBusy(true);
    try {
      const key = wizard.key.trim().toLowerCase();
      if (!key) throw new Error('Tenant key wajib diisi');
      if (!wizard.primaryDomain.trim()) throw new Error('Primary domain wajib diisi');
      if (!wizard.googleClientId.trim()) throw new Error('Google Client ID wajib diisi');
      if (!wizard.googleClientSecret.trim()) throw new Error('Google Client Secret wajib diisi');
      if (!wizard.googleRedirectUri.trim()) throw new Error('Google Redirect URI wajib diisi');

      const domains = [
        wizard.primaryDomain.trim().toLowerCase(),
        ...parseCsv(wizard.extraDomainsCsv).map((v) => v.toLowerCase())
      ];

      const payload = {
        key,
        label: wizard.label.trim() || key,
        googleClientId: wizard.googleClientId.trim(),
        googleClientSecret: wizard.googleClientSecret.trim(),
        googleRedirectUri: wizard.googleRedirectUri.trim(),
        adminEmails: parseCsv(wizard.adminEmailsCsv),
        domains,
        envValues: tryParseJson(wizard.envValuesJson, {})
      };

      await api('/api/super-admin/sites', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (wizard.autoProvisionCloudflare) {
        for (const domain of domains) {
          // Continue on provision errors to still allow tenant creation.
          try {
            await api('/api/super-admin/cloudflare/provision', {
              method: 'POST',
              body: JSON.stringify({ projectKey: key, domain })
            });
          } catch (error) {
            console.error('Cloudflare provision failed for', domain, error);
          }
        }
      }

      const envContent = await exportTenantEnv(key, wizard.exportCustomDomain.trim() || domains[0]);
      setWizardEnv(envContent);
      setWizardStep(4);
      setNotice(`Tenant ${key} berhasil dibuat`);
      await loadData();
    } catch (error) {
      setNotice(`Error: ${error.message}`);
    } finally {
      setWizardBusy(false);
    }
  }, [api, exportTenantEnv, loadData, wizard]);

  const copyText = useCallback(async (text, successMsg = 'Copied') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(successMsg);
    } catch {
      setNotice('Error: gagal copy ke clipboard');
    }
  }, []);

  const stats = {
    sites: sites.length,
    oauthReady: sites.filter((s) => s.hasToken).length,
    domains: sites.reduce((acc, s) => acc + (s.domains?.length || 0), 0),
    envKeys: sites.reduce((acc, s) => acc + Object.keys(s.envValues || {}).length, 0)
  };

  const allDomains = sites.flatMap((site) =>
    (site.domains || []).map((domain) => ({ domain, siteKey: site.key, siteLabel: site.label }))
  );

  const envRows = sites.flatMap((site) =>
    Object.entries(site.envValues || {}).map(([key, value]) => ({
      siteKey: site.key,
      siteLabel: site.label,
      key,
      value
    }))
  );

  function siteToForm(site) {
    return {
      key: site.key || '',
      label: site.label || '',
      googleClientId: site.googleClientId || '',
      googleClientSecret: '',
      googleRedirectUri: site.googleRedirectUri || '',
      adminEmailsCsv: csvFromArray(site.adminEmails),
      domainsCsv: csvFromArray(site.domains),
      envValuesJson: JSON.stringify(site.envValues || {}, null, 2)
    };
  }

  const wizardSummary = {
    domains: [
      wizard.primaryDomain.trim().toLowerCase(),
      ...parseCsv(wizard.extraDomainsCsv).map((v) => v.toLowerCase())
    ].filter(Boolean),
    admins: parseCsv(wizard.adminEmailsCsv)
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Panel Super Admin</div>
        <div className="muted" style={{ color: '#94a3b8', marginBottom: 14 }}>
          Aplikasi terpisah untuk mengelola banyak tenant
        </div>
        <div className="menu">
          {MENU.map((item) => (
            <button
              key={item.id}
              className={activeMenu === item.id ? 'active' : ''}
              onClick={() => setActiveMenu(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="navbar">
          <div>
            <strong>Kontrol Tenant SaaS</strong>
            <div className="muted">Semua pengaturan tenant dilakukan dari sini</div>
          </div>
          <div className="controls">
            <Field label="URL App Utama" hint="Contoh: http://localhost:3000">
              <input
                value={coreBaseUrl}
                onChange={(e) => setCoreBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                style={{ minWidth: 250 }}
              />
            </Field>
            <Field label="Key Super Admin" hint="Isi sesuai SUPER_ADMIN_API_KEY di app utama">
              <input
                value={superAdminKey}
                onChange={(e) => setSuperAdminKey(e.target.value)}
                placeholder="Masukkan key"
                style={{ minWidth: 230 }}
              />
            </Field>
            <button className="primary" type="button" onClick={loadData} disabled={loading} style={{ alignSelf: 'end' }}>
              {loading ? 'Menyambungkan...' : 'Sambungkan'}
            </button>
          </div>
        </div>

        <section className="content">
          {notice && (
            <div className="card">
              <div className="muted">{notice}</div>
            </div>
          )}

          {(activeMenu === 'overview' || activeMenu === 'sites') && (
            <div className="grid-3">
              <div className="card">
                <h3>Jumlah Tenant</h3>
                <div>{stats.sites}</div>
              </div>
              <div className="card">
                <h3>OAuth Siap</h3>
                <div>{stats.oauthReady}</div>
              </div>
              <div className="card">
                <h3>Jumlah Domain</h3>
                <div>{stats.domains}</div>
              </div>
            </div>
          )}

          {activeMenu === 'overview' && (
            <div className="card">
              <h3>Ringkasan Sistem</h3>
              <HelpBox
                title="Cara pakai menu ini"
                lines={[
                  'Klik Sambungkan dulu agar data tenant muncul.',
                  'Cek jumlah tenant, status OAuth, dan domain total.',
                  'Lanjut ke menu Wizard Tenant untuk membuat tenant baru.'
                ]}
              />
              <div className="muted">Tenant default: {defaultProject}</div>
              <div className="muted">Total env key custom: {stats.envKeys}</div>
              <div className="muted">Aktivitas terakhir: {activities[0]?.action || '-'}</div>
            </div>
          )}

          {activeMenu === 'wizard' && (
            <>
              <div className="card">
                <h3>Wizard Buat Tenant Baru</h3>
                <HelpBox
                  title="Cara isi wizard"
                  lines={[
                    'Step 1: Isi kode tenant, nama tenant, dan email admin tenant.',
                    'Step 2: Isi domain utama tenant, lalu domain tambahan jika ada.',
                    'Step 3: Isi Google OAuth dan env tambahan tenant.',
                    'Step 4: Copy hasil template env untuk deploy tenant.'
                  ]}
                />
                <div className="muted" style={{ marginBottom: 12 }}>
                  Ikuti dari langkah 1 sampai 4. Sistem akan otomatis membuat tenant dan menyiapkan template env.
                </div>
                <div className="controls" style={{ marginBottom: 12 }}>
                  <span className={`badge ${wizardStep >= 1 ? 'ok' : 'warn'}`}>1. Identitas</span>
                  <span className={`badge ${wizardStep >= 2 ? 'ok' : 'warn'}`}>2. Domain</span>
                  <span className={`badge ${wizardStep >= 3 ? 'ok' : 'warn'}`}>3. OAuth + Env</span>
                  <span className={`badge ${wizardStep >= 4 ? 'ok' : 'warn'}`}>4. Export</span>
                </div>

                {wizardStep === 1 && (
                  <div className="form-grid">
                    <Field label="Kode Tenant" hint="Gunakan huruf kecil. Contoh: acme atau toko_a">
                      <input
                        value={wizard.key}
                        onChange={(e) => setWizard((s) => ({ ...s, key: e.target.value }))}
                        placeholder="acme"
                      />
                    </Field>
                    <Field label="Nama Tenant" hint="Nama ini tampil di dashboard">
                      <input
                        value={wizard.label}
                        onChange={(e) => setWizard((s) => ({ ...s, label: e.target.value }))}
                        placeholder="Acme Mail"
                      />
                    </Field>
                    <div className="full">
                      <Field label="Email Admin Tenant" hint="Pisahkan dengan koma jika lebih dari satu">
                        <textarea
                          className="full"
                          rows={2}
                          value={wizard.adminEmailsCsv}
                          onChange={(e) => setWizard((s) => ({ ...s, adminEmailsCsv: e.target.value }))}
                          placeholder="admin@acme.com,owner@acme.com"
                        />
                      </Field>
                    </div>
                    <div className="full controls">
                      <button className="primary" type="button" onClick={() => setWizardStep(2)}>
                        Lanjut ke Langkah Domain
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="form-grid">
                    <Field label="Domain Utama" hint="Domain utama untuk tenant ini">
                      <input
                        value={wizard.primaryDomain}
                        onChange={(e) => setWizard((s) => ({ ...s, primaryDomain: e.target.value }))}
                        placeholder="acme-mail.com"
                      />
                    </Field>
                    <Field label="Domain Tambahan" hint="Opsional. Pisahkan koma jika lebih dari satu">
                      <input
                        value={wizard.extraDomainsCsv}
                        onChange={(e) => setWizard((s) => ({ ...s, extraDomainsCsv: e.target.value }))}
                        placeholder="acme.id,acme.co"
                      />
                    </Field>
                    <label className="full" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={wizard.autoProvisionCloudflare}
                        onChange={(e) =>
                          setWizard((s) => ({ ...s, autoProvisionCloudflare: e.target.checked }))
                        }
                      />
                      <span>Aktifkan setup DNS Cloudflare otomatis saat tenant dibuat</span>
                    </label>
                    <div className="full controls">
                      <button className="ghost" type="button" onClick={() => setWizardStep(1)}>
                        Kembali
                      </button>
                      <button className="primary" type="button" onClick={() => setWizardStep(3)}>
                        Lanjut ke Langkah OAuth
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="form-grid">
                    <div className="full">
                      <Field label="Google Client ID" hint="Diambil dari Google Cloud OAuth client">
                        <input
                          className="full"
                          value={wizard.googleClientId}
                          onChange={(e) => setWizard((s) => ({ ...s, googleClientId: e.target.value }))}
                          placeholder="1234567890-xxxx.apps.googleusercontent.com"
                        />
                      </Field>
                    </div>
                    <div className="full">
                      <Field label="Google Client Secret" hint="Simpan aman, jangan dibagikan ke user biasa">
                        <input
                          className="full"
                          value={wizard.googleClientSecret}
                          onChange={(e) => setWizard((s) => ({ ...s, googleClientSecret: e.target.value }))}
                          placeholder="GOCSPX-..."
                        />
                      </Field>
                    </div>
                    <div className="full">
                      <Field label="Google Redirect URI" hint="Contoh: https://domain-tenant.com/oauth2callback">
                        <input
                          className="full"
                          value={wizard.googleRedirectUri}
                          onChange={(e) => setWizard((s) => ({ ...s, googleRedirectUri: e.target.value }))}
                          placeholder="https://acme-mail.com/oauth2callback"
                        />
                      </Field>
                    </div>
                    <div className="full">
                      <Field label="Env Tambahan Tenant (JSON)" hint='Opsional. Gunakan format JSON key-value'>
                        <textarea
                          className="full"
                          rows={6}
                          value={wizard.envValuesJson}
                          onChange={(e) => setWizard((s) => ({ ...s, envValuesJson: e.target.value }))}
                          placeholder={`{\n  "NEXT_PUBLIC_BRAND_NAME": "Acme Mail"\n}`}
                        />
                      </Field>
                    </div>
                    <div className="full">
                      <Field label="Domain untuk Template Env" hint="Opsional. Kosongkan jika pakai domain utama">
                        <input
                          className="full"
                          value={wizard.exportCustomDomain}
                          onChange={(e) => setWizard((s) => ({ ...s, exportCustomDomain: e.target.value }))}
                          placeholder="acme-mail.com"
                        />
                      </Field>
                    </div>
                    <div className="full controls">
                      <button className="ghost" type="button" onClick={() => setWizardStep(2)}>
                        Kembali
                      </button>
                      <button className="primary" type="button" onClick={runWizardCreate} disabled={wizardBusy}>
                        {wizardBusy ? 'Sedang Membuat Tenant...' : 'Buat Tenant + Generate Env'}
                      </button>
                    </div>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="form-grid">
                    <div className="full muted">
                      Tenant berhasil dibuat. Langkah berikutnya: copy template env ini, deploy, lalu lakukan OAuth dari admin tenant.
                    </div>
                    <textarea className="full" rows={14} value={wizardEnv} readOnly />
                    <div className="full controls">
                      <button
                        className="primary"
                        type="button"
                        onClick={() => copyText(wizardEnv, 'Env template copied')}
                      >
                        Copy Env Template
                      </button>
                      <button className="ghost" type="button" onClick={() => setWizardStep(1)}>
                        Mulai Buat Tenant Baru
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="card">
                <h3>Ringkasan Input Wizard</h3>
                <div className="muted">Kode tenant: {wizard.key || '-'}</div>
                <div className="muted">Nama tenant: {wizard.label || '-'}</div>
                <div className="muted">Domain: {wizardSummary.domains.join(', ') || '-'}</div>
                <div className="muted">Admin: {wizardSummary.admins.join(', ') || '-'}</div>
              </div>
            </>
          )}

          {activeMenu === 'sites' && (
            <>
              <div className="card">
                <h3>Form Tenant (Manual)</h3>
                <HelpBox
                  title="Cara pakai menu ini"
                  lines={[
                    'Gunakan menu ini jika ingin edit tenant manual tanpa wizard.',
                    'Klik Edit pada tabel tenant untuk mengisi form otomatis.',
                    'Klik Export Env pada tenant untuk mendapatkan template deploy.'
                  ]}
                />
                <div className="form-grid">
                  <Field label="Kode Tenant" hint="Contoh: client-a">
                    <input
                      value={form.key}
                      onChange={(e) => setForm((s) => ({ ...s, key: e.target.value }))}
                      placeholder="client-a"
                    />
                  </Field>
                  <Field label="Nama Tenant" hint="Nama yang tampil di daftar tenant">
                    <input
                      value={form.label}
                      onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
                      placeholder="Client A"
                    />
                  </Field>
                  <div className="full">
                    <Field label="Google Client ID" hint="Diisi dari Google Cloud">
                      <input
                        className="full"
                        value={form.googleClientId}
                        onChange={(e) => setForm((s) => ({ ...s, googleClientId: e.target.value }))}
                        placeholder="1234567890-xxxx.apps.googleusercontent.com"
                      />
                    </Field>
                  </div>
                  <div className="full">
                    <Field label="Google Client Secret" hint="Kosongkan jika tidak ingin mengganti secret lama">
                      <input
                        className="full"
                        value={form.googleClientSecret}
                        onChange={(e) => setForm((s) => ({ ...s, googleClientSecret: e.target.value }))}
                        placeholder="GOCSPX-..."
                      />
                    </Field>
                  </div>
                  <div className="full">
                    <Field label="Google Redirect URI" hint="Contoh: https://domain-tenant.com/oauth2callback">
                      <input
                        className="full"
                        value={form.googleRedirectUri}
                        onChange={(e) => setForm((s) => ({ ...s, googleRedirectUri: e.target.value }))}
                        placeholder="https://client-a.com/oauth2callback"
                      />
                    </Field>
                  </div>
                  <div className="full">
                    <Field label="Email Admin Tenant" hint="Pisahkan koma jika banyak email">
                      <textarea
                        className="full"
                        rows={2}
                        value={form.adminEmailsCsv}
                        onChange={(e) => setForm((s) => ({ ...s, adminEmailsCsv: e.target.value }))}
                        placeholder="admin@client-a.com,owner@client-a.com"
                      />
                    </Field>
                  </div>
                  <div className="full">
                    <Field label="Domain Tenant" hint="Pisahkan koma jika lebih dari satu domain">
                      <textarea
                        className="full"
                        rows={2}
                        value={form.domainsCsv}
                        onChange={(e) => setForm((s) => ({ ...s, domainsCsv: e.target.value }))}
                        placeholder="client-a.com,mail.client-a.com"
                      />
                    </Field>
                  </div>
                  <div className="full">
                    <Field label="Env Tambahan (JSON)" hint='Opsional. Contoh: {"NEXT_PUBLIC_BRAND_NAME":"Client A"}'>
                      <textarea
                        className="full"
                        rows={6}
                        value={form.envValuesJson}
                        onChange={(e) => setForm((s) => ({ ...s, envValuesJson: e.target.value }))}
                        placeholder={`{\n  "NEXT_PUBLIC_BRAND_NAME": "Client A"\n}`}
                      />
                    </Field>
                  </div>
                  <div className="full" style={{ display: 'flex', gap: 8 }}>
                    <button className="primary" type="button" onClick={upsertSite}>
                      Simpan Tenant
                    </button>
                    <button className="ghost" type="button" onClick={() => setForm(DEFAULT_FORM)}>
                      Kosongkan Form
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3>Daftar Tenant</h3>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Tenant default: {defaultProject}
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tenant</th>
                        <th>OAuth</th>
                        <th>Admin</th>
                        <th>Domain</th>
                        <th>Jumlah Env</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sites.map((site) => (
                        <tr key={site.key}>
                          <td>
                            <strong>{site.label}</strong>
                            <div className="muted">{site.key}</div>
                          </td>
                          <td>
                            <span className={`badge ${site.hasToken ? 'ok' : 'warn'}`}>
                              {site.hasToken ? 'Siap' : 'Belum OAuth'}
                            </span>
                          </td>
                          <td>{csvFromArray(site.adminEmails) || '-'}</td>
                          <td>{csvFromArray(site.domains) || '-'}</td>
                          <td>{Object.keys(site.envValues || {}).length}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="ghost" type="button" onClick={() => setForm(siteToForm(site))}>
                                Ubah
                              </button>
                              <button
                                className="ghost"
                                type="button"
                                onClick={async () => {
                                  try {
                                    const envContent = await exportTenantEnv(site.key, site.domains?.[0] || '');
                                    await copyText(envContent, `Env template ${site.key} copied`);
                                  } catch (error) {
                                    setNotice(`Error: ${error.message}`);
                                  }
                                }}
                              >
                                Export Env
                              </button>
                              {site.key !== defaultProject && (
                                <button className="danger" type="button" onClick={() => deleteSite(site.key)}>
                                  Hapus
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sites.length === 0 && (
                        <tr>
                          <td colSpan={6} className="muted">
                            Belum ada tenant. Buat tenant dari Wizard atau form di atas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeMenu === 'domains' && (
            <div className="card">
              <h3>Kelola Domain</h3>
              <HelpBox
                title="Cara pakai menu ini"
                lines={[
                  'Menu ini menampilkan semua domain dari semua tenant.',
                  'Klik Provision DNS untuk setup DNS Cloudflare otomatis.',
                  'Jika gagal, cek CLOUDFLARE_API_TOKEN dan CLOUDFLARE_ACCOUNT_ID di app utama.'
                ]}
              />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Tenant</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allDomains.map((row) => (
                      <tr key={`${row.siteKey}-${row.domain}`}>
                        <td>{row.domain}</td>
                        <td>{row.siteLabel} ({row.siteKey})</td>
                        <td>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => provisionDns(row.siteKey, row.domain)}
                          >
                            Setup DNS Cloudflare
                          </button>
                        </td>
                      </tr>
                    ))}
                    {allDomains.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">Belum ada domain tenant.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeMenu === 'keys' && (
            <div className="card">
              <h3>Env Key-Value Tenant</h3>
              <HelpBox
                title="Cara pakai menu ini"
                lines={[
                  'Menu ini menampilkan env tambahan tiap tenant.',
                  'Untuk menambah env, buka menu Data Tenant lalu isi field Env JSON.',
                  'Untuk env deploy lengkap, gunakan tombol Export Env di Data Tenant.'
                ]}
              />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Key</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envRows.map((row) => (
                      <tr key={`${row.siteKey}-${row.key}`}>
                        <td>{row.siteLabel} ({row.siteKey})</td>
                        <td>{row.key}</td>
                        <td>{String(row.value).slice(0, 80)}</td>
                      </tr>
                    ))}
                    {envRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="muted">Belum ada env tambahan tenant.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeMenu === 'activity' && (
            <div className="card">
              <h3>Riwayat Aktivitas</h3>
              <HelpBox
                title="Cara pakai menu ini"
                lines={[
                  'Menu ini berisi catatan aksi penting super admin.',
                  'Gunakan untuk audit: siapa/apa yang diubah dan kapan.',
                  'Periksa log ini jika tenant mengalami masalah konfigurasi.'
                ]}
              />
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Tenant</th>
                      <th>Aksi</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((entry, idx) => (
                      <tr key={`${entry.timestamp || 't'}-${idx}`}>
                        <td>{entry.timestamp || '-'}</td>
                        <td>{entry.projectKey || '-'}</td>
                        <td>{entry.action || '-'}</td>
                        <td>{JSON.stringify(entry).slice(0, 120)}</td>
                      </tr>
                    ))}
                    {activities.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">Belum ada aktivitas.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
