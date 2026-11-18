# PHP Wallet service

This directory is a PHP alternative to the existing `server/` Node service. It serves the same two wallet URLs and uses the same profile fixture and `.env` credentials. No Laravel or Composer package is required.

From the project root, run:

```bash
php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php
```

Keep the Angular app running separately with `npm start`. Its existing `/api` proxy targets port 4400. Stop the Node wallet service first, since the two services cannot bind the same port. The PHP service requires PHP 8.1+ with cURL, OpenSSL, GD and Zip extensions, and the `openssl` command on the server. The EXIF extension is used when available to rotate JPEG profile photos correctly.

The entry point is `public/index.php`; only `server-php/public/` should be exposed as the PHP document root. It reads profiles from the project root at `data/mock-profiles.json`, falling back to `dist/data/mock-profiles.json`. It prefers `.env` in the service directory, then falls back to the project-root `.env`; process environment variables take precedence. Relative credential paths resolve against the directory containing the selected `.env`, so the existing project-root setup can still reuse `server/credentials/`. Do not place secrets in `server-php/public/` or the Angular build.

Apple requests create a signed `.pkpass` using the pass certificate, private key and WWDR certificate. The pass includes 90, 180 and 270 pixel PNG thumbnails generated from `profile.photo` when the image loads; an unavailable photo does not prevent pass issuance. Google requests obtain a service-account token, create or update the Generic Pass class and object through Google's Wallet API, then redirect to an ID-only signed save URL. The Google object uses a profile photo as its logo only when it has a public HTTPS URL. Changes to an existing Google pass are sent when its Add to Google Wallet link is opened again. The PHP service needs outbound HTTPS access to Google's OAuth and Wallet Objects APIs and to any remote profile photos.

For production, route `GET /api/v1/public/contact/{public-token}/wallet/{apple|google}` on the same origin as the Angular app to this PHP entry point. Configure your web server to forward those URLs to `public/index.php`; the PHP built-in server does this with the command above. Deploy `server-php/`, `src/assets/images/`, `data/mock-profiles.json`, `.env`, and the credential files together while keeping everything except `server-php/public/` outside the document root. The PHP code uses its own `assets/` images for pass icons and logos and `src/assets/images/` for local profile photos. Unknown tokens return 404 and unconfigured providers return 503.

For a deployment with sibling `api/` and `dist/` directories, place this service in `api/` (entry point `api/public/index.php`). Profile loading first checks `data/mock-profiles.json` in their shared parent directory, then falls back to `dist/data/mock-profiles.json`. The service prefers `api/.env` when present (credential paths then resolve relative to `api/`); otherwise it uses the shared-parent `.env` and resolves credential paths relative to that parent.

Run the offline tests with:

```bash
php server-php/tests/run.php
```

The tests use generated keys and a mocked Google HTTP client; they do not issue live Google passes.

php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php

## UAT deployment: uat-people.sbmgroup.mu

Use this filesystem layout (the parent path is illustrative):

```text
/srv/people/
  dist/                    # contents of the Angular build/ directory
    index.html
    data/mock-profiles.json
    assets/images/...
  api/                     # contents of server-php/
    .env                   # copy .env.example and fill in signing settings
    credentials/...
    public/index.php
    src/...
    assets/...
```

Build with Node 22.12+ using `npm ci` and `npm run build`, then upload the **contents of `build/`** to `dist/`. Upload `server-php/` contents to `api/`. The build includes the profile JSON at `/data/mock-profiles.json`; the frontend loads it at runtime. PHP reads that same file from disk at `dist/data/mock-profiles.json` when the development `data/mock-profiles.json` is absent. Do not leave an outdated `data/` directory beside `dist/`, as that development path takes precedence.

Copy `api/.env.example` to `api/.env`, set `PUBLIC_BASE_URL=https://uat-people.sbmgroup.mu`, and supply the actual Apple and/or Google signing settings. When `api/.env` exists, credential paths such as `credentials/google-service-account.json` resolve relative to `api/`. Otherwise the legacy shared-parent `.env` and relative paths still apply. Process environment variables override file settings. Never upload real credentials into `dist/` or `api/public/`.

The web server must:

