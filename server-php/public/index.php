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
// Reject non-wallet routes before loading credentials or profile data.
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '';
if ($method !== 'GET' || !preg_match('~^/api/v1/public/contact/[A-Za-z0-9_-]{20,}/wallet/(apple|google)$~', $path)) {
    $response = walletResponse($method, $uri, [], []);
    http_response_code($response['status']);
    foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
    echo $response['body'];
    exit;
}
$configRoot = is_file(dirname(__DIR__) . '/.env') ? dirname(__DIR__) : $root;
$keys = ['PUBLIC_BASE_URL', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM', 'APPLE_WWDR_CERT_PEM', 'APPLE_PASS_KEY_PASSWORD'];
$overrides = [];
foreach ($keys as $key) {
    $value = getenv($key);
    if ($value !== false) $overrides[$key] = $value;
}

try {
    $config = configFromEnvironment(loadEnvironment($configRoot . '/.env', $overrides), $configRoot);
    $profilesPath = $root . '/data/mock-profiles.json';
    if (!is_file($profilesPath)) {
        $profilesPath = $root . '/dist/data/mock-profiles.json';
    }
    $profiles = json_decode(file_get_contents($profilesPath), true, 512, JSON_THROW_ON_ERROR);
    $byPublicToken = array_column($profiles, null, 'publicToken');
    $response = walletResponse($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['REQUEST_URI'] ?? '/', $byPublicToken, $config);
} catch (Throwable $error) {
    error_log('Wallet pass generation failed: ' . $error->getMessage());
    $response = plainResponse(500, 'Could not create wallet pass');
}

http_response_code($response['status']);
foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
echo $response['body'];
