import { spawnSync } from 'node:child_process';
const php = process.env.PHP_BIN || 'php';
for (const args of [
  ['-l', 'plugins/sitepulse-connector/sitepulse-connector.php'],
  ['-l', 'plugins/sitepulse-connector/uninstall.php'],
  ['-l', 'plugins/sitepulse-connector/security-scanner.php'],
  ['-l', 'plugins/sitepulse-connector/management.php'],
  ['plugins/sitepulse-connector/tests/run.php'],
  ['plugins/sitepulse-connector/tests/security-scanner-test.php'],
  ['plugins/sitepulse-connector/tests/inventory-test.php'],
  ['plugins/sitepulse-connector/tests/management-test.php'],
]) {
  const result = spawnSync(php, args, { stdio: 'inherit' });
  if (result.error) {
    console.error('PHP 8.1+ is required. Set PHP_BIN to its executable.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
