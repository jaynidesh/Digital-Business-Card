<?php
declare(strict_types=1);
namespace SBMWallet;
use InvalidArgumentException;
use RuntimeException;

// TLS authenticates the server and key exchange. This envelope is not user authentication.
function encryptProfilePayload(string $plaintext, string $clientPublicKey, string $path, ?string $opensslConfig = null): array {
    if (strlen($clientPublicKey) > 256) throw new InvalidArgumentException('Invalid response key');
    $der = base64_decode($clientPublicKey, true);
    if ($der === false || strlen($der) !== 91) throw new InvalidArgumentException('Invalid response key');
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $client = openssl_pkey_get_public($pem);
    $details = $client ? openssl_pkey_get_details($client) : false;
    if (!$details || $details['type'] !== OPENSSL_KEYTYPE_EC || ($details['ec']['curve_name'] ?? '') !== 'prime256v1') {
        throw new InvalidArgumentException('Invalid response key');
    }
    // Some PHP/OpenSSL builds validate the generic bit-size before selecting the EC curve.
    $options = ['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1'];
    if ($opensslConfig !== null && $opensslConfig !== '') {
        if (!is_file($opensslConfig) || !is_readable($opensslConfig)) {
            throw new RuntimeException('OpenSSL configuration file is not readable; check OPENSSL_CONF and the IIS application-pool permissions');
        }
        $options['config'] = $opensslConfig;
    }
    // Isolate errors from this operation; log diagnostics without exposing keys or data.
    while (openssl_error_string() !== false) {}
    $server = @openssl_pkey_new($options);
    if (!$server) {
        $errors = [];
        while (($error = openssl_error_string()) !== false) $errors[] = $error;
        throw new RuntimeException('Could not generate response key: ' . ($errors ? implode('; ', $errors) : 'No OpenSSL error details available') . '. Check OPENSSL_CONF points to a valid readable openssl.cnf and P-256 is supported by this PHP/OpenSSL installation.');
    }
    $secret = openssl_pkey_derive($client, $server, 32);
    if ($secret === false) throw new InvalidArgumentException('Invalid response key');
    $salt = random_bytes(32);
    $context = 'sbm-profile-response-v1:' . $path;
    $key = hash_hkdf('sha256', $secret, 32, $context, $salt);
    $iv = random_bytes(12);
    $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $context, 16);
    if ($ciphertext === false) throw new RuntimeException('Response encryption failed');
    $serverPem = openssl_pkey_get_details($server)['key'];
    $serverDer = base64_decode(preg_replace('~-----[^-]+-----|\s~', '', $serverPem), true);
    if ($serverDer === false) throw new RuntimeException('Could not export response key');
    return [
        'version' => 1, 'algorithm' => 'ECDH-P256-HKDF-SHA256-A256GCM',
        'serverPublicKey' => base64_encode($serverDer), 'salt' => base64_encode($salt),
        'iv' => base64_encode($iv), 'ciphertext' => base64_encode($ciphertext . $tag),
    ];
}

function encryptProfileResponse(array $response, string $requestBody, string $path, ?string $opensslConfig = null): array {
    if (strlen($requestBody) > 1024) throw new InvalidArgumentException('Invalid encryption request');
    try { $request = json_decode($requestBody, true, 8, JSON_THROW_ON_ERROR); }
    catch (\JsonException $error) { throw new InvalidArgumentException('Invalid encryption request'); }
    if (!is_array($request) || ($request['version'] ?? null) !== 1 || !is_string($request['clientPublicKey'] ?? null)) {
        throw new InvalidArgumentException('Invalid encryption request');
    }
    if ($response['status'] !== 200) return $response;
    $response['body'] = json_encode(encryptProfilePayload($response['body'], $request['clientPublicKey'], $path, $opensslConfig), JSON_THROW_ON_ERROR);
    return $response;
}
