"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

function useBootstrap() {
  useEffect(() => {
    import('bootstrap/dist/js/bootstrap.bundle.min.js');
  }, []);
}

function isValidDomainName(value) {
  const domain = String(value || '').trim().toLowerCase();
  if (!domain) return false;
  if (domain.startsWith('http://') || domain.startsWith('https://')) return false;
  return /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain);
}

export default function AdminPage() {
  const router = useRouter();
  useBootstrap();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('default');
  const [accessToken, setAccessToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [stats, setStats] = useState(null);
  const [aliases, setAliases] = useState([]);
  const [domains, setDomains] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('disconnected');
  const [toast, setToast] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    const ensureSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/admin/login');
        return;
      }
      setAccessToken(data.session.access_token || '');
      setUserEmail(data.session.user?.email || '');
      setSessionChecked(true);
    };
    ensureSession();
  }, [router]);

  const withProject = useCallback((path) => {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}project=${encodeURIComponent(selectedProject)}`;
  }, [selectedProject]);

  async function persistProject(projectKey) {
    try {
      await fetch('/api/projects/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectKey })
      });
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('project', projectKey);
      window.history.replaceState({}, '', nextUrl.toString());
    } catch (err) {
      console.error('Failed to persist selected project', err);
    }
  }

  const fetchWithAdmin = useCallback(async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (options.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(withProject(path), { cache: 'no-store', ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.error || `Request failed with ${res.status}`;
      throw new Error(message);
    }
    return res.json();
  }, [accessToken, withProject]);

  const loadAll = useCallback(async () => {
    if (!sessionChecked) return;
    if (!accessToken) return;
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchWithAdmin('/api/admin/stats'),
        fetchWithAdmin('/api/admin/aliases'),
        fetchWithAdmin('/api/admin/domains'),
        fetchWithAdmin('/api/admin/logs?limit=50')
      ]);

      const [statsRes, aliasesRes, domainsRes, logsRes] = results;
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (aliasesRes.status === 'fulfilled') setAliases(aliasesRes.value.aliases || []);
      if (domainsRes.status === 'fulfilled') setDomains(domainsRes.value.domains || []);
      if (logsRes.status === 'fulfilled') setLogs(logsRes.value.logs || []);

      const anyError = results.some((r) => r.status === 'rejected');
      setStatus('connected');
      setToast(anyError ? '⚠ Sebagian data gagal dimuat' : '✓ Data berhasil dimuat');
    } catch (err) {
      console.error(err);
      setStatus('disconnected');
      setToast(`✗ ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [sessionChecked, accessToken, fetchWithAdmin]);

  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch('/api/projects', { cache: 'no-store' });
        const data = await res.json();
        const list = data.projects || [];
        setProjects(list);
        if (list.length > 0) {
          const fromUrl = new URL(window.location.href).searchParams.get('project');
          const validFromUrl = list.find((item) => item.key === fromUrl);
          setSelectedProject(validFromUrl ? validFromUrl.key : data.defaultProject || list[0].key);
        }
      } catch (err) {
        console.error('Failed loading projects', err);
      }
    }
    loadProjects();
  }, []);

  useEffect(() => {
    if (accessToken) loadAll();
  }, [accessToken, loadAll]);

  useEffect(() => {
    if (!selectedProject) return;
    persistProject(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function handleAddDomain() {
    const domainName = newDomain.trim().toLowerCase();
    if (!domainName) return;
    if (!isValidDomainName(domainName)) {
      setToast('✗ Format domain tidak valid. Contoh benar: example.com');
      return;
    }
    try {
      await fetchWithAdmin('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify({ name: domainName })
      });
      setNewDomain('');
      await loadAll();
      setToast('✓ Domain berhasil ditambahkan');
    } catch (err) {
      setToast(`✗ ${err.message}`);
    }
  }

  async function removeDomain(name) {
    if (!window.confirm(`Delete domain "${name}"?`)) return;
    try {
      await fetchWithAdmin(`/api/admin/domains/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      await loadAll();
      setToast('✓ Domain berhasil dihapus');
    } catch (err) {
      setToast(`✗ ${err.message}`);
    }
  }

  async function removeAlias(address) {
    try {
      await fetchWithAdmin(`/api/admin/aliases/${encodeURIComponent(address)}`, {
        method: 'DELETE'
      });
      await loadAll();
      setToast('✓ Alias berhasil dihapus');
    } catch (err) {
      setToast(`✗ ${err.message}`);
    }
  }

  async function clearAllLogs() {
    if (!window.confirm('Clear all logs? This cannot be undone.')) return;
    try {
      await fetchWithAdmin('/api/admin/logs', { method: 'DELETE' });
      await loadAll();
      setToast('✓ Log berhasil dibersihkan');
    } catch (err) {
      setToast(`✗ ${err.message}`);
    }
  }

  async function revokeToken() {
    if (!window.confirm('Revoke token? You will need to re-authenticate.')) return;
    try {
      await fetchWithAdmin('/auth/revoke', { method: 'POST' });
      setToast('✓ Token berhasil dicabut');
    } catch (err) {
      setToast(`✗ ${err.message}`);
    }
  }

  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh' }}>
      <header className="bg-white border-bottom sticky-top">
        <div className="container-xl py-3">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <div className="bg-primary text-white d-flex align-items-center justify-content-center rounded" style={{ width: 40, height: 40 }}>
                <i className="bi bi-gear-fill" />
              </div>
              <h1 className="h5 mb-0">Dashboard Admin</h1>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className={`badge ${status === 'connected' ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}`}>
                <i className="bi bi-circle-fill me-1" style={{ fontSize: '0.5rem' }} />
                {status === 'connected' ? 'Terhubung' : 'Terputus'}
              </span>
              <Link href="/" className="btn btn-sm btn-outline-secondary">
                <i className="bi bi-arrow-left me-1" /> Kembali
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container-xl py-4">
        <div className="row mb-4">
          <div className="col-12">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h6 className="fw-bold mb-3">Sesi Admin</h6>
              <div className="alert alert-info py-2 px-3 small">
                Gunakan halaman ini untuk kelola domain, alias, OAuth token, dan log tenant yang dipilih.
              </div>
              <div className="row g-3 align-items-end">
                <div className="col-md-3">
                  <label className="form-label small fw-500">Tenant</label>
                  <select
                    className="form-select"
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                  >
                    {(projects.length ? projects : [{ key: 'default', label: 'Default' }]).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}{p.hasToken ? ' [siap]' : ' [perlu oauth]'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-5">
                  <label className="form-label small fw-500">Login sebagai</label>
                  <input
                    type="text"
                    className="form-control"
                    value={userEmail || 'Unknown'}
                    readOnly
                  />
                </div>
                <div className="col-md-4">
                  <button className="btn btn-primary w-100" onClick={loadAll} disabled={loading || !accessToken}>
                    <i className={`bi ${loading ? 'bi-hourglass-split' : 'bi-arrow-clockwise'} me-2`} />
                    {loading ? 'Memuat...' : 'Muat Ulang Data'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {stats && (
          <div className="row g-3 mb-4">
            <div className="col-sm-6 col-lg-3">
              <div className="bg-white rounded-lg shadow-sm p-4 text-center">
                <div className="text-primary mb-2" style={{ fontSize: '1.5rem' }}>
                  <i className="bi bi-at" />
                </div>
                <h3 className="mb-1">{stats.totalAliases}</h3>
                <p className="text-muted small">Total Alias</p>
              </div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="bg-white rounded-lg shadow-sm p-4 text-center">
                <div className="text-success mb-2" style={{ fontSize: '1.5rem' }}>
                  <i className="bi bi-arrow-up-right-circle" />
                </div>
                <h3 className="mb-1">{stats.totalHits}</h3>
                <p className="text-muted small">Total Akses</p>
              </div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="bg-white rounded-lg shadow-sm p-4 text-center">
                <div className="text-warning mb-2" style={{ fontSize: '1.5rem' }}>
                  <i className="bi bi-globe" />
                </div>
                <h3 className="mb-1">{stats.totalDomains}</h3>
                <p className="text-muted small">Domain</p>
              </div>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="bg-white rounded-lg shadow-sm p-4">
                <p className="text-muted small mb-1">Aktivitas Terakhir</p>
                <p className="mb-0 small fw-500">{stats.lastAliasCreatedAt?.split('T')[0] || '-'}</p>
              </div>
            </div>
          </div>
        )}

        <ul className="nav nav-tabs bg-white rounded-lg shadow-sm p-3 mb-4" role="tablist">
          <li className="nav-item">
            <button className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <i className="bi bi-diagram-3 me-2" /> Dashboard
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${activeTab === 'domains' ? 'active' : ''}`} onClick={() => setActiveTab('domains')}>
              <i className="bi bi-globe me-2" /> Domain
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${activeTab === 'aliases' ? 'active' : ''}`} onClick={() => setActiveTab('aliases')}>
              <i className="bi bi-at me-2" /> Aliases
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
              <i className="bi bi-clock-history me-2" /> Log
            </button>
          </li>
        </ul>

        {activeTab === 'domains' && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
            <h6 className="fw-bold mb-3">Kelola Domain</h6>
            <p className="text-muted small mb-2">
              Isi domain tanpa http/https. Contoh benar: <code>example.com</code>
            </p>
            <div className="input-group mb-3">
              <input className="form-control" placeholder="example.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value.toLowerCase())} />
              <button className="btn btn-primary" onClick={handleAddDomain} disabled={!newDomain.trim()}>
                <i className="bi bi-plus-lg me-1" /> Tambah
              </button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {domains.length === 0 ? (
                <p className="text-muted small">Belum ada domain</p>
              ) : (
                domains.map((d) => (
                  <div key={d.name} className="d-flex align-items-center justify-content-between p-2 border-bottom">
                    <div>
                      <div className="fw-500">{d.name}</div>
                      <small className="text-muted">Dibuat {d.createdAt?.split('T')[0]}</small>
                    </div>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => removeDomain(d.name)} disabled={loading}>
                      Hapus
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'aliases' && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
            <h6 className="fw-bold mb-3">Alias Terbaru (menampilkan {Math.min(20, aliases.length)} dari {aliases.length})</h6>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {aliases.length === 0 ? (
                <p className="text-muted small">Belum ada alias</p>
              ) : (
                aliases.slice(0, 20).map((a) => (
                  <div key={a.address} className="d-flex align-items-center justify-content-between p-2 border-bottom">
                    <div className="flex-grow-1 min-width-0">
                      <div className="fw-500 text-break" style={{ fontSize: '0.9rem' }}>{a.address}</div>
                      <small className="text-muted">Hits: {a.hits || 0}</small>
                    </div>
                    <button className="btn btn-sm btn-outline-danger ms-2" onClick={() => removeAlias(a.address)} disabled={loading}>
                      <i className="bi bi-trash" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold mb-0">Log Aktivitas (50 terbaru)</h6>
              <button className="btn btn-sm btn-outline-danger" onClick={clearAllLogs} disabled={loading || logs.length === 0}>
                Hapus Semua
              </button>
            </div>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <p className="text-muted small">Belum ada log</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover">
                    <thead>
                      <tr>
                        <th style={{ fontSize: '0.8rem' }}>Email</th>
                        <th style={{ fontSize: '0.8rem' }}>Subjek</th>
                        <th style={{ fontSize: '0.8rem' }}>Pengirim</th>
                        <th style={{ fontSize: '0.8rem' }}>Terakhir Dilihat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td style={{ fontSize: '0.8rem' }} className="text-nowrap">{l.alias?.split('@')[0] || '-'}</td>
                          <td style={{ fontSize: '0.8rem' }} className="text-truncate">{l.subject || '-'}</td>
                          <td style={{ fontSize: '0.8rem' }} className="text-truncate">{l.from || '-'}</td>
                          <td style={{ fontSize: '0.8rem' }} className="text-nowrap">{l.lastSeenAt?.split('T')[1]?.slice(0, 5) || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
            <h6 className="fw-bold mb-3">Kelola Token OAuth</h6>
            <p className="text-muted small mb-3">
              Jika tenant belum terhubung Gmail, klik Mulai OAuth. Jika ingin putuskan akses, klik Cabut Token.
            </p>
            <div className="row g-2">
              <div className="col-sm-6">
                <Link href={`/login?project=${encodeURIComponent(selectedProject)}`} target="_blank" className="btn btn-primary w-100">
                  <i className="bi bi-google me-2" /> Mulai OAuth
                </Link>
              </div>
              <div className="col-sm-6">
                <button className="btn btn-outline-danger w-100" onClick={revokeToken} disabled={loading}>
                  <i className="bi bi-shield-x me-2" /> Cabut Token
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div className="position-fixed bottom-0 start-50 translate-middle-x mb-3 px-3 py-2 rounded-pill" style={{ background: toast.startsWith('✓') ? '#10b981' : '#ef4444', color: 'white', zIndex: 2000, fontSize: '0.875rem' }}>
          {toast}
        </div>
      )}
    </main>
  );
}
