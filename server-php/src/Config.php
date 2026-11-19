<?php
declare(strict_types=1);

namespace SBMWallet;

use RuntimeException;

function loadEnvironment(string $file, array $overrides = []): array {
    $values = [];
    if (is_file($file)) {
        foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $key)) continue;
            $value = trim($value);
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && substr($value, -1) === $value[0]) {
                $value = substr($value, 1, -1);
            } else {
                $value = trim(preg_replace('/\s+#.*$/', '', $value));
            }
            $values[$key] = $value;
        }
    }
    return array_replace($values, $overrides);
}

function configFromEnvironment(array $env, string $root, ?string $provider = null): array {
    $path = static function (?string $value) use ($root): ?string {
        if (!$value) return null;
        return preg_match('~^(?:[A-Za-z]:[\\\\/]|/|\\\\\\\\)~', $value) ? $value : $root . '/' . $value;
    };
    $google = null;
    if ($provider !== 'apple' && !empty($env['GOOGLE_WALLET_ISSUER_ID']) && !empty($env['GOOGLE_WALLET_SERVICE_ACCOUNT_JSON'])) {
        $accountFile = $path($env['GOOGLE_WALLET_SERVICE_ACCOUNT_JSON']);
        $json = @file_get_contents($accountFile);
        if ($json === false) throw new RuntimeException('Cannot read GOOGLE_WALLET_SERVICE_ACCOUNT_JSON; check the configured path and IIS application pool permissions');
        $account = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (empty($account['client_email']) || empty($account['private_key'])) throw new RuntimeException('Google service account is incomplete');
        $google = [
            'issuerId' => $env['GOOGLE_WALLET_ISSUER_ID'],
            'clientEmail' => $account['client_email'],
            'privateKey' => $account['private_key'],
        ];
    }
    $apple = null;
    $appleKeys = ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM', 'APPLE_WWDR_CERT_PEM'];
    if ($provider !== 'google' && count(array_filter($appleKeys, static fn ($key) => !empty($env[$key]))) === count($appleKeys)) {
        $apple = [
            'passTypeId' => $env['APPLE_PASS_TYPE_ID'],
            'teamId' => $env['APPLE_TEAM_ID'],
            'certificatePath' => $path($env['APPLE_PASS_CERT_PEM']),
            'privateKeyPath' => $path($env['APPLE_PASS_KEY_PEM']),
            'wwdrCertificatePath' => $path($env['APPLE_WWDR_CERT_PEM']),
            'privateKeyPassword' => $env['APPLE_PASS_KEY_PASSWORD'] ?? null,
        ];
    }
    return ['includeContactPhoto' => filter_var($env['WALLET_INCLUDE_CONTACT_PHOTO'] ?? false, FILTER_VALIDATE_BOOLEAN), 'publicBaseUrl' => $env['PUBLIC_BASE_URL'] ?? null, 'google' => $google, 'apple' => $apple];
}
