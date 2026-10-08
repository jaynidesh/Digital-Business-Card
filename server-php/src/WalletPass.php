<?php
declare(strict_types=1);

namespace SBMWallet;

use RuntimeException;
use ZipArchive;

function publicContactUrl(array $profile, string $baseUrl): string {
    $parts = parse_url($baseUrl);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host']) || !in_array($parts['scheme'], ['https', 'http'], true)) {
        throw new RuntimeException('Invalid public base URL');
    }
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return $origin . '/contact/' . rawurlencode($profile['publicToken']);
}

function googlePassIds(array $profile, string $issuerId): array {
    return [
        'classId' => $issuerId . '.staff_contact',
        'objectId' => $issuerId . '.contact_' . substr(hash('sha256', $profile['publicToken']), 0, 32),
    ];
}

function localized(string $value): array {
    return ['defaultValue' => ['language' => 'en-US', 'value' => $value]];
}

function webUrl(?string $value): ?string {
    if (!$value || !filter_var($value, FILTER_VALIDATE_URL)) return null;
    $scheme = strtolower(parse_url($value, PHP_URL_SCHEME) ?: '');
    return in_array($scheme, ['http', 'https'], true) ? $value : null;
}

function privatePhotoHost(string $host): bool {
    $host = strtolower(trim($host, '[]'));
    return $host === '' || $host === 'localhost' || $host === '127.0.0.1' || $host === '::1'
        || str_starts_with($host, '10.') || str_starts_with($host, '192.168.')
        || preg_match('/^172\.(1[6-9]|2\d|3[01])\./', $host) === 1;
}

function encodedPhotoPath(string $path): string {
    $segments = [];
    foreach (explode('/', $path) as $segment) {
        $decoded = rawurldecode($segment);
        if ($decoded === '' || $decoded === '.') continue;
        if ($decoded === '..') {
            array_pop($segments);
            continue;
        }
        $segments[] = rawurlencode($decoded);
    }
    $encoded = '/' . implode('/', $segments);
    return str_ends_with($path, '/') && $encoded !== '/' ? $encoded . '/' : $encoded;
}

function photoUrlTail(array $parts): string {
    $query = isset($parts['query']) ? '?' . str_replace(' ', '%20', $parts['query']) : '';
    $fragment = isset($parts['fragment']) ? '#' . str_replace(' ', '%20', $parts['fragment']) : '';
    return $query . $fragment;
}

function profilePhotoUrl(array $profile, string $publicBaseUrl): ?string {
    $photo = trim($profile['photo'] ?? '');
    if ($photo === '') return null;
    $parts = parse_url($photo);
    if ($parts === false) return null;
    if (isset($parts['scheme'])) {
        if (strtolower($parts['scheme']) !== 'https' || privatePhotoHost($parts['host'] ?? '')) return null;
        $origin = 'https://' . strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '');
        return $origin . encodedPhotoPath($parts['path'] ?? '/') . photoUrlTail($parts);
    }
    $base = parse_url($publicBaseUrl);
    if ($base === false || strtolower($base['scheme'] ?? '') !== 'https' || privatePhotoHost($base['host'] ?? '')) return null;
    $origin = 'https://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '');
    $relative = parse_url('/' . ltrim($photo, '/'));
    if ($relative === false) return null;
    return $origin . encodedPhotoPath($relative['path'] ?? '/') . photoUrlTail($relative);
}

