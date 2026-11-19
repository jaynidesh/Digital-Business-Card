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
        $location = $googlePass($profile, [...$config['google'], 'publicBaseUrl' => $config['publicBaseUrl'], 'includeContactPhoto' => $config['includeContactPhoto'] ?? false]);
        return ['status' => 302, 'headers' => ['Location' => $location, 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer'], 'body' => ''];
    }
    $applePass ??= __NAMESPACE__ . '\\createApplePass';
    $pass = $applePass($profile, [...$config['apple'], 'publicBaseUrl' => $config['publicBaseUrl'], 'includeContactPhoto' => $config['includeContactPhoto'] ?? false]);
    return ['status' => 200, 'headers' => [
        'Content-Type' => 'application/vnd.apple.pkpass',
        'Content-Disposition' => 'attachment; filename="contact.pkpass"',
        'Content-Length' => (string) strlen($pass),
        'Cache-Control' => 'no-store',
    ], 'body' => $pass];
}

function profileResponse(string $method, string $path, array $profiles): array {
    if ($method !== 'GET') return plainResponse(405, 'Method not allowed');
    $path = parse_url($path, PHP_URL_PATH) ?: '';
    if (!preg_match('~^/api/v1/(public|staff)/contact/([A-Za-z0-9_-]{20,})(/manifest)?$~', $path, $match)) return plainResponse(404, 'Not found');
    $field = $match[1] === 'staff' ? 'staffToken' : 'publicToken';
    $profile = null;
    foreach ($profiles as $candidate) {
        if (hash_equals($candidate[$field], $match[2])) { $profile = $candidate; break; }
    }
    if ($profile === null) return plainResponse(404, 'Contact not found');
    if (!empty($match[3])) {
        $route = ($match[1] === 'staff' ? '/staff/' : '/contact/') . $match[2];
        $body = [
            'id' => $route, 'name' => $profile['displayName'] . ' — SBM Contact',
            'short_name' => $profile['displayName'], 'start_url' => $route, 'scope' => $route,
            'display' => 'standalone', 'background_color' => '#e8f0ee', 'theme_color' => '#083f38',
            'icons' => [
                ['src' => '/icons/icon-192x192.png', 'sizes' => '192x192', 'type' => 'image/png'],
                ['src' => '/icons/icon-512x512.png', 'sizes' => '512x512', 'type' => 'image/png'],
            ],
        ];
        $contentType = 'application/manifest+json; charset=utf-8';
    } else {
        // Explicit allowlist: neither staff bearer tokens nor future private fields leave PHP.
        $fields = ['publicToken', 'displayName', 'initials', 'jobTitle', 'department', 'company', 'mobile', 'mobileDisplay', 'office', 'extension', 'email', 'website', 'websiteDisplay', 'address', 'whatsapp', 'socials', 'photo'];
        $body = array_intersect_key($profile, array_flip($fields));
        $contentType = 'application/json; charset=utf-8';
    }
    return ['status' => 200, 'headers' => ['Content-Type' => $contentType, 'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff', 'Referrer-Policy' => 'no-referrer'], 'body' => json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES)];
}
