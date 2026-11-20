# Digital Staff Contact

Angular digital business cards backed by PHP for encrypted contact lookup, PWA manifests, and Apple/Google Wallet passes. The legacy Node wallet-only service remains available for development. Profile administration still uses a local source fixture; the planned backoffice is not connected yet.

## Run

```bash
npm install
npm start
```

The homepage does not list profiles. Open an issued `/contact/{publicToken}` or `/staff/{staffToken}` link. Generate the encrypted store and start the PHP backend as described in [the deployment guide](server-php/README.md).

- Public customer view: `/contact/{public-token}` — no login.
- Staff QR view: `/staff/{staff-token}` — no login.

Each profile has two different opaque bearer tokens. PHP returns only the requested contact and excludes its staff token. There is no public directory or bundled dataset. Possession of a link permits viewing that contact; staff authentication/SSO is not implemented. Rotate previously exposed tokens if link secrecy is required.

## Updating mock profile data

After editing `data/mock-profiles.json`, run the existing encryption script from the project root (PHP 8.1+ with Sodium is required):

```bash
php server-php/tools/encrypt-profiles.php data/mock-profiles.json
```

The script validates the records and replaces `server-php/private/profiles.enc.json`. It reuses `server-php/private/profiles.key` if present; otherwise it creates a new key. Keep the existing key when updating data for an already deployed server: the encrypted file must be generated with the same key that server uses.

