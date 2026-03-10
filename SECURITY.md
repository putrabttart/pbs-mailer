# Security Best Practices

Dokumen ini menjelaskan praktik keamanan yang diimplementasikan dan rekomendasi deployment.

## 1. Autentikasi & Otorisasi

### Admin API Key
- **WAJIB**: Ganti `ADMIN_API_KEY` dari nilai default ke string acak min 32 karakter
- Generate secure key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Simpan di ENV atau secret manager (AWS Secrets Manager, Azure Key Vault, dll)
- Jangan hard-code atau commit ke repository
- Rotasi key secara berkala (setiap 90 hari)

### OAuth Token Protection
- `token.json` berisi refresh token yang valid indefinitely (sampai di-revoke)
- **Enkripsi at-rest**: Set `TOKEN_ENCRYPTION_KEY` (16 bytes hex) untuk enkripsi AES-128-CBC
- Generate key: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
- Jika tidak dienkripsi, pastikan file permission ketat: `chmod 600 token.json`
- Gunakan custom path via `TOKEN_PATH` di luar webroot jika hosting shared
- Revoke token saat tidak digunakan: `POST /auth/revoke` (admin only)

### OAuth State Protection
- State tokens untuk mencegah CSRF attack di OAuth flow
- TTL 10 menit, auto-cleanup expired states
- Setiap state hanya bisa digunakan sekali (consumed after use)

## 2. Network Security

### CORS (Cross-Origin Resource Sharing)
- Default allowlist: `localhost:3000`, `localhost:5173`
- **Production**: Hanya izinkan domain frontend resmi
- Set `ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com`
- Jangan gunakan wildcard `*` di production

### Rate Limiting
- Public endpoints: 100 req/menit per IP
- Admin endpoints: 60 req/menit per IP
- Customize di `index.js` jika perlu (contoh: 30 req/menit untuk admin di production)
- Consider menggunakan Redis untuk rate limiting distributed (jika multi-instance)

### Helmet - HTTP Headers
- Content Security Policy (CSP) aktif dengan allowlist CDN
- **Production**: Self-host semua asset (Bootstrap, jQuery, Font Awesome) dan ganti CSP ke `'self'` only
- X-Frame-Options: DENY (mencegah clickjacking)
- X-Content-Type-Options: nosniff
- Strict-Transport-Security: max-age=31536000 (jika HTTPS)

## 3. Input Validation

### Zod Schema Validation
- Email: max 254 chars, local max 64, domain max 190
- Domain: regex validation, max 190 chars
- Semua user input divalidasi sebelum diproses
- Reject request dengan 400 Bad Request jika invalid

### Domain Allowlist
- Hanya domain yang terdaftar dan aktif yang bisa digunakan untuk alias
- Admin harus eksplisit menambahkan domain baru
- Mencegah abuse dengan domain arbitrary

### SQL Injection & XSS
- Tidak ada database SQL (file-based JSON)
- Output di frontend di-escape (escapeHtml function)
- Gmail API response trusted tapi tetap di-sanitize sebelum render HTML body

## 4. Audit & Logging

### Audit Trail
- Semua admin actions dicatat di `data/audit.json`
- Capture: timestamp, action, IP, user-agent
- Actions: alias_deleted, domain_added, domain_deleted, logs_cleared, token_revoked, admin_unauthorized
- Capped at 1000 entries (FIFO)
- **Production**: Ship audit logs ke SIEM (Splunk, ELK, CloudWatch)

### Structured Logging
- Format JSON: `{level, message, timestamp, ...meta}`
- Levels: info, warn, error
- Set `LOG_LEVEL=warn` di production untuk reduce noise
- Jangan log sensitive data (passwords, tokens, full email bodies)

### Access Logs
- User inbox access dicatat di `data/logs.json`
- Capped at 500 entries untuk prevent bloat
- **Production**: Rotate logs daily atau ship ke log aggregator

## 5. Deployment

### Environment Separation
- Pisahkan ENV untuk dev/staging/production
- Production:
  - `NODE_ENV=production`
  - `LOG_LEVEL=warn`
  - Rate limits lebih ketat (30 req/menit admin)
  - HTTPS only (reverse proxy Nginx/Caddy)

### HTTPS & TLS
- **WAJIB** di production
- Gunakan Let's Encrypt atau wildcard cert
- Redirect HTTP → HTTPS
- Set `Strict-Transport-Security` header (Helmet)
- Update `GOOGLE_REDIRECT_URI` ke `https://...`

### Reverse Proxy
- Nginx/Caddy/Traefik di depan Node.js
- Proxy headers: `X-Forwarded-For`, `X-Real-IP` (trust proxy enabled)
- Rate limiting tambahan di proxy layer
- Static asset serving dari proxy (cache control)

