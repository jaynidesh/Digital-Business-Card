<?php
declare(strict_types=1);
namespace SBMWallet;
use RuntimeException;

function requireSodium(): void {
    if (!extension_loaded('sodium') || !function_exists('sodium_crypto_secretbox') || !function_exists('sodium_crypto_secretbox_open') || !defined('SODIUM_CRYPTO_SECRETBOX_KEYBYTES')) {
        throw new RuntimeException('PHP Sodium extension is required. Enable php_sodium.dll in the php.ini used by IIS FastCGI, then recycle the API application pool.');
    }
}

function encryptProfiles(array $profiles, string $key): string {
    requireSodium();
    if (strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) throw new RuntimeException('Invalid profile encryption key');
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $ciphertext = sodium_crypto_secretbox(json_encode($profiles, JSON_THROW_ON_ERROR), $nonce, $key);
    return json_encode(['version' => 1, 'nonce' => base64_encode($nonce), 'ciphertext' => base64_encode($ciphertext)], JSON_THROW_ON_ERROR);
}

function decryptProfiles(string $encrypted, string $key): array {
    requireSodium();
    if (strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) throw new RuntimeException('Invalid profile encryption key');
    $envelope = json_decode($encrypted, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($envelope) || ($envelope['version'] ?? null) !== 1) throw new RuntimeException('Invalid profile store format');
    $nonce = base64_decode($envelope['nonce'] ?? '', true);
    $ciphertext = base64_decode($envelope['ciphertext'] ?? '', true);
    if ($nonce === false || strlen($nonce) !== SODIUM_CRYPTO_SECRETBOX_NONCEBYTES || $ciphertext === false || strlen($ciphertext) < SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
        throw new RuntimeException('Invalid profile store format');
    }
    $plaintext = sodium_crypto_secretbox_open($ciphertext, $nonce, $key);
    if ($plaintext === false) throw new RuntimeException('Profile store authentication failed');
    $profiles = json_decode($plaintext, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($profiles) || !array_is_list($profiles)) throw new RuntimeException('Invalid profile collection');
    foreach ($profiles as $profile) {
        if (!is_array($profile) || !is_string($profile['publicToken'] ?? null) || !is_string($profile['staffToken'] ?? null)) {
            throw new RuntimeException('Invalid profile record');
        }
    }
    return $profiles;
}

function loadProfiles(string $serviceRoot, array $env): array {
    $path = static function (string $value) use ($serviceRoot): string {
        return preg_match('~^(?:[A-Za-z]:[\\\\/]|/|\\\\\\\\)~', $value) ? $value : $serviceRoot . '/' . $value;
    };
    $keyFile = $path($env['PROFILES_KEY_FILE'] ?? 'private/profiles.key');
    $dataFile = $path($env['PROFILES_FILE'] ?? 'private/profiles.enc.json');
    if (!is_readable($keyFile) || !is_readable($dataFile)) throw new RuntimeException('Encrypted profile store or key is unavailable');
    return decryptProfiles(file_get_contents($dataFile), file_get_contents($keyFile));
}
