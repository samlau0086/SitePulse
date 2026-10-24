import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareDeploymentConfiguration } from '../packages/config/src/deployment.ts';

try {
  const files = prepareDeploymentConfiguration(process.env);
  const directory = process.argv[2];
  if (!directory) throw new Error('Configuration output directory is required');
  mkdirSync(directory, { mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content, { mode: 0o600, flag: 'wx' });
  }
  console.info(
    'Deployment configuration validated; protected transfer files prepared.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