function buildGooglePassObject(array $profile, array $config): array {
    ['classId' => $classId, 'objectId' => $objectId] = googlePassIds($profile, $config['issuerId']);
    $url = publicContactUrl($profile, $config['publicBaseUrl']);
    $text = [];
    $links = [['id' => 'contact', 'uri' => $url, 'description' => 'Open contact card']];
    $addText = static function (string $id, string $header, ?string $value) use (&$text): void {
        if ($value !== null && trim($value) !== '') $text[] = ['id' => $id, 'header' => $header, 'body' => trim($value)];
    };
    $addLink = static function (string $id, string $description, ?string $uri) use (&$links): void {
        if ($uri && count($links) < 4) $links[] = ['id' => $id, 'uri' => $uri, 'description' => $description];
    };
    $addText('mobile', 'Mobile', ($profile['mobileDisplay'] ?? null) ?: ($profile['mobile'] ?? null));
    $addText('office', 'Office', !empty($profile['office']) ? $profile['office'] . (!empty($profile['extension']) ? ' ext. ' . $profile['extension'] : '') : null);
    $addText('email', 'Email', $profile['email'] ?? null);
    $addText('department', 'Department', $profile['department'] ?? null);
    $addText('role', 'Role', $profile['jobTitle'] ?? null);
    $addText('website', 'Website', ($profile['websiteDisplay'] ?? null) ?: ($profile['website'] ?? null));
    $addText('address', 'Address', $profile['address'] ?? null);
    $addText('whatsapp', 'WhatsApp', $profile['whatsapp'] ?? null);
    $addLink('mobile', 'Call mobile', !empty($profile['mobile']) ? 'tel:' . $profile['mobile'] : null);
    $addLink('email', 'Send email', !empty($profile['email']) ? 'mailto:' . $profile['email'] : null);
    $whatsapp = preg_replace('/\D/', '', $profile['whatsapp'] ?? '');
    $addLink('whatsapp', 'Message on WhatsApp', $whatsapp !== '' ? 'https://wa.me/' . $whatsapp : null);
    $object = [
        'id' => $objectId,
        'classId' => $classId,
        'state' => 'ACTIVE',
        'cardTitle' => localized($profile['company']),
        'header' => localized($profile['displayName']),
        'subheader' => localized($profile['jobTitle']),
        'hexBackgroundColor' => '#1E3868',
        'barcode' => ['type' => 'QR_CODE', 'value' => $url, 'alternateText' => 'Scan contact card'],
        'textModulesData' => $text,
        'linksModuleData' => ['uris' => $links],
    ];
    $photoUrl = profilePhotoUrl($profile, $config['publicBaseUrl']);
    if ($photoUrl) {
        $object['logo'] = [
            'sourceUri' => ['uri' => $photoUrl],
            'contentDescription' => localized($profile['displayName'] . ' profile photo'),
        ];
    }
    return $object;
}

function base64Url(string $bytes): string {
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

function signJwt(array $claims, string $privateKey): string {
    $input = base64Url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR)) . '.' . base64Url(json_encode($claims, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    if (!openssl_sign($input, $signature, $privateKey, OPENSSL_ALGO_SHA256)) throw new RuntimeException('JWT signing failed');
    return $input . '.' . base64Url($signature);
}

function createGoogleSaveUrl(array $profile, array $config): string {
    foreach (['issuerId', 'clientEmail', 'privateKey', 'publicBaseUrl'] as $key) {
        if (empty($config[$key])) throw new RuntimeException('Google Wallet is not configured');
    }
    ['classId' => $classId, 'objectId' => $objectId] = googlePassIds($profile, $config['issuerId']);
    $parts = parse_url($config['publicBaseUrl']);
    $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    $claims = [
        'iss' => $config['clientEmail'], 'aud' => 'google', 'typ' => 'savetowallet', 'iat' => time(),
        'origins' => [$origin], 'payload' => ['genericObjects' => [['id' => $objectId, 'classId' => $classId]]],
    ];
    return 'https://pay.google.com/gp/v/save/' . signJwt($claims, $config['privateKey']);
}

function runCommand(array $command, string $directory): void {
    $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, $directory);
    if (!is_resource($process)) throw new RuntimeException('Could not start pass signing');
    stream_get_contents($pipes[1]); fclose($pipes[1]);
    $error = stream_get_contents($pipes[2]); fclose($pipes[2]);
    if (proc_close($process) !== 0) throw new RuntimeException('Pass signing failed: ' . trim($error));
}

