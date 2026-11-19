# PHP contact and Wallet service

This is the backend for the secured Angular app. It serves individual contact records and PWA manifests, and signs Apple/Google Wallet passes. It reads an authenticated encrypted profile store; there is no plaintext JSON fallback or listing endpoint. PHP 8.1+ with Sodium, OpenSSL, cURL and Zip is required. GD is needed for optional contact thumbnails, and EXIF is optional for photo orientation. Local signing tests use the `openssl` executable.

## UAT deployment: uat-people.sbmgroup.mu

```text
C:\Sites\People\
  dist\                         # contents of build/, served at /
    index.html
    web.config
    assets\...
  api\                          # contents of server-php/
    .env
    private\                    # never mapped to an HTTP URL
      profiles.enc.json
      profiles.key
    credentials\...
    src\...
    assets\...
    public\                     # IIS /api application physical path
      index.php
      web.config
```

1. Build with Node 22.12+ (`npm ci`, `npm run build`). The build fails if it finds profile tokens, datasets, legacy per-contact manifest files, or inline styles/scripts in HTML.
2. Encrypt the current source data locally or on a secured administration host:

   ```text
   php server-php/tools/encrypt-profiles.php data/mock-profiles.json
   ```

   This creates `server-php/private/profiles.enc.json` and a random 32-byte `profiles.key`. It reuses the existing key on updates and writes a fresh random nonce each time. Both files are ignored by Git. A custom private output directory can be supplied as a second argument. The source JSON is an administration input only: do not upload it under `dist` or any web root.
3. Deploy `build/` contents to `dist/`, and `server-php/` contents to `api/`. Transfer the encrypted store and key separately through your approved secure deployment channel. Restrict the key's NTFS ACL to the API application-pool identity and authorized administrators; on Windows, `chmod` is not a replacement for NTFS ACL configuration. Prefer placing the key in a separate protected location and set `PROFILES_KEY_FILE` to its absolute path. Back up it securely: losing it makes the encrypted store unreadable.
4. Copy `api/.env.example` to `api/.env` and configure `PUBLIC_BASE_URL=https://uat-people.sbmgroup.mu` and the Apple/Google signing settings. `PROFILES_FILE` and `PROFILES_KEY_FILE` default to `private/profiles.enc.json` and `private/profiles.key`, relative to `api/`; absolute Windows paths are supported. Other credential paths resolve relative to the selected `.env` directory. `api/.env` takes precedence over the legacy parent `.env`; process environment variables override file values.
5. Set the IIS website physical path to `dist`. Add a child **Application** named `api`, pointing to `api/public`, not the whole `api` directory. Install IIS URL Rewrite, enable CGI/FastCGI, and map `*.php` to the installed `php-cgi.exe` via `FastCgiModule`. Executable paths and FastCGI settings are host-specific and are not hardcoded in `web.config`.
6. Grant the application-pool identity read access to the encrypted store, key, PHP source, credentials and `dist/assets`. Apple signing uses PHP's OpenSSL extension and needs write access to PHP's temp directory. Google issuance needs outbound HTTPS to Google APIs.

## Required migration from the public JSON version

Deploy these changes together; the old frontend JSON lookup is incompatible with the secured backend.

- Remove the old `dist/data/` and `dist/pwa/` directories from the server. Uploading files over an existing deployment does not remove stale files. The new IIS configuration also blocks `/data` and `/pwa`, including files left behind accidentally.
- Replace the frontend build, `ngsw.json`, worker files, and both IIS configurations. Use a clean `dist` deployment. Verify the old JSON URL returns 404, not JSON or SPA HTML.
- Clear the site's stored data/service-worker caches on previously used devices and reopen the app. Old installed app versions may retain the previously public JSON and manifest indexes until those caches are removed. The new version deliberately does not cache contact API responses: offline contact lookup is no longer supported.
- Previously published tokens/data cannot be made secret retroactively. Rotate public/staff tokens and reissue links/QR codes if those tokens must now act as access capabilities. This change does not rotate existing links automatically.

## Data protection and endpoints

The encrypted store uses PHP Sodium `secretbox` authenticated encryption with a random key and nonce. Tampering or a wrong key fails closed. The key never enters the frontend bundle or an API response. TLS protects responses in transit; configure HTTPS on IIS using your existing certificate.

Available endpoints (no login required):

| URL | Response |
| --- | --- |
| `POST /api/v1/public/contact/{publicToken}` | Encrypted allowlisted contact, excluding its staff token |
| `POST /api/v1/staff/contact/{staffToken}` | Encrypted allowlisted contact, excluding its staff token |
| `GET` either contact URL followed by `/manifest` | That card's PWA install manifest |
| `/api/v1/public/contact/{publicToken}/wallet/apple` | Signed `.pkpass` |
| `/api/v1/public/contact/{publicToken}/wallet/google` | Redirect to Google Wallet |

