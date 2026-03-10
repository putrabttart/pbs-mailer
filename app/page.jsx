"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

const DEFAULT_DOMAIN = '';
const AUTO_REFRESH_MS = 10000;

function randomAlias(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function useBootstrap() {
  useEffect(() => {
    import('bootstrap/dist/js/bootstrap.bundle.min.js');
  }, []);
}

function formatMessageDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function sanitizeLocalPart(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32);
}

export default function HomePage() {
  useBootstrap();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('default');
  const [address, setAddress] = useState('');
  const [localPart, setLocalPart] = useState(() => randomAlias());
  const [selectedDomain, setSelectedDomain] = useState(DEFAULT_DOMAIN);
  const [domains, setDomains] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState('');
  const displayedMessages = useMemo(() => (messages || []).slice(0, 3), [messages]);
  const localPartValid = useMemo(() => /^[a-z0-9._-]{3,32}$/.test(localPart), [localPart]);

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

  function pickOtpFromText(text) {
    const input = String(text || '');
    if (!input) return null;

    const keywordRe = /(otp|kode|code|verification|verify|login|password|token)/i;
    const candidates = [];
    const re = /\b\d{4,8}\b/g;
    let m;
    while ((m = re.exec(input)) !== null) {
      const code = m[0];
      const idx = m.index;
      const len = code.length;
      const windowStart = Math.max(0, idx - 40);
      const windowEnd = Math.min(input.length, idx + len + 40);
      const near = input.slice(windowStart, windowEnd);
      let score = 0;
      if (len === 6) score += 3;
      if (len === 5 || len === 7) score += 2;
      if (len === 4 || len === 8) score += 1;
      if (keywordRe.test(near)) score += 5;
      candidates.push({ code, score, idx });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return candidates[0].code;
  }

  function htmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return doc?.body?.textContent || '';
    } catch {
      return '';
    }
  }

  async function copyToClipboard(text, options = {}) {
    const { successToast = '✓ Berhasil disalin' } = options;
    try {
      // Method 1: Modern Clipboard API (desktop + some mobile browsers)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setToast(successToast);
        return;
      }
    } catch (err) {
      console.log('Clipboard API failed, trying fallback');
    }

    // Method 2: Fallback for older/mobile browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, 99999); // For mobile
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        setToast(successToast);
      } else {
        setToast('✗ Gagal menyalin');
      }
    } catch (err) {
      console.error('Copy failed:', err);
      setToast('✗ Gagal menyalin');
    }
  }

  async function copyOtpFromMessage(msg, options = {}) {
    const base = `${msg?.subject || ''}\n${msg?.snippet || ''}`;
    const otp = pickOtpFromText(base);
    if (!otp) {
      setToast(options.notFoundToast || '✗ Kode OTP tidak ditemukan');
      return;
    }
    await copyToClipboard(otp, { successToast: options.successToast || '✓ OTP disalin' });
  }

  async function copyOtpFromDetail() {
    if (!detail || detail.loading || detail.error) return;
    const combined = [
      detail.subject || '',
      detail.bodyText || '',
      htmlToText(detail.bodyHtml || '')
    ].join('\n');
    const otp = pickOtpFromText(combined);
    if (!otp) {
      setToast('✗ Kode OTP tidak ditemukan');
      return;
    }
    await copyToClipboard(otp, { successToast: '✓ OTP disalin' });
  }

  const registerAlias = useCallback(async (addr) => {
    if (!addr || typeof addr !== 'string') return;
    const trimmed = addr.trim();
    if (!trimmed.includes('@')) return;
    try {
      const res = await fetch(withProject('/api/aliases'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: trimmed })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Gagal menyimpan alias');
      }
    } catch (e) {
      console.error('Failed to register alias', e);
      // Avoid noisy UI: only show this when user is actively doing an action
    }
  }, [withProject]);

  const refreshInbox = useCallback(async (currentAddr = address, options = {}) => {
    const { silent = false } = options;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const res = await fetch(
        withProject(`/api/messages?alias=${encodeURIComponent(currentAddr)}`)
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Gagal mengambil pesan');
      setMessages(data.messages || []);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err) {
      console.error(err);
      if (!silent) setError(err?.message || 'Gagal memuat inbox');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [address, withProject]);

  async function openMessage(id) {
    try {
      setDetail({ loading: true });
      const res = await fetch(withProject(`/api/messages/${id}`));
      if (!res.ok) throw new Error('Gagal mengambil detail pesan');
      const data = await res.json();
      setDetail({ ...data, loading: false });
    } catch (err) {
      console.error(err);
      setDetail({ loading: false, error: 'Gagal memuat isi pesan' });
    }
  }

  useEffect(() => {
    if (!address || !address.includes('@') || !localPartValid) return undefined;
    registerAlias(address);
    refreshInbox(address);
    const timer = setInterval(() => refreshInbox(address, { silent: true }), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [address, selectedProject, registerAlias, refreshInbox, localPartValid]);

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
      } catch (e) {
        console.error('Failed to load projects', e);
      }
    }
    loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    persistProject(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    async function loadDomains() {
      try {
        const res = await fetch(withProject('/api/domains'));
        const data = await res.json();
        const active = (data.domains || []).map((d) => d.name);
        setDomains(active);
        if (active.length > 0) {
          // ensure selectedDomain is valid
          if (!selectedDomain || !active.includes(selectedDomain)) setSelectedDomain(active[0]);
        }
      } catch (e) {
        console.error('Failed to load domains', e);
      }
    }
    loadDomains();
  }, [selectedProject, selectedDomain, withProject]);

  useEffect(() => {
    if (!selectedDomain) return;
    const newAddr = `${localPart}@${selectedDomain}`;
    setAddress(newAddr);
  }, [localPart, selectedDomain]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <main style={{ background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <header className="bg-white border-bottom sticky-top">
        <div className="container-xl py-3">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <div className="bg-primary text-white d-flex align-items-center justify-content-center rounded" style={{ width: 40, height: 40 }}>
                <i className="bi bi-envelope-fill" />
              </div>
              <h1 className="h5 mb-0">PBS Mail</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container-xl py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-lg-8">
            {/* Email Input Section */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
              <div className="row g-3 mb-3">
                <div className="col-12 col-md-6">
                  <label className="form-label small text-muted fw-bold">Pilih Tenant</label>
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
              </div>
              <div className="alert alert-info py-2 px-3 small mb-3">
                Cara pakai: buat alamat email sementara, salin alamatnya, lalu tunggu email masuk otomatis.
              </div>
              <h6 className="text-uppercase text-muted fw-bold mb-3" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                Alamat Email Sementara
              </h6>
              <div className="input-group input-group-lg mb-3">
                <span className="input-group-text bg-light border-0">
                  <i className="bi bi-at" />
                </span>
                <input
                  value={localPart}
                  onChange={(e) => setLocalPart(sanitizeLocalPart(e.target.value))}
                  className="form-control border-0 fs-5"
                  placeholder="nama-alias"
                  spellCheck="false"
                />
                <span className="input-group-text border-0 bg-white">@</span>
                <select
                  className="form-select border-0 fs-6"
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                  aria-label="Select domain"
                >
                  {(domains.length ? domains : [DEFAULT_DOMAIN]).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="d-grid gap-2 d-sm-flex">
                <button
                  className="btn btn-primary flex-grow-1"
                  onClick={() => copyToClipboard(address)}
                  disabled={!address || !address.includes('@') || !localPartValid}
                >
                  <i className="bi bi-clipboard me-2" /> Salin
                </button>
                <button
                  className="btn btn-outline-primary flex-grow-1"
                  onClick={() => {
                    const alias = randomAlias(10);
                    setLocalPart(alias);
                    setToast('✓ Alamat baru dibuat');
                  }}
                  disabled={!selectedDomain}
                >
                  <i className="bi bi-arrow-repeat me-2" /> Buat Alamat Baru
                </button>
              </div>
              {!localPartValid && (
                <div className="text-danger small mt-2">
                  Alias harus 3-32 karakter dan hanya boleh huruf kecil, angka, titik, strip, atau underscore.
                </div>
              )}
            </div>

            {/* Inbox Section */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="d-flex align-items-center justify-content-between p-4 border-bottom bg-light">
                <h6 className="mb-0 fw-bold">Kotak Masuk</h6>
                <div className="d-flex align-items-center gap-2">
                  <small className="text-muted">
                    {lastRefreshed && `Diperbarui ${lastRefreshed}`}
                  </small>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => refreshInbox()}
                    disabled={loading}
                  >
                    <i className={`bi ${loading ? 'bi-hourglass-split' : 'bi-arrow-clockwise'}`} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="alert alert-warning m-0 rounded-0 border-0 d-flex align-items-center gap-2">
                  <i className="bi bi-exclamation-triangle-fill" />
                  <span>{error}</span>
                </div>
              )}

              <div style={{ minHeight: '200px' }}>
                {loading && (
                  <div className="p-5 text-center text-muted">
                    <div className="spinner-border spinner-border-sm mb-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="small">Memuat pesan...</p>
                  </div>
                )}
                {!loading && !error && messages.length === 0 && (
                  <div className="p-5 text-center text-muted">
                    <div className="spinner-border spinner-border-sm" role="status" aria-label="Waiting for emails" />
                  </div>
                )}
                {!loading && messages.length > 0 && (
                  <div className="list-group list-group-flush">
                      {displayedMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="list-group-item list-group-item-action border-0 border-bottom text-start p-3 hover-light"
                        onClick={() => openMessage(msg.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') openMessage(msg.id);
                        }}
                        role="button"
                        tabIndex={0}
                        style={{ transition: 'background-color 0.15s' }}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-2 mb-1">
                          <h6 className="mb-0 fw-600" style={{ fontSize: '0.95rem' }}>
                            {msg.subject || '(no subject)'}
                          </h6>
                          <div className="d-flex align-items-center ms-auto gap-2">
                            <small className="text-muted text-nowrap">{formatMessageDate(msg.date)}</small>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                copyOtpFromMessage(msg);
                              }}
                              title="Copy"
                            >
                              <i className="bi bi-clipboard-check me-1" /> Salin OTP
                            </button>
                          </div>
                        </div>
                        <p className="mb-0 text-muted small" style={{ lineHeight: 1.4 }}>
                          {msg.snippet || '(no preview)'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email Detail Modal */}
      {detail && (
        <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setDetail(null)}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header border-0 bg-light">
                <div className="d-flex align-items-center justify-content-between w-100 gap-2">
                  <h5 className="modal-title mb-0">{detail.loading ? 'Memuat...' : detail.subject || '(tanpa subjek)'}</h5>
                  <div className="d-flex align-items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={copyOtpFromDetail}
                      disabled={detail.loading || Boolean(detail.error)}
                      title="Copy"
                    >
                      <i className="bi bi-clipboard-check me-1" /> Salin OTP
                    </button>
                    <button type="button" className="btn-close" onClick={() => setDetail(null)} />
                  </div>
                </div>
              </div>
              <div className="modal-body">
                {detail.loading && (
                  <div className="text-center text-muted py-5">
                    <div className="spinner-border spinner-border-sm mb-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="small">Memuat isi pesan...</p>
                  </div>
                )}
                {detail.error && (
                  <div className="alert alert-danger mb-0">{detail.error}</div>
                )}
                {!detail.loading && !detail.error && (
                  <>
                    <div className="bg-light p-3 rounded mb-3">
                      <small className="d-block text-muted mb-1">
                        <strong>From:</strong> {detail.from}
                      </small>
                      <small className="d-block text-muted">
                        <strong>Tanggal:</strong> {formatMessageDate(detail.date)}
                      </small>
                    </div>
                    <div className="email-body">
                      {detail.bodyHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: detail.bodyHtml }} />
                      ) : detail.bodyText ? (
                        <pre style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                          {detail.bodyText}
                        </pre>
                      ) : (
                        <p className="text-muted small">No content</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className="position-fixed bottom-0 start-50 translate-middle-x mb-3 px-3 py-2 bg-dark text-white rounded-pill"
          style={{ zIndex: 2000, fontSize: '0.875rem' }}
        >
          {toast}
        </div>
      )}
    </main>
  );
}
