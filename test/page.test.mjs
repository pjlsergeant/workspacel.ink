import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, buildPage, cspContent } from '../build.mjs';
import { SETTINGS_KEY } from '../parser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const outDir = mkdtempSync(join(tmpdir(), 'workspacelink-'));
build(outDir);
const builtHtml = readFileSync(join(outDir, 'index.html'), 'utf8');
rmSync(outDir, { recursive: true, force: true });

function inlineScript(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, 'exactly one <script>');
  assert.equal(scripts[0][0].startsWith('<script>'), true, 'classic inline script without attributes');
  return scripts[0][1];
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

// ---- banned sinks ----------------------------------------------------------

const BANNED = [
  [/innerHTML/, 'innerHTML'],
  [/outerHTML/, 'outerHTML'],
  [/insertAdjacentHTML/, 'insertAdjacentHTML'],
  [/document\.write/, 'document.write'],
  [/\beval\s*\(/, 'eval('],
  [/new\s+Function\b/, 'new Function'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/, 'string-argument setTimeout/setInterval'],
  [/srcdoc/i, 'srcdoc'],
  [/<[a-z][^>]*\son[a-z]+\s*=/i, 'inline on*= attribute'],
  [/setAttribute\s*\(\s*['"`]on/i, "setAttribute('on...')"],
  [/location\.(?:hash|href)\b/, 'location.hash / location.href'],
  [/\.assign\s*\(/, 'location.assign'],
  [/<form\b/i, '<form>'],
];

function scan(name, text) {
  for (const [re, label] of BANNED) assert.doesNotMatch(text, re, `${name}: banned ${label}`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

test('banned-sink scan of src/, parser.mjs and the built index.html', () => {
  const files = [...walk(join(ROOT, 'src')), join(ROOT, 'parser.mjs')];
  for (const f of files) scan(f, readFileSync(f, 'utf8'));
  scan('built index.html', builtHtml);
});

test('the banned-sink scanner catches what it should', () => {
  for (const bad of [
    'x.innerHTML = y',
    'document.write(1)',
    'eval (s)',
    'new Function("x")',
    "setTimeout('x()', 1)",
    'setInterval("x()", 1)',
    '<iframe srcdoc="x">',
    '<a href="#" onclick="x()">',
    "el.setAttribute('onclick', 'x')",
    'location.href',
    'insertAdjacentHTML',
    'outerHTML',
  ]) {
    assert.ok(BANNED.some(([re]) => re.test(bad)), bad);
  }
});

// ---- build output ---------------------------------------------------------------

test('CSP meta hash matches the inlined script; referrer meta present', () => {
  const hash = sha256(inlineScript(builtHtml));
  const head = builtHtml.slice(0, builtHtml.indexOf('<style>'));
  assert.ok(
    head.includes(`<meta http-equiv="Content-Security-Policy" content="${cspContent(hash)}">`),
    'CSP meta before <style>',
  );
  assert.equal(
    cspContent(hash),
    `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; ` +
      `base-uri 'none'; form-action 'none'`,
  );
  assert.equal(builtHtml.match(/http-equiv="Content-Security-Policy"/g).length, 1);
  assert.ok(head.includes('<meta name="referrer" content="no-referrer">'), 'referrer meta before <style>');
});

test('built page makes no external requests and has the required copy', () => {
  // Only the GitHub link and the SVG namespace may mention another origin.
  const urls = [...builtHtml.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]+/gi)].map((m) => m[0]);
  for (const u of urls) {
    assert.ok(
      ['https://github.com', 'http://www.w3.org', 'https://workspacel.ink', 'https://x.invalid'].includes(u),
      u,
    );
  }
  const markup = builtHtml.replace(/<script>[\s\S]*<\/script>/, '');
  const resources = [...markup.matchAll(/<(?:link|img|iframe|object|embed|source|video|audio)\b[^>]*>/gi)];
  assert.deepEqual(
    resources.map((m) => m[0]).filter((tag) => !/\shref="data:/.test(tag)),
    [],
  );
  assert.match(builtHtml, /<link rel="icon" href="data:image\/svg\+xml,/);
  for (const text of [
    'workspacel.ink',
    'NOT ASSOCIATED WITH SLACK',
    'ZERO DATA RETENTION',
    'We store nothing. Cloudflare may log the URL you visit. Your settings stay in your browser.',
    'Not a Slack link we understand.',
    'Put workspacel.ink/ in front of any Slack link.',
    'href="https://github.com/pjlsergeant/workspacel.ink"',
    '>settings<',
    '>STOP<',
    'For automated agents:',
    'whichever Slack workspace you have been told to use',
  ]) {
    assert.ok(builtHtml.includes(text), text);
  }
});

test('stylesheet makes [hidden] win over display rules', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(builtHtml)[1];
  assert.match(style, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('stylesheet hides the agent explanation so browsers never paint it', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(builtHtml)[1];
  assert.match(style, /#agents\s*\{\s*display:\s*none;\s*\}/);
});

test('build refuses unsafe script sources', () => {
  const parserSource = readFileSync(join(ROOT, 'parser.mjs'), 'utf8');
  const template = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  const importLine = "import { parse } from '../parser.mjs';\n";
  const page = (body) =>
    `<!doctype html>\n<meta charset="utf-8">\n<p>x</p><script type="module">\n${importLine}${body}</script>\n`;

  assert.doesNotThrow(() => buildPage(template, parserSource));
  assert.doesNotThrow(() => buildPage(page('parse("/", "");\n'), parserSource));
  assert.throws(() => buildPage(page("const x = '</script>';\n"), parserSource));
  assert.throws(() => buildPage(page("const x = '</SCRIPT >';\n"), parserSource));
  assert.throws(() => buildPage(page("const x = '<!--';\n"), parserSource));
  assert.throws(() => buildPage(page('1;\n') + '<script>2</script>', parserSource));
  assert.throws(() => buildPage(page('1;\n'), `${parserSource}\n// </script>\n`));
  assert.throws(() => buildPage(page('1;\n'), `${parserSource}\n// <!--\n`));
  assert.throws(() => buildPage('<p>no script</p>', parserSource));
});

test('inlined script is a classic script that compiles', () => {
  assert.doesNotThrow(() => new vm.Script(inlineScript(builtHtml)));
});

// ---- behaviour under a minimal fake DOM ------------------------------------------

const IDS = new Set([...builtHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const INITIALLY_HIDDEN = new Set(
  [...builtHtml.matchAll(/<[a-z]+\s[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\shidden(?=[\s>=])/.test(tag))
    .map((tag) => /\sid="([^"]+)"/.exec(tag)?.[1])
    .filter(Boolean),
);

function runPage({
  pathname,
  search = '',
  stored = null,
  storageThrows = false,
  clipboardFails = false,
}) {
  const elements = new Map();
  const touched = [];
  const getEl = (id) => {
    assert.ok(IDS.has(id), `unknown element id ${id}`);
    touched.push(id);
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        id,
        hidden: INITIALLY_HIDDEN.has(id),
        textContent: '',
        value: '',
        href: '',
        selected: false,
        removed: false,
        listeners,
        addEventListener(type, fn) {
          (listeners[type] ||= []).push(fn);
        },
        focus() {},
        remove() {
          this.removed = true;
        },
        select() {
          this.selected = true;
        },
        fire(type, event = {}) {
          for (const fn of listeners[type] || []) fn({ preventDefault() {}, ...event });
        },
      });
    }
    return elements.get(id);
  };

  const replaced = [];
  const location = {
    pathname,
    search,
    replace(url) {
      replaced.push(url);
    },
  };
  for (const banned of ['hash', 'href', 'assign']) {
    Object.defineProperty(location, banned, {
      get() {
        throw new Error(`page read location.${banned}`);
      },
    });
  }

  const store = new Map();
  if (stored !== null) store.set(SETTINGS_KEY, stored);
  const localStorage = {
    getItem(k) {
      if (storageThrows) throw new Error('SecurityError');
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (storageThrows) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
  };

  let nextTimer = 1;
  const timers = new Map();
  const copied = [];
  const window = { location, localStorage };
  const context = {
    window,
    document: { getElementById: getEl },
    navigator: {
      clipboard: {
        writeText(v) {
          if (clipboardFails) return Promise.reject(new Error('denied'));
          copied.push(v);
          return Promise.resolve();
        },
      },
    },
    setTimeout(fn, ms) {
      assert.equal(typeof fn, 'function');
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    URL,
    console,
  };
  vm.runInNewContext(inlineScript(builtHtml), context);
  const firstTouched = touched[0];

  const tick = () => {
    const [id, t] = timers.entries().next().value ?? [];
    if (id === undefined) return false;
    timers.delete(id);
    t.fn();
    return true;
  };
  return { el: getEl, replaced, store, timers, tick, copied, firstTouched };
}

const CH = 'C0CDA94QTQQ';
const MSG = 'p1793097077519469';
const SETTINGS = (org, delay) => JSON.stringify({ v: 1, org, delay });

test('page: the agent explanation is removed first, on every startup path', () => {
  for (const [pathname, stored] of [
    ['/', null],
    [`/r/archives/${CH}`, SETTINGS('mine', 2)],
    ['/favicon.ico', SETTINGS('mine', 0)],
    [`/r/archives/${CH}`, null],
  ]) {
    const p = runPage({ pathname, stored });
    assert.equal(p.firstTouched, 'agents', pathname);
    assert.equal(p.el('agents').removed, true, pathname);
  }
});

test('page: landing shows the converter; converts and copies', async () => {
  const p = runPage({ pathname: '/' });
  assert.equal(p.el('landing').hidden, false);
  assert.equal(p.el('redirect').hidden, true);
  assert.equal(p.el('settings').hidden, true);

  p.el('paste').value = `https://secretcorp.slack.com/archives/${CH}/${MSG}?thread_ts=1793097077.519469&x=1`;
  p.el('paste').fire('input');
  assert.equal(p.el('converted').hidden, false);
  assert.equal(p.el('convert-error').hidden, true);
  assert.equal(p.el('canonical').value, `https://workspacel.ink/r/archives/${CH}/${MSG}?thread_ts=1793097077.519469`);

  p.el('copy').fire('click');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.copied, [p.el('canonical').value]);
  assert.equal(p.el('copy').textContent, 'copied');

  p.el('paste').value = `acme.slack.com/archives/${CH}`;
  p.el('paste').fire('input');
  assert.equal(p.el('copy').textContent, 'copy', 'label resets when the output changes');

  // Input changing while the clipboard write is pending doesn't leave 'copied'.
  p.el('copy').fire('click');
  p.el('paste').value = `acme.slack.com/team/U0123ABCD`;
  p.el('paste').fire('input');
  await new Promise((r) => setImmediate(r));
  assert.equal(p.el('copy').textContent, 'copy');

  p.el('paste').value = 'https://evil.com/archives/' + CH;
  p.el('paste').fire('input');
  assert.equal(p.el('converted').hidden, true);
  assert.equal(p.el('convert-error').hidden, false);
  assert.equal(p.el('canonical').value, '', 'no stale link left to copy');

  p.el('paste').value = `acme.slack.com/archives/${CH}`;
  p.el('paste').fire('input');
  assert.notEqual(p.el('canonical').value, '');
  p.el('paste').value = '  ';
  p.el('paste').fire('input');
  assert.equal(p.el('canonical').value, '');
  assert.equal(p.el('converted').hidden, true);
  assert.equal(p.replaced.length, 0);
});

test('page: copy falls back to selecting the text', async () => {
  const p = runPage({ pathname: '/', clipboardFails: true });
  p.el('paste').value = `acme.slack.com/archives/${CH}`;
  p.el('paste').fire('input');
  p.el('copy').fire('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(p.el('canonical').selected, true);
});

test('page: valid link + workspace set counts down then location.replace', () => {
  const p = runPage({ pathname: `/https://theirs.slack.com/archives/${CH}/${MSG}`, stored: SETTINGS('mine', 2) });
  const dest = `https://mine.slack.com/archives/${CH}/${MSG}`;
  assert.equal(p.el('redirect').hidden, false);
  assert.equal(p.el('dest').textContent, dest);
  assert.match(p.el('countdown').textContent, /2/);
  assert.equal(p.replaced.length, 0);
  assert.ok(p.tick());
  assert.match(p.el('countdown').textContent, /1/);
  assert.equal(p.replaced.length, 0);
  assert.ok(p.tick());
  assert.deepEqual(p.replaced, [dest]);
  assert.equal(p.timers.size, 0);
});

test('page: delay 0 redirects immediately', () => {
  const p = runPage({ pathname: `/r/archives/${CH}`, stored: SETTINGS('mine.enterprise', 0) });
  assert.deepEqual(p.replaced, [`https://mine.enterprise.slack.com/archives/${CH}`]);
  assert.equal(p.timers.size, 0);
});

test('page: STOP clears the timer and shows a plain link', () => {
  const p = runPage({ pathname: `/r/archives/${CH}`, stored: SETTINGS('mine', 5) });
  assert.equal(p.timers.size, 1);
  p.el('stop').fire('click');
  assert.equal(p.timers.size, 0);
  assert.equal(p.el('dest-link').href, `https://mine.slack.com/archives/${CH}`);
  assert.equal(p.el('dest-link').textContent, `https://mine.slack.com/archives/${CH}`);
  assert.equal(p.el('dest-link-wrap').hidden, false);
  assert.equal(p.el('stop').hidden, true);
  assert.equal(p.tick(), false);
  assert.equal(p.replaced.length, 0);
});

test('page: opening settings during the countdown stops it', () => {
  const p = runPage({ pathname: `/r/archives/${CH}`, stored: SETTINGS('mine', 3) });
  p.el('settings-toggle').fire('click');
  assert.equal(p.timers.size, 0);
  assert.equal(p.el('settings').hidden, false);
  assert.equal(p.el('org').value, 'mine');
  assert.equal(p.el('delay').value, '3');
});

test('page: no workspace set shows settings inline, never prefilled from the link; save proceeds', () => {
  const p = runPage({ pathname: `/theirs.slack.com/archives/${CH}/${MSG}`, search: '?thread_ts=1793097077.519469' });
  assert.equal(p.el('settings').hidden, false);
  assert.equal(p.el('redirect').hidden, true);
  assert.equal(p.el('org').value, '');
  assert.equal(p.el('delay').value, '2');

  p.el('org').value = 'https://evil.com';
  p.el('save').fire('click');
  assert.equal(p.store.size, 0);
  assert.equal(p.el('settings').hidden, false);
  assert.notEqual(p.el('settings-msg').textContent, '');

  p.el('org').value = ' Mine.Slack.com ';
  p.el('delay').value = '1';
  p.el('org').fire('keydown', { key: 'a' });
  assert.equal(p.store.size, 0);
  p.el('org').fire('keydown', { key: 'Enter' });
  assert.equal(p.store.get(SETTINGS_KEY), SETTINGS('mine', 1));
  assert.equal(p.el('settings').hidden, true);
  assert.equal(p.replaced.length, 0);
  p.tick();
  assert.deepEqual(p.replaced, [`https://mine.slack.com/archives/${CH}/${MSG}?thread_ts=1793097077.519469`]);
});

test('page: settings toggle never leaves the page empty', () => {
  // First visit: settings is the only thing shown, so it stays open.
  const p = runPage({ pathname: `/r/archives/${CH}` });
  assert.equal(p.el('settings').hidden, false);
  p.el('settings-toggle').fire('click');
  assert.equal(p.el('settings').hidden, false);

  // With something else showing, the toggle closes and reopens settings.
  const q = runPage({ pathname: '/' });
  q.el('settings-toggle').fire('click');
  assert.equal(q.el('settings').hidden, false);
  q.el('settings-toggle').fire('click');
  assert.equal(q.el('settings').hidden, true);
  assert.equal(q.el('landing').hidden, false);
});

test('page: invalid stored settings are "not set"', () => {
  for (const stored of [
    '{',
    SETTINGS('evil.com', 2),
    JSON.stringify({ v: 2, org: 'mine', delay: 2 }),
    SETTINGS('xn--x', 0),
    SETTINGS('app', 0),
  ]) {
    const p = runPage({ pathname: `/r/archives/${CH}`, stored });
    assert.equal(p.el('settings').hidden, false, stored);
    assert.equal(p.el('org').value, '', stored);
    assert.equal(p.replaced.length, 0);
  }
});

test('page: localStorage throwing is survivable', () => {
  const p = runPage({ pathname: `/r/archives/${CH}`, storageThrows: true });
  assert.equal(p.el('settings').hidden, false);
  p.el('org').value = 'mine';
  p.el('delay').value = '0';
  p.el('save').fire('click');
  assert.deepEqual(p.replaced, [`https://mine.slack.com/archives/${CH}`]);
});

test('page: unrecognised link shows the error and never redirects', () => {
  for (const [pathname, search] of [
    ['//evil.com', ''],
    ['/https://evil.com/archives/' + CH, ''],
    ['/r/archives/' + CH, '?thread_ts=1'],
    ['/favicon.ico', ''],
  ]) {
    const p = runPage({ pathname, search, stored: SETTINGS('mine', 0) });
    assert.equal(p.el('error').hidden, false, pathname);
    assert.equal(p.el('redirect').hidden, true, pathname);
    assert.equal(p.replaced.length, 0, pathname);
    assert.equal(p.timers.size, 0, pathname);
  }
});

test('page: org validation messages on save', () => {
  const cases = [
    ['https://evil.com', "That doesn't look like a Slack workspace."],
    [
      `https://app.slack.com/client/T0123ABCD/${CH}`,
      "That's a Slack service address, not a workspace \u2014 use your workspace's name (e.g. acme.slack.com).",
    ],
  ];
  for (const [input, message] of cases) {
    const p = runPage({ pathname: `/r/archives/${CH}` });
    p.el('org').value = input;
    p.el('save').fire('click');
    assert.equal(p.el('settings-msg').textContent, message, input);
    assert.equal(p.store.size, 0, input);
    assert.equal(p.el('settings').hidden, false, input);
    assert.equal(p.replaced.length, 0, input);
  }
});
