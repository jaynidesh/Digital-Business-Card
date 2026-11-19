import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory = new URL('../build/', import.meta.url);
const profiles = JSON.parse(await readFile(new URL('../data/mock-profiles.json', import.meta.url), 'utf8'));
const files = [];
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const child = join(path, item.name);
    if (item.isDirectory()) await walk(child); else files.push(child);
  }
}
await walk(directory.pathname);
for (const file of files) {
  assert.ok(!/\/(?:data|pwa)\//.test(file.slice(directory.pathname.length - 1)), `Private data/legacy manifest published: ${file}`);
  if (!/\.(?:html|js|json|css|webmanifest)$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  for (const profile of profiles) {
    for (const token of [profile.publicToken, profile.staffToken]) {
      assert.ok(!source.includes(token), `Contact token leaked into ${file}`);
    }
  }
  if (file.endsWith('.html')) {
    assert.doesNotMatch(source, /<style\b|\sstyle\s*=|\son\w+\s*=/i, `Inline CSS or handlers in ${file}`);
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(match[1], /\bsrc\s*=/i, `Inline script in ${file}`);
      assert.equal(match[2].trim(), '', `Inline script content in ${file}`);
    }
  }
}
const worker = JSON.parse(await readFile(new URL('ngsw.json', directory), 'utf8'));
assert.equal(worker.dataGroups.length, 0, 'Profile cache must not survive in the new service-worker configuration');
console.log('Security build checks passed: no profile tokens/datasets, legacy manifests, inline HTML styles/scripts, or profile data cache.');
