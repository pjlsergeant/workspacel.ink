import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, buildDestination, canonicalLink, convertPasted } from '../parser.mjs';

const CH = 'C0CDA94QTQQ';
const GRP = 'G0123ABCDE';
const DM = 'D0123ABCDEF';
const USER = 'U0123ABCD';
const WUSER = 'W0123ABCDEFGH';
const FILE = 'F0123ABCDE';
const TEAM = 'T0123ABCD';
const ENT = 'E0123ABCD';
const MSG = 'p1793097077519469';
const TS = '1793097077.519469';
const ORG = 'mine';

// Browser-equivalent: what location.pathname / location.search would be.
function viaUrl(input) {
  assert.ok(input.startsWith('/'), `case must start with /: ${JSON.stringify(input)}`);
  const u = new URL(`https://workspacel.ink${input}`);
  assert.equal(u.host, 'workspacel.ink', `host changed for ${JSON.stringify(input)}`);
  return parse(u.pathname, u.search);
}

function splitRaw(input) {
  const q = input.indexOf('?');
  return q < 0 ? [input, ''] : [input.slice(0, q), input.slice(q)];
}

function viaRaw(input) {
  const [p, s] = splitRaw(input);
  return parse(p, s);
}

function dest(parsed, org = ORG) {
  return parsed === null ? null : buildDestination(parsed, org);
}

