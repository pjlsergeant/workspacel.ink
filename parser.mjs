// workspacel.ink parser: the single source of truth for what links are
// understood. Pure functions, no DOM, no percent-decoding anywhere.
//
// Anything not strictly understood is rejected (null) or, for unknown query
// parameters, dropped.

export const SETTINGS_KEY = 'workspacel.ink:settings';
const SETTINGS_VERSION = 1;
export const DEFAULT_DELAY = 2;
const MAX_DELAY = 10;
const CANONICAL_ORIGIN = 'https://workspacel.ink';

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const RE_ORG = new RegExp(`^${LABEL}(?:\\.enterprise)?$`);
const RE_WORKSPACE_HOST = new RegExp(`^${LABEL}(?:\\.enterprise)?\\.slack\\.com$`);
const APP_HOST = 'app.slack.com';
// Slack service hostnames that are never a workspace.
const RESERVED_LABELS = new Set(['app', 'www', 'api', 'files', 'slack', 'status']);

const RE_CHANNEL = /^[CGD][A-Z0-9]{8,12}$/;
const RE_USER = /^[UW][A-Z0-9]{8,12}$/;
const RE_FILE = /^F[A-Z0-9]{8,12}$/;
const RE_TEAM = /^[TE][A-Z0-9]{8,12}$/;
const RE_MESSAGE = /^p[0-9]{16}$/;
const RE_THREAD = /^([CGD][A-Z0-9]{8,12})-([0-9]{10})\.([0-9]{6})$/;
// Discarded filename: any printable non-space ASCII except '/'. No length
// cap: browsers percent-encode non-ASCII, so a short name can be long here.
const RE_FILENAME = /^[\x21-\x2e\x30-\x7e]+$/;
const RE_THREAD_TS = /^[0-9]{10}\.[0-9]{6}$/;
const RE_ASCII = /^[\x00-\x7f]*$/;
const RE_CONTROL = /[\x00-\x1f\x7f]/;

// The canonical thread query; `channel` is omitted when undefined.
function threadQuery(ts, channel) {
  return channel === undefined ? `?thread_ts=${ts}` : `?thread_ts=${ts}&cid=${channel}`;
}

// Match the Slack path segments (after any /r/ or host prefix) against the
// allowlisted shapes. Returns { path, client, queryChannel?, fixedQuery? } or
// null. queryChannel is set only on archives/CH/p<16>, the one shape that
// accepts thread_ts / cid; fixedQuery is the client thread shape's own query.
function matchShape(segs) {
  const n = segs.length;
  switch (segs[0]) {
    case 'archives':
      if (n === 2 && RE_CHANNEL.test(segs[1])) {
        return { path: `/archives/${segs[1]}`, client: false };
      }
      if (n === 3 && RE_CHANNEL.test(segs[1]) && RE_MESSAGE.test(segs[2])) {
        return { path: `/archives/${segs[1]}/${segs[2]}`, client: false, queryChannel: segs[1] };
      }
      return null;
    case 'team':
      if (n === 2 && RE_USER.test(segs[1])) {
        return { path: `/team/${segs[1]}`, client: false };
      }
      return null;
    case 'files':
      if ((n === 3 || n === 4) && RE_USER.test(segs[1]) && RE_FILE.test(segs[2])) {
        if (n === 4) {
          const name = segs[3];
          if (!RE_FILENAME.test(name) || name === '.' || name === '..') return null;
        }
        // The filename segment is always discarded.
        return { path: `/files/${segs[1]}/${segs[2]}`, client: false };
      }
      return null;
    case 'docs':
      if (n === 3 && RE_TEAM.test(segs[1]) && RE_FILE.test(segs[2])) {
        return { path: `/docs/${segs[1]}/${segs[2]}`, client: false };
      }
      return null;
    case 'client':
      if (n === 3 && RE_TEAM.test(segs[1]) && RE_CHANNEL.test(segs[2])) {
        return { path: `/archives/${segs[2]}`, client: true };
      }
      if (n === 5 && RE_TEAM.test(segs[1]) && RE_CHANNEL.test(segs[2]) && segs[3] === 'thread') {
        const m = RE_THREAD.exec(segs[4]);
        if (!m || m[1] !== segs[2]) return null;
        return {
          path: `/archives/${segs[2]}/p${m[2]}${m[3]}`,
          client: true,
          fixedQuery: threadQuery(`${m[2]}.${m[3]}`, segs[2]),
        };
      }
      return null;
    default:
      return null;
  }
}

