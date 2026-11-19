# Profile security implementation

- [x] Add authenticated encrypted profile storage and a CLI; test round trips, tamper/wrong-key rejection and API allowlists.
- [x] Serve individual contacts and manifests through PHP without requiring wallet credentials for lookup; remove public enumeration.
- [x] Replace Angular dataset lookup; remove profile caching and generated manifest indexes; block legacy data URLs in IIS.
- [x] Externalize all CSS and enforce strict CSP; verify production artifacts and public/staff rendering in Chrome.
- [x] Document deployment, private key permissions, legacy cache removal, and token rotation considerations.

Validation: Node suite, PHP wallet/security suites, production build and artifact scan. Local Chrome under the configured CSP rendered public/staff cards with no inline style elements/attributes or observed CSP violations. IIS deployment and live signing remain operator checks.
