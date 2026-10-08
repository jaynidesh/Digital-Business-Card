<?php
declare(strict_types=1);

namespace SBMWallet;

use RuntimeException;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const GOOGLE_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

function googleHttp(string $method, string $url, array $headers, ?string $body): array {
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 10,
    ]);
    $result = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($result === false) throw new RuntimeException('Google Wallet HTTP request failed: ' . $error);
    return ['status' => $status, 'body' => $result];
}

function ensureGooglePass(array $profile, array $config, ?callable $http = null): string {
    foreach (['issuerId', 'clientEmail', 'privateKey', 'publicBaseUrl'] as $key) {
        if (empty($config[$key])) throw new RuntimeException('Google Wallet is not configured');
    }
    $http ??= __NAMESPACE__ . '\\googleHttp';
    $object = buildGooglePassObject($profile, $config);
    $now = time();
    $assertion = signJwt([
        'iss' => $config['clientEmail'], 'scope' => GOOGLE_WALLET_SCOPE,
        'aud' => GOOGLE_TOKEN_URL, 'iat' => $now, 'exp' => $now + 3600,
    ], $config['privateKey']);
    $tokenResponse = $http('POST', GOOGLE_TOKEN_URL, ['Content-Type: application/x-www-form-urlencoded'], http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $assertion,
    ]));
    if ($tokenResponse['status'] < 200 || $tokenResponse['status'] >= 300) throw new RuntimeException('Google OAuth token request failed: ' . $tokenResponse['status']);
    $token = json_decode($tokenResponse['body'], true, 512, JSON_THROW_ON_ERROR)['access_token'] ?? null;
    if (!$token) throw new RuntimeException('Google OAuth token response did not contain an access token');
    $request = static function (string $method, string $path, ?array $body = null) use ($http, $token): array {
        $headers = ['Authorization: Bearer ' . $token];
        if ($body !== null) $headers[] = 'Content-Type: application/json';
        return $http($method, GOOGLE_WALLET_API . $path, $headers, $body !== null ? json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) : null);
    };
    $requireSuccess = static function (array $response, string $operation): void {
        if ($response['status'] < 200 || $response['status'] >= 300) throw new RuntimeException('Google Wallet ' . $operation . ' failed: ' . $response['status']);
    };
    $class = $request('GET', '/genericClass/' . rawurlencode($object['classId']));
    if ($class['status'] === 404) {
        $created = $request('POST', '/genericClass', ['id' => $object['classId']]);
        if ($created['status'] !== 409) $requireSuccess($created, 'class creation');
    } else {
        $requireSuccess($class, 'class lookup');
    }
    $objectPath = '/genericObject/' . rawurlencode($object['id']);
    $found = $request('GET', $objectPath);
    $updates = $object;
    unset($updates['id'], $updates['classId']);
    if ($found['status'] === 404) {
        $created = $request('POST', '/genericObject', $object);
        if ($created['status'] === 409) $requireSuccess($request('PATCH', $objectPath, $updates), 'object update');
        else $requireSuccess($created, 'object creation');
    } else {
        $requireSuccess($found, 'object lookup');
        $requireSuccess($request('PATCH', $objectPath, $updates), 'object update');
    }
    return createGoogleSaveUrl($profile, $config);
}
