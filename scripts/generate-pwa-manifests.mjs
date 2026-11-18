import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function generatePwaManifests(profiles, baseManifest, outputDirectory) {
  for (const [kind, field] of [['contact', 'publicToken'], ['staff', 'staffToken']]) {
    const expected = new Set(profiles.map(profile => `${profile[field]}.webmanifest`));
    const directory = join(outputDirectory, kind);
    await mkdir(directory, { recursive: true });
    for (const filename of await readdir(directory)) {
      if (filename.endsWith('.webmanifest') && !expected.has(filename)) {
        await unlink(join(directory, filename));
      }
    }
  }
  for (const profile of profiles) {
    for (const [kind, token] of [['contact', profile.publicToken], ['staff', profile.staffToken]]) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error(`Invalid ${kind} token for PWA manifest`);
      }
      const path = `/${kind}/${token}`;
      const manifest = {
        ...baseManifest,
        id: path,
        name: `${profile.displayName} — SBM Contact`,
        short_name: profile.displayName,
        start_url: path,
        scope: path,
        icons: baseManifest.icons.map(icon => ({ ...icon, src: `/${icon.src.replace(/^\/+/, '')}` }))
      };
      const directory = join(outputDirectory, kind);
      await writeFile(join(directory, `${token}.webmanifest`), JSON.stringify(manifest, null, 2) + '\n');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const profiles = JSON.parse(await readFile(join(root, 'data/mock-profiles.json'), 'utf8'));
  const baseManifest = JSON.parse(await readFile(join(root, 'public/manifest.webmanifest'), 'utf8'));
  await generatePwaManifests(profiles, baseManifest, join(root, 'public/pwa'));
}