function loadProfilePhoto(array $profile): ?string {
    $photo = trim($profile['photo'] ?? '');
    if ($photo === '') return null;
    if (preg_match('~^https?://~i', $photo)) {
        $curl = curl_init($photo);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 15,
        ]);
        $bytes = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        if ($bytes === false || $status < 200 || $status >= 300) throw new RuntimeException('Unable to download contact photo');
        return $bytes;
    }
    if (preg_match('/^[A-Za-z][A-Za-z0-9+.-]*:/', $photo)) throw new RuntimeException('Unsupported contact photo URL');
    $relative = preg_replace('~^assets/~', '', ltrim($photo, '/'));
    $assets = realpath(__DIR__ . '/../../src/assets');
    $path = realpath($assets . '/' . $relative);
    if ($path === false || !str_starts_with($path, $assets . DIRECTORY_SEPARATOR) || !is_file($path)) {
        throw new RuntimeException('Contact photo not found');
    }
    $bytes = file_get_contents($path);
    if ($bytes === false) throw new RuntimeException('Could not read contact photo');
    return $bytes;
}

function orientPhoto(\GdImage $image, int $orientation): \GdImage {
    if (in_array($orientation, [2, 5, 7], true)) imageflip($image, IMG_FLIP_HORIZONTAL);
    if ($orientation === 4) imageflip($image, IMG_FLIP_VERTICAL);
    $degrees = match ($orientation) {
        3 => 180,
        6, 7 => -90,
        5, 8 => 90,
        default => 0,
    };
    if ($degrees === 0) return $image;
    $rotated = imagerotate($image, $degrees, 0);
    if (!$rotated) throw new RuntimeException('Could not rotate contact photo');
    imagedestroy($image);
    return $rotated;
}

function createAppleContactImages(array $profile, string $directory): array {
    $bytes = loadProfilePhoto($profile);
    if ($bytes === null) return [];
    $image = @imagecreatefromstring($bytes);
    if (!$image) throw new RuntimeException('Contact photo has an unsupported image format');
    $sourcePath = $directory . '/contact-source';
    file_put_contents($sourcePath, $bytes);
    $exif = function_exists('exif_read_data') ? @exif_read_data($sourcePath) : false;
    $image = orientPhoto($image, (int) ($exif['Orientation'] ?? 1));
    $side = min(imagesx($image), imagesy($image));
    $left = (int) floor((imagesx($image) - $side) / 2);
    $top = (int) floor((imagesy($image) - $side) / 2);
    $thumbnails = [];
    foreach (['thumbnail.png' => 90, 'thumbnail@2x.png' => 180, 'thumbnail@3x.png' => 270] as $name => $size) {
        $target = imagecreatetruecolor($size, $size);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefill($target, 0, 0, imagecolorallocatealpha($target, 0, 0, 0, 127));
        imagecopyresampled($target, $image, 0, 0, $left, $top, $size, $size, $side, $side);
        ob_start();
        imagepng($target);
        $thumbnails[$name] = ob_get_clean();
        imagedestroy($target);
    }
    imagedestroy($image);
    return $thumbnails;
}

