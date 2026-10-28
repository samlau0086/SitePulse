<?php
define('ABSPATH', __DIR__);
require dirname(__DIR__) . '/security-scanner.php';

$root = sys_get_temp_dir() . '/sitepulse-security-' . bin2hex(random_bytes(6));
$uploads = $root . '/uploads';
mkdir($uploads, 0700, true);
file_put_contents($uploads . '/image.php', '<?php echo "fixture";');
file_put_contents($uploads . '/bundle.js', 'eval(atob("fixture"));');
file_put_contents($root . '/command.php8', '<?php system($_REQUEST["run"]);');

$result = SitePulse_Security_Scanner::scan($root, $uploads);
$rules = array_column($result['findings'], 'rule');
if ($result['status'] !== 'complete' || !in_array('php_in_uploads', $rules, true) || !in_array('encoded_eval', $rules, true) || !in_array('command_execution', $rules, true)) {
    throw new RuntimeException('Security scanner contract failed');
}

unlink($uploads . '/image.php');
unlink($uploads . '/bundle.js');
unlink($root . '/command.php8');
file_put_contents($uploads . '/large.php', str_repeat('x', SitePulse_Security_Scanner::MAX_BYTES + 1));
$result = SitePulse_Security_Scanner::scan($root, $uploads);
if ($result['status'] !== 'partial' || $result['skippedFiles'] !== 1) { throw new RuntimeException('Oversized files must produce partial coverage'); }
unlink($uploads . '/large.php');
symlink(__FILE__, $uploads . '/outside.php');
$result = SitePulse_Security_Scanner::scan($root, $uploads);
if ($result['status'] !== 'partial' || $result['scannedFiles'] !== 0) { throw new RuntimeException('Scanner must not follow symbolic links'); }
unlink($uploads . '/outside.php');
rmdir($uploads);
rmdir($root);
echo "Security scanner contract passed. Findings require human review.\n";
