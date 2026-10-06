# Digital Staff Contact — Front App

Angular public-facing digital business card. This deliberately excludes the back-office and Laravel API for now.

## Run

```bash
npm install
npm start
```

Open `/` to see three demo profiles.

- Public customer view: `/contact/{public-token}` — no login.
- Staff QR view: `/staff/{staff-token}` — no login.

Each profile has two different opaque tokens. The demo directory at `/` and the profile data are bundled into the frontend, so these links are public identifiers, not access controls. In production, profile lookup and token management must be handled by the backend.

## Backend integration

Replace the mock implementation in `PublicProfileService` with `GET /api/v1/public/contact/{token}` and replace the browser-generated vCard with the Laravel vCard endpoint when available.
