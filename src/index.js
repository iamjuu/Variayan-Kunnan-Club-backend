import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { AdminUser } from './models/AdminUser.js';

async function main() {
  await connectDatabase();

  if (env.isProduction && (await AdminUser.exists({ isDevelopmentSeed: true }))) {
    console.error('Refusing to start: the development admin account still exists with its seed password.');
    console.error('Change its password (or delete it) before deploying to production.');
    process.exit(1);
  }

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`VKC Keralotsavam API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

main().catch((error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
