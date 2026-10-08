# Digital Staff Contact

Angular digital business cards with interchangeable Node and PHP services for Apple Wallet and Google Wallet passes. Profile data is still a demo fixture; the planned backoffice API is not connected yet.

## Run

```bash
npm install
npm start
```

Open `/` to see three demo profiles.

- Public customer view: `/contact/{public-token}` — no login.
- Staff QR view: `/staff/{staff-token}` — no login.

Each profile has two different opaque tokens. The demo directory at `/` and the profile data are bundled into the frontend, so these links are public identifiers, not access controls. In production, profile lookup and token management must be handled by the backend.

## Wallet passes

The public and staff cards show **Add to Apple Wallet** on iPhone and iPad, **Add to Google Wallet** on Android, and both choices on other devices. The buttons call the same-origin wallet service using the contact's public token. Apple receives a signed `.pkpass`; Google creates or updates the contact's Generic Pass through the Wallet API and redirects to a signed `pay.google.com` save link. A wallet pass contains a QR code linking back to the public card.

The Google pass shows the company, name, role and QR code, with mobile, office, email, department, website, address and WhatsApp text when available. It includes up to four priority links: public card, mobile call, email and WhatsApp. A profile photo is used as its logo only when it resolves to a public HTTPS URL; local and private URLs are skipped. The Apple pass includes profile thumbnails when the image can be loaded, and still signs if the photo is unavailable. The detailed Google object is stored through the Google Wallet API before issuing a short ID-only save link, since embedding all details in the link would exceed Google's recommended JWT length. Open **Add to Google Wallet** again after restarting the Wallet service to update a previously saved pass with the new fields.

The service that issues Wallet passes must hold the signing credentials. You can use the existing Node service or the parallel PHP service; the backoffice can take over this role later. To configure either service:

1. Run `cp .env.example .env` and create `server/credentials/`. Both `.env` and this credential directory are ignored by Git.
2. Put the Apple pass-signing certificate and matching private key in PEM format in that directory, along with the matching Apple WWDR intermediate certificate. Pass Type ID certificates issued by WWDR G4 need the [G4 intermediate from Apple PKI](https://www.apple.com/certificateauthority/); a G3 intermediate will not validate them. If your signing identity is a `.p12`, export its certificate and key to PEM with OpenSSL. Set `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, and `APPLE_WWDR_CERT_PEM` in `.env` to the corresponding identifiers and file paths. Set `APPLE_PASS_KEY_PASSWORD` if the PEM key is encrypted.
3. Put the authorized Google service-account JSON key in the same directory. Set `GOOGLE_WALLET_ISSUER_ID` and `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` in `.env` to the issuer ID and JSON file path.
4. Set `PUBLIC_BASE_URL` to the public HTTPS origin that serves `/contact/{public-token}`. This URL is encoded in both Wallet passes. For Node, keep the default `WALLET_PORT=4400` for the Angular development proxy, or update `proxy.conf.json` if you change it. For PHP, use port 4400 in the `php -S` command below or update that command and the proxy together.

For example, the file path values can be:

```dotenv
APPLE_PASS_CERT_PEM=server/credentials/apple-pass-cert.pem
APPLE_PASS_KEY_PEM=server/credentials/apple-pass-key.pem
APPLE_WWDR_CERT_PEM=server/credentials/apple-wwdr.pem
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=server/credentials/google-service-account.json
```

If Apple supplied a `.p12` signing identity and a DER-format WWDR `.cer`, convert them locally before filling in `.env`:

```bash
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out server/credentials/apple-pass-cert.pem
openssl pkcs12 -in pass.p12 -nocerts -out server/credentials/apple-pass-key.pem
openssl x509 -inform DER -in AppleWWDRCA.cer -out server/credentials/apple-wwdr.pem
```

The private-key export asks you to set a PEM password; put that password in `APPLE_PASS_KEY_PASSWORD`. Keep the original `.p12` and all exported files out of Git.

If OpenSSL reports unsupported encryption when opening an older `.p12`, add `-legacy` immediately after `pkcs12` in both export commands. The Wallet service decrypts a password-protected PEM key in a private temporary directory for signing and removes the temporary file afterward.

The required identifiers and certificates are:

- Apple: a Pass Type ID certificate issued for your Apple Developer team, its private key, and the WWDR certificate used to sign the pass.
- Google: a Wallet issuer ID and a service account authorized for that issuer. Test issuers display a test label until approved.

Run the wallet service and Angular dev server in separate terminals:

```bash
npm run wallet:server
npm start
```

To use the PHP service instead, stop the Node wallet service and run this from the project root in the first terminal:

```bash
php -S 127.0.0.1:4400 -t server-php/public server-php/public/index.php
```

Run `php server-php/tests/run.php` to verify its pass generation. PHP 8.1+ with the cURL, OpenSSL, GD, and Zip extensions, plus the `openssl` command, is required. The PHP service uses the same `.env`, credential paths, profile fixture, and `/api/v1/public/contact/{token}/wallet/{apple|google}` routes as Node, so the Angular proxy needs no change. See [server-php/README.md](server-php/README.md) for deployment details. Run only one wallet service on port 4400 at a time.

Angular proxies `/api` to the local wallet service during development. If you deploy this Node service, deploy `server/`, `src/assets/images/`, and `data/mock-profiles.json` alongside the Angular build, and reverse-proxy `/api/v1/public/contact/{token}/wallet/{apple|google}` to it on the same origin. The Google service account must be authorized for the Wallet issuer and the service needs outbound HTTPS access to Google's OAuth and Wallet Objects APIs. Copy `.env.example` to `.env` before running the service; its start script uses Node's `--env-file=.env` option. Use Node 22.12+ for both Angular and the Wallet service; the Wallet service also runs on Node 20.18.2. OpenSSL and `zip` are required. Requests for unknown tokens return 404; unconfigured wallet providers return 503.

Do not put certificate keys or service account JSON into `public/`, `src/`, or the Angular build. The wallet service resolves a token against `data/mock-profiles.json`; it never signs contact fields submitted by the browser. The demo profile JSON itself is also bundled in the frontend, so the tokens are public identifiers.

The current actions are plain text buttons. Before public release, use the [Apple-provided Wallet badge](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/) and the [Google-provided Wallet button](https://developers.google.com/wallet/generic/resources/brand-guidelines) under their respective brand guidelines. For issuer setup and pass validation, see [Apple pass creation](https://developer.apple.com/documentation/walletpasses/building-a-pass) and [Google Wallet web issuance](https://developers.google.com/wallet/generic/web).

## Backoffice integration

Replace the mock implementation in `PublicProfileService` with the backoffice's public contact endpoint, such as `GET /api/v1/public/contact/{token}`. The backoffice should resolve and manage both public and staff tokens. It can also provide a vCard endpoint in place of the browser-generated file.

Wallet settings belong on whichever server signs the passes: the backoffice if it takes over issuance, or the Node or PHP wallet service if it remains deployed. Keep the Apple certificate and private key, Google issuer ID and service-account key, and public base URL on that server. The Angular frontend only selects the device-appropriate button and calls the same-origin `/api/v1/public/contact/{token}/wallet/{apple|google}` endpoint; it must never receive signing keys. If the backoffice implements these two routes, update the development proxy to point to it and retire the demo wallet services. Until then, both services read `data/mock-profiles.json` rather than the backoffice's authoritative profile store.
