import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as sass from 'sass';

const read = path => readFileSync(path, 'utf8');
const filesIn = path => readdirSync(path, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesIn(join(path, entry.name)) : [join(path, entry.name)]);

test('production emits external CSS without critical CSS or font inlining', () => {
  const build = JSON.parse(read('angular.json')).projects['digital-contact'].architect.build;
  assert.equal(build.configurations.production.optimization.styles.inlineCritical, false);
  assert.equal(build.configurations.production.optimization.fonts.inline, false);
  assert.ok(!build.options.assets.some(asset => typeof asset === 'object' && asset.input === 'data'));
  const css = sass.compile('src/styles.scss').css;
  for (const host of ['app-public-contact', 'app-staff-card', 'app-examples', 'app-pwa-install']) {
    assert.ok(css.includes(host), `Missing external styles for ${host}`);
  }
  assert.ok(!css.includes(':host'));
  assert.match(css, /\.clipboard-fallback\s*\{/);
});

test('Angular source does not inject component or attribute styles', () => {
  for (const path of filesIn('src').filter(path => /\.(ts|html)$/.test(path))) {
    const source = read(path);
    assert.doesNotMatch(source, /\b(?:styleUrls?|styles)\s*:/, path);
    assert.doesNotMatch(source, /\bstyle\s*=|\[style(?:\.|\])|\[ngStyle\]|\.style\.[\w]+\s*=/, path);
  }
});

test('IIS serves a strict CSP with only required image origins', () => {
  const config = read('public/web.config');
  const policy = config.match(/<add name="Content-Security-Policy" value="([^"]+)"/)[1];
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|\*/);
  for (const directive of ["script-src 'self'", "style-src 'self'", "style-src-attr 'none'", "script-src-attr 'none'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(policy.split(';').map(value => value.trim()).includes(directive));
  }
  assert.ok(policy.includes("img-src 'self' data: https://media.licdn.com"));
});