- Serve `/` and static files from `dist/`.
- Route `/contact/...` and `/staff/...` to `dist/index.html` for direct links and refreshes.
- Forward `/api` and `/api/...` to `api/public/index.php`, preserving the full original request URI including `/api`.
- Return 404 for missing `/data/` files rather than serving the Angular HTML.
- Expose only the PHP front controller, never `api/.env`, credentials, or source files.

For Nginx, the relevant directives inside your existing HTTPS server block can look like this. Adapt the filesystem path and PHP-FPM socket to your host; retain your existing TLS configuration:

```nginx
root /srv/people/dist;
index index.html;

location ~ ^/api(?:/|$) {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /srv/people/api/public/index.php;
    fastcgi_param DOCUMENT_ROOT /srv/people/api/public;
    fastcgi_param REQUEST_URI $request_uri;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
}
location /data/ {
    add_header Cache-Control "no-store";
    try_files $uri =404;
}
location / {
    try_files $uri $uri/ /index.html;
}
```

If using Apache/IIS instead, configure the equivalent mappings above. The Angular service worker excludes `/api` and `/data` from its navigation fallback. The Angular service worker uses a network-first profile cache: previously loaded data is available offline for up to seven days, with a five-second network timeout. The `/data/` HTTP response should use `Cache-Control: no-store` to avoid a separate stale browser HTTP cache. Offline or slow requests may show the last cached profile. Rebuild when adding or changing tokens so the per-contact PWA manifests are regenerated.

Verify after upload:

1. `/data/mock-profiles.json` returns JSON, and `/contact/{publicToken}` displays that record after a refresh.
2. `/api/` returns `404 Not found`; this is intentional, not a health check or pass endpoint.
3. `/api/v1/public/contact/{publicToken}/wallet/apple` downloads a signed pass when Apple is configured, or returns 503 when it is not.
4. The equivalent `/google` URL redirects to Google Wallet when configured. A 500 requires checking the PHP log entry beginning `Wallet pass generation failed:`.

The public JSON currently contains staff tokens and contact details, and the homepage lists the profiles. These staff links are not an authentication boundary. Restricted staff data requires an authenticated backend rather than this public fixture setup.

Local validation: `npm test` (Node 22.12+ and PHP available), `php server-php/tests/run.php`, and `npm run build`. The deployment regression test constructs the sibling `api/` and `dist/` directories and verifies profile lookup, `api/.env`, local photos, and handling of `/api/` without signing credentials.

## IIS URL Rewrite configuration

Two configuration files are included:

- `public/web.config` (at the repository root) is copied by the Angular build to `build/web.config`. Deploy it as `dist/web.config`.
- `server-php/public/web.config` is deployed as `api/public/web.config` alongside `index.php`.

In IIS Manager:

1. Set the website physical path to the absolute path of `dist`, for example `C:\Sites\People\dist`.
2. Add a child **Application** with alias **api** and physical path `C:\Sites\People\api\public`. The application must point to `public`, not the whole `api` directory. The other PHP files remain in `C:\Sites\People\api\src`, with `.env` in `C:\Sites\People\api`.
3. Install the IIS URL Rewrite module and enable CGI/FastCGI. Configure a PHP handler mapping for `*.php` using the installed `php-cgi.exe` and `FastCgiModule`. No PHP executable path is hardcoded in these files because that path depends on the server.
4. Give the API application-pool identity read access to `api` and `dist/data`, and read access to `dist/assets` for contact photos. Pass generation also needs write access to PHP's temporary directory and permission to run the `openssl` command.
5. Upload the build and PHP files to their respective folders. Keep the full `/api/...` original request URI; PHP matches routes using `REQUEST_URI`.

The app configuration serves actual files and rewrites Angular navigation to `index.html`. It excludes `/api`, data, assets, manifests, and missing file URLs from that fallback. The API configuration rewrites requests to `index.php` and preserves PHP's error responses instead of replacing them with IIS error pages. The API root still intentionally returns `404 Not found`.

A `500.19` error generally indicates an unavailable/locked configuration section or invalid IIS configuration: inspect its detailed error code, check URL Rewrite is installed, and ensure the listed sections are delegated. If PHP source is downloaded or displayed, the FastCGI handler is not configured correctly; correct the mapping before serving the API.

References: [Microsoft URL Rewrite configuration](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/url-rewrite-module-configuration-reference) and [PHP installation on IIS](https://www.php.net/manual/en/install.windows.iis.php).