// Query contract. Returns the canonical query string ('' or '?thread_ts=...'
// or '?thread_ts=...&cid=...'), or null to reject the whole link.
function parseQuery(search, queryChannel) {
  let s = search;
  if (s.startsWith('?')) s = s.slice(1);
  if (s === '') return '';

  let threadTs;
  let cid;
  for (const piece of s.split('&')) {
    const eq = piece.indexOf('=');
    const name = eq < 0 ? piece : piece.slice(0, eq);
    const value = eq < 0 ? null : piece.slice(eq + 1);
    if (name === 'thread_ts') {
      if (threadTs !== undefined) return null;
      threadTs = value;
    } else if (name === 'cid') {
      if (cid !== undefined) return null;
      cid = value;
    }
    // Any other name is dropped.
  }

  if (threadTs === undefined && cid === undefined) return '';
  // thread_ts / cid are only accepted on the archives/CH/p<16> shape.
  if (queryChannel === undefined) return null;

  // The patterns exclude '%', so nothing encoded can get through.
  if (threadTs !== undefined) {
    if (typeof threadTs !== 'string' || !RE_THREAD_TS.test(threadTs)) return null;
  }
  if (cid !== undefined) {
    if (typeof cid !== 'string' || !RE_CHANNEL.test(cid)) return null;
    if (cid !== queryChannel) return null;
  }

  if (threadTs === undefined) return ''; // cid without thread_ts is dropped
  return threadQuery(threadTs, cid);
}

/**
 * Parse a request. Inputs are exactly location.pathname and location.search.
 * @returns {{ path: string, query: string } | null}
 */
export function parse(pathname, search) {
  if (typeof pathname !== 'string' || typeof search !== 'string') return null;
  if (!pathname.startsWith('/')) return null;

  const segs = pathname.slice(1).split('/');
  let host = null;
  let rest;
  if (segs[0] === 'r') {
    rest = segs.slice(1);
  } else if (segs[0] === 'https:') {
    if (segs.length < 3 || segs[1] !== '') return null;
    host = segs[2];
    rest = segs.slice(3);
  } else {
    host = segs[0];
    rest = segs.slice(1);
  }

  let hostKind = 'any';
  if (host !== null) {
    if (host === APP_HOST) hostKind = 'app';
    else if (RE_WORKSPACE_HOST.test(host)) hostKind = 'workspace';
    else return null;
  }

  const shape = matchShape(rest);
  if (!shape) return null;
  if (hostKind === 'app' && !shape.client) return null;
  if (hostKind === 'workspace' && shape.client) return null;

  // Incoming thread_ts / cid on client/ shapes is rejected by parseQuery;
  // the client thread shape then supplies its own canonical query.
  const query = parseQuery(search, shape.queryChannel);
  if (query === null) return null;
  return { path: shape.path, query: shape.fixedQuery ?? query };
}

// True iff `parsed` is exactly something parse() could have produced as
// output (an output-shape path plus a canonical query).
function isCanonicalParsed(parsed) {
  if (parsed === null || typeof parsed !== 'object') return false;
  const { path, query } = parsed;
  if (typeof path !== 'string' || typeof query !== 'string') return false;
  const again = parse(`/r${path}`, query);
  return again !== null && again.path === path && again.query === query;
}

/**
 * Validate what the visitor typed into the settings box.
 * @returns {{ org: string | null, error: null | 'invalid' | 'reserved' }}
 *   org is `acme` or `acme.enterprise` when error is null.
 */
