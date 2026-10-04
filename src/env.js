import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Optional local configuration for the server port and save directory.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