### Docker Security
- Run container as non-root user
- Scan image dengan Trivy/Snyk
- Multi-stage build untuk reduce attack surface
- Mount secret files read-only: `-v /secure/token.json:/app/token.json:ro`

### File Permissions
```bash
# Backend directory
chmod 750 gmail-backend
chmod 600 gmail-backend/.env
chmod 600 gmail-backend/token.json
chmod 700 gmail-backend/data

# Data files
chmod 600 gmail-backend/data/*.json
```

## 6. Incident Response

### Token Compromise
1. Revoke token: `curl -X POST http://localhost:3000/auth/revoke -H "x-admin-key: YOUR_KEY"`
2. Hapus file: `rm token.json`
3. Revoke di Google Console: https://myaccount.google.com/permissions
4. Re-authenticate via `/login`
5. Rotasi `TOKEN_ENCRYPTION_KEY`

### Admin Key Leak
1. Generate key baru: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Update `.env` dengan key baru
3. Restart service
4. Notify admin users untuk update config
5. Check audit logs untuk aktivitas mencurigakan

### Rate Limit Bypass
- Check IP di audit logs
- Blacklist IP di firewall/proxy level
- Reduce rate limit window atau increase ban duration
- Consider Cloudflare atau AWS WAF

## 7. Monitoring & Alerts

### Health Checks
- `/health` — Overall health (hasToken, cacheSize, config)
- `/health/token` — Gmail API connectivity (requires auth)
- Set up uptime monitoring (UptimeRobot, Pingdom, AWS CloudWatch)
- Alert jika `/health` return non-200 atau token invalid

### Metrics to Track
- Request rate per endpoint
- Error rate (5xx responses)
- Token refresh failures
- Cache hit/miss ratio
- Audit log entries (spike = potential attack)
- Memory usage (cache growth)

### Alert Thresholds
- Error rate > 5% dalam 5 menit
- Request rate > 1000/menit per IP
- Token health check fail 3x berturut-turut
- Disk usage > 80% (log files)

## 8. Dependencies Security

### npm audit
```bash
# Check vulnerabilities
npm audit

# Auto-fix (test first!)
npm audit fix

# Production install only
npm ci --only=production
```

### Keep Updated
- Update dependencies monthly: `npm update`
- Monitor security advisories: GitHub Dependabot, Snyk
- Pin major versions di `package.json`
- Test before updating to new major versions

### Known Safe Versions (Dec 2025)
- express: 5.x
- helmet: 7.x
- express-rate-limit: 7.x
- googleapis: 166.x
- zod: 3.x
- p-limit: 6.x

## 9. Compliance

### GDPR (jika EU users)
- Data minimization: hanya simpan metadata, bukan full email body
- Right to deletion: endpoint `/api/admin/aliases/:address` (DELETE)
- Data retention: logs capped, old entries auto-deleted
- Consent: inform users bahwa email metadata di-log

### Data Retention Policy
- Aliases: indefinite (sampai di-delete manual)
- Logs: 500 entries FIFO (~ 1-7 hari depending on traffic)
- Audit: 1000 entries FIFO (~ 30-90 hari)
- Message cache: 5 menit TTL

### Privacy
- Email content tidak disimpan di disk (hanya di cache RAM)
- OAuth token hanya untuk read-only Gmail access
- Tidak share data dengan third-party
- IP di audit log: hash jika required by privacy policy

## 10. Checklist Pre-Production

- [ ] Ganti `ADMIN_API_KEY` ke nilai secure (32+ chars)
- [ ] Set `TOKEN_ENCRYPTION_KEY` untuk enkripsi token
- [ ] Update `ALLOWED_ORIGINS` ke domain production only
- [ ] Set `LOG_LEVEL=warn` atau `error`
- [ ] Enable HTTPS via reverse proxy
- [ ] Set custom `TOKEN_PATH` di luar webroot
- [ ] File permissions: `.env` (600), `token.json` (600), `data/` (700)
- [ ] Setup health check monitoring
- [ ] Ship audit logs ke SIEM
- [ ] Configure backup untuk `data/` directory
- [ ] Test OAuth flow end-to-end
- [ ] Test admin key authentication
- [ ] Test rate limiting (automated)
- [ ] Review CSP allowlist (self-host assets jika possible)
- [ ] Setup alerts untuk error rate & token health
- [ ] Document incident response procedure
- [ ] Security scan: `npm audit`, Docker image scan
- [ ] Penetration testing (optional tapi recommended)

## Resources
- OWASP Top 10: https://owasp.org/www-project-top-ten/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Helmet.js Documentation: https://helmetjs.github.io/
