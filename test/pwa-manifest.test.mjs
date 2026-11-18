import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { generatePwaManifests } from '../scripts/generate-pwa-manifests.mjs';

test('each contact and staff page gets a distinct install identity and launch URL', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sbm-pwa-manifest-'));
  try {
    await generatePwaManifests([
      { displayName: 'Alice Smith', publicToken: 'pub_A', staffToken: 'staff_A' },
      { displayName: 'Bob Jones', publicToken: 'pub_B', staffToken: 'staff_B' }
    ], {
      name: 'SBM Contact', short_name: 'SBM Contact', start_url: '/', display: 'standalone',
      icons: [{ src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }]
    }, output);

    const publicAlice = JSON.parse(await readFile(join(output, 'contact/pub_A.webmanifest'), 'utf8'));
    const staffAlice = JSON.parse(await readFile(join(output, 'staff/staff_A.webmanifest'), 'utf8'));
    const publicBob = JSON.parse(await readFile(join(output, 'contact/pub_B.webmanifest'), 'utf8'));
    assert.equal(publicAlice.id, '/contact/pub_A');
    assert.equal(publicAlice.start_url, '/contact/pub_A');
    assert.equal(publicAlice.scope, '/contact/pub_A');
    assert.equal(staffAlice.id, '/staff/staff_A');
    assert.equal(staffAlice.start_url, '/staff/staff_A');
    assert.equal(staffAlice.scope, '/staff/staff_A');
    assert.equal(publicBob.id, '/contact/pub_B');
    assert.equal(publicBob.scope, '/contact/pub_B');
    assert.equal(new Set([publicAlice.id, staffAlice.id, publicBob.id]).size, 3);
    assert.equal(publicAlice.name, 'Alice Smith — SBM Contact');
    assert.deepEqual(publicAlice.icons.map(icon => icon.src), ['/icons/icon-192x192.png', '/icons/icon-512x512.png']);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('regeneration removes manifests for contacts removed from the fixture', async () => {
  const output = await mkdtemp(join(tmpdir(), 'sbm-pwa-stale-'));
  try {
    await mkdir(join(output, 'contact'), { recursive: true });
    await writeFile(join(output, 'contact/old_token.webmanifest'), '{}');
    await generatePwaManifests([
      { displayName: 'Alice Smith', publicToken: 'pub_A', staffToken: 'staff_A' }
    ], { icons: [] }, output);
    await assert.rejects(readFile(join(output, 'contact/old_token.webmanifest')), { code: 'ENOENT' });
    await readFile(join(output, 'contact/pub_A.webmanifest'));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('the page selects its manifest on direct load and after client navigation', async () => {
  const script = await readFile(new URL('../public/pwa-manifest.js', import.meta.url), 'utf8');
  const links = [];
  const location = { pathname: '/staff/staff_A' };
  const window = { location };
  const document = {
    createElement: tag => ({ tag }),
    head: { appendChild: link => links.push(link) }
  };
  runInNewContext(script, { document, window, location });
  assert.equal(links.length, 1);
  assert.equal(links[0].rel, 'manifest');
  assert.equal(links[0].href, '/pwa/staff/staff_A.webmanifest');

  location.pathname = '/contact/pub_B';
  window.updatePwaManifest();
  assert.equal(links[0].href, '/pwa/contact/pub_B.webmanifest');

  location.pathname = '/';
  window.updatePwaManifest();
  assert.equal(links[0].href, '/manifest.webmanifest');
});