function createApplePass(array $profile, array $config): string {
    foreach (['passTypeId', 'teamId', 'certificatePath', 'privateKeyPath', 'wwdrCertificatePath', 'publicBaseUrl'] as $key) {
        if (empty($config[$key])) throw new RuntimeException('Apple Wallet is not configured');
    }
    $url = publicContactUrl($profile, $config['publicBaseUrl']);
    $pass = [
        'formatVersion' => 1,
        'passTypeIdentifier' => $config['passTypeId'],
        'serialNumber' => substr(hash('sha256', $profile['publicToken']), 0, 32),
        'teamIdentifier' => $config['teamId'],
        'organizationName' => $profile['company'],
        'description' => $profile['displayName'] . ' contact card',
        'logoText' => $profile['company'],
        'backgroundColor' => 'rgb(255,255,255)',
        'foregroundColor' => 'rgb(30,56,104)',
        'labelColor' => 'rgb(212,174,98)',
        'generic' => [
            'primaryFields' => [['key' => 'name', 'label' => 'CONTACT', 'value' => $profile['displayName']]],
            'secondaryFields' => [['key' => 'title', 'label' => 'ROLE', 'value' => $profile['jobTitle']]],
            'auxiliaryFields' => [['key' => 'department', 'label' => 'DEPARTMENT', 'value' => $profile['department']]],
            'backFields' => [
                ['key' => 'mobile', 'label' => 'Mobile', 'value' => ($profile['mobileDisplay'] ?? null) ?: ($profile['mobile'] ?? '')],
                ['key' => 'office', 'label' => 'Office', 'value' => !empty($profile['office']) ? $profile['office'] . (!empty($profile['extension']) ? ' ext. ' . $profile['extension'] : '') : ''],
                ['key' => 'email', 'label' => 'Email', 'value' => $profile['email'] ?? ''],
                ['key' => 'website', 'label' => 'Website', 'value' => ($profile['websiteDisplay'] ?? null) ?: ($profile['website'] ?? '')],
                ['key' => 'card', 'label' => 'Digital contact card', 'value' => $url],
            ],
        ],
        'barcodes' => [['format' => 'PKBarcodeFormatQR', 'message' => $url, 'messageEncoding' => 'iso-8859-1', 'altText' => 'Scan contact card']],
    ];
    $directory = sys_get_temp_dir() . '/sbm-pkpass-' . bin2hex(random_bytes(12));
    if (!mkdir($directory, 0700)) throw new RuntimeException('Could not create pass directory');
    try {
        $files = ['pass.json' => json_encode($pass, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)];
        foreach (['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'] as $name) {
            $files[$name] = file_get_contents(__DIR__ . '/../assets/' . $name);
            if ($files[$name] === false) throw new RuntimeException('Pass asset missing: ' . $name);
        }
        try {
            $files = array_merge($files, createAppleContactImages($profile, $directory));
        } catch (\Throwable $error) {
            error_log('Unable to add Apple Wallet contact photo: ' . $error->getMessage());
        }
        $manifest = [];
        foreach ($files as $name => $bytes) {
            file_put_contents($directory . '/' . $name, $bytes);
            $manifest[$name] = sha1($bytes);
        }
        $manifestJson = json_encode($manifest, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        file_put_contents($directory . '/manifest.json', $manifestJson);
        $keyPath = $config['privateKeyPath'];
        if (!empty($config['privateKeyPassword'])) {
            $key = openssl_pkey_get_private(file_get_contents($keyPath), $config['privateKeyPassword']);
            if (!$key || !openssl_pkey_export($key, $plainKey)) throw new RuntimeException('Could not decrypt Apple pass key');
            $keyPath = $directory . '/signing-key.pem';
            file_put_contents($keyPath, $plainKey);
            chmod($keyPath, 0600);
        }
        runCommand(['openssl', 'cms', '-sign', '-binary', '-in', 'manifest.json', '-signer', $config['certificatePath'], '-inkey', $keyPath, '-certfile', $config['wwdrCertificatePath'], '-outform', 'DER', '-out', 'signature', '-nosmimecap'], $directory);
        $archive = new ZipArchive();
        $archivePath = $directory . '/contact.pkpass';
        if ($archive->open($archivePath, ZipArchive::CREATE) !== true) throw new RuntimeException('Could not create pass ZIP');
        foreach ([...array_keys($files), 'manifest.json', 'signature'] as $name) $archive->addFile($directory . '/' . $name, $name);
        if (!$archive->close()) throw new RuntimeException('Could not finish pass ZIP');
        return file_get_contents($archivePath);
    } finally {
        foreach (glob($directory . '/*') as $file) unlink($file);
        rmdir($directory);
    }
}
