import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

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
  assert.equal(links[0].href, '/api/v1/staff/contact/staff_A/manifest');

  location.pathname = '/contact/pub_B';
  window.updatePwaManifest();
  assert.equal(links[0].href, '/api/v1/public/contact/pub_B/manifest');

  location.pathname = '/';
  window.updatePwaManifest();
  assert.equal(links[0].href, '/manifest.webmanifest');
});