export function validateOrg(input) {
  const invalid = { org: null, error: 'invalid' };
  if (typeof input !== 'string') return invalid;
  let s = input.trim();
  const sep = s.indexOf('://');

  if (sep >= 0) {
    // URL input: only the authority must be ASCII; path/query/fragment are
    // ignored and may contain anything.
    const rest = s.slice(sep + 3);
    const end = rest.search(/[/?#]/);
    const authority = end < 0 ? rest : rest.slice(0, end);
    if (!RE_ASCII.test(authority)) return invalid;
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') {
        return invalid;
      }
      if (!RE_WORKSPACE_HOST.test(u.hostname)) return invalid;
      // Fail closed: the authority must be literally the host as typed (no
      // userinfo, port, percent-encoding, backslash or other normalisation).
      if (authority.toLowerCase() !== u.hostname) return invalid;
      s = u.hostname;
    } catch {
      return invalid;
    }
  } else {
    if (!RE_ASCII.test(s)) return invalid;
    s = s.toLowerCase();
  }

  if (s.endsWith('.slack.com')) s = s.slice(0, -'.slack.com'.length);
  if (!RE_ORG.test(s)) return invalid;
  if (RESERVED_LABELS.has(s.split('.')[0])) return { org: null, error: 'reserved' };

  // The org must be usable as a hostname exactly as written (rejects e.g.
  // invalid punycode such as xn--x, which the URL parser refuses).
  try {
    const u = new URL('https://x.invalid/');
    u.hostname = `${s}.slack.com`;
    if (u.hostname !== `${s}.slack.com`) return invalid;
  } catch {
    return invalid;
  }
  return { org: s, error: null };
}

/**
 * Normalise what the visitor typed into the settings box to an org
 * (`acme` or `acme.enterprise`), or null.
 */
export function normaliseOrg(input) {
  return validateOrg(input).org;
}

// True iff `org` is already in stored form (what normaliseOrg returns).
function isStoredOrg(org) {
  return typeof org === 'string' && normaliseOrg(org) === org;
}

/**
 * Build the redirect target on the visitor's workspace, or null.
 */
export function buildDestination(parsed, org) {
  if (!isStoredOrg(org)) return null;
  if (!isCanonicalParsed(parsed)) return null;
  const host = `${org}.slack.com`;
  let u;
  try {
    u = new URL('https://x.invalid/');
    u.hostname = host;
    u.pathname = parsed.path;
    u.search = parsed.query;
  } catch {
    return null;
  }
  if (
    u.protocol !== 'https:' ||
    u.hostname !== host ||
    u.username !== '' ||
    u.password !== '' ||
    u.port !== '' ||
    u.hash !== '' ||
    u.pathname !== parsed.path ||
    u.search !== parsed.query
  ) {
    return null;
  }
  return u.href;
}

/**
 * The converter's canonical link: https://workspacel.ink/r/<path><query>.
 * Built from parsed fields only. Returns null if `parsed` is not a valid
 * parse() result (fail closed).
 */
export function canonicalLink(parsed) {
  if (!isCanonicalParsed(parsed)) return null;
  return `${CANONICAL_ORIGIN}/r${parsed.path}${parsed.query}`;
}

/**
 * Converter: treat pasted text exactly as if the visitor had put
 * workspacel.ink/ in front of it, then parse the resulting pathname/search.
 * Returns the canonical link or null.
 */
export function convertPasted(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (s === '' || RE_CONTROL.test(s)) return null;
  let u;
  try {
    u = new URL(`${CANONICAL_ORIGIN}/${s}`);
  } catch {
    return null;
  }
  if (u.origin !== CANONICAL_ORIGIN) return null;
  const parsed = parse(u.pathname, u.search);
  return parsed ? canonicalLink(parsed) : null;
}

/**
 * Validate a raw settings blob (the string stored in localStorage).
 * @returns {{ org: string, delay: number } | null} null means "not set".
 */
export function readSettings(raw) {
  if (typeof raw !== 'string') return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 3 || keys[0] !== 'delay' || keys[1] !== 'org' || keys[2] !== 'v') return null;
  if (obj.v !== SETTINGS_VERSION) return null;
  if (!isStoredOrg(obj.org)) return null;
  if (!isValidDelay(obj.delay)) return null;
  return { org: obj.org, delay: obj.delay };
}

/** Serialise settings for storage, or null if invalid. */
export function serialiseSettings(org, delay) {
  if (!isStoredOrg(org) || !isValidDelay(delay)) return null;
  return JSON.stringify({ v: SETTINGS_VERSION, org, delay });
}

/** Parse the delay box value: integer 0-10, or null. */
export function normaliseDelay(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!/^[0-9]{1,2}$/.test(s)) return null;
  const n = Number(s);
  return isValidDelay(n) ? n : null;
}

function isValidDelay(d) {
  return Number.isInteger(d) && d >= 0 && d <= MAX_DELAY;
}