There is no endpoint that enumerates contacts. The homepage no longer lists staff cards. Contact and manifest responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Profile lookup does not require valid wallet credentials. `/api/` intentionally returns `404 Not found`; missing provider configuration returns 503. For a 500, check the PHP log (`Contact lookup failed:` or `Wallet pass generation failed:`).

A person who possesses a contact or staff link can read that contact's displayed details; this is bearer-link access, not staff authentication. If staff cards require verified employee identity, add SSO/authorization. Do not log complete bearer-token paths in analytics, proxies or IIS logs; apply the organization's log redaction/retention policy. Public contact photos remain publicly served assets.

## Strict Content Security Policy

`public/web.config` in the repository is copied into `build/web.config`. It applies a CSP without `unsafe-inline` or `unsafe-eval`; inline style attributes and script handlers are blocked. Component CSS is bundled into external stylesheets with component-host selector scoping. Critical CSS and font inlining are disabled. API rewrites live in `server-php/public/web.config`.

The allowed image sources are same-origin, `data:` for QR codes, and `https://media.licdn.com` for the existing remote profile photos. Additional remote images require a deliberate CSP allowlist change or hosting the images locally. The headers are enforced by IIS; `ng serve` does not read `web.config`.

Keep `index.html`, contact routes and all static assets on the app's origin. The IIS application mapping preserves the original `/api/...` request URI for PHP route matching. A `500.19` error requires inspecting the IIS detailed error code for missing URL Rewrite or locked configuration sections. Configure PHP FastCGI correctly before exposing the application.

## Local development and validation

Generate the private store, then run:

```text
php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php
npm start
```

The Angular proxy forwards `/api` to port 4400. Use PHP for the secured frontend: the legacy Node wallet-only service does not implement encrypted contact lookup or manifests.

Checks:

```text
npm test
php server-php/tests/run.php
php server-php/tests/profile-security.php
npm run build
```

Tests cover encrypted round trips, tamper/wrong-key rejection, response allowlists, lookup without wallet credentials, deployed directory layout, CSP source constraints and existing wallet signing behavior. Validate runtime CSP enforcement and real Apple/Google issuance on IIS after deployment.

