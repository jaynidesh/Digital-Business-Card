import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../build/index.html', import.meta.url), new URL('../build/404.html', import.meta.url));
