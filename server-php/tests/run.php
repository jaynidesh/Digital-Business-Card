<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Config.php';
require_once __DIR__ . '/../src/WalletPass.php';
require_once __DIR__ . '/../src/GoogleWallet.php';
require_once __DIR__ . '/../src/App.php';

use function SBMWallet\buildGooglePassObject;
use function SBMWallet\createApplePass;
use function SBMWallet\createGoogleSaveUrl;
use function SBMWallet\ensureGooglePass;
use function SBMWallet\loadEnvironment;
use function SBMWallet\walletResponse;

$profile = json_decode(file_get_contents(__DIR__ . '/../../data/mock-profiles.json'), true, 512, JSON_THROW_ON_ERROR)[0];
$keys = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
openssl_pkey_export($keys, $privateKey);
$publicKey = openssl_pkey_get_details($keys)['key'];
$config = [
    'issuerId' => '123456789',
    'clientEmail' => 'wallet@example.test',
    'privateKey' => $privateKey,
    'publicBaseUrl' => 'https://contacts.example.test',
];

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

function run(string $name, callable $test): void {
    $test();
    echo "PASS $name\n";
}

run('environment file preserves quoted secrets and explicit process values', function (): void {
    $file = tempnam(sys_get_temp_dir(), 'wallet-env-');
    file_put_contents($file, "PUBLIC_BASE_URL=https://example.test\nAPPLE_PASS_KEY_PASSWORD=\"secret#value\"\nBACKSLASH_VALUE=\"foo\\bar\"\n");
    try {
        $env = loadEnvironment($file, ['PUBLIC_BASE_URL' => 'https://override.test']);
        check($env['PUBLIC_BASE_URL'] === 'https://override.test', 'process environment should win');
        check($env['APPLE_PASS_KEY_PASSWORD'] === 'secret#value', 'quoted value was altered');
        check($env['BACKSLASH_VALUE'] === 'foo\\bar', 'quoted backslash was altered');
    } finally {
        unlink($file);
    }
});

run('Google pass matches the Node profile fields and URI IDs', function () use ($profile, $config): void {
    $pass = buildGooglePassObject($profile, $config);
    $fields = array_column($pass['textModulesData'], 'body', 'id');
    $links = array_column($pass['linksModuleData']['uris'], 'uri', 'id');
    check($pass['header']['defaultValue']['value'] === $profile['displayName'], 'name missing');
    check($fields['mobile'] === $profile['mobileDisplay'], 'mobile missing');
    check($fields['office'] === $profile['office'] . ' ext. ' . $profile['extension'], 'office missing');
    check($fields['address'] === $profile['address'], 'address missing');
    check($links['contact'] === 'https://contacts.example.test/contact/' . $profile['publicToken'], 'contact URL differs');
    check($links['mobile'] === 'tel:' . $profile['mobile'], 'mobile URI differs');
    check($links['email'] === 'mailto:' . $profile['email'], 'email URI differs');
    check($links['whatsapp'] === 'https://wa.me/' . preg_replace('/\D/', '', $profile['whatsapp']), 'WhatsApp URL differs');
    check(count($links) === 4, 'Google priority link limit differs');
    check($pass['barcode']['alternateText'] === 'Scan contact card', 'QR alternate text missing');
    check($pass['logo']['sourceUri']['uri'] === 'https://contacts.example.test/' . $profile['photo'], 'Google profile logo missing');
    check(count($fields) <= 10, 'text module limit exceeded');
    check(!str_contains(json_encode($pass), $profile['staffToken']), 'staff token leaked');
});

run('Google photo is omitted for local, insecure, or inline sources', function () use ($profile, $config): void {
    $local = buildGooglePassObject($profile, [...$config, 'publicBaseUrl' => 'http://127.0.0.1:4200']);
    check(!isset($local['logo']), 'private HTTP origin should not be a Google image');
    $inline = buildGooglePassObject([...$profile, 'photo' => 'data:image/png;base64,AAAA'], $config);
    check(!isset($inline['logo']), 'inline image should not be a Google image URL');
    $remote = buildGooglePassObject([...$profile, 'photo' => 'https://images.example.test/photo.jpg'], $config);
    check($remote['logo']['sourceUri']['uri'] === 'https://images.example.test/photo.jpg', 'public HTTPS image should be used');
    $spaced = buildGooglePassObject([...$profile, 'photo' => 'assets/images/staff portrait.jpg'], $config);
    check($spaced['logo']['sourceUri']['uri'] === 'https://contacts.example.test/assets/images/staff%20portrait.jpg', 'photo filename was not URL encoded');
});

