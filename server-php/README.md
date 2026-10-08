# PHP Wallet service

This directory is a PHP alternative to the existing `server/` Node service. It serves the same two wallet URLs and uses the same profile fixture and `.env` credentials. No Laravel or Composer package is required.

From the project root, run:

```bash
php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php
```

Keep the Angular app running separately with `npm start`. Its existing `/api` proxy targets port 4400. Stop the Node wallet service first, since the two services cannot bind the same port. The PHP service requires PHP 8.1+ with cURL, OpenSSL, GD and Zip extensions, and the `openssl` command on the server. The EXIF extension is used when available to rotate JPEG profile photos correctly.

The entry point is `public/index.php`; only `server-php/public/` should be exposed as the PHP document root. It reads `.env` and `data/mock-profiles.json` from the project root, with process environment variables taking precedence over `.env`. Credential file paths in `.env` are resolved relative to the project root, so the files already in `server/credentials/` can be reused. Do not place secrets in `server-php/public/` or the Angular build.

Apple requests create a signed `.pkpass` using the pass certificate, private key and WWDR certificate. The pass includes 90, 180 and 270 pixel PNG thumbnails generated from `profile.photo` when the image loads; an unavailable photo does not prevent pass issuance. Google requests obtain a service-account token, create or update the Generic Pass class and object through Google's Wallet API, then redirect to an ID-only signed save URL. The Google object uses a profile photo as its logo only when it has a public HTTPS URL. Changes to an existing Google pass are sent when its Add to Google Wallet link is opened again. The PHP service needs outbound HTTPS access to Google's OAuth and Wallet Objects APIs and to any remote profile photos.

For production, route `GET /api/v1/public/contact/{public-token}/wallet/{apple|google}` on the same origin as the Angular app to this PHP entry point. Configure your web server to forward those URLs to `public/index.php`; the PHP built-in server does this with the command above. Deploy `server-php/`, `src/assets/images/`, `data/mock-profiles.json`, `.env`, and the credential files together while keeping everything except `server-php/public/` outside the document root. The PHP code uses its own `assets/` images for pass icons and logos and `src/assets/images/` for local profile photos. Unknown tokens return 404 and unconfigured providers return 503.

Run the offline tests with:

```bash
php server-php/tests/run.php
```

The tests use generated keys and a mocked Google HTTP client; they do not issue live Google passes.

php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php
