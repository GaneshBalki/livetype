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

// 4.5.0
const { regexRun, splitWords, convertCase, textStats, mdToHtml, hashText, uuid7, uuidInfo } = await import('../js/toolcore.js');
let r = regexRun('(\\d+)-(?<w>[a-z]+)', 'g', 'a 12-ab 3-c', '[$<w>]');
assert.equal(r.matches.length, 2);
assert.deepEqual([r.matches[0].index, r.matches[0].text, r.matches[0].groups[0], r.matches[1].named.w], [2, '12-ab', '12', 'c']);
assert.equal(r.replaced, 'a [ab] [c]');
assert.equal(regexRun('a', '', 'aaa').matches.length, 1);
assert.equal(regexRun('x*', 'g', 'abc').matches.length, 4);
assert.ok(regexRun('(', 'g', 'x').error);
assert.equal(regexRun('a', 'g', 'a'.repeat(5000)).capped, true);
assert.deepEqual(splitWords('HTTPServer_userID-name value'), ['HTTP', 'Server', 'user', 'ID', 'name', 'value']);
assert.equal(convertCase('hello world\nuser_id', 'camel'), 'helloWorld\nuserId');
assert.equal(convertCase('helloWorld', 'constant'), 'HELLO_WORLD');
assert.equal(convertCase('my-var name', 'title'), 'My Var Name');
const st = textStats("Hello world. It's a test!\n\nSecond para here");
assert.deepEqual([st.words, st.sentences, st.paragraphs, st.lines], [8, 3, 2, 3]);
assert.equal(textStats('').words, 0);
assert.equal(mdToHtml('# Hi *there*'), '<h1>Hi <em>there</em></h1>');
assert.equal(mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
assert.equal(mdToHtml('[x](javascript:alert(1))').includes('href'), false);
assert.ok(mdToHtml('[x](https://a.com/?a=1&b=2)').includes('href="https://a.com/?a=1&amp;b=2"'));
assert.equal(mdToHtml('[x](" onmouseover=alert(1))').includes('onmouseover="'), false);
assert.equal(mdToHtml('- a\n- [x] **b**'), '<ul><li>a</li><li><input type="checkbox" disabled checked> <strong>b</strong></li></ul>');
assert.equal(mdToHtml('```js\nif (a<b) {}\n```'), '<pre><code class="lang-js">if (a&lt;b) {}</code></pre>');
assert.equal(mdToHtml('`*x*` and snake_case_name'), '<p><code>*x*</code> and snake_case_name</p>');
assert.ok(mdToHtml('| a | b |\n|---|---|\n| 1 | 2 |').includes('<th>a</th>'));
assert.ok(mdToHtml('> quote <b>').startsWith('<blockquote><p>quote &lt;b&gt;'));
assert.equal(await hashText('abc', 'SHA-256'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const u = uuid7(1764253800000);
assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(uuidInfo(u).date.getTime(), 1764253800000);
assert.equal(uuidInfo(crypto.randomUUID()).version, 4);
assert.equal(uuidInfo('c232ab00-9414-11ec-b3c8-9e6bdeced846').date.toISOString(), '2022-02-22T19:22:22.000Z');
assert.equal(uuidInfo('nope'), null);
console.log('tools 4.5 ok');
assert.equal(regexRun('(', 'g', 'x').error, 'Unterminated group');