run('PHP pass assets are deployable without the Node server', function (): void {
    foreach (['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'] as $name) {
        check(is_file(__DIR__ . '/../assets/' . $name), 'PHP pass asset missing: ' . $name);
    }
});

run('Google save URL contains a short signed ID-only JWT', function () use ($profile, $config, $publicKey): void {
    $url = createGoogleSaveUrl($profile, $config);
    check(str_starts_with($url, 'https://pay.google.com/gp/v/save/'), 'save URL differs');
    check(strlen($url) < 1800, 'save URL too long');
    [$header, $payload, $signature] = explode('.', basename($url));
    $jwt = json_decode(base64_decode(strtr($payload, '-_', '+/')), true, 512, JSON_THROW_ON_ERROR);
    check(openssl_verify("$header.$payload", base64_decode(strtr($signature, '-_', '+/')), $publicKey, OPENSSL_ALGO_SHA256) === 1, 'JWT signature invalid');
    check(count($jwt['payload']['genericObjects']) === 1, 'object count differs');
    check(array_keys($jwt['payload']['genericObjects'][0]) === ['id', 'classId'], 'JWT embeds full pass');
});

run('Google creates missing objects and patches existing ones', function () use ($profile, $config): void {
    foreach ([false, true] as $existing) {
        $calls = [];
        $http = function (string $method, string $url, array $headers, ?string $body) use (&$calls, $existing): array {
            $path = parse_url($url, PHP_URL_PATH);
            $calls[] = [$method, $path, $headers, $body];
            if ($path === '/token') return ['status' => 200, 'body' => '{"access_token":"test-token"}'];
            if ($method === 'GET') return ['status' => $existing ? 200 : 404, 'body' => '{}'];
            return ['status' => 200, 'body' => '{}'];
        };
        $url = ensureGooglePass($profile, $config, $http);
        check(str_starts_with($url, 'https://pay.google.com/gp/v/save/'), 'missing save redirect');
        $methods = array_map(fn ($call) => $call[0] . ' ' . $call[1], $calls);
        check(count($methods) === ($existing ? 4 : 5), 'wrong Google request count');
        check(str_starts_with(end($methods), $existing ? 'PATCH /walletobjects/v1/genericObject/' : 'POST /walletobjects/v1/genericObject'), 'wrong object operation');
        $object = json_decode(end($calls)[3], true, 512, JSON_THROW_ON_ERROR);
        check(($object['linksModuleData']['uris'][0]['id'] ?? null) === 'contact', 'Google object links missing');
    }
});

run('Apple thumbnail orientation matches EXIF transpose and transverse', function (): void {
    foreach ([5 => '03/14/25', 7 => '52/41/30'] as $orientation => $expected) {
        $source = imagecreatetruecolor(3, 2);
        for ($y = 0; $y < 2; $y++) {
            for ($x = 0; $x < 3; $x++) {
                imagesetpixel($source, $x, $y, imagecolorallocate($source, 0, 0, ($y * 3 + $x) * 30));
            }
        }
        $oriented = SBMWallet\orientPhoto($source, $orientation);
        $rows = [];
        for ($y = 0; $y < imagesy($oriented); $y++) {
            $row = '';
            for ($x = 0; $x < imagesx($oriented); $x++) {
                $row .= (string) round((imagecolorat($oriented, $x, $y) & 0xff) / 30);
            }
            $rows[] = $row;
        }
        check(implode('/', $rows) === $expected, 'EXIF orientation ' . $orientation . ' is reversed');
        imagedestroy($oriented);
    }
});

