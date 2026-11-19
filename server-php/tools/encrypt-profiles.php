<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/ProfileStore.php';
use function SBMWallet\encryptProfiles;
use function SBMWallet\decryptProfiles;
use function SBMWallet\requireSodium;
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
try {
    requireSodium();
    $input = $argv[1] ?? null;
    if (!$input) throw new RuntimeException('Usage: php server-php/tools/encrypt-profiles.php INPUT_JSON [PRIVATE_OUTPUT_DIRECTORY]');
    $directory = $argv[2] ?? dirname(__DIR__) . '/private';
    $profiles = json_decode(file_get_contents($input), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($profiles) || !array_is_list($profiles)) throw new RuntimeException('Expected a profile array');
    if (!is_dir($directory) && !mkdir($directory, 0700, true)) throw new RuntimeException('Cannot create private directory');
    $keyFile = $directory . '/profiles.key';
    if (!is_file($keyFile)) {
        $keyHandle = fopen($keyFile, 'x');
        if (!$keyHandle) throw new RuntimeException('Cannot create key file');
        chmod($keyFile, 0600);
        try {
            if (fwrite($keyHandle, random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES)) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) throw new RuntimeException('Cannot write key');
        } finally { fclose($keyHandle); }
    }
    $key = file_get_contents($keyFile);
    $encrypted = encryptProfiles($profiles, $key);
    decryptProfiles($encrypted, $key); // Validate records before replacing the store.
    $temporary = tempnam($directory, 'profiles-');
    try {
        chmod($temporary, 0600);
        if (file_put_contents($temporary, $encrypted) === false || !rename($temporary, $directory . '/profiles.enc.json')) throw new RuntimeException('Cannot save encrypted profiles');
    } finally { if (is_file($temporary)) unlink($temporary); }
    echo "Encrypted profile store saved. Keep its key private and outside the web root.\n";
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
