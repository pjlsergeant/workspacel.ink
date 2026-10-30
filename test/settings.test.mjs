import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseOrg, validateOrg, normaliseDelay, readSettings, serialiseSettings, SETTINGS_KEY } from '../parser.mjs';

test('normaliseOrg: valid inputs', () => {
  const cases = [
    ['acme', 'acme'],
    ['  acme  ', 'acme'],
    ['ACME', 'acme'],
    ['AcMe-Corp', 'acme-corp'],
    ['a', 'a'],
    ['a1', 'a1'],
    ['1a', '1a'],
    ['x'.repeat(63), 'x'.repeat(63)],
    ['acme.slack.com', 'acme'],
    ['ACME.SLACK.COM', 'acme'],
    ['acme.enterprise', 'acme.enterprise'],
    ['acme.enterprise.slack.com', 'acme.enterprise'],
    ['https://acme.slack.com', 'acme'],
    ['https://acme.slack.com/', 'acme'],
    ['https://acme.slack.com/archives/C0CDA94QTQQ?x=1#y', 'acme'],
    ['https://acme.slack.com?x', 'acme'],
    ['https://acme.slack.com#x', 'acme'],
    ['HTTPS://ACME.SLACK.COM/', 'acme'],
    ['https://acme.enterprise.slack.com/', 'acme.enterprise'],
    ['xn--80ak6aa92e', 'xn--80ak6aa92e'], // ASCII punycode matches LABEL
    ['https://xn--bcher-kva.slack.com/', 'xn--bcher-kva'],
    // Only the authority of a URL must be ASCII; the rest is ignored.
    ['https://acme.slack.com/caf\u00e9', 'acme'],
    ['https://acme.slack.com/?q=\u00fc#\u2603', 'acme'],
  ];
  for (const [input, expected] of cases) assert.equal(normaliseOrg(input), expected, input);
});

test('normaliseOrg: invalid inputs', () => {
  const cases = [
    '',
    '   ',
    'x'.repeat(64),
    '-acme',
    'acme-',
    'ac_me',
    'ac me',
    'acme.',
    'acme.slack.com.',
    'acme..slack.com',
    'a.b',
    'a.b.slack.com',
    'acme.enterprise.enterprise',
    'enterprise.acme',
    '.slack.com',
    'slack.com',
    'acme.slack.co',
    'acme/',
    'acme\\',
    'acme@',
    'acme:',
    'acme?',
    'acme#',
    'acme%',
    'ac%6de',
    'acme\t1',
    'аcme', // Cyrillic a
    'acmé',
    'ａｃｍｅ', // fullwidth
    '\uff41cme', // fullwidth a
    '\u212Acme', // Kelvin sign (lowercases to ASCII k)
    'https://\uff41cme.slack.com',
    'https://\u212Acme.slack.com',
    'https://acme.slack.com\uff0fx', // fullwidth solidus inside the authority
    'acme\u200b',
    'ac\u00a0me',
    'http://acme.slack.com',
    'ftp://acme.slack.com',
    'javascript://acme.slack.com',
    'https://evil.com',
    'https://acme.slack.com.evil.com',
    'https://evil.com/acme.slack.com',
    'https://evil.com?acme.slack.com',
    'https://acme.slack.com.',
    'https://acme.slack.com./',
    'https://user@acme.slack.com',
    'https://user:pass@acme.slack.com',
    'https://:pass@acme.slack.com',
    'https://acme.slack.com@evil.com',
    'https://evil.com@acme.slack.com',
    'https://acme.slack.com:443',
    'https://acme.slack.com:8443/',
    'https://acme.slack.com:',
    'https://ac%6De.slack.com',
    'https://acme%2eslack.com',
    'https:\\\\acme.slack.com',
    'https://acme.slack.com\\evil',
    'https://аcme.slack.com',
    'https://app.slack.com.evil.com',
    'https://slack.com',
    'https://',
    '://acme.slack.com',
    null,
    undefined,
    42,
    {},
  ];
  for (const input of cases) assert.equal(normaliseOrg(input), null, JSON.stringify(input));
});

test('validateOrg: unusable hostnames (invalid punycode) are rejected', () => {
  for (const input of ['xn--x', 'xn--x.enterprise', 'xn--x.slack.com', 'xn--x.enterprise.slack.com']) {
    assert.deepEqual(validateOrg(input), { org: null, error: 'invalid' }, input);
  }
  assert.deepEqual(validateOrg('https://xn--x.slack.com/'), { org: null, error: 'invalid' });
});