// [slack path + query, expected output path + query, kind]
// kind: 'perma' needs a workspace host; 'client' needs app.slack.com.
const SHAPES = [
  [`archives/${CH}`, `/archives/${CH}`, 'perma'],
  [`archives/${GRP}`, `/archives/${GRP}`, 'perma'],
  [`archives/${DM}`, `/archives/${DM}`, 'perma'],
  [`archives/${CH}/${MSG}`, `/archives/${CH}/${MSG}`, 'perma'],
  [`archives/${CH}/${MSG}?thread_ts=${TS}`, `/archives/${CH}/${MSG}?thread_ts=${TS}`, 'perma'],
  [
    `archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
    `/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
    'perma',
  ],
  [
    `archives/${CH}/${MSG}?cid=${CH}&utm=x&thread_ts=${TS}`,
    `/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
    'perma',
  ],
  [`archives/${CH}/${MSG}?cid=${CH}`, `/archives/${CH}/${MSG}`, 'perma'],
  [`archives/${CH}/${MSG}?foo=bar`, `/archives/${CH}/${MSG}`, 'perma'],
  [`team/${USER}`, `/team/${USER}`, 'perma'],
  [`team/${WUSER}`, `/team/${WUSER}`, 'perma'],
  [`files/${USER}/${FILE}`, `/files/${USER}/${FILE}`, 'perma'],
  [`files/${WUSER}/${FILE}/report.pdf`, `/files/${WUSER}/${FILE}`, 'perma'],
  [`files/${USER}/${FILE}/my%20file~v2_final-1.png`, `/files/${USER}/${FILE}`, 'perma'],
  [`files/${USER}/${FILE}/image%20(1).png`, `/files/${USER}/${FILE}`, 'perma'],
  [`files/${USER}/${FILE}/Q3%20Report%20(final).pdf`, `/files/${USER}/${FILE}`, 'perma'],
  [`files/${USER}/${FILE}/John's%20notes.txt`, `/files/${USER}/${FILE}`, 'perma'],
  [`files/${USER}/${FILE}/budget,%20v2.xlsx`, `/files/${USER}/${FILE}`, 'perma'],
  [`docs/${TEAM}/${FILE}`, `/docs/${TEAM}/${FILE}`, 'perma'],
  [`docs/${ENT}/${FILE}`, `/docs/${ENT}/${FILE}`, 'perma'],
  [`client/${TEAM}/${CH}`, `/archives/${CH}`, 'client'],
  [`client/${ENT}/${GRP}`, `/archives/${GRP}`, 'client'],
  [`client/${TEAM}/${CH}/thread/${CH}-${TS}`, `/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`, 'client'],
  [`client/${TEAM}/${CH}/thread/${CH}-${TS}?foo=bar`, `/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`, 'client'],
  [`client/${ENT}/${DM}/thread/${DM}-1700000000.000001`,
    `/archives/${DM}/p1700000000000001?thread_ts=1700000000.000001&cid=${DM}`, 'client'],
];

const WS_HOSTS = ['acme.slack.com', 'acme-corp.enterprise.slack.com', 'a.slack.com'];

function forms(slackPath, kind) {
  const hosts = kind === 'client' ? ['app.slack.com'] : WS_HOSTS;
  const out = [`/r/${slackPath}`];
  for (const h of hosts) out.push(`/https://${h}/${slackPath}`, `/${h}/${slackPath}`);
  return out;
}

test('every allowlisted shape x every input form', () => {
  for (const [slackPath, expected, kind] of SHAPES) {
    for (const input of forms(slackPath, kind)) {
      for (const [mode, fn] of [['url', viaUrl], ['raw', viaRaw]]) {
        const parsed = fn(input);
        assert.ok(parsed, `${mode} ${input} should parse`);
        const href = dest(parsed);
        const u = new URL(href);
        assert.equal(u.host, `${ORG}.slack.com`, `${mode} ${input}`);
        assert.equal(u.pathname + u.search, expected, `${mode} ${input}`);
        assert.equal(href, `https://${ORG}.slack.com${expected}`, `${mode} ${input}`);
      }
    }
  }
});

test('enterprise org destination host', () => {
  const parsed = parse(`/r/archives/${CH}`, '');
  assert.equal(buildDestination(parsed, 'big.enterprise'), `https://big.enterprise.slack.com/archives/${CH}`);
});

test('app.slack.com only with client shapes; workspace hosts only with non-client shapes', () => {
  for (const [slackPath, , kind] of SHAPES) {
    const wrongHosts = kind === 'client' ? WS_HOSTS : ['app.slack.com'];
    for (const h of wrongHosts) {
      for (const input of [`/https://${h}/${slackPath}`, `/${h}/${slackPath}`]) {
        assert.equal(viaUrl(input), null, input);
        assert.equal(viaRaw(input), null, input);
      }
    }
  }
});

test('the parser receives /https://host/... as pathname intact', () => {
  const u = new URL(`https://workspacel.ink/https://acme.slack.com/archives/${CH}/${MSG}?thread_ts=${TS}#frag`);
  assert.equal(u.pathname, `/https://acme.slack.com/archives/${CH}/${MSG}`);
  assert.equal(u.search, `?thread_ts=${TS}`);
});

// Hostile corpus. Each case: input, expected destination via URL, expected
// via raw. `null` = rejected. Default for both is null.
const P = `archives/${CH}/${MSG}`;
const OK = `https://${ORG}.slack.com/${P}`;
const HOSTILE = [
  // Literal (undecoded) '%2e%2e' is a permitted filename and is discarded.
  ['/r/files/U12345678/F12345678/%2e%2e', null, `https://${ORG}.slack.com/files/U12345678/F12345678`],
  // The browser resolves %2e%2e, leaving a valid /https:// form on the org host.
  ['/r/%2e%2e/https://acme.slack.com/archives/' + CH, `https://${ORG}.slack.com/archives/${CH}`, null],
  ['/https://acme.slack.com@evil.com/archives/' + CH],
  ['//evil.com'],
  ['//evil.com/archives/' + CH],
  ['/r//evil.com'],
  ['/r//evil.com/' + P],
  ['/\\evil.com'],
  ['/\\evil.com/' + P],
  ['/r/\\evil.com/' + P],
  ['/r/%2F%2Fevil.com'],
  ['/%2F%2Fevil.com/' + P],
  ['/r/archives%2F' + CH],
  ['/r/archives/' + CH + '%2F' + MSG],
  ['/r/%252F%252Fevil.com'],
  ['/r/archives/' + CH + '/%252e%252e'],
  ['/r/%2e%2e/' + P],
  ['/r/archives/' + CH + '/%2e%2e/' + MSG],
  ['/r/archives/%2e%2e/' + CH],
  ['/r/../' + P], // becomes /archives/... (no host) in the browser
  ['/r/./' + P, `https://${ORG}.slack.com/${P}`, null],
  ['/r/archives/' + CH + '/..'],
  ['/r/archives/' + CH + '/.'],
  ['/r/archives/./' + CH, `https://${ORG}.slack.com/archives/${CH}`, null],
  ['/r/@evil.com/' + P],
  ['/r/archives/' + CH + '@evil.com'],
  ['/r/javascript:alert(1)'],
  ['/javascript:alert(1)'],
  ['/javascript://acme.slack.com/' + P],
  ['/r/data:text/html,<script>alert(1)</script>'],
  ['/data:text/html;base64,PHNjcmlwdD4='],
  ['/http://acme.slack.com/' + P],
  ['/http:/acme.slack.com/' + P],
  ['/https:/acme.slack.com/' + P],
  ['/https:///acme.slack.com/' + P],
  ['/HTTPS://acme.slack.com/' + P],
  ['/ftp://acme.slack.com/' + P],
  ['/slack://acme.slack.com/' + P],
  ['/r/' + P + '%0d%0aLocation:%20https://evil.com'],
  ['/r/' + P + '%0A'],
  ['/r/' + P + '%00'],
  ['/r/archives/' + CH + '%0d%0a/' + MSG],
  ['/r/' + P + '?thread_ts=' + TS + '%0d%0a'],
  ['/r/' + P + '?thread_ts=' + TS + '%00'],
  ['/r/' + P + '?thread_ts=1793097077%2E519469'],
  ['/r/' + P + '?cid=' + CH + '%00&thread_ts=' + TS],
  ['/r/ａrchives/' + CH],
  ['/r/archives/Ｃ0CDA94QTQQ'],
  ['/r/archives/C0CDA94QTQＱ'],
  ['/r/archives/С0CDA94QTQQ'], // Cyrillic Es
  ['/r/archives/C0CDA94QTQQ/р1793097077519469'], // Cyrillic er
  ['/acme.slack.com.evil.com/' + P],
  ['/https://acme.slack.com.evil.com/' + P],
  ['/slack.com.evil.com/' + P],
  ['/slack.com/' + P],
  ['/https://slack.com/' + P],
  ['/evil.com/.slack.com/' + P],
  ['/https://evil.com/.slack.com/' + P],
  ['/evil.com/' + P],
  ['/acme.slack.com@evil.com/' + P],
  ['/https://acme.slack.com@evil.com/' + P],
  ['/https://user:pass@acme.slack.com/' + P],
  ['/https://user@acme.slack.com/' + P],
  ['/acme.slack.com:443/' + P],
  ['/https://acme.slack.com:443/' + P],
  ['/https://acme.slack.com:8080/' + P],
  ['/acme.slack.com./' + P],
  ['/https://acme.slack.com./' + P],
  ['/ACME.slack.com/' + P],
  ['/acme.SLACK.com/' + P],
  ['/xn--80ak6aa92e.slack.com/' + P, OK, OK],
  ['/аcme.slack.com/' + P], // Cyrillic a
  ['/acme.slack.com%2F/' + P],
  ['/acme%2Eslack.com/' + P],
  ['/-acme.slack.com/' + P],
  ['/acme-.slack.com/' + P],
  ['/a.b.slack.com/' + P],
  ['/acme.slack.co/' + P],
  ['/acme.slack.com'],
  ['/acme.slack.com/'],
  ['/r'],
  ['/r/'],
  ['/'],
  ['/r/archives'],
  ['/r/archives/'],
  ['/r/archives/' + CH + '/'],
  ['/r/archives//' + CH],
  ['/r//archives/' + CH],
  ['/r/archives/' + CH + '/' + MSG + '/'],
  ['/r/archives/' + CH + '/' + MSG + '/extra'],
  ['/r/archives/C1234567'], // short
  ['/r/archives/C1234567890123'], // overlong
  ['/r/archives/c0cda94qtqq'], // lowercase
  ['/r/archives/X0CDA94QTQQ'], // wrong prefix
  ['/r/archives/' + CH + '/p179309707751946'], // 15 digits
  ['/r/archives/' + CH + '/p17930970775194690'], // 17 digits
  ['/r/archives/' + CH + '/P1793097077519469'],
  ['/r/team/' + CH],
  ['/r/team/u0123abcd'],
  ['/r/files/' + USER],
  ['/r/files/' + USER + '/' + FILE + '/..'],
  ['/r/files/' + USER + '/' + FILE + '/.'],
  ['/r/files/' + USER + '/' + FILE + '/a/b'],
  ['/r/files/' + USER + '/' + FILE + '/a@b', `https://${ORG}.slack.com/files/${USER}/${FILE}`,
    `https://${ORG}.slack.com/files/${USER}/${FILE}`],
  // The browser turns '\\' into '/' (an extra segment); raw, it is a filename character.
  ['/r/files/' + USER + '/' + FILE + '/a\\b', null, `https://${ORG}.slack.com/files/${USER}/${FILE}`],
  // Raw space / non-ASCII are rejected; the browser percent-encodes them first.
  ['/r/files/' + USER + '/' + FILE + '/a b', `https://${ORG}.slack.com/files/${USER}/${FILE}`, null],
  ['/r/files/' + USER + '/' + FILE + '/caf\u00e9.png', `https://${ORG}.slack.com/files/${USER}/${FILE}`, null],
  // No length cap on the discarded filename.
  ['/r/files/' + USER + '/' + FILE + '/' + 'x'.repeat(1000), `https://${ORG}.slack.com/files/${USER}/${FILE}`,
    `https://${ORG}.slack.com/files/${USER}/${FILE}`],
  ['/r/files/' + USER + '/' + FILE + '/', null, null],
  ['/r/files/' + CH + '/' + FILE],
  ['/r/docs/' + USER + '/' + FILE],
  ['/r/docs/' + TEAM + '/' + FILE + '/x'],
  ['/r/client/' + TEAM],
  ['/r/client/' + USER + '/' + CH],
  ['/r/client/' + TEAM + '/' + CH + '/thread/' + GRP + '-' + TS], // channel mismatch
  ['/r/client/' + TEAM + '/' + CH + '/thread/' + CH + '-1793097077.51946'],
  ['/r/client/' + TEAM + '/' + CH + '/thread/' + CH + '-' + TS + '?thread_ts=' + TS],
  ['/r/client/' + TEAM + '/' + CH + '/thread/' + CH + '-' + TS + '?cid=' + CH],
  ['/r/client/' + TEAM + '/' + CH + '/thread/' + CH + '-' + TS + '?thread_ts=' + TS + '&cid=' + CH],
  ['/app.slack.com/client/' + TEAM + '/' + CH + '/thread/' + CH + '-' + TS + '?cid=' + CH],
  ['/r/client/' + TEAM + '/' + CH + '?thread_ts=' + TS],
  ['/r/client/' + TEAM + '/' + CH + '?cid=' + CH],
  ['/r/client/' + TEAM + '/' + CH + '/threads/' + CH + '-' + TS],
  ['/r/client/' + TEAM + '/' + CH + '/thread'],
  ['/app.slack.com/' + P],
  ['/https://app.slack.com/' + P],
  ['/app.slack.com/team/' + USER],
  ['/acme.slack.com/client/' + TEAM + '/' + CH],
  ['/https://acme.enterprise.slack.com/client/' + TEAM + '/' + CH],
  // WHATWG strips trailing C0/space from the whole URL string.
  ['/r/archives/' + CH + ' ', `https://${ORG}.slack.com/archives/${CH}`, null],
  ['/r/archives/ ' + CH],
  ['/r/archives/' + CH + '%20'],
  ['/r/archives/' + CH + '%09'],
  ['/r/archives/' + CH + '\u0000', `https://${ORG}.slack.com/archives/${CH}`, null],
  ['/r/archives/' + CH + '\u0000/' + MSG],
  ['/r/archives/' + CH + '#x', `https://${ORG}.slack.com/archives/${CH}`, null],
  ['/r/archives/' + CH + '?thread_ts=' + TS], // thread_ts on non-message shape
  ['/r/archives/' + CH + '?cid=' + CH],
  ['/r/team/' + USER + '?cid=' + CH],
  ['/r/' + P + '?thread_ts=1&cid=' + CH],
  ['/r/' + P + '?thread_ts=A&thread_ts=B'],
  ['/r/' + P + '?thread_ts=' + TS + '&thread_ts=' + TS],
  ['/r/' + P + '?thread_ts=' + TS + '&cid=' + CH + '&cid=' + CH],
  ['/r/' + P + '?thread_ts=' + TS + '&cid=' + GRP], // cid != channel
  ['/r/' + P + '?thread_ts=' + TS + '&cid=c0cda94qtqq'],
  ['/r/' + P + '?thread_ts'],
  ['/r/' + P + '?thread_ts='],
  ['/r/' + P + '?thread_ts==' + TS],
  ['/r/' + P + '?thread_ts=' + TS + '#', `${OK}?thread_ts=${TS}`, null],
  ['/r/' + P + '?thread_ts=' + TS + '/../evil'],
  ['/r/' + P + '?thread_ts=' + TS + ' ', `${OK}?thread_ts=${TS}`, null],
  ['/r/' + P + '?thread_ts=' + TS + ' &cid=' + CH],
  ['/r/' + P + '?thread_ts=//evil.com'],
  ['/r/' + P + '?Thread_ts=x', OK, OK],
  ['/r/' + P + '?thread%5Fts=x', OK, OK],
  ['/r/' + P + '?%74hread_ts=x', OK, OK],
  ['/r/' + P + '?next=https://evil.com', OK, OK],
  ['/r/' + P + '??thread_ts=' + TS, OK, OK],
];

test('hostile corpus via new URL() and raw', () => {
  const mismatches = [];
  for (const [input, expUrl = null, expRaw = null] of HOSTILE) {
    let urlResult;
    try {
      urlResult = dest(viaUrl(input));
    } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      urlResult = null; // URL itself failed to parse: nothing to hand us
    }
    const rawResult = dest(viaRaw(input));
    if (urlResult !== expUrl) mismatches.push({ mode: 'url', input, got: urlResult, want: expUrl });
    if (rawResult !== expRaw) mismatches.push({ mode: 'raw', input, got: rawResult, want: expRaw });
  }
  assert.deepEqual(mismatches, []);
});

