// Run: node web/test/tools.test.mjs
import assert from 'node:assert/strict';
import { jsonFormat, b64encode, b64decode, urlEncode, urlDecode, urlParts, jwtDecode, parseTime, relative } from '../js/toolcore.js';

// JSON
assert.equal(jsonFormat('{"b":1,"a":[1,2]}').out, '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
assert.equal(jsonFormat('{"b":1,"a":{"d":1,"c":2}}', { sort: true, minify: true }).out, '{"a":{"c":2,"d":1},"b":1}');
assert.equal(jsonFormat('[1]', { indent: 'tab' }).out, '[\n\t1\n]');
let e = jsonFormat('{\n  "a": 1,\n  "b": 2,\n}');
assert.ok(e.error && e.line === 4 && e.col === 1, JSON.stringify(e));
e = jsonFormat('{"a":');
assert.ok(e.error && e.line === 1, JSON.stringify(e));

// Base64
assert.equal(b64encode('héllo 👋'), 'aMOpbGxvIPCfkYs=');
assert.equal(b64encode('héllo 👋', true), 'aMOpbGxvIPCfkYs');
assert.equal(b64decode('aMOpbGxvIPCfkYs'), 'héllo 👋');
assert.equal(b64decode(' aMOp\nbGxv '), 'héllo');
assert.throws(() => b64decode('ab$c'), /not Base64/);
assert.throws(() => b64decode('abcde'), /cut short/);
assert.throws(() => b64decode('/w=='), /not text/);
assert.equal(b64decode(b64encode('x'.repeat(100000))).length, 100000);

// URL
assert.equal(urlEncode('a b&c=d/é'), 'a%20b%26c%3Dd%2F%C3%A9');
assert.equal(urlEncode('https://x.com/a b?q=1&r=é', false), 'https://x.com/a%20b?q=1&r=%C3%A9');
assert.equal(urlDecode('a+b%20c'), 'a+b c');
assert.equal(urlDecode('a+b%20c', true), 'a b c');
assert.throws(() => urlDecode('100%'), /broken %/);
const p = urlParts('https://devshire.in:8080/a%20b?q=hello%20world&q=2&x#top');
assert.deepEqual([p.protocol, p.host, p.path, p.hash], ['https', 'devshire.in:8080', '/a b', 'top']);
assert.deepEqual(p.params, [['q', 'hello world'], ['q', '2'], ['x', '']]);
assert.equal(urlParts('just text'), null);

// JWT
const tok = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const j = jwtDecode('Bearer ' + tok);
assert.equal(j.header.alg, 'HS256');
assert.equal(j.payload.iat, 1516239022);
assert.equal(j.signature.length, 43);
assert.throws(() => jwtDecode('abc'), /three parts/);
assert.throws(() => jwtDecode('e30.!!!.x'), /payload is not valid Base64/);
assert.throws(() => jwtDecode('e30.bm90IGpzb24.x'), /payload is not valid JSON/);

// Time
assert.equal(parseTime('1516239022').date.toISOString(), '2018-01-18T01:30:22.000Z');
assert.equal(parseTime('1516239022000').unit, 'milliseconds');
assert.equal(parseTime('1516239022000000').date.getTime(), 1516239022000);
assert.equal(parseTime('2026-11-27T14:30:00Z').date.getTime(), Date.UTC(2026, 10, 27, 14, 30));
assert.ok(parseTime('2026-11-27 14:30'));
assert.equal(parseTime('nope'), null);
assert.equal(relative(new Date(0), 3 * 86400000), '3 days ago');
assert.equal(relative(new Date(7200000), 0), 'in 2 hours');

console.log('tools ok');
