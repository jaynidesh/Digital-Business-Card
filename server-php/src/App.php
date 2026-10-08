<?php
declare(strict_types=1);

namespace SBMWallet;

function plainResponse(int $status, string $message): array {
    return ['status' => $status, 'headers' => ['Content-Type' => 'text/plain; charset=utf-8', 'Cache-Control' => 'no-store'], 'body' => $message];
}

function walletResponse(string $method, string $path, array $profiles, array $config, ?callable $googlePass = null, ?callable $applePass = null): array {
    if ($method !== 'GET') return plainResponse(405, 'Method not allowed');
    $path = parse_url($path, PHP_URL_PATH) ?: '';
    if (!preg_match('~^/api/v1/public/contact/([A-Za-z0-9_-]{20,})/wallet/(apple|google)$~', $path, $match)) return plainResponse(404, 'Not found');
    $profile = $profiles[$match[1]] ?? null;
    if (!$profile) return plainResponse(404, 'Contact not found');
    $platform = $match[2];
    if (empty($config['publicBaseUrl']) || empty($config[$platform])) return plainResponse(503, 'Wallet pass is not configured');
    if ($platform === 'google') {
        $googlePass ??= __NAMESPACE__ . '\\ensureGooglePass';
        $location = $googlePass($profile, [...$config['google'], 'publicBaseUrl' => $config['publicBaseUrl']]);
        return ['status' => 302, 'headers' => ['Location' => $location, 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer'], 'body' => ''];
    }
    $applePass ??= __NAMESPACE__ . '\\createApplePass';
    $pass = $applePass($profile, [...$config['apple'], 'publicBaseUrl' => $config['publicBaseUrl']]);
    return ['status' => 200, 'headers' => [
        'Content-Type' => 'application/vnd.apple.pkpass',
        'Content-Disposition' => 'attachment; filename="contact.pkpass"',
        'Content-Length' => (string) strlen($pass),
        'Cache-Control' => 'no-store',
    ], 'body' => $pass];
}
