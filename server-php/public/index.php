<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Config.php';
require_once __DIR__ . '/../src/WalletPass.php';
require_once __DIR__ . '/../src/GoogleWallet.php';
require_once __DIR__ . '/../src/App.php';

use function SBMWallet\configFromEnvironment;
use function SBMWallet\loadEnvironment;
use function SBMWallet\plainResponse;
use function SBMWallet\walletResponse;

$root = dirname(__DIR__, 2);
$keys = ['PUBLIC_BASE_URL', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM', 'APPLE_WWDR_CERT_PEM', 'APPLE_PASS_KEY_PASSWORD'];
$overrides = [];
foreach ($keys as $key) {
    $value = getenv($key);
    if ($value !== false) $overrides[$key] = $value;
}

try {
    $config = configFromEnvironment(loadEnvironment($root . '/.env', $overrides), $root);
    $profiles = json_decode(file_get_contents($root . '/data/mock-profiles.json'), true, 512, JSON_THROW_ON_ERROR);
    $byPublicToken = array_column($profiles, null, 'publicToken');
    $response = walletResponse($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['REQUEST_URI'] ?? '/', $byPublicToken, $config);
} catch (Throwable $error) {
    error_log('Wallet pass generation failed: ' . $error->getMessage());
    $response = plainResponse(500, 'Could not create wallet pass');
}

http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
echo $response['body'];