test('validateOrg: reserved Slack service labels', () => {
  for (const label of ['app', 'www', 'api', 'files', 'slack', 'status']) {
    for (const input of [
      label,
      label.toUpperCase(),
      `${label}.slack.com`,
      `${label}.enterprise`,
      `${label}.enterprise.slack.com`,
      `https://${label}.slack.com/`,
    ]) {
      assert.deepEqual(validateOrg(input), { org: null, error: 'reserved' }, input);
    }
  }
  // Pasting a Slack client URL into settings.
  assert.deepEqual(validateOrg('https://app.slack.com/client/T0123ABCD/C0CDA94QTQQ'), {
    org: null,
    error: 'reserved',
  });
  // Labels merely containing a reserved word are fine.
  assert.equal(normaliseOrg('apps'), 'apps');
  assert.equal(normaliseOrg('my-app'), 'my-app');
  assert.equal(normaliseOrg('slackers.enterprise'), 'slackers.enterprise');
});

test('normaliseDelay', () => {
  for (const [input, expected] of [
    ['0', 0], ['2', 2], ['10', 10], [' 5 ', 5], ['07', 7],
    ['11', null], ['-1', null], ['1.5', null], ['', null], ['1e1', null], ['0x2', null],
    ['100', null], ['two', null], [null, null], [3, null],
  ]) {
    assert.equal(normaliseDelay(input), expected, String(input));
  }
});

test('settings key', () => {
  assert.equal(SETTINGS_KEY, 'workspacel.ink:settings');
});

test('readSettings: valid blob', () => {
  assert.deepEqual(readSettings('{"v":1,"org":"acme","delay":2}'), { org: 'acme', delay: 2 });
  assert.deepEqual(readSettings('{"delay":0,"org":"acme.enterprise","v":1}'), { org: 'acme.enterprise', delay: 0 });
  assert.deepEqual(readSettings(serialiseSettings('acme', 10)), { org: 'acme', delay: 10 });
});

test('readSettings: corrupt / wrong-version / invalid blobs are "not set"', () => {
  for (const raw of [
    null,
    undefined,
    '',
    'acme',
    '{',
    'null',
    '1',
    '"acme"',
    '[]',
    '[1,"acme",2]',
    '{}',
    '{"v":2,"org":"acme","delay":2}',
    '{"v":"1","org":"acme","delay":2}',
    '{"v":0,"org":"acme","delay":2}',
    '{"org":"acme","delay":2}',
    '{"v":1,"delay":2}',
    '{"v":1,"org":"acme"}',
    '{"v":1,"org":"ACME","delay":2}',
    '{"v":1,"org":"acme.slack.com","delay":2}',
    '{"v":1,"org":"https://acme.slack.com","delay":2}',
    '{"v":1,"org":"evil.com","delay":2}',
    '{"v":1,"org":"//evil.com","delay":2}',
    '{"v":1,"org":" acme","delay":2}',
    '{"v":1,"org":"","delay":2}',
    '{"v":1,"org":5,"delay":2}',
    '{"v":1,"org":["acme"],"delay":2}',
    '{"v":1,"org":"acme","delay":11}',
    '{"v":1,"org":"acme","delay":-1}',
    '{"v":1,"org":"acme","delay":1.5}',
    '{"v":1,"org":"acme","delay":"2"}',
    '{"v":1,"org":"acme","delay":null}',
    '{"v":1,"org":"acme","delay":2,"extra":true}',
    '{"v":1,"org":"xn--x","delay":2}',
    '{"v":1,"org":"xn--x.enterprise","delay":2}',
    '{"v":1,"org":"app","delay":2}',
    '{"v":1,"org":"www.enterprise","delay":2}',
    '{"v":1,"org":"status","delay":2}',
    '{"v":1,"org":"acme","delay":2,"__proto__":{}}',
  ]) {
    assert.equal(readSettings(raw), null, String(raw));
  }
});

test('serialiseSettings rejects invalid values', () => {
  assert.equal(serialiseSettings('acme', 2), '{"v":1,"org":"acme","delay":2}');
  assert.equal(serialiseSettings('ACME', 2), null);
  assert.equal(serialiseSettings('acme.slack.com', 2), null);
  assert.equal(serialiseSettings('acme', 11), null);
  assert.equal(serialiseSettings('acme', '2'), null);
});