run('Apple pass is signed and contains the public QR URL', function () use ($profile): void {
    $dir = sys_get_temp_dir() . '/sbm-php-test-' . bin2hex(random_bytes(8));
    mkdir($dir, 0700);
    try {
        $key = $dir . '/key.pem';
        $cert = $dir . '/cert.pem';
        $wwdr = $dir . '/wwdr.pem';
        $cmd = ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', $key, '-out', $cert, '-days', '1', '-subj', '/CN=Wallet Test'];
        $process = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        stream_get_contents($pipes[1]); fclose($pipes[1]);
        stream_get_contents($pipes[2]); fclose($pipes[2]);
        check(proc_close($process) === 0, 'test certificate failed');
        $wwdrProcess = proc_open(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', $dir . '/wwdr-key.pem', '-out', $wwdr, '-days', '1', '-subj', '/CN=WWDR Test'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        stream_get_contents($pipes[1]); fclose($pipes[1]);
        stream_get_contents($pipes[2]); fclose($pipes[2]);
        check(proc_close($wwdrProcess) === 0, 'WWDR test certificate failed');
        $bytes = createApplePass($profile, [
            'passTypeId' => 'pass.mu.sbm.contact', 'teamId' => 'TEAM123456',
            'certificatePath' => $cert, 'privateKeyPath' => $key, 'wwdrCertificatePath' => $wwdr,
            'publicBaseUrl' => 'https://contacts.example.test',
        ]);
        check(str_starts_with($bytes, 'PK'), 'pass is not ZIP');
        $archive = $dir . '/pass.pkpass';
        file_put_contents($archive, $bytes);
        $zip = new ZipArchive();
        check($zip->open($archive) === true, 'cannot open pass');
        $passJson = $zip->getFromName('pass.json');
        $manifestJson = $zip->getFromName('manifest.json');
        $signature = $zip->getFromName('signature');
        $zip->close();
        $pass = json_decode($passJson, true, 512, JSON_THROW_ON_ERROR);
        $manifest = json_decode($manifestJson, true, 512, JSON_THROW_ON_ERROR);
        check($pass['barcodes'][0]['message'] === 'https://contacts.example.test/contact/' . $profile['publicToken'], 'Apple QR URL differs');
        $back = array_column($pass['generic']['backFields'], 'value', 'key');
        check($back['mobile'] === $profile['mobileDisplay'], 'Apple mobile display differs');
        check($back['office'] === $profile['office'] . ' ext. ' . $profile['extension'], 'Apple office display differs');
        check($back['website'] === $profile['websiteDisplay'], 'Apple website display differs');
        check($manifest['pass.json'] === sha1($passJson), 'manifest hash incorrect');
        foreach (['thumbnail.png' => 90, 'thumbnail@2x.png' => 180, 'thumbnail@3x.png' => 270] as $name => $size) {
            $zip = new ZipArchive();
            check($zip->open($archive) === true, 'cannot inspect pass photo');
            $image = $zip->getFromName($name);
            $zip->close();
            check($image !== false, 'Apple photo missing: ' . $name);
            [$width, $height] = getimagesizefromstring($image);
            check($width === $size && $height === $size, 'Apple photo size differs: ' . $name);
            check($manifest[$name] === sha1($image), 'Apple photo manifest hash differs: ' . $name);
        }
        file_put_contents($dir . '/manifest.json', $manifestJson);
        file_put_contents($dir . '/signature', $signature);
        $verify = proc_open(['openssl', 'cms', '-verify', '-binary', '-inform', 'DER', '-in', $dir . '/signature', '-content', $dir . '/manifest.json', '-noverify', '-out', $dir . '/verified'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        stream_get_contents($pipes[1]); fclose($pipes[1]);
        stream_get_contents($pipes[2]); fclose($pipes[2]);
        check(proc_close($verify) === 0, 'Apple signature invalid');
    } finally {
        foreach (glob($dir . '/*') as $file) unlink($file);
        rmdir($dir);
    }
});

run('Apple pass signs with an encrypted PEM key', function () use ($profile): void {
    $dir = sys_get_temp_dir() . '/sbm-php-encrypted-test-' . bin2hex(random_bytes(8));
    mkdir($dir, 0700);
    try {
        $key = $dir . '/key.pem';
        $cert = $dir . '/cert.pem';
        $wwdr = $dir . '/wwdr.pem';
        foreach ([[$key, $cert, 'Wallet Test'], [$dir . '/wwdr-key.pem', $wwdr, 'WWDR Test']] as [$generatedKey, $generatedCert, $subject]) {
            $process = proc_open(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', $generatedKey, '-out', $generatedCert, '-days', '1', '-subj', '/CN=' . $subject], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            stream_get_contents($pipes[1]); fclose($pipes[1]);
            stream_get_contents($pipes[2]); fclose($pipes[2]);
            check(proc_close($process) === 0, 'test certificate failed');
        }
        $private = openssl_pkey_get_private(file_get_contents($key));
        check(openssl_pkey_export($private, $encrypted, 'test-passphrase', ['encrypt_key_cipher' => OPENSSL_CIPHER_AES_256_CBC]), 'could not encrypt test key');
        file_put_contents($key, $encrypted);
        $bytes = createApplePass($profile, [
            'passTypeId' => 'pass.mu.sbm.contact', 'teamId' => 'TEAM123456',
            'certificatePath' => $cert, 'privateKeyPath' => $key, 'wwdrCertificatePath' => $wwdr,
            'privateKeyPassword' => 'test-passphrase', 'publicBaseUrl' => 'https://contacts.example.test',
        ]);
        $archivePath = $dir . '/encrypted.pkpass';
        file_put_contents($archivePath, $bytes);
        $zip = new ZipArchive();
        check($zip->open($archivePath) === true, 'encrypted-key pass cannot be opened');
        check($zip->getFromName('signature') !== false, 'encrypted-key pass is unsigned');
        check($zip->getFromName('signing-key.pem') === false, 'decrypted key leaked into pass');
        $zip->close();
    } finally {
        foreach (glob($dir . '/*') as $file) unlink($file);
        rmdir($dir);
    }
});

run('route rejects unknown contacts and unconfigured providers', function () use ($profile): void {
    $profiles = [$profile['publicToken'] => $profile];
    $unknown = walletResponse('GET', '/api/v1/public/contact/aaaaaaaaaaaaaaaaaaaa/wallet/apple', $profiles, ['publicBaseUrl' => 'https://contacts.example.test']);
    check($unknown['status'] === 404, 'unknown token should be 404');
    $missing = walletResponse('GET', '/api/v1/public/contact/' . $profile['publicToken'] . '/wallet/apple', $profiles, ['publicBaseUrl' => 'https://contacts.example.test']);
    check($missing['status'] === 503, 'missing credentials should be 503');
    $method = walletResponse('POST', '/api/v1/public/contact/' . $profile['publicToken'] . '/wallet/apple', $profiles, []);
    check($method['status'] === 405, 'POST should be 405');
});

run('route preserves Google redirect and Apple pass response headers', function () use ($profile): void {
    $profiles = [$profile['publicToken'] => $profile];
    $base = '/api/v1/public/contact/' . $profile['publicToken'] . '/wallet/';
    $config = ['publicBaseUrl' => 'https://contacts.example.test', 'google' => ['issuerId' => '123'], 'apple' => ['passTypeId' => 'pass.test']];
    $google = walletResponse('GET', $base . 'google', $profiles, $config, static fn ($contact, $settings) => 'https://pay.google.com/gp/v/save/test');
    check($google['status'] === 302 && $google['headers']['Location'] === 'https://pay.google.com/gp/v/save/test', 'Google redirect differs');
    check($google['headers']['Cache-Control'] === 'no-store', 'Google redirect may be cached');
    $apple = walletResponse('GET', $base . 'apple', $profiles, $config, null, static fn ($contact, $settings) => 'PKtest');
    check($apple['status'] === 200 && $apple['body'] === 'PKtest', 'Apple pass body differs');
    check($apple['headers']['Content-Type'] === 'application/vnd.apple.pkpass', 'Apple MIME type differs');
    check($apple['headers']['Content-Length'] === '6', 'Apple content length differs');
});

echo "All PHP wallet tests passed.\n";