test('parse rejects non-string input', () => {
  assert.equal(parse(undefined, ''), null);
  assert.equal(parse('/r/archives/' + CH, undefined), null);
  assert.equal(parse(null, null), null);
  assert.equal(parse({ toString: () => '/r/archives/' + CH }, ''), null);
});

test('query contract examples', () => {
  const p = `/r/archives/${CH}/${MSG}`;
  assert.deepEqual(parse(p, `?thread_ts=${TS}&cid=${CH}&utm=x`), {
    path: `/archives/${CH}/${MSG}`,
    query: `?thread_ts=${TS}&cid=${CH}`,
  });
  assert.equal(parse(p, `?thread_ts=1&cid=${CH}`), null);
  assert.equal(parse(p, '?thread_ts=A&thread_ts=B'), null);
  assert.deepEqual(parse(p, '?foo=bar'), { path: `/archives/${CH}/${MSG}`, query: '' });
  // Leading '?' is optional on raw input; only one is stripped.
  assert.deepEqual(parse(p, `thread_ts=${TS}`), { path: `/archives/${CH}/${MSG}`, query: `?thread_ts=${TS}` });
  assert.deepEqual(parse(p, '?'), { path: `/archives/${CH}/${MSG}`, query: '' });
  assert.deepEqual(parse(p, '?&&'), { path: `/archives/${CH}/${MSG}`, query: '' });
  // cid without thread_ts is dropped (when otherwise valid).
  assert.deepEqual(parse(p, `?cid=${CH}`), { path: `/archives/${CH}/${MSG}`, query: '' });
  // Invalid or mismatched cid rejects even without thread_ts (fail closed).
  assert.equal(parse(p, '?cid=nope'), null);
  assert.equal(parse(p, `?cid=${GRP}`), null);
  assert.equal(parse(p, `?thread_ts=${TS}&cid=`), null);
  assert.equal(parse(p, `?thread_ts=1793097077%2e519469`), null);
});