References: [PHP authenticated encryption](https://www.php.net/manual/en/function.sodium-crypto-secretbox.php), [Angular build configuration](https://angular.dev/reference/configs/workspace-config), [IIS URL Rewrite](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/url-rewrite-module-configuration-reference), [PHP on IIS](https://www.php.net/manual/en/install.windows.iis.php).

## Encrypted contact responses (no authentication)

Angular creates a fresh, non-extractable ECDH P-256 private key for each contact lookup. It POSTs `{ "version": 1, "clientPublicKey": "<base64 SPKI public key>" }` to the contact URL. PHP generates its own ephemeral P-256 key, derives the shared secret, uses HKDF-SHA-256 with a random 32-byte salt, and encrypts the allowlisted contact JSON with AES-256-GCM (12-byte IV, 16-byte tag). The protocol context includes the exact endpoint path for both HKDF and authenticated additional data.

The response is an envelope with `version`, `algorithm`, `serverPublicKey`, `salt`, `iv`, and `ciphertext` (base64 ciphertext followed by its authentication tag). Angular derives the same key and decrypts in memory before displaying the card. Keys are never embedded in JavaScript or stored in local/session storage. Requests use a fresh key pair; decryption failure has no plaintext fallback. Direct GET contact requests return 405. Error responses contain only generic plaintext errors, never contact details.

Deploy the frontend and PHP changes together, and permit POST through IIS/FastCGI/request filtering. No new persistent response-encryption key or `.env` setting is needed. HTTPS remains mandatory: TLS authenticates the exchange, and browser Web Crypto requires a secure context (localhost is permitted for development). This extra encryption does not replace HTTPS or restrict who can open a card. Anyone with a valid token can create their own key pair and decrypt that contact; browser users can inspect the displayed plaintext.

PWA manifests, Wallet files and Google redirects keep their browser/platform-required formats. Manifests still contain the card name and install URL. Existing links and QR codes remain valid; there is no authentication step.

Interoperability tests run PHP encryption against the same TypeScript Web Crypto decryption code used by Angular, plus actual PHP HTTP POSTs. They cover ciphertext tampering, a wrong private key, a different endpoint context, malformed requests, plaintext GET rejection and unchanged manifest delivery.

Protocol references: [Web Crypto ECDH/HKDF](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [PHP ECDH](https://www.php.net/openssl-pkey-derive), [PHP HKDF](https://www.php.net/hash-hkdf).

## IIS 405 on encrypted contact POST

If the response is the IIS HTML page `405 - HTTP verb used to access this page is not allowed`, with `Allow: GET, HEAD, OPTIONS, TRACE`, check the server mapping before changing application code. That response indicates IIS handling, commonly the StaticFile handler. A service-worker label in Chrome does not mean the worker generated the error.

In IIS Manager, select the **api application**, then verify:

1. **Basic Settings:** alias `api`, physical path ending in `api\public`. It must be a child application beneath the frontend site, not an ordinary directory under `dist`.
2. **URL Rewrite:** the `Wallet PHP front controller` rule from `api/public/web.config` must be present and rewrite the application-relative URL to `index.php`. No parent/global SPA fallback may intercept `/api` first.
3. **Handler Mappings:** the effective `*.php` mapping must use `FastCgiModule` with the actual installed `php-cgi.exe`. Open **Edit → Request Restrictions → Verbs** and ensure `GET,HEAD,POST` are permitted. In **View Ordered List**, the PHP mapping must be able to handle `index.php` rather than falling through to StaticFile. Do not add POST to the StaticFile handler.
4. **Request Filtering → HTTP Verbs:** verify POST is not denied by an inherited policy. Have the IIS administrator adjust the API application's policy if necessary; do not broadly enable all verbs.
5. Verify the deployed PHP files include `src/ResponseEncryption.php` and the current `public/index.php` with POST contact routing.

Diagnostic requests (replace TOKEN with an existing public token):

```powershell
curl.exe -i "https://uat-people.sbmgroup.mu/api/index.php"
curl.exe -i -X POST "https://uat-people.sbmgroup.mu/api/v1/public/contact/TOKEN" -H "Content-Type: application/json" --data "{}"
```

The first should reach PHP and return plain `404 Not found`. With the encrypted profile store configured, the second should return plain `400 Invalid encryption request`, because the diagnostic body intentionally lacks a public key. An application-generated 500 instead requires checking PHP's log/store configuration. An IIS HTML 405 still means the handler/rewrite configuration is unresolved. If both mappings appear correct, inspect IIS Failed Request Tracing or the detailed error's **Module** and **Handler** fields to identify which module rejected POST.

Reference: [Microsoft IIS 405 troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/developer/webapps/iis/site-behavior-performance/http-error-405-website).


## Undefined SODIUM_CRYPTO_SECRETBOX_KEYBYTES on IIS

This means the PHP runtime handling the request has not loaded Sodium. In the PHP installation selected by the API's FastCGI handler, enable `extension=php_sodium.dll` in the active `php.ini`. Verify `extension_dir` points to that installation's `ext` directory and that `php_sodium.dll` is present from the matching PHP distribution. Check IIS FastCGI's `PHPRC` setting if CLI and web requests use different configuration files. Recycle the API application pool after the change and retry the contact request. If loading still fails, inspect PHP startup errors for DLL/dependency/version issues.

Keep the existing encrypted store and key; enabling the extension does not require generating a new key. The application now logs an explicit Sodium configuration error instead of accessing an undefined constant. See [PHP's Windows Sodium installation instructions](https://www.php.net/manual/en/sodium.installation.php).


## Could not generate response key on IIS

This error comes from OpenSSL creating the ephemeral P-256 response key, after the profile store has been decrypted. A missing/unreadable `openssl.cnf` is one possible Windows cause; the updated PHP error log includes the underlying OpenSSL errors to distinguish configuration problems from unavailable EC/provider support.

Locate the valid `openssl.cnf` supplied with your PHP/OpenSSL installation. Set its actual absolute path in `api/.env`, for example (only if that file exists):

```ini
OPENSSL_CONF=C:/PHP/extras/ssl/openssl.cnf
```

Deploy the updated `api/src/ResponseEncryption.php` and `api/public/index.php`. Give the API application-pool identity read access to the configuration file, recycle the pool and retry. The app passes this setting explicitly to PHP key generation; `.env` files do not automatically populate process environment variables. A process-level `OPENSSL_CONF`, if configured, overrides `.env` as with the other settings.

Use your organization's existing OpenSSL/provider policy; do not replace it with an arbitrary configuration or enable legacy algorithms. If the error persists, collect the complete new `Contact lookup failed: Could not generate response key: ...` log line. Do not regenerate the profile-storage key: it is unrelated to this ephemeral response key.

Reference: [PHP OpenSSL Windows configuration requirements](https://www.php.net/manual/en/openssl.installation.php).