For the UAT layout (`C:\Sites\People\`), upload these files through the secure deployment channel:

| Local file | Server destination | When to upload |
| --- | --- | --- |
| `server-php/private/profiles.enc.json` | `C:\Sites\People\api\private\profiles.enc.json` | Every profile-data update. |
| `server-php/private/profiles.key` | `C:\Sites\People\api\private\profiles.key` | Initial setup only, or a deliberate key rotation together with its matching encrypted file. Keep the deployed key for routine updates. |

If the server configures `PROFILES_FILE` or `PROFILES_KEY_FILE` in `.env`, use those configured destinations instead. Keep the key outside the web root and preserve its restricted permissions. Never upload the plaintext `data/mock-profiles.json` into `dist/` or another public directory.

For profile-field changes only, no Angular build or frontend upload is required. Refresh the affected contact page while online after replacing the encrypted file and verify the updated details. For local development, run the same encryption command and refresh the page with the PHP backend running.

If the update also adds or changes bundled photos or other frontend assets, run `npm run build` and deploy the updated `build/` contents to `C:\Sites\People\dist\` as well. If you change a public or staff token, distribute the corresponding new links and QR codes.

See [the PHP deployment guide](server-php/README.md) for initial server setup. The legacy Node wallet-only service reads the JSON fixture directly and must be restarted after fixture changes; it does not serve the secured contact frontend.

## Install as an app

Each public contact page and staff QR page gets its install manifest from the PHP API. Manifests are not generated as publicly indexed files. The app shell is installable, but contact lookup requires a network connection; contact API responses are not cached.

The app shows a small **Install Our App** popup only on a resolved staff page (`/staff/{staff-token}`). It does not appear on public contact pages or the dashboard. When Chrome or Edge reports that the staff page is installable, **Install App** opens the browser's native prompt; **Maybe Later** hides the popup for the rest of that browser tab's session. iPhone and iPad visitors see **Share → Add to Home Screen** steps; if their browser does not offer that action, they can open the page in Safari. Safari on macOS shows **File → Add to Dock** guidance. The popup stays hidden in standalone mode and while a staff card is loading or unavailable. Browsers that cannot offer a native prompt do not show a nonfunctional Install button. The existing service worker caches app assets only; it does not cache wallet API responses or private customer data.

To check the installation flow, build and deploy with `npm run build`, open a specific staff URL directly, and wait for the popup. Confirm that the dashboard and corresponding public contact URL show no popup. A native install event is offered only on the page where the browser emitted it; reload the staff card after navigating from another page if needed. On Android Chrome or desktop Chrome/Edge, choose **Install App**, accept or dismiss the browser prompt, then verify a new installed icon launches that staff URL. On iPhone/iPad, follow the displayed Share-menu steps and launch the saved icon. Test **Maybe Later** by navigating and reloading in the same tab, then opening a new browser session. An installed standalone window should never show the popup. Browser installation prompts are controlled by the browser and may not appear when the app is already installed or fails installability checks.

On Android, open the **production build on a publicly reachable HTTPS site** in Chrome, then use **Install app**. `http://<local-ip>:4200` is not a secure origin, so **Add to Home screen** may only create a browser shortcut. The normal `npm start` also disables Angular's service worker. Your server must serve the manifest and icons at their built URLs and return the Angular `index.html` for direct `/contact/...` and `/staff/...` requests. Remove any old home-screen shortcut or installation made with the root manifest before testing a specific page again.

For local service-worker testing, create a certificate for your LAN IP that the Android device trusts, then run `npm run pwa:preview`. This command serves the production Angular configuration over HTTPS using `.certs/lan.pem` and `.certs/lan-key.pem`; those files are ignored by Git. With `mkcert` installed, run `mkdir -p .certs` and `mkcert -cert-file .certs/lan.pem -key-file .certs/lan-key.pem <local-ip>`. Use `mkcert -CAROOT` to locate its `rootCA.pem`, then install that CA certificate on the Android device; trusting it on the computer alone is insufficient. Local HTTPS is useful for testing, but Android may still make a shortcut if its WebAPK service cannot install the app from a private LAN address.

## Wallet passes

The public and staff cards show **Add to Apple Wallet** on iPhone and iPad, **Add to Google Wallet** on Android, and both choices on other devices. The buttons call the same-origin wallet service using the contact's public token. Apple receives a signed `.pkpass`; Google creates or updates the contact's Generic Pass through the Wallet API and redirects to a signed `pay.google.com` save link. A wallet pass contains a QR code linking back to the public card.

The Google pass shows the company, name, role and QR code, with mobile, office, email, department, website, address and WhatsApp text when available. It includes up to four priority links: public card, mobile call, email and WhatsApp. A profile photo is used as its logo only when it resolves to a public HTTPS URL; local and private URLs are skipped. The Apple pass includes profile thumbnails when the image can be loaded, and still signs if the photo is unavailable. The detailed Google object is stored through the Google Wallet API before issuing a short ID-only save link, since embedding all details in the link would exceed Google's recommended JWT length. Open **Add to Google Wallet** again after restarting the Wallet service to update a previously saved pass with the new fields.

The PHP service implements the secured frontend APIs and holds Wallet signing credentials. The legacy Node service supports wallet issuance only, not the new encrypted contact APIs. The backoffice can take over this role later. Wallet configuration:

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

Do not put certificate keys or service account JSON into `public/`, `src/`, or the Angular build. The PHP service resolves a token against its encrypted private profile store; it never signs contact fields submitted by the browser. The source JSON must not be deployed into the frontend. Previously exposed tokens should be rotated if their secrecy is required.

The current actions are plain text buttons. Before public release, use the [Apple-provided Wallet badge](https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/) and the [Google-provided Wallet button](https://developers.google.com/wallet/generic/resources/brand-guidelines) under their respective brand guidelines. For issuer setup and pass validation, see [Apple pass creation](https://developer.apple.com/documentation/walletpasses/building-a-pass) and [Google Wallet web issuance](https://developers.google.com/wallet/generic/web).

## Backoffice integration

The frontend loads one contact through an encrypted PHP POST response and decrypts it in memory using an ephemeral browser key. No login is required. Profile data is encrypted at rest outside the web root; the build contains neither the dataset nor token-bearing manifests. For the UAT `dist/` + `api/` layout, follow [the PHP deployment guide](server-php/README.md#uat-deployment-uat-peoplesbmgroupmu).

Replace the mock implementation in `PublicProfileService` with the backoffice's public contact endpoint, such as `GET /api/v1/public/contact/{token}`. The backoffice should resolve and manage both public and staff tokens. It can also provide a vCard endpoint in place of the browser-generated file.

Wallet settings belong on whichever server signs the passes: the backoffice if it takes over issuance, or the Node or PHP wallet service if it remains deployed. Keep the Apple certificate and private key, Google issuer ID and service-account key, and public base URL on that server. The Angular frontend only selects the device-appropriate button and calls the same-origin `/api/v1/public/contact/{token}/wallet/{apple|google}` endpoint; it must never receive signing keys. If the backoffice implements these two routes, update the development proxy to point to it and retire the demo wallet services. Until then, the PHP service reads its encrypted profile store; the legacy Node wallet service still uses the development JSON fixture.