test('buildDestination rejects hostile orgs', () => {
  const parsed = parse(`/r/archives/${CH}`, '');
  for (const org of [
    '//evil.com',
    'https://evil.com',
    '\\evil.com',
    'evil.com#',
    'evil.com',
    'acme.slack.com',
    'acme@evil.com',
    'acme:443',
    'acme/',
    'acme?',
    'acme#',
    'ACME',
    ' acme',
    'acme.',
    'acme.enterprise.',
    'acme%2e',
    'xn--x',
    'xn--x.enterprise',
    'app',
    'www.enterprise',
    '',
    'аcme',
    null,
    undefined,
    42,
    { toString: () => 'acme' },
  ]) {
    assert.equal(buildDestination(parsed, org), null, JSON.stringify(String(org)));
  }
});

test('buildDestination rejects hostile parsed values', () => {
  for (const parsed of [
    null,
    undefined,
    'archives',
    {},
    { path: '//evil.com', query: '' },
    { path: '/\\evil.com', query: '' },
    { path: 'https://evil.com', query: '' },
    { path: '/archives/' + CH + '#', query: '' },
    { path: '/archives/' + CH, query: '#x' },
    { path: '/archives/' + CH, query: '?x=1' },
    { path: '/archives/' + CH + '/' + MSG, query: '?thread_ts=' + TS + '&utm=x' },
    { path: '/archives/' + CH + '/' + MSG, query: '?cid=' + CH + '&thread_ts=' + TS },
    { path: '/archives/' + CH + '/' + MSG, query: 'thread_ts=' + TS },
    { path: '/archives/' + CH + '/../../evil', query: '' },
    { path: '/archives/%2e%2e', query: '' },
    { path: '/files/' + USER + '/' + FILE + '/name.pdf', query: '' },
    { path: '/client/' + TEAM + '/' + CH, query: '' },
    { path: '/archives/' + CH + '/' + MSG, query: '?thread_ts=' + TS + '&cid=' + GRP },
    { path: '/archives/' + CH + '/' + MSG, query: '?thread_ts=' + TS + '&cid=' + CH + '#' },
    { path: 'archives/' + CH, query: '' },
    { path: '/archives/' + CH, query: undefined },
    { path: ['/archives/' + CH], query: '' },
  ]) {
    assert.equal(buildDestination(parsed, ORG), null, JSON.stringify(parsed));
    assert.equal(canonicalLink(parsed), null, JSON.stringify(parsed));
  }
});

