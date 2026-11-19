<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Config.php';
require_once __DIR__ . '/../src/WalletPass.php';
require_once __DIR__ . '/../src/GoogleWallet.php';
require_once __DIR__ . '/../src/App.php';
require_once __DIR__ . '/../src/ProfileStore.php';
require_once __DIR__ . '/../src/ResponseEncryption.php';

use function SBMWallet\encryptProfileResponse;
use function SBMWallet\configFromEnvironment;
use function SBMWallet\loadEnvironment;
use function SBMWallet\loadProfiles;
use function SBMWallet\plainResponse;
use function SBMWallet\profileResponse;
use function SBMWallet\walletResponse;

$serviceRoot = dirname(__DIR__);
$root = dirname($serviceRoot);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '';
$isProfile = preg_match('~^/api/v1/(public|staff)/contact/[A-Za-z0-9_-]{20,}(/manifest)?$~', $path) === 1;
$isWallet = preg_match('~^/api/v1/public/contact/[A-Za-z0-9_-]{20,}/wallet/(apple|google)$~', $path) === 1;

$isContact = $isProfile && !str_ends_with($path, '/manifest');

try {
    if ($method !== ($isContact ? 'POST' : 'GET')) {
        $response = plainResponse(405, 'Method not allowed');
    } elseif (!$isProfile && !$isWallet) {
        $response = plainResponse(404, 'Not found');
    } else {
        $configRoot = is_file($serviceRoot . '/.env') ? $serviceRoot : $root;
        $keys = ['WALLET_INCLUDE_CONTACT_PHOTO', 'OPENSSL_CONF', 'PUBLIC_BASE_URL', 'PROFILES_FILE', 'PROFILES_KEY_FILE', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON', 'APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM', 'APPLE_WWDR_CERT_PEM', 'APPLE_PASS_KEY_PASSWORD'];
        $overrides = [];
        foreach ($keys as $key) {
            $value = getenv($key);
            if ($value !== false) $overrides[$key] = $value;
        }
        $env = loadEnvironment($configRoot . '/.env', $overrides);
        $profiles = loadProfiles($serviceRoot, $env);
        if ($isProfile) {
            // Contact lookup does not depend on wallet signing credentials.
            $response = profileResponse('GET', $uri, $profiles);
            if ($isContact) {
                $body = file_get_contents('php://input', false, null, 0, 1025);
                $response = encryptProfileResponse($response, $body, $path, $env['OPENSSL_CONF'] ?? null);
            }
        } else {
            $config = configFromEnvironment($env, $configRoot, basename($path));
            $response = walletResponse($method, $uri, array_column($profiles, null, 'publicToken'), $config);
        }
    }
} catch (InvalidArgumentException $error) {
    $response = plainResponse(400, 'Invalid encryption request');
} catch (Throwable $error) {
    error_log(($isWallet ? 'Wallet pass generation failed: ' : 'Contact lookup failed: ') . $error->getMessage());
    $response = plainResponse(500, $isWallet ? 'Could not create wallet pass' : 'Contact service unavailable');
}

http_response_code($response['status']);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
foreach ($response['headers'] as $name => $value) header($name . ': ' . $value);
echo $response['body'];
