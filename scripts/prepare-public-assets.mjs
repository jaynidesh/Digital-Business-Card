import { rm } from 'node:fs/promises';

// Remove legacy generated manifests: their filenames reveal bearer tokens and
// Angular's service-worker asset index would otherwise enumerate them publicly.
await rm(new URL('../public/pwa/', import.meta.url), { recursive: true, force: true });