test('canonicalLink builds /r/ links from parsed fields', () => {
  assert.equal(
    canonicalLink(parse(`/https://acme.slack.com/archives/${CH}/${MSG}`, `?utm=1&cid=${CH}&thread_ts=${TS}`)),
    `https://workspacel.ink/r/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
  );
  assert.equal(
    canonicalLink(parse(`/app.slack.com/client/${TEAM}/${CH}/thread/${CH}-${TS}`, '')),
    `https://workspacel.ink/r/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
  );
});

test('converter output never contains the source workspace', () => {
  const pasted = [
    [`https://secretcorp.slack.com/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`,
      `https://workspacel.ink/r/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`],
    [`secretcorp.slack.com/archives/${CH}`, `https://workspacel.ink/r/archives/${CH}`],
    [`  https://secretcorp.enterprise.slack.com/team/${USER}  `, `https://workspacel.ink/r/team/${USER}`],
    [`https://secretcorp.slack.com/files/${USER}/${FILE}/secretcorp-plan.pdf`,
      `https://workspacel.ink/r/files/${USER}/${FILE}`],
    [`https://secretcorp.slack.com/files/${USER}/${FILE}/image (1).png`,
      `https://workspacel.ink/r/files/${USER}/${FILE}`],
    [`https://secretcorp.slack.com/files/${USER}/${FILE}/Q3 Report (final).pdf`,
      `https://workspacel.ink/r/files/${USER}/${FILE}`],
    [`https://secretcorp.slack.com/files/${USER}/${FILE}/John's notes.txt`,
      `https://workspacel.ink/r/files/${USER}/${FILE}`],
    [`https://secretcorp.slack.com/files/${USER}/${FILE}/budget, v2.xlsx`,
      `https://workspacel.ink/r/files/${USER}/${FILE}`],
    [`https://secretcorp.slack.com/docs/${TEAM}/${FILE}`, `https://workspacel.ink/r/docs/${TEAM}/${FILE}`],
    [`https://app.slack.com/client/${TEAM}/${CH}/thread/${CH}-${TS}`,
      `https://workspacel.ink/r/archives/${CH}/${MSG}?thread_ts=${TS}&cid=${CH}`],
    [`https://secretcorp.slack.com/archives/${CH}/${MSG}?secretcorp=1#secretcorp`,
      `https://workspacel.ink/r/archives/${CH}/${MSG}`],
  ];
  for (const [input, expected] of pasted) {
    const out = convertPasted(input);
    assert.equal(out, expected, input);
    assert.ok(!out.includes('secretcorp'), input);
  }
});

