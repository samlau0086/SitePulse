<?php
// Standalone WordPress doubles exercise the actual expanded inventory sender.
define('ABSPATH', __DIR__);
define('WP_CONTENT_DIR', __DIR__);
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', true);
$options = array('active_plugins' => array('example/main.php'));
$sent = null;
function is_multisite() { return false; }
function add_action(...$args) {}
function register_activation_hook(...$args) {}
function register_deactivation_hook(...$args) {}
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function update_option($key, $value, $autoload = null) { if ($autoload !== false) { throw new RuntimeException('Scan must not autoload'); } $GLOBALS['options'][$key] = $value; }
function get_plugins() { return array('example/main.php' => array('Name' => 'Example', 'Version' => '1.0'), 'inactive/main.php' => array('Name' => 'Inactive', 'Version' => '2.0', 'UpdateURI' => 'https://vendor.test')); }
function get_site_transient($key) { return $key === 'update_plugins' ? (object) array('response' => array('example/main.php' => (object) array('id' => 'w.org/plugins/example', 'new_version' => '1.1'))) : (object) array('response' => array()); }
function get_core_updates($args) { return array(); }
function sanitize_key($value) { return strtolower(preg_replace('/[^a-zA-Z0-9_-]/', '', $value)); }
function sanitize_text_field($value) { return strip_tags($value); }
class InventoryTheme {
    public function __construct(private $slug) {}
    public function get_stylesheet() { return $this->slug; }
    public function get($key) { return array('Name' => 'Theme', 'Version' => '1.0', 'ThemeURI' => 'https://wordpress.org/themes/' . $this->slug . '/')[$key] ?? ''; }
}
function wp_get_theme() { return new InventoryTheme('active'); }
function wp_get_themes() { return array('active' => new InventoryTheme('active'), 'inactive' => new InventoryTheme('inactive')); }
function wp_upload_dir(...$args) { return array('basedir' => __DIR__ . '/missing-uploads'); }
function wp_get_environment_type() { return 'production'; }
function force_ssl_admin() { return true; }
function get_bloginfo($key) { return '6.7.1'; }
function wp_parse_url($value) { return parse_url($value); }
function wp_json_encode($value) { return json_encode($value); }
function wp_safe_remote_post($url, $args) { $GLOBALS['sent'] = json_decode($args['body'], true); return array(); }
function is_wp_error($value) { return false; }
function wp_remote_retrieve_response_code($response) { return 200; }
function wp_remote_retrieve_body($response) { return '{"success":true}'; }
require dirname(__DIR__) . '/sitepulse-connector.php';
SitePulse_Connector::inventory(array('origin' => 'https://pulse.example.test', 'site_id' => '00000000-0000-4000-8000-000000000001', 'credential' => str_repeat('S', 43)));
if (count($sent['installedPlugins']) !== 2 || count($sent['installedThemes']) !== 2 || count($sent['activePlugins']) !== 1 || count($sent['activeThemes']) !== 1) { throw new RuntimeException('Installed inventory must include inactive components'); }
if ($sent['installedPlugins'][0]['source'] !== 'wordpress.org' || $sent['installedPlugins'][0]['updateVersion'] !== '1.1' || $sent['installedPlugins'][1]['source'] !== 'unknown') { throw new RuntimeException('Source/update metadata contract failed'); }
if (!$sent['environment']['wpDebug'] || !$sent['environment']['wpDebugDisplay'] || !$sent['localSecurityScan']['scannedAt']) { throw new RuntimeException('Security metadata missing'); }
$first = $sent['localSecurityScan'];
SitePulse_Connector::inventory(array('origin' => 'https://pulse.example.test', 'site_id' => '00000000-0000-4000-8000-000000000001', 'credential' => str_repeat('S', 43)));
if ($first !== $sent['localSecurityScan']) { throw new RuntimeException('Scan cache not reused'); }
echo "Expanded inventory and cached scan contracts passed.\n";
