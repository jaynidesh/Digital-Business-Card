import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWallets } from '../src/app/public-contact/wallet-platform.ts';

test('iPhone and iPad show Apple Wallet', () => {
  assert.deepEqual(visibleWallets('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), ['apple']);
  assert.deepEqual(visibleWallets('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5), ['apple']);
});

test('Android shows Google Wallet', () => {
  assert.deepEqual(visibleWallets('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), ['google']);
});

test('desktop and unknown devices show both options', () => {
  assert.deepEqual(visibleWallets('Mozilla/5.0 (Windows NT 10.0)'), ['apple', 'google']);
  assert.deepEqual(visibleWallets(''), ['apple', 'google']);
});