test('long non-ASCII filenames are accepted once percent-encoded', () => {
  // 30 CJK characters become 270 bytes of percent-encoding.
  const name = '\u5831\u544a\u66f8'.repeat(10) + '.pdf';
  const u = new URL(`https://workspacel.ink/r/files/${USER}/${FILE}/${name}`);
  assert.ok(u.pathname.length - u.pathname.lastIndexOf('/') > 255);
  assert.deepEqual(parse(u.pathname, u.search), { path: `/files/${USER}/${FILE}`, query: '' });
  assert.equal(
    convertPasted(`https://secretcorp.slack.com/files/${USER}/${FILE}/${name}`),
    `https://workspacel.ink/r/files/${USER}/${FILE}`,
  );
});

test('converter rejects what it does not understand', () => {
  for (const input of [
    '',
    '   ',
    'hello',
    'https://evil.com/archives/' + CH,
    'http://acme.slack.com/archives/' + CH,
    'javascript:alert(1)',
    '//evil.com',
    '@evil.com/archives/' + CH,
    'https://acme.slack.com@evil.com/archives/' + CH,
    'https://acme.slack.com/archives/' + CH + '/' + MSG + '?thread_ts=1',
    'https://app.slack.com/archives/' + CH,
    // Embedded control characters (the URL parser would silently strip them).
    `https://acme.slack.com/arch\rives/${CH}`,
    `https://acme.slack.com/arch\tives/${CH}`,
    `https://acme.slack.com/archives/${CH}\t/${MSG}`,
    `acme.slack.com/archives/\n${CH}`,
    `acme.slack.com/archives/${CH}\x00`,
    `acme.slack.com/archives/${CH}\x7f`,
    null,
    undefined,
  ]) {
    assert.equal(convertPasted(input), null, String(input));
  }
});
