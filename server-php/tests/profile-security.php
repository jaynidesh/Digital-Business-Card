<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/ProfileStore.php';
require_once __DIR__ . '/../src/App.php';
use function SBMWallet\encryptProfiles;
use function SBMWallet\decryptProfiles;
use function SBMWallet\profileResponse;
function expect(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$profiles = [[
    'publicToken' => str_repeat('p', 24), 'staffToken' => str_repeat('s', 24),
    'displayName' => 'Security Test', 'email' => 'test@example.test',
    'privateNote' => 'never publish',
]];
$key = random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
$encrypted = encryptProfiles($profiles, $key);
expect(!str_contains($encrypted, 'Security Test'), 'plaintext leaked into encrypted data');
expect(decryptProfiles($encrypted, $key) === $profiles, 'round trip failed');
foreach (['wrong key', 'tampered data'] as $case) {
    try {
        $input = $encrypted;
        if ($case === 'tampered data') {
            $data = json_decode($input, true);
            $bytes = base64_decode($data['ciphertext']);
            $bytes[0] = chr(ord($bytes[0]) ^ 1);
            $data['ciphertext'] = base64_encode($bytes);
            $input = json_encode($data);
        }
        decryptProfiles($input, $case === 'wrong key' ? random_bytes(32) : $key);
        throw new LogicException('Decryption accepted ' . $case);
    } catch (RuntimeException $error) {
        expect(!($error instanceof LogicException), 'invalid ciphertext accepted');
    }
}
foreach (['public' => str_repeat('p',24), 'staff' => str_repeat('s',24)] as $kind => $token) {
    $result = profileResponse('GET', "/api/v1/$kind/contact/$token", $profiles);
    expect($result['status'] === 200, 'known contact not found');
    $body = json_decode($result['body'],true);
    expect($body['displayName'] === 'Security Test', 'wrong contact');
    expect(!isset($body['staffToken'], $body['privateNote']), 'private fields leaked');
    expect(!array_key_exists('staffToken', $body) && !array_key_exists('privateNote', $body), 'private field leaked');
    expect($result['headers']['Cache-Control'] === 'no-store', 'profile may be cached');
}
expect(profileResponse('GET', '/api/v1/public/contact/' . str_repeat('s',24), $profiles)['status'] === 404, 'staff token accepted publicly');
expect(profileResponse('GET', '/api/v1/public/contact/' . str_repeat('z',24), $profiles)['status'] === 404, 'unknown contact accepted');
expect(profileResponse('GET', '/api/v1/public/contact', $profiles)['status'] === 404, 'listing exposed');
expect(profileResponse('POST', '/api/v1/public/contact/' . str_repeat('p',24), $profiles)['status'] === 405, 'POST accepted');
$manifest = profileResponse('GET', '/api/v1/staff/contact/' . str_repeat('s',24) . '/manifest', $profiles);
expect($manifest['status'] === 200, 'manifest missing');
expect(json_decode($manifest['body'],true)['start_url'] === '/staff/' . str_repeat('s',24), 'manifest route differs');
echo "All profile security tests passed.\n";
