// Standalone fake R2 for browser tests: R2_KEY / R2_SECRET / R2_BUCKET / R2_PORT (default 54500). Prints the endpoint.
import { startFakeR2 } from './fake-r2.js';
const fake = await startFakeR2({ key: process.env.R2_KEY || 'r2-test-key', secret: process.env.R2_SECRET || 'r2-test-secret', bucket: process.env.R2_BUCKET || 'amuwa-files', cors: true, port: Number(process.env.R2_PORT || 54500) });
console.log(`fake R2 listening on ${fake.endpoint}`);
setInterval(() => {}, 1 << 30);
