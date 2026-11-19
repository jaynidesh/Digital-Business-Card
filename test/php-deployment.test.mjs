import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the PHP entry point in the deployed sibling api/dist layout.
test('PHP deployment resolves profiles, configuration, and photos outside its public root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sbm-deployment-'));
  try {
    await mkdir(join(root, 'api/public'), { recursive: true });
    await mkdir(join(root, 'dist/data'), { recursive: true });
    await mkdir(join(root, 'dist/assets/images'), { recursive: true });
    await cp('server-php/src', join(root, 'api/src'), { recursive: true });
    await cp('server-php/public/index.php', join(root, 'api/public/index.php'));
    execFileSync('php', ['server-php/tools/encrypt-profiles.php', 'data/mock-profiles.json', join(root, 'api/private')]);
    await writeFile(join(root, 'api/.env'), 'PUBLIC_BASE_URL=https://uat-people.sbmgroup.mu\n');
    await writeFile(join(root, 'dist/assets/images/photo.jpg'), 'photo bytes');
    const profiles = JSON.parse(await readFile('data/mock-profiles.json', 'utf8'));
    const env = { PATH: process.env.PATH };
    const request = (uri) => execFileSync('php', ['-r',
      '$_SERVER["REQUEST_URI"]=$argv[2]; ob_start(); include $argv[1]; $body=ob_get_clean(); echo json_encode([http_response_code(),$body,($config["publicBaseUrl"] ?? null)]);',
      join(root, 'api/public/index.php'), uri], { encoding: 'utf8', env });
    assert.deepEqual(JSON.parse(request(`/api/v1/public/contact/${profiles[0].publicToken}/wallet/apple`)),
      [503, 'Wallet pass is not configured', 'https://uat-people.sbmgroup.mu']);
    assert.equal(JSON.parse(request('/api/v1/public/contact/aaaaaaaaaaaaaaaaaaaa/wallet/apple'))[0], 404);
    const photo = execFileSync('php', ['-r',
      'require $argv[1]; echo SBMWallet\\loadProfilePhoto(["photo"=>"assets/images/photo.jpg"]);',
      join(root, 'api/src/WalletPass.php')], { encoding: 'utf8', env });
    assert.equal(photo, 'photo bytes');
    const contact = JSON.parse(request(`/api/v1/public/contact/${profiles[0].publicToken}`));
    assert.equal(contact[0], 405); // No plaintext GET contact response.
    assert.equal(JSON.parse(request(`/api/v1/public/contact/${profiles[0].publicToken}/manifest`))[0], 200);
    assert.equal(JSON.parse(request('/data/mock-profiles.json'))[0], 404);
    // Invalid configuration must not turn a non-wallet URL into a generation error.
    await writeFile(join(root, 'api/.env'), 'GOOGLE_WALLET_ISSUER_ID=test\nGOOGLE_WALLET_SERVICE_ACCOUNT_JSON=missing.json\n');
    const rootResponse = execFileSync('php', ['-r',
      '$_SERVER["REQUEST_URI"]="/api/"; register_shutdown_function(function(){echo "|".http_response_code();}); include $argv[1];',
      join(root, 'api/public/index.php')], { encoding: 'utf8', env });
    assert.equal(rootResponse, 'Not found|404');
    assert.equal(JSON.parse(request(`/api/v1/public/contact/${profiles[0].publicToken}/manifest`))[0], 200);
    await rm(join(root, 'api/private/profiles.key'));
    assert.equal(JSON.parse(request(`/api/v1/public/contact/${profiles[0].publicToken}/manifest`))[0], 500);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
