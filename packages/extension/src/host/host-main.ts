import { fileURLToPath } from 'node:url';

// The entry each child of an app host runs: one package, its parts (docs/part-image.md).
export const HOST_MAIN = fileURLToPath(new URL('./main.js', import.meta.url));
