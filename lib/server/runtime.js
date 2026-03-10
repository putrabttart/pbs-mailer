import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { google } from 'googleapis';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const MODULE_INSTANCE_ID =
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const LOG_LEVELS = { info: 0, warn: 1, error: 2 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] >= CURRENT_LOG_LEVEL) {
    console.log(
      JSON.stringify({ level, message, ...meta, timestamp: new Date().toISOString() })
    );
  }
}

// ========== ENV VALIDATION ==========
const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  PROJECTS_JSON: z.string().optional(),
  DEFAULT_PROJECT_KEY: z.string().optional(),
  SUPER_ADMIN_EMAILS: z.string().optional(),
  SUPER_ADMIN_API_KEY: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  MAX_MESSAGES: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  TOKEN_PATH: z.string().optional(),
  DATA_DIR: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_KV_TABLE: z.string().optional(),
  SUPABASE_TABLE_ALIASES: z.string().optional(),
  SUPABASE_TABLE_DOMAINS: z.string().optional(),
  SUPABASE_TABLE_LOGS: z.string().optional(),
  SUPABASE_TABLE_AUDIT: z.string().optional()
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Missing required environment variables: ${parsed.error.issues
        .map((i) => i.path.join('.'))
        .join(', ')}`
    );
  }
  return parsed.data;
}

const env = loadEnv();
const ROOT_DIR = process.cwd();
const fsPromises = fs.promises;

const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');
const LEGACY_DATA_DIR = path.join(ROOT_DIR, 'gmail-backend', 'data');
const DATA_DIR = env.DATA_DIR || (fs.existsSync(DEFAULT_DATA_DIR) ? DEFAULT_DATA_DIR : LEGACY_DATA_DIR);

const DEFAULT_TOKEN_PATH = path.join(ROOT_DIR, 'token.json');
const LEGACY_TOKEN_PATH = path.join(ROOT_DIR, 'gmail-backend', 'token.json');
// Prefer new location, fallback to legacy hanya jika ada dan default belum ada
const TOKEN_PATH = env.TOKEN_PATH || DEFAULT_TOKEN_PATH;
const ALIASES_PATH = path.join(DATA_DIR, 'aliases.json');
const DOMAINS_PATH = path.join(DATA_DIR, 'domains.json');
const LOGS_PATH = path.join(DATA_DIR, 'logs.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.json');
const SUPERADMIN_PROJECTS_PATH = path.join(DATA_DIR, 'superadmin-projects.json');

const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const MAX_MESSAGES = Math.min(parseInt(env.MAX_MESSAGES || '20', 10) || 20, 50);
const TOKEN_ENCRYPTION_KEY = env.TOKEN_ENCRYPTION_KEY || null;
const ADMIN_EMAILS = (env.ADMIN_EMAILS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
const SUPER_ADMIN_EMAILS = normalizeEmails(env.SUPER_ADMIN_EMAILS || env.ADMIN_EMAILS || '');
const SUPER_ADMIN_API_KEY = String(env.SUPER_ADMIN_API_KEY || '').trim();
const CLOUDFLARE_API_TOKEN = String(env.CLOUDFLARE_API_TOKEN || '').trim();
const CLOUDFLARE_ACCOUNT_ID = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();

const PROJECT_KEY_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function normalizeProjectKey(input) {
  const normalized = String(input || '').trim().toLowerCase();
  return PROJECT_KEY_REGEX.test(normalized) ? normalized : null;
}

function normalizeEmails(input) {
  if (Array.isArray(input)) {
    return input
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function parseProjectListFromEnv() {
  const raw = env.PROJECTS_JSON;
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PROJECTS_JSON must be valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('PROJECTS_JSON must be an array');
  }

  return parsed
    .map((item) => {
      const key = normalizeProjectKey(item?.key);
      if (!key) return null;
      return {
        key,
        label: String(item?.label || key),
        googleClientId: String(item?.googleClientId || item?.google?.clientId || '').trim(),
        googleClientSecret: String(item?.googleClientSecret || item?.google?.clientSecret || '').trim(),
        googleRedirectUri: String(item?.googleRedirectUri || item?.google?.redirectUri || '').trim(),
        adminEmails: normalizeEmails(item?.adminEmails)
      };
    })
    .filter(Boolean);
}

const configuredProjects = parseProjectListFromEnv();

const globalGoogleConfig = {
  googleClientId: String(env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: String(env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleRedirectUri: String(env.GOOGLE_REDIRECT_URI || '').trim()
};

const DEFAULT_PROJECT_KEY =
  normalizeProjectKey(env.DEFAULT_PROJECT_KEY) ||
  configuredProjects[0]?.key ||
  'default';

const PROJECTS = new Map();

configuredProjects.forEach((project) => {
  PROJECTS.set(project.key, {
    ...project,
    googleClientId: project.googleClientId || globalGoogleConfig.googleClientId,
    googleClientSecret: project.googleClientSecret || globalGoogleConfig.googleClientSecret,
    googleRedirectUri: project.googleRedirectUri || globalGoogleConfig.googleRedirectUri,
    adminEmails: project.adminEmails.length ? project.adminEmails : ADMIN_EMAILS
  });
});

if (!PROJECTS.size) {
  PROJECTS.set(DEFAULT_PROJECT_KEY, {
    key: DEFAULT_PROJECT_KEY,
    label: 'Default',
    ...globalGoogleConfig,
    adminEmails: ADMIN_EMAILS
  });
}

for (const project of PROJECTS.values()) {
  if (!project.googleClientId || !project.googleClientSecret || !project.googleRedirectUri) {
    throw new Error(
      `Missing Google OAuth config for project "${project.key}". ` +
        'Set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI or PROJECTS_JSON with per-project credentials.'
    );
  }
}

function normalizeProjectInput(item) {
  const key = normalizeProjectKey(item?.key);
  if (!key) return null;
  const adminEmails = normalizeEmails(item?.adminEmails);
  const envValues = item?.envValues && typeof item.envValues === 'object' && !Array.isArray(item.envValues)
    ? Object.fromEntries(
        Object.entries(item.envValues).map(([k, v]) => [String(k), String(v ?? '')])
      )
    : {};
  return {
    key,
    label: String(item?.label || key),
    googleClientId: String(item?.googleClientId || item?.google?.clientId || '').trim(),
    googleClientSecret: String(item?.googleClientSecret || item?.google?.clientSecret || '').trim(),
    googleRedirectUri: String(item?.googleRedirectUri || item?.google?.redirectUri || '').trim(),
    adminEmails,
    domains: Array.isArray(item?.domains)
      ? item.domains.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
      : [],
    envValues,
    createdAt: item?.createdAt ? String(item.createdAt) : undefined,
    updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined
  };
}

function enrichProject(project) {
  return {
    ...project,
    googleClientId: project.googleClientId || globalGoogleConfig.googleClientId,
    googleClientSecret: project.googleClientSecret || globalGoogleConfig.googleClientSecret,
    googleRedirectUri: project.googleRedirectUri || globalGoogleConfig.googleRedirectUri,
    adminEmails: project.adminEmails?.length ? project.adminEmails : ADMIN_EMAILS,
    domains: Array.isArray(project.domains) ? project.domains : [],
    envValues:
      project.envValues && typeof project.envValues === 'object' && !Array.isArray(project.envValues)
        ? project.envValues
        : {}
  };
}

async function loadSuperAdminProjects() {
  if (USE_SUPABASE_STORAGE) {
    const value = await supabaseGet('superadmin:projects');
    if (!Array.isArray(value)) return [];
    return value.map(normalizeProjectInput).filter(Boolean);
  }

  if (!(await fileExists(SUPERADMIN_PROJECTS_PATH))) return [];
  try {
    const raw = await fsPromises.readFile(SUPERADMIN_PROJECTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProjectInput).filter(Boolean);
  } catch (error) {
    log('error', 'Failed to load super admin projects', { error: error.message });
    return [];
  }
}

async function saveSuperAdminProjects(list) {
  const normalized = list.map(normalizeProjectInput).filter(Boolean);
  if (USE_SUPABASE_STORAGE) {
    await supabaseSet('superadmin:projects', normalized);
    return;
  }
  await fsPromises.writeFile(SUPERADMIN_PROJECTS_PATH, JSON.stringify(normalized, null, 2));
}

async function getMergedProjectMap() {
  const merged = new Map();

  for (const project of PROJECTS.values()) {
    merged.set(project.key, enrichProject(project));
  }

  const dynamicProjects = await loadSuperAdminProjects();
  for (const dynamicProject of dynamicProjects) {
    const existing = merged.get(dynamicProject.key);
    merged.set(dynamicProject.key, enrichProject({ ...existing, ...dynamicProject }));
  }

  if (!merged.size) {
    merged.set(DEFAULT_PROJECT_KEY, enrichProject({ key: DEFAULT_PROJECT_KEY, label: 'Default' }));
  }

  return merged;
}

async function resolveProjectConfigAsync(projectKeyInput) {
  const normalized = normalizeProjectKey(projectKeyInput) || DEFAULT_PROJECT_KEY;
  const merged = await getMergedProjectMap();
  return merged.get(normalized) || merged.get(DEFAULT_PROJECT_KEY) || Array.from(merged.values())[0];
}

function resolveProjectFromRequest(request) {
  const url = new URL(request.url);
  const fromQuery = normalizeProjectKey(url.searchParams.get('project'));
  const fromHeader = normalizeProjectKey(request.headers.get('x-project-key'));
  const fromCookie = normalizeProjectKey(
    typeof request.cookies?.get === 'function'
      ? request.cookies.get('tmail_project')?.value
      : null
  );
  return fromQuery || fromHeader || fromCookie || DEFAULT_PROJECT_KEY;
}

function listProjects() {
  return {
    defaultProject: DEFAULT_PROJECT_KEY,
    projects: Array.from(PROJECTS.values()).map((project) => ({
      key: project.key,
      label: project.label,
      hasCustomGoogleConfig:
        project.googleClientId !== globalGoogleConfig.googleClientId ||
        project.googleRedirectUri !== globalGoogleConfig.googleRedirectUri
    }))
  };
}

async function listProjectsWithStatus() {
  const merged = await getMergedProjectMap();
  const base = {
    defaultProject: DEFAULT_PROJECT_KEY,
    projects: Array.from(merged.values()).map((project) => ({
      key: project.key,
      label: project.label,
      googleClientId: project.googleClientId || '',
      googleRedirectUri: project.googleRedirectUri || '',
      hasCustomGoogleConfig:
        project.googleClientId !== globalGoogleConfig.googleClientId ||
        project.googleRedirectUri !== globalGoogleConfig.googleRedirectUri,
      adminEmails: project.adminEmails,
      domains: project.domains,
      envValues: project.envValues,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null
    }))
  };
  const projects = await Promise.all(
    base.projects.map(async (project) => ({
      ...project,
      hasToken: await tokenExists(project.key)
    }))
  );

  return {
    ...base,
    projects
  };
}

const SUPABASE_URL = env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KV_TABLE = env.SUPABASE_KV_TABLE || 'app_kv';
const SUPABASE_TABLE_ALIASES = env.SUPABASE_TABLE_ALIASES || 'app_aliases';
const SUPABASE_TABLE_DOMAINS = env.SUPABASE_TABLE_DOMAINS || 'app_domains';
const SUPABASE_TABLE_LOGS = env.SUPABASE_TABLE_LOGS || 'app_logs';
const SUPABASE_TABLE_AUDIT = env.SUPABASE_TABLE_AUDIT || 'app_audit';
const USE_SUPABASE_STORAGE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!USE_SUPABASE_STORAGE) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let supabaseAdmin = null;
function getSupabaseAdmin() {
  if (!USE_SUPABASE_STORAGE) return null;
  if (supabaseAdmin) return supabaseAdmin;
  const noStoreFetch = (input, init = {}) => {
    return fetch(input, {
      ...init,
      // Important: don't set both `cache` and `next.revalidate` (Next.js warns).
      // Supabase admin reads should always bypass caching.
      cache: 'no-store'
    });
  };
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch }
  });
  return supabaseAdmin;
}

const STORAGE_KEYS = {
  [TOKEN_PATH]: 'token',
  [ALIASES_PATH]: 'aliases',
  [DOMAINS_PATH]: 'domains',
  [LOGS_PATH]: 'logs',
  [AUDIT_PATH]: 'audit'
};

function getStorageKey(file) {
  return STORAGE_KEYS[file] || path.basename(file);
}

function getScopedStorageKey(file, projectKey) {
  const baseKey = getStorageKey(file);
  return `${projectKey}:${baseKey}`;
}

function getScopedFilePath(file, projectKey) {
  if (projectKey === DEFAULT_PROJECT_KEY) return file;
  return `${file}.${projectKey}.json`;
}

function shouldUseLegacyStructuredTables(projectKey) {
  return USE_SUPABASE_STORAGE && projectKey === DEFAULT_PROJECT_KEY;
}

async function supabaseGet(key) {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client
    .from(SUPABASE_KV_TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    log('error', 'Supabase get failed', { key, error: error.message });
    return null;
  }
  return data?.value ?? null;
}

async function supabaseSet(key, value) {
  const client = getSupabaseAdmin();
  if (!client) return;
  const { error } = await client
    .from(SUPABASE_KV_TABLE)
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    log('error', 'Supabase set failed', { key, error: error.message });
  }
}

async function supabaseSelectAll(table, orderBy = null) {
  const client = getSupabaseAdmin();
  if (!client) return null;
  let query = client.from(table).select('*');
  if (orderBy) query = query.order(orderBy, { ascending: true });
  const { data, error } = await query;
  if (error) {
    log('error', 'Supabase select failed', { table, error: error.message });
    return null;
  }
  return data || [];
}

async function supabaseReplaceAll(table, rows, pkField) {
  const client = getSupabaseAdmin();
  if (!client) return;
  const { error: deleteError } = await client.from(table).delete().neq(pkField, '');
  if (deleteError) {
    log('error', 'Supabase delete failed', { table, error: deleteError.message });
    return;
  }
  if (!rows.length) return;
  const { error: insertError } = await client.from(table).insert(rows);
  if (insertError) {
    log('error', 'Supabase insert failed', { table, error: insertError.message });
  }
}

async function supabaseInsert(table, row) {
  const client = getSupabaseAdmin();
  if (!client) return;
  const { error } = await client.from(table).insert(row);
  if (error) {
    log('error', 'Supabase insert failed', { table, error: error.message });
  }
}

async function supabaseTrimAudit(limit) {
  const client = getSupabaseAdmin();
  if (!client) return;
  const { data, error } = await client
    .from(SUPABASE_TABLE_AUDIT)
    .select('id')
    .order('timestamp', { ascending: false })
    .range(limit, limit + 1000);
  if (error || !data || !data.length) return;
  const ids = data.map((row) => row.id);
  await client.from(SUPABASE_TABLE_AUDIT).delete().in('id', ids);
}

async function fileExists(file) {
  try {
    await fsPromises.access(file);
    return true;
  } catch {
    return false;
  }
}

// ========== FILE HELPERS ==========
function encryptToken(text) {
  if (!TOKEN_ENCRYPTION_KEY) return text;
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function decryptToken(text) {
  if (!TOKEN_ENCRYPTION_KEY) return text;
  const parts = text.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted token format');
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function loadJson(file, fallback, projectKey = DEFAULT_PROJECT_KEY) {
  if (USE_SUPABASE_STORAGE) {
    const key = getScopedStorageKey(file, projectKey);
    const value = await supabaseGet(key);
    if (value == null) return fallback;
    if (file === TOKEN_PATH) {
      if (typeof value === 'string') {
        const content = TOKEN_ENCRYPTION_KEY ? decryptToken(value) : value;
        return JSON.parse(content);
      }
      return value;
    }
    return value;
  }

  const targetFile = getScopedFilePath(file, projectKey);
  if (!(await fileExists(targetFile))) return fallback;
  try {
    const raw = await fsPromises.readFile(targetFile, 'utf8');
    const content = file === TOKEN_PATH ? decryptToken(raw) : raw;
    return JSON.parse(content);
  } catch (e) {
    log('error', `Failed to parse ${targetFile}`, { error: e.message });
    return fallback;
  }
}

async function saveJson(file, data, projectKey = DEFAULT_PROJECT_KEY) {
  if (USE_SUPABASE_STORAGE) {
    const key = getScopedStorageKey(file, projectKey);
    if (file === TOKEN_PATH) {
      const raw = JSON.stringify(data, null, 2);
      const content = TOKEN_ENCRYPTION_KEY ? encryptToken(raw) : raw;
      await supabaseSet(key, content);
      return;
    }
    await supabaseSet(key, data);
    return;
  }

  const raw = JSON.stringify(data, null, 2);
  const content = file === TOKEN_PATH ? encryptToken(raw) : raw;
  const targetFile = getScopedFilePath(file, projectKey);
  await fsPromises.writeFile(targetFile, content);
}

async function loadAliases(projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const data = await supabaseSelectAll(SUPABASE_TABLE_ALIASES, 'created_at');
    if (!data) return [];
    return data.map((row) => ({
      address: row.address,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      hits: row.hits || 0,
      active: row.active
    }));
  }
  return loadJson(ALIASES_PATH, [], projectKey);
}

async function saveAliases(list, projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const rows = list.map((item) => ({
      address: item.address,
      created_at: item.createdAt || null,
      last_used_at: item.lastUsedAt || null,
      hits: item.hits || 0,
      active: typeof item.active === 'boolean' ? item.active : true
    }));
    await supabaseReplaceAll(SUPABASE_TABLE_ALIASES, rows, 'address');
    return;
  }
  await saveJson(ALIASES_PATH, list, projectKey);
}

async function loadDomains(projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const data = await supabaseSelectAll(SUPABASE_TABLE_DOMAINS, 'created_at');
    if (data && data.length) {
      return data.map((row) => ({
        name: row.name,
        active: typeof row.active === 'boolean' ? row.active : true,
        createdAt: row.created_at
      }));
    }
    return [];
  }
  const domains = await loadJson(DOMAINS_PATH, [], projectKey);
  if (domains.length) return domains;
  return [];
}

async function saveDomains(list, projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const rows = list.map((item) => ({
      name: item.name,
      active: typeof item.active === 'boolean' ? item.active : true,
      created_at: item.createdAt || null
    }));
    await supabaseReplaceAll(SUPABASE_TABLE_DOMAINS, rows, 'name');
    return;
  }
  await saveJson(DOMAINS_PATH, list, projectKey);
}

async function loadLogs(projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const data = await supabaseSelectAll(SUPABASE_TABLE_LOGS, 'last_seen_at');
    if (!data) return [];
    return data.map((row) => ({
      id: row.id,
      alias: row.alias,
      from: row.from ?? row.from_email ?? '',
      subject: row.subject,
      date: row.date,
      snippet: row.snippet,
      lastSeenAt: row.last_seen_at
    }));
  }
  return loadJson(LOGS_PATH, [], projectKey);
}

async function saveLogs(list, projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const rows = list.map((item) => ({
      id: item.id,
      alias: item.alias || null,
      from_email: item.from || null,
      subject: item.subject || '',
      date: item.date || '',
      snippet: item.snippet || '',
      last_seen_at: item.lastSeenAt || null
    }));
    await supabaseReplaceAll(SUPABASE_TABLE_LOGS, rows, 'id');
    return;
  }
  await saveJson(LOGS_PATH, list, projectKey);
}

async function loadAudit(projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const data = await supabaseSelectAll(SUPABASE_TABLE_AUDIT, 'timestamp');
    if (!data) return [];
    return data.map((row) => ({
      timestamp: row.timestamp,
      action: row.action,
      ip: row.ip || null,
      userAgent: row.user_agent || null,
      ...(row.meta || {})
    }));
  }
  return loadJson(AUDIT_PATH, [], projectKey);
}

async function saveAudit(list, projectKey = DEFAULT_PROJECT_KEY) {
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const rows = list.map((item) => ({
      timestamp: item.timestamp || new Date().toISOString(),
      action: item.action || 'unknown',
      ip: item.ip || null,
      user_agent: item.userAgent || null,
      meta: item
    }));
    await supabaseReplaceAll(SUPABASE_TABLE_AUDIT, rows, 'timestamp');
    return;
  }
  await saveJson(AUDIT_PATH, list, projectKey);
}

// ========== VALIDATION ==========
const emailSchema = z
  .string()
  .email()
  .max(254)
  .refine((email) => {
    const [local, domain] = email.split('@');
    return local && local.length <= 64 && domain && domain.length <= 190;
  });

const domainSchema = z
  .string()
  .regex(/^[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/)
  .max(190);

function isValidEmail(address) {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim().toLowerCase();
  return emailSchema.safeParse(trimmed).success;
}

async function isAllowedDomain(domain, projectKey = DEFAULT_PROJECT_KEY) {
  const domains = await loadDomains(projectKey);
  return domains.find((d) => d.name === domain && d.active !== false);
}

async function auditLog(action, reqMeta = {}, projectKey = DEFAULT_PROJECT_KEY) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    projectKey,
    ...reqMeta
  };
  if (shouldUseLegacyStructuredTables(projectKey)) {
    const { ip, userAgent, ...meta } = reqMeta || {};
    await supabaseInsert(SUPABASE_TABLE_AUDIT, {
      timestamp: entry.timestamp,
      action,
      ip: ip || null,
      user_agent: userAgent || null,
      meta: { ...meta, projectKey }
    });
    await supabaseTrimAudit(1000);
    log('info', 'Audit log', entry);
    return;
  }
  const audits = await loadAudit(projectKey);
  audits.push(entry);
  const MAX_AUDIT = 1000;
  if (audits.length > MAX_AUDIT) audits.splice(0, audits.length - MAX_AUDIT);
  await saveAudit(audits, projectKey);
  log('info', 'Audit log', entry);
}

// ========== CACHE ==========
const messageCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const entry = messageCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    messageCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  messageCache.set(key, { value, expiresAt: Date.now() + ttl });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of messageCache.entries()) {
    if (entry.expiresAt < now) messageCache.delete(key);
  }
}, CACHE_TTL_MS).unref();

// ========== OAUTH STATE ==========
const AUTH_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

function createState(projectKey) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { expiresAt: Date.now() + AUTH_STATE_TTL_MS, projectKey });
  return state;
}

function consumeState(state) {
  const entry = pendingStates.get(state);
  if (!entry) return null;
  pendingStates.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry.projectKey || DEFAULT_PROJECT_KEY;
}

setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingStates.entries()) {
    if (entry.expiresAt < now) pendingStates.delete(state);
  }
}, AUTH_STATE_TTL_MS).unref();

// ========== OAUTH CLIENT ==========
const oauthClientSingletons = new Map();

async function tokenExists(projectKey = DEFAULT_PROJECT_KEY) {
  if (USE_SUPABASE_STORAGE) {
    const key = getScopedStorageKey(TOKEN_PATH, projectKey);
    const value = await supabaseGet(key);
    return value != null;
  }
  const filePath = getScopedFilePath(TOKEN_PATH, projectKey);
  return fileExists(filePath);
}

async function getOAuthClient(projectKey = DEFAULT_PROJECT_KEY) {
  if (oauthClientSingletons.has(projectKey)) return oauthClientSingletons.get(projectKey);
  const project = await resolveProjectConfigAsync(projectKey);
  const client = new google.auth.OAuth2(
    project.googleClientId,
    project.googleClientSecret,
    project.googleRedirectUri
  );

  if (await tokenExists(projectKey)) {
    try {
      const saved = await loadJson(TOKEN_PATH, null, projectKey);
      if (saved) {
        client.setCredentials(saved);
        log('info', 'Loaded saved token', { projectKey });
      }
    } catch (e) {
      log('error', 'Failed to parse token file', { error: e.message, projectKey });
    }
  }

  client.on('tokens', async (tokens) => {
    let current = {};
    if (await tokenExists(projectKey)) {
      try {
        current = await loadJson(TOKEN_PATH, {}, projectKey);
      } catch (e) {
        log('error', 'Failed reading token on refresh', { error: e.message, projectKey });
      }
    }
    const updated = { ...current, ...tokens };
    await saveJson(TOKEN_PATH, updated, projectKey);
    log('info', 'Token refreshed and saved', { projectKey });
  });

  oauthClientSingletons.set(projectKey, client);
  return client;
}

async function ensureToken(projectKey = DEFAULT_PROJECT_KEY) {
  if (!(await tokenExists(projectKey))) {
    throw new HttpError(401, 'Not authenticated');
  }
  try {
    const tokens = await loadJson(TOKEN_PATH, null, projectKey);
    if (!tokens) throw new Error('Invalid token content');
    const client = await getOAuthClient(projectKey);
    client.setCredentials(tokens);
    return client;
  } catch (e) {
    log('error', 'Failed to read token', { error: e.message, projectKey });
    throw new HttpError(500, 'Token file invalid');
  }
}

async function requireAdmin(request, projectKey = DEFAULT_PROJECT_KEY) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const project = await resolveProjectConfigAsync(projectKey);
  const allowedAdmins = project.adminEmails || ADMIN_EMAILS;

  if (token) {
    const client = getSupabaseAdmin();
    if (!client) {
      throw new HttpError(500, 'Supabase admin client not configured');
    }
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      throw new HttpError(401, 'Unauthorized');
    }
    const email = (data.user.email || '').toLowerCase();
    if (allowedAdmins.length > 0 && !allowedAdmins.includes(email)) {
      throw new HttpError(403, 'Forbidden');
    }
    return;
  }

  const key = request.headers.get('x-admin-key');
  if (env.ADMIN_API_KEY && key && key === env.ADMIN_API_KEY) {
    return;
  }

  throw new HttpError(401, 'Unauthorized');
}

async function getUserFromBearerToken(token) {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new HttpError(500, 'Supabase admin client not configured');
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    throw new HttpError(401, 'Unauthorized');
  }
  return data.user;
}

async function requireSuperAdmin(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (token) {
    const user = await getUserFromBearerToken(token);
    const email = (user.email || '').toLowerCase();
    if (SUPER_ADMIN_EMAILS.length > 0 && !SUPER_ADMIN_EMAILS.includes(email)) {
      throw new HttpError(403, 'Forbidden');
    }
    return { user };
  }

  const key = request.headers.get('x-super-admin-key');
  if (SUPER_ADMIN_API_KEY && key && key === SUPER_ADMIN_API_KEY) {
    return { user: null };
  }

  throw new HttpError(401, 'Unauthorized');
}

function decodeBase64Url(str = '') {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(payload) {
  let bodyHtml = '';
  let bodyText = '';

  function traverse(part) {
    if (!part) return;
    const data = part.body?.data ? decodeBase64Url(part.body.data) : '';
    if (part.mimeType === 'text/html') bodyHtml += data;
    if (part.mimeType === 'text/plain') bodyText += data;
    if (part.parts) part.parts.forEach(traverse);
  }

  traverse(payload);
  return { bodyHtml, bodyText };
}

async function touchLogs(msgs, alias, projectKey = DEFAULT_PROJECT_KEY) {
  if (!msgs || !msgs.length) return;
  const now = new Date().toISOString();
  const logs = await loadLogs(projectKey);
  const indexById = new Map();
  logs.forEach((l, i) => indexById.set(l.id, i));

  msgs.forEach((m) => {
    const idx = indexById.get(m.id);
    if (idx != null) {
      logs[idx].lastSeenAt = now;
      logs[idx].alias = alias || logs[idx].alias || null;
    } else {
      logs.push({
        id: m.id,
        alias: alias || null,
        from: m.from || '',
        subject: m.subject || '',
        date: m.date || '',
        snippet: m.snippet || '',
        lastSeenAt: now
      });
    }
  });

  const MAX_LOGS = 500;
  if (logs.length > MAX_LOGS) {
    logs.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
    logs.length = MAX_LOGS;
  }

  await saveLogs(logs, projectKey);
}

// ========== SERVICE METHODS ==========
async function generateAuthUrl(projectKey = DEFAULT_PROJECT_KEY) {
  const state = createState(projectKey);
  const client = await getOAuthClient(projectKey);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: AUTH_SCOPES,
    prompt: 'consent',
    state
  });
  return { url, state, expiresInMs: AUTH_STATE_TTL_MS, projectKey };
}

async function exchangeCode(code, state, projectKeyHint = DEFAULT_PROJECT_KEY) {
  if (!code) throw new HttpError(400, 'No code provided');
  let projectKey = normalizeProjectKey(projectKeyHint) || DEFAULT_PROJECT_KEY;
  // State validation optional (for development) - state bisa null
  if (state) {
    const fromState = consumeState(state);
    if (fromState) {
      projectKey = fromState;
    } else {
      log('warn', 'State validation failed but proceeding', { state, projectKey });
    }
  }
  try {
    const client = await getOAuthClient(projectKey);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await saveJson(TOKEN_PATH, tokens, projectKey);
    log('info', 'Token obtained and saved successfully', { projectKey });
    return { ok: true, projectKey };
  } catch (err) {
    log('error', 'Failed to get tokens', { error: err.message, projectKey });
    throw new HttpError(500, 'Failed to get tokens');
  }
}

async function revokeToken(projectKey = DEFAULT_PROJECT_KEY) {
  if (!(await tokenExists(projectKey))) {
    throw new HttpError(404, 'No token to revoke');
  }
  try {
    const client = await getOAuthClient(projectKey);
    await client.revokeCredentials();
    if (!USE_SUPABASE_STORAGE) {
      await fsPromises.unlink(getScopedFilePath(TOKEN_PATH, projectKey));
    } else {
      await supabaseSet(getScopedStorageKey(TOKEN_PATH, projectKey), null);
    }
    await auditLog('token_revoked', {}, projectKey);
    return { ok: true, projectKey };
  } catch (err) {
    log('error', 'Failed to revoke token', { error: err.message, projectKey });
    throw new HttpError(500, 'Failed to revoke token');
  }
}

async function health(projectKey = DEFAULT_PROJECT_KEY) {
  return {
    ok: true,
    projectKey,
    hasToken: await tokenExists(projectKey),
    allowedOrigins: ALLOWED_ORIGINS,
    maxMessages: MAX_MESSAGES,
    cacheSize: messageCache.size
  };
}

async function tokenHealth(projectKey = DEFAULT_PROJECT_KEY) {
  const client = await ensureToken(projectKey);
  const gmail = google.gmail({ version: 'v1', auth: client });
  const start = Date.now();
  await gmail.users.getProfile({ userId: 'me' });
  return { ok: true, tokenValid: true, latencyMs: Date.now() - start, projectKey };
}

async function listMessages(alias, projectKey = DEFAULT_PROJECT_KEY) {
  const client = await ensureToken(projectKey);
  const gmail = google.gmail({ version: 'v1', auth: client });
  const trimmedAlias = (alias || '').trim().toLowerCase();

  const listOptions = {
    userId: 'me',
    maxResults: MAX_MESSAGES
  };

  if (trimmedAlias) {
    if (!isValidEmail(trimmedAlias)) throw new HttpError(400, 'Invalid alias address');
    const domain = trimmedAlias.split('@')[1];
    if (!(await isAllowedDomain(domain, projectKey))) throw new HttpError(400, 'Domain not allowed');
    // Cloudflare Email Routing forwards to a destination Gmail address.
    // Depending on provider, the original alias may not be searchable via Gmail operators.
    // Strategy: list recent messages and filter by headers (Delivered-To/X-Original-To/To/Cc/Bcc).
    listOptions.q = 'newer_than:7d';
    // Don't hard-filter to INBOX; forwarded mail may be archived/spam.
    listOptions.includeSpamTrash = true;

    const now = new Date().toISOString();
    const aliases = await loadAliases(projectKey);
    const found = aliases.find((a) => a.address === trimmedAlias);
    if (found) {
      found.lastUsedAt = now;
      found.hits = (found.hits || 0) + 1;
      await saveAliases(aliases, projectKey);
    }
  } else {
    // Default view: latest inbox messages
    listOptions.labelIds = ['INBOX'];
  }

  const listRes = await gmail.users.messages.list(listOptions);
  const messages = listRes.data.messages || [];

  const results = (await Promise.all(
    messages.map(async (msg) => {
      const cacheKey = trimmedAlias
        ? `msg:${projectKey}:${msg.id}:${trimmedAlias}`
        : `msg:${projectKey}:${msg.id}`;
      const cached = cacheGet(cacheKey);
      if (cached) return cached;

      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date', 'To', 'Cc', 'Bcc', 'Delivered-To', 'X-Original-To']
      });

      const headers = msgRes.data.payload.headers || [];
      const getHeader = (name) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const result = {
        id: msg.id,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        date: getHeader('Date'),
        snippet: msgRes.data.snippet || ''
      };

      if (trimmedAlias) {
        const recipientHaystack = [
          getHeader('To'),
          getHeader('Cc'),
          getHeader('Bcc'),
          getHeader('Delivered-To'),
          getHeader('X-Original-To')
        ]
          .join(' ')
          .toLowerCase();

        if (!recipientHaystack.includes(trimmedAlias)) {
          return null;
        }
      }

      cacheSet(cacheKey, result);
      return result;
    })
  ))
    .filter(Boolean);

  await touchLogs(results, trimmedAlias || null, projectKey);
  return { messages: results, projectKey };
}

async function getMessageDetail(id, projectKey = DEFAULT_PROJECT_KEY) {
  if (!id) throw new HttpError(400, 'Missing message id');
  const cached = cacheGet(`detail:${projectKey}:${id}`);
  if (cached) return cached;

  const client = await ensureToken(projectKey);
  const gmail = google.gmail({ version: 'v1', auth: client });
  const msgRes = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full'
  });

  const headers = msgRes.data.payload.headers || [];
  const getHeader = (name) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const { bodyHtml, bodyText } = extractBody(msgRes.data.payload);

  const result = {
    id,
    projectKey,
    subject: getHeader('Subject'),
    from: getHeader('From'),
    date: getHeader('Date'),
    snippet: msgRes.data.snippet,
    bodyHtml,
    bodyText
  };

  cacheSet(`detail:${projectKey}:${id}`, result);
  return result;
}

async function registerAlias(address, projectKey = DEFAULT_PROJECT_KEY) {
  const addr = (address || '').trim().toLowerCase();
  if (!isValidEmail(addr)) throw new HttpError(400, 'Invalid address');
  const domain = addr.split('@')[1];
  if (!(await isAllowedDomain(domain, projectKey))) throw new HttpError(400, 'Domain not allowed');

  const now = new Date().toISOString();
  const aliases = await loadAliases(projectKey);
  const existing = aliases.find((a) => a.address === addr);
  if (existing) {
    existing.lastUsedAt = now;
    existing.hits = (existing.hits || 0) + 1;
  } else {
    aliases.push({ address: addr, createdAt: now, lastUsedAt: now, hits: 1, active: true });
  }
  await saveAliases(aliases, projectKey);
  return { ok: true, projectKey };
}

async function adminStats(projectKey = DEFAULT_PROJECT_KEY) {
  const aliases = await loadAliases(projectKey);
  const domains = await loadDomains(projectKey);
  const total = aliases.length;
  const totalHits = aliases.reduce((sum, a) => sum + (a.hits || 0), 0);
  return {
    projectKey,
    totalAliases: total,
    totalHits,
    lastAliasCreatedAt: aliases[total - 1]?.createdAt || null,
    totalDomains: domains.length,
    storage: {
      mode: shouldUseLegacyStructuredTables(projectKey)
        ? 'supabase-structured'
        : USE_SUPABASE_STORAGE
          ? 'supabase-kv-scoped'
          : 'json-scoped',
      supabaseUrlHost: SUPABASE_URL ? new URL(SUPABASE_URL).host : null,
      instanceId: MODULE_INSTANCE_ID,
      tables: {
        kv: SUPABASE_KV_TABLE,
        aliases: SUPABASE_TABLE_ALIASES,
        domains: SUPABASE_TABLE_DOMAINS,
        logs: SUPABASE_TABLE_LOGS,
        audit: SUPABASE_TABLE_AUDIT
      }
    }
  };
}

async function adminAliases(projectKey = DEFAULT_PROJECT_KEY) {
  return {
    projectKey,
    aliases: await loadAliases(projectKey),
    storage: {
      mode: shouldUseLegacyStructuredTables(projectKey)
        ? 'supabase-structured'
        : USE_SUPABASE_STORAGE
          ? 'supabase-kv-scoped'
          : 'json-scoped',
      supabaseUrlHost: SUPABASE_URL ? new URL(SUPABASE_URL).host : null,
      instanceId: MODULE_INSTANCE_ID,
      tables: {
        aliases: SUPABASE_TABLE_ALIASES
      }
    }
  };
}

async function deleteAlias(address, projectKey = DEFAULT_PROJECT_KEY) {
  const addrParam = decodeURIComponent(address || '').toLowerCase();
  const aliases = await loadAliases(projectKey);
  const filtered = aliases.filter((a) => a.address !== addrParam);
  await saveAliases(filtered, projectKey);
  await auditLog('alias_deleted', { address: addrParam }, projectKey);
  return { removed: aliases.length - filtered.length };
}

async function adminDomains(projectKey = DEFAULT_PROJECT_KEY) {
  return {
    projectKey,
    domains: await loadDomains(projectKey),
    storage: {
      mode: shouldUseLegacyStructuredTables(projectKey)
        ? 'supabase-structured'
        : USE_SUPABASE_STORAGE
          ? 'supabase-kv-scoped'
          : 'json-scoped',
      supabaseUrlHost: SUPABASE_URL ? new URL(SUPABASE_URL).host : null,
      instanceId: MODULE_INSTANCE_ID,
      tables: {
        domains: SUPABASE_TABLE_DOMAINS
      }
    }
  };
}

async function publicDomains(projectKey = DEFAULT_PROJECT_KEY) {
  const domains = (await loadDomains(projectKey)).filter((d) => d.active !== false);
  return { domains, projectKey };
}

async function addDomain(name, projectKey = DEFAULT_PROJECT_KEY) {
  const trimmed = (name || '').trim().toLowerCase();
  const validation = domainSchema.safeParse(trimmed);
  if (!validation.success) throw new HttpError(400, 'Invalid domain name');

  const domains = await loadDomains(projectKey);
  if (domains.find((d) => d.name === trimmed)) throw new HttpError(400, 'Domain already exists');

  const now = new Date().toISOString();
  domains.push({ name: trimmed, active: true, createdAt: now });
  await saveDomains(domains, projectKey);
  await auditLog('domain_added', { domain: trimmed }, projectKey);
  return { ok: true, projectKey };
}

async function updateDomain(name, body, projectKey = DEFAULT_PROJECT_KEY) {
  const nameParam = decodeURIComponent(name || '').toLowerCase();
  const domains = await loadDomains(projectKey);
  const target = domains.find((d) => d.name === nameParam);
  if (!target) throw new HttpError(404, 'Domain not found');
  if (typeof body?.active === 'boolean') target.active = body.active;
  await saveDomains(domains, projectKey);
  return { ok: true, domain: target, projectKey };
}

async function deleteDomain(name, projectKey = DEFAULT_PROJECT_KEY) {
  const nameParam = decodeURIComponent(name || '').toLowerCase();
  const domains = await loadDomains(projectKey);
  const filtered = domains.filter((d) => d.name !== nameParam);
  await saveDomains(filtered, projectKey);
  await auditLog('domain_deleted', { domain: nameParam }, projectKey);
  return { removed: domains.length - filtered.length };
}

async function adminLogs(limit, aliasFilter, projectKey = DEFAULT_PROJECT_KEY) {
  const normalizedLimit = Math.min(parseInt(limit || '50', 10) || 50, 200);
  const filter = (aliasFilter || '').toLowerCase().trim();
  let logs = await loadLogs(projectKey);
  if (filter) logs = logs.filter((l) => (l.alias || '').toLowerCase() === filter);
  logs.sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
  logs = logs.slice(0, normalizedLimit);
  return {
    projectKey,
    logs,
    storage: {
      mode: shouldUseLegacyStructuredTables(projectKey)
        ? 'supabase-structured'
        : USE_SUPABASE_STORAGE
          ? 'supabase-kv-scoped'
          : 'json-scoped',
      supabaseUrlHost: SUPABASE_URL ? new URL(SUPABASE_URL).host : null,
      instanceId: MODULE_INSTANCE_ID,
      tables: {
        logs: SUPABASE_TABLE_LOGS
      }
    }
  };
}

async function clearLogs(projectKey = DEFAULT_PROJECT_KEY) {
  await auditLog('logs_cleared', {}, projectKey);
  await saveLogs([], projectKey);
  return { cleared: true, projectKey };
}

async function debugStorage(projectKey = DEFAULT_PROJECT_KEY) {
  const supabaseUrlHost = SUPABASE_URL ? new URL(SUPABASE_URL).host : null;
  const serviceRoleClaims = (() => {
    try {
      if (!SUPABASE_SERVICE_ROLE_KEY) return null;
      const parts = String(SUPABASE_SERVICE_ROLE_KEY).split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(decodeBase64Url(parts[1]));
      return {
        ref: payload.ref ?? null,
        role: payload.role ?? null,
        iat: payload.iat ?? null,
        exp: payload.exp ?? null
      };
    } catch {
      return null;
    }
  })();

  if (!USE_SUPABASE_STORAGE) {
    return {
      ok: true,
      instanceId: MODULE_INSTANCE_ID,
      projectKey,
      useSupabaseStorage: false,
      supabaseUrlHost,
      serviceRoleClaims,
      tables: {
        kv: SUPABASE_KV_TABLE,
        aliases: SUPABASE_TABLE_ALIASES,
        domains: SUPABASE_TABLE_DOMAINS,
        logs: SUPABASE_TABLE_LOGS,
        audit: SUPABASE_TABLE_AUDIT
      },
      computed: {
        loadAliasesCount: (await loadAliases(projectKey)).length,
        loadDomainsCount: (await loadDomains(projectKey)).length
      }
    };
  }

  const client = getSupabaseAdmin();
  const result = {
    ok: true,
    instanceId: MODULE_INSTANCE_ID,
    projectKey,
    useSupabaseStorage: true,
    supabaseUrlHost,
    serviceRoleClaims,
    supabaseClient: {
      restUrl: client?.rest?.url ?? null
    },
    tables: {
      kv: SUPABASE_KV_TABLE,
      aliases: SUPABASE_TABLE_ALIASES,
      domains: SUPABASE_TABLE_DOMAINS,
      logs: SUPABASE_TABLE_LOGS,
      audit: SUPABASE_TABLE_AUDIT
    },
    checks: {
      kv: { ok: false },
      aliases: { ok: false },
      domains: { ok: false }
    },
    computed: {
      loadAliasesCount: null,
      loadAliasesSample: [],
      loadDomainsCount: null,
      loadDomainsSample: [],
      supabaseSelectAll: {
        aliasesLen: null,
        aliasesFirst: null,
        domainsLen: null,
        domainsFirst: null
      }
    }
  };

  {
    const aliases = await loadAliases(projectKey);
    result.computed.loadAliasesCount = aliases.length;
    result.computed.loadAliasesSample = aliases.slice(0, 3);
  }

  {
    const domains = await loadDomains(projectKey);
    result.computed.loadDomainsCount = domains.length;
    result.computed.loadDomainsSample = domains.slice(0, 3);
  }

  {
    const rawAliases = await supabaseSelectAll(SUPABASE_TABLE_ALIASES, 'created_at');
    result.computed.supabaseSelectAll.aliasesLen = rawAliases ? rawAliases.length : null;
    result.computed.supabaseSelectAll.aliasesFirst = rawAliases?.[0] ?? null;
  }

  {
    const rawDomains = await supabaseSelectAll(SUPABASE_TABLE_DOMAINS, 'created_at');
    result.computed.supabaseSelectAll.domainsLen = rawDomains ? rawDomains.length : null;
    result.computed.supabaseSelectAll.domainsFirst = rawDomains?.[0] ?? null;
  }

  {
    const { error } = await client.from(SUPABASE_KV_TABLE).select('key').limit(1);
    result.checks.kv.ok = !error;
    result.checks.kv.error = error?.message || null;
  }

  {
    const { data, error } = await client
      .from(SUPABASE_TABLE_ALIASES)
      .select('address,active,created_at,last_used_at,hits')
      .order('created_at', { ascending: false })
      .limit(10);
    result.checks.aliases.ok = !error;
    result.checks.aliases.error = error?.message || null;
    result.checks.aliases.sample = (data || []).map((r) => ({
      address: r.address,
      active: typeof r.active === 'boolean' ? r.active : null,
      created_at: r.created_at ?? null,
      last_used_at: r.last_used_at ?? null,
      hits: typeof r.hits === 'number' ? r.hits : null
    }));

    const { count, error: countError } = await client
      .from(SUPABASE_TABLE_ALIASES)
      .select('*', { count: 'exact', head: true });
    result.checks.aliases.count = count ?? null;
    result.checks.aliases.countError = countError?.message || null;
  }

  {
    const { data, error } = await client.from(SUPABASE_TABLE_DOMAINS).select('*').limit(10);
    result.checks.domains.ok = !error;
    result.checks.domains.error = error?.message || null;
    result.checks.domains.sample = (data || []).map((r) => ({
      name: r.name,
      active: typeof r.active === 'boolean' ? r.active : null,
      created_at: r.created_at ?? null
    }));

    const { count, error: countError } = await client
      .from(SUPABASE_TABLE_DOMAINS)
      .select('*', { count: 'exact', head: true });
    result.checks.domains.count = count ?? null;
    result.checks.domains.countError = countError?.message || null;
  }

  return result;
}

async function syncSiteDomainsToProject(projectKey, domains) {
  const normalizedDomains = (domains || [])
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => domainSchema.safeParse(v).success);
  if (!normalizedDomains.length) return;

  const existing = await loadDomains(projectKey);
  const set = new Map(existing.map((item) => [item.name, item]));
  const now = new Date().toISOString();

  normalizedDomains.forEach((name) => {
    if (!set.has(name)) {
      set.set(name, { name, active: true, createdAt: now });
    }
  });

  await saveDomains(Array.from(set.values()), projectKey);
}

function redactSiteSecrets(site) {
  return {
    ...site,
    googleClientSecretMasked: site.googleClientSecret ? '********' : ''
  };
}

async function superAdminListSites() {
  const projects = await listProjectsWithStatus();
  return {
    ...projects,
    projects: projects.projects.map(redactSiteSecrets)
  };
}

async function superAdminActivity(limit = 100) {
  const merged = await getMergedProjectMap();
  const items = [];

  for (const projectKey of merged.keys()) {
    const audits = await loadAudit(projectKey);
    audits.forEach((entry) => {
      items.push({
        ...entry,
        projectKey: entry.projectKey || projectKey
      });
    });
  }

  items.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  return {
    activities: items.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)))
  };
}

async function superAdminUpsertSite(input) {
  const normalized = normalizeProjectInput(input);
  if (!normalized) throw new HttpError(400, 'Invalid project key');

  const list = await loadSuperAdminProjects();
  const idx = list.findIndex((item) => item.key === normalized.key);

  const existing = idx >= 0 ? list[idx] : null;
  const next = {
    ...existing,
    ...normalized,
    // Keep old secret if incoming payload omits it.
    googleClientSecret:
      normalized.googleClientSecret || existing?.googleClientSecret || '',
    updatedAt: new Date().toISOString()
  };

  if (idx >= 0) list[idx] = next;
  else list.push({ ...next, createdAt: next.updatedAt });

  await saveSuperAdminProjects(list);
  await syncSiteDomainsToProject(next.key, next.domains || []);
  await auditLog('super_admin_site_upsert', { siteKey: next.key }, next.key);

  return {
    ok: true,
    site: redactSiteSecrets(next)
  };
}

async function superAdminDeleteSite(projectKeyInput) {
  const projectKey = normalizeProjectKey(projectKeyInput);
  if (!projectKey) throw new HttpError(400, 'Invalid project key');
  if (projectKey === DEFAULT_PROJECT_KEY) {
    throw new HttpError(400, 'Default project cannot be deleted');
  }

  const list = await loadSuperAdminProjects();
  const filtered = list.filter((item) => item.key !== projectKey);
  await saveSuperAdminProjects(filtered);
  await auditLog('super_admin_site_deleted', { siteKey: projectKey }, DEFAULT_PROJECT_KEY);

  return {
    ok: true,
    removed: list.length - filtered.length
  };
}

async function cloudflareRequest(pathname, init = {}) {
  if (!CLOUDFLARE_API_TOKEN) {
    throw new HttpError(400, 'CLOUDFLARE_API_TOKEN is not configured');
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    },
    cache: 'no-store'
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    const msg = payload?.errors?.[0]?.message || `Cloudflare request failed: ${res.status}`;
    throw new HttpError(400, msg);
  }
  return payload.result;
}

async function ensureCloudflareZone(domain) {
  const encodedDomain = encodeURIComponent(domain);
  const existing = await cloudflareRequest(`/zones?name=${encodedDomain}&status=active`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0];

  if (!CLOUDFLARE_ACCOUNT_ID) {
    throw new HttpError(400, 'Zone not found and CLOUDFLARE_ACCOUNT_ID is not configured');
  }

  return cloudflareRequest('/zones', {
    method: 'POST',
    body: JSON.stringify({
      account: { id: CLOUDFLARE_ACCOUNT_ID },
      name: domain,
      type: 'full'
    })
  });
}

async function createDnsRecordIfMissing(zoneId, type, name, content, priority = null) {
  const existing = await cloudflareRequest(
    `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`
  );

  const hasRecord = Array.isArray(existing)
    && existing.some((record) => record.content === content && (priority == null || record.priority === priority));
  if (hasRecord) return { created: false };

  const body = {
    type,
    name,
    content,
    ttl: 1
  };
  if (priority != null) body.priority = priority;

  await cloudflareRequest(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(body)
  });

  return { created: true };
}

async function superAdminProvisionCloudflareDomain(projectKeyInput, domainInput) {
  const projectKey = normalizeProjectKey(projectKeyInput);
  if (!projectKey) throw new HttpError(400, 'Invalid project key');

  const domain = String(domainInput || '').trim().toLowerCase();
  if (!domainSchema.safeParse(domain).success) {
    throw new HttpError(400, 'Invalid domain');
  }

  const zone = await ensureCloudflareZone(domain);
  const zoneId = zone.id;

  const results = [];
  results.push(await createDnsRecordIfMissing(zoneId, 'MX', domain, 'route1.mx.cloudflare.net', 49));
  results.push(await createDnsRecordIfMissing(zoneId, 'MX', domain, 'route2.mx.cloudflare.net', 50));
  results.push(await createDnsRecordIfMissing(zoneId, 'MX', domain, 'route3.mx.cloudflare.net', 50));
  results.push(
    await createDnsRecordIfMissing(
      zoneId,
      'TXT',
      domain,
      'v=spf1 include:_spf.mx.cloudflare.net ~all'
    )
  );

  await syncSiteDomainsToProject(projectKey, [domain]);
  await auditLog('super_admin_cloudflare_provisioned', { siteKey: projectKey, domain }, projectKey);

  return {
    ok: true,
    projectKey,
    domain,
    zoneId,
    nameservers: zone.name_servers || [],
    createdRecords: results.filter((item) => item.created).length,
    message:
      'DNS records applied. Ensure Cloudflare Email Routing and route *@domain are enabled in dashboard.'
  };
}

function stringifyEnvValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (/\s|#|"/.test(text)) {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return text;
}

async function superAdminExportTenantEnv(projectKeyInput, options = {}) {
  const projectKey = normalizeProjectKey(projectKeyInput);
  if (!projectKey) throw new HttpError(400, 'Invalid project key');

  const merged = await getMergedProjectMap();
  const site = merged.get(projectKey);
  if (!site) throw new HttpError(404, 'Site not found');

  const customDomain = String(options?.customDomain || '').trim().toLowerCase();
  const primaryDomain = customDomain || site.domains?.[0] || '';
  const redirectUri = site.googleRedirectUri || globalGoogleConfig.googleRedirectUri || '';
  const allowedOrigins = primaryDomain
    ? `https://${primaryDomain},http://localhost:3000,http://localhost:5173`
    : (env.ALLOWED_ORIGINS || 'http://localhost:3000');

  const lines = [
    `# Tenant template for ${projectKey}`,
    `TENANT_KEY=${projectKey}`,
    `PORT=${process.env.PORT || 3000}`,
    '',
    '# Core multi-project settings',
    `DEFAULT_PROJECT_KEY=${projectKey}`,
    `PROJECTS_JSON=${stringifyEnvValue(JSON.stringify([
      {
        key: site.key,
        label: site.label,
        google: {
          clientId: site.googleClientId || '',
          clientSecret: site.googleClientSecret || '',
          redirectUri
        },
        adminEmails: site.adminEmails || []
      }
    ]))}`,
    '',
    '# Auth and admin',
    `ADMIN_EMAILS=${stringifyEnvValue((site.adminEmails || []).join(','))}`,
    `SUPER_ADMIN_EMAILS=${stringifyEnvValue(env.SUPER_ADMIN_EMAILS || '')}`,
    'ADMIN_API_KEY=',
    'SUPER_ADMIN_API_KEY=',
    '',
    '# Tenant Google OAuth',
    `GOOGLE_CLIENT_ID=${stringifyEnvValue(site.googleClientId || '')}`,
    `GOOGLE_CLIENT_SECRET=${stringifyEnvValue(site.googleClientSecret || '')}`,
    `GOOGLE_REDIRECT_URI=${stringifyEnvValue(redirectUri)}`,
    '',
    '# Network and limits',
    `ALLOWED_ORIGINS=${stringifyEnvValue(allowedOrigins)}`,
    `MAX_MESSAGES=${stringifyEnvValue(env.MAX_MESSAGES || '20')}`,
    '',
    '# Security',
    `TOKEN_ENCRYPTION_KEY=${stringifyEnvValue(env.TOKEN_ENCRYPTION_KEY || '')}`,
    'TOKEN_PATH=',
    '',
    '# Supabase (shared or dedicated per tenant)',
    `NEXT_PUBLIC_SUPABASE_URL=${stringifyEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || '')}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${stringifyEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')}`,
    `SUPABASE_URL=${stringifyEnvValue(env.SUPABASE_URL || '')}`,
    `SUPABASE_SERVICE_ROLE_KEY=${stringifyEnvValue(env.SUPABASE_SERVICE_ROLE_KEY || '')}`,
    `SUPABASE_KV_TABLE=${stringifyEnvValue(env.SUPABASE_KV_TABLE || 'app_kv')}`,
    `SUPABASE_TABLE_ALIASES=${stringifyEnvValue(env.SUPABASE_TABLE_ALIASES || 'app_aliases')}`,
    `SUPABASE_TABLE_DOMAINS=${stringifyEnvValue(env.SUPABASE_TABLE_DOMAINS || 'app_domains')}`,
    `SUPABASE_TABLE_LOGS=${stringifyEnvValue(env.SUPABASE_TABLE_LOGS || 'app_logs')}`,
    `SUPABASE_TABLE_AUDIT=${stringifyEnvValue(env.SUPABASE_TABLE_AUDIT || 'app_audit')}`,
    '',
    '# Optional Cloudflare integration',
    `CLOUDFLARE_API_TOKEN=${stringifyEnvValue(env.CLOUDFLARE_API_TOKEN || '')}`,
    `CLOUDFLARE_ACCOUNT_ID=${stringifyEnvValue(env.CLOUDFLARE_ACCOUNT_ID || '')}`
  ];

  const extraEnv = site.envValues && typeof site.envValues === 'object'
    ? Object.entries(site.envValues)
    : [];

  if (extraEnv.length > 0) {
    lines.push('', '# Tenant custom env values');
    extraEnv.forEach(([key, value]) => {
      lines.push(`${String(key)}=${stringifyEnvValue(value)}`);
    });
  }

  return {
    ok: true,
    projectKey,
    suggestedFileName: `.env.${projectKey}`,
    customDomain: primaryDomain || null,
    envContent: lines.join('\n') + '\n'
  };
}

export {
  HttpError,
  env,
  listProjects,
  listProjectsWithStatus,
  resolveProjectFromRequest,
  health,
  tokenHealth,
  generateAuthUrl,
  exchangeCode,
  revokeToken,
  listMessages,
  getMessageDetail,
  registerAlias,
  adminStats,
  adminAliases,
  deleteAlias,
  adminDomains,
  publicDomains,
  addDomain,
  updateDomain,
  deleteDomain,
  adminLogs,
  clearLogs,
  debugStorage,
  requireAdmin,
  requireSuperAdmin,
  superAdminListSites,
  superAdminActivity,
  superAdminUpsertSite,
  superAdminDeleteSite,
  superAdminProvisionCloudflareDomain,
  superAdminExportTenantEnv
};
