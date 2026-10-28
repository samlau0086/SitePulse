<?php
// Standalone WordPress doubles exercise the actual expanded inventory sender.
define('ABSPATH', __DIR__);
define('WP_CONTENT_DIR', __DIR__);
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', true);
$options = array('active_plugins' => array('example/main.php'));
$sent = null;
$events = array(); $requests = array(); $failure = null; $collection_failure = false;
class WP_Error {
    public function __construct(private $code, private $message, private $data = null) {}
    public function get_error_code() { return $this->code; }
    public function get_error_data() { return $this->data; }
}
function is_multisite() { return false; }
function add_action(...$args) {}
function register_activation_hook(...$args) {}
function register_deactivation_hook(...$args) {}
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function add_option($key, $value, ...$args) { if (isset($GLOBALS['options'][$key])) { return false; } $GLOBALS['options'][$key] = $value; return true; }
function delete_option($key) { unset($GLOBALS['options'][$key]); }
function wp_next_scheduled($hook) { return $GLOBALS['events'][$hook] ?? false; }
function wp_clear_scheduled_hook($hook) { unset($GLOBALS['events'][$hook]); }
function wp_schedule_single_event($when, $hook) { $GLOBALS['events'][$hook] = $when; return true; }
function update_option($key, $value, $autoload = null) { if ($autoload !== false) { throw new RuntimeException('Scan must not autoload'); } $GLOBALS['options'][$key] = $value; }
function get_plugins() { if ($GLOBALS['collection_failure']) { throw new RuntimeException('private plugin source /path secret'); } return array('example/main.php' => array('Name' => 'Example', 'Version' => '1.0'), 'inactive/main.php' => array('Name' => 'Inactive', 'Version' => '2.0', 'UpdateURI' => 'https://vendor.test')); }
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
function wp_safe_remote_post($url, $args) { $GLOBALS['sent'] = json_decode($args['body'], true); $GLOBALS['requests'][] = array('url' => $url, 'body' => $GLOBALS['sent']); return str_ends_with($url, '/inventory') ? ($GLOBALS['failure'] ?? array()) : array(); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_remote_retrieve_response_code($response) { return $response['status'] ?? 200; }
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
$options[SitePulse_Connector::OPTION] = array('origin' => 'https://pulse.example.test', 'site_id' => '00000000-0000-4000-8000-000000000001', 'credential' => str_repeat('S', 43));
SitePulse_Connector::ensure_inventory_upgrade();
if (abs($events[SitePulse_Connector::INVENTORY_HOOK] - time()) > 1) { throw new RuntimeException('Upgrade sync must be due immediately'); }
unset($events[SitePulse_Connector::INVENTORY_HOOK]);
SitePulse_Connector::ensure_inventory_upgrade();
if (isset($events[SitePulse_Connector::INVENTORY_HOOK])) { throw new RuntimeException('Upgrade must only queue once per version and credential'); }
$options[SitePulse_Connector::INVENTORY_VERSION] = '0.3.0';
SitePulse_Connector::ensure_inventory_upgrade();
if (!isset($events[SitePulse_Connector::INVENTORY_HOOK])) { throw new RuntimeException('Version change must queue inventory'); }
$request_id = '00000000-0000-4000-8000-000000000002';
SitePulse_Connector::sync_inventory($request_id);
if ($sent['inventoryRequestId'] !== $request_id || $options[SitePulse_Connector::INVENTORY_STATUS]['error'] !== null) { throw new RuntimeException('Requested upload must correlate success'); }
$success = $options[SitePulse_Connector::INVENTORY_STATUS]['last_success'];
$failure = array('status' => 400);
SitePulse_Connector::sync_inventory($request_id);
if ($sent !== array('siteId' => $options[SitePulse_Connector::OPTION]['site_id'], 'code' => 'rejected', 'inventoryRequestId' => $request_id) || $options[SitePulse_Connector::INVENTORY_STATUS]['last_success'] !== $success) { throw new RuntimeException('Rejected payload must report safe code and retain success'); }
$failure = new WP_Error('timeout', 'private network details');
SitePulse_Connector::sync_inventory();
if ($sent['code'] !== 'network') { throw new RuntimeException('Network failure classification'); }
$collection_failure = true;
SitePulse_Connector::sync_inventory();
if ($sent['code'] !== 'collection' || str_contains(json_encode($sent), 'private')) { throw new RuntimeException('Collection errors must not leak details'); }
$count = count($requests);
add_option(SitePulse_Connector::INVENTORY_LOCK, time());
SitePulse_Connector::sync_inventory();
if (count($requests) !== $count) { throw new RuntimeException('Concurrent sync must not collect twice'); }
delete_option(SitePulse_Connector::INVENTORY_LOCK);
SitePulse_Connector::sync_inventory('invalid');
if (count($requests) !== $count) { throw new RuntimeException('Malformed sync ID must not collect'); }
echo "Inventory lifecycle, correlation, failure privacy and locking checks passed.\n";
$options[SitePulse_Connector::OPTION] += array('sequence' => 0, 'failures' => 0, 'last_success' => 0);
SitePulse_Connector::heartbeat();
if ($events[SitePulse_Connector::HOOK] < time() + 899 || $options[SitePulse_Connector::OPTION]['failures'] !== 0 || $options[SitePulse_Connector::INVENTORY_STATUS]['error'] !== 'collection') { throw new RuntimeException('Inventory exception must not mark heartbeat failed or prevent next heartbeat'); }
echo "Heartbeat remains healthy and scheduled after inventory collection exception.\n";
