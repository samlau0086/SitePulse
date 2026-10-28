<?php
// Isolated WordPress doubles. No network or real WordPress changes.
$root = sys_get_temp_dir() . '/sitepulse-management-' . bin2hex(random_bytes(6)) . '/';
mkdir($root . 'wp-admin/includes', 0700, true);
foreach (array('plugin.php','theme.php','file.php','update.php','class-wp-upgrader.php','plugin-install.php','theme-install.php') as $name) { file_put_contents($root . 'wp-admin/includes/' . $name, '<?php'); }
define('ABSPATH', $root);
$options = array(); $tests = 0; $allowed = true; $user = 7; $multi = false; $active = array(); $installed = array('hello/hello.php' => array('Name' => 'Hello', 'Version' => '1.0', 'UpdateURI' => '')); $theme = 'theme-a'; $deleted = array(); $executions = 0; $fail_ack = false; $response_command = null; $dependent = false; $filesystem = 'direct'; $events = array(); $upgrader = array(); $transients = array(); $api_info = null;
function check($condition, $message) { $GLOBALS['tests']++; if (!$condition) { throw new RuntimeException($message); } }
function get_option($name, $default = false) { return $GLOBALS['options'][$name] ?? $default; }
function update_option($name, $value, ...$args) { $GLOBALS['options'][$name] = $value; return true; }
function add_option($name, $value, ...$args) { if (isset($GLOBALS['options'][$name])) { return false; } return update_option($name, $value); }
function delete_option($name) { unset($GLOBALS['options'][$name]); }
function is_multisite() { return $GLOBALS['multi']; }
function get_user_by(...$args) { return (object) array('ID' => 7); }
function user_can(...$args) { return $GLOBALS['allowed']; }
function current_user_can(...$args) { return $GLOBALS['allowed']; }
function check_admin_referer($action) { if ($action !== 'sitepulse_management') { throw new RuntimeException('Bad nonce'); } }
function wp_unslash($value) { return $value; }
function wp_die(...$args) { throw new RuntimeException('Denied'); }
function wp_safe_redirect($url) { throw new RuntimeException('Redirect'); }
function admin_url($path) { return $path; }
function get_current_user_id() { return $GLOBALS['user']; }
function wp_set_current_user($id) { $GLOBALS['user'] = $id; }
function wp_next_scheduled($hook) { return $GLOBALS['events'][$hook] ?? false; }
function wp_clear_scheduled_hook($hook) { unset($GLOBALS['events'][$hook]); }
function wp_schedule_single_event($time, $hook) { $GLOBALS['events'][$hook] = $time; }
class WP_Error { public function get_error_data() { return array('status' => 503); } }
function is_wp_error($value) { return $value instanceof WP_Error; }
function get_plugins() { return $GLOBALS['installed']; }
function plugin_basename($path) { return 'sitepulse-connector/sitepulse-connector.php'; }
function activate_plugin($file, ...$args) { $GLOBALS['executions']++; $GLOBALS['active'][$file] = true; return null; }
function deactivate_plugins($file, ...$args) { $GLOBALS['executions']++; unset($GLOBALS['active'][$file]); }
function is_plugin_active($file) { return !empty($GLOBALS['active'][$file]); }
function delete_plugins($files) { $GLOBALS['executions']++; $GLOBALS['deleted'] = $files; return true; }
function get_filesystem_method() { return $GLOBALS['filesystem']; }
class WP_Plugin_Dependencies {
    public static function initialize() {}
    public static function has_active_dependents($file) { return $GLOBALS['dependent']; }
}
class Fake_Theme {
    public function __construct(public $slug) {}
    public function exists() { return in_array($this->slug, array('theme-a','theme-b','theme-child'), true); }
    public function errors() { return false; }
    public function is_allowed() { return true; }
    public function get_stylesheet() { return $this->slug; }
    public function get_template() { return $this->slug; }
    public function get($key) {
        if ($key === 'Template' && $this->slug === 'theme-child') { return 'theme-a'; }
        if ($key === 'Version') { return '1.0'; }
        return '';
    }
}
function wp_get_theme($slug = '') { return new Fake_Theme($slug ?: $GLOBALS['theme']); }
function wp_get_themes() { return array(new Fake_Theme('theme-a'),new Fake_Theme('theme-b'),new Fake_Theme('theme-child')); }
function switch_theme($slug) { $GLOBALS['theme'] = $slug; }
function delete_theme($slug) { $GLOBALS['deleted'][] = $slug; return true; }
function plugins_api(...$args) { return $GLOBALS['api_info']; }
function themes_api(...$args) { return $GLOBALS['api_info']; }
function add_filter(...$args) {}
function remove_filter(...$args) {}
function get_site_transient($name) { return $GLOBALS['transients'][$name] ?? false; }
function set_site_transient($name, $value) { $GLOBALS['transients'][$name] = $value; return true; }
class Automatic_Upgrader_Skin {}
class Plugin_Upgrader {
    public function __construct(...$args) {}
    public function install($package) { $GLOBALS['upgrader'][] = array('plugin-install', $package); return true; }
    public function upgrade($key) { $GLOBALS['upgrader'][] = array('plugin-update', $key); return true; }
}
class Theme_Upgrader {
    public function __construct(...$args) {}
    public function install($package) { $GLOBALS['upgrader'][] = array('theme-install', $package); return true; }
    public function upgrade($key) { $GLOBALS['upgrader'][] = array('theme-update', $key); return true; }
}
class SitePulse_Connector {
    const OPTION = 'connection';
    public static function sync_inventory($request_id = '') { $GLOBALS['inventory_syncs'][] = $request_id; }
    public static function queue_inventory() { $GLOBALS['queued_syncs'] = ($GLOBALS['queued_syncs'] ?? 0) + 1; }
    public static function request($origin, $path, $body, $credential) {
        if ($path === 'software-result') { $GLOBALS['reported'] = $body; return $GLOBALS['fail_ack'] ? new WP_Error() : array('success' => true); }
        return array('command' => $GLOBALS['response_command'], 'inventoryRequestId' => $GLOBALS['inventory_request'] ?? null);
    }
}
require dirname(__DIR__) . '/management.php';
$command = array('kind' => 'plugin', 'action' => 'activate', 'slug' => 'hello', 'id' => '11111111-1111-4111-8111-111111111111', 'token' => str_repeat('a',43), 'executeBefore' => gmdate('c',time()+60));
try {
    check(!SitePulse_Management::enabled(), 'Default disabled');
    update_option(SitePulse_Management::OPTION, array('enabled' => true, 'user_id' => 7));
    check(SitePulse_Management::enabled(), 'Explicit administrator permission');
    $allowed = false; check(!SitePulse_Management::enabled(), 'Revoked local capabilities'); $allowed = true;
    $multi = true; check(!SitePulse_Management::enabled(), 'No multisite'); $multi = false;
    foreach (array('../hello','hello/main.php','https://evil.example/a.zip','a%2fb','A_B') as $slug) { check(!SitePulse_Management::valid(array_merge($command,array('slug'=>$slug))), 'Reject path/URL'); }
    check(!SitePulse_Management::valid(array_merge($command,array('action'=>'shell'))), 'Reject arbitrary command');
    check(!SitePulse_Management::valid(array_merge($command,array('kind'=>'theme','action'=>'deactivate'))), 'Theme deactivation requires replacement');
    check(!SitePulse_Management::valid(array_merge($command,array('replacement'=>'theme-a'))), 'Other commands reject replacement');
    check(SitePulse_Management::package_allowed('https://downloads.wordpress.org/plugin/hello.1.0.zip','plugin','hello'), 'Official package');
    foreach (array('http://downloads.wordpress.org/plugin/hello.1.zip','https://downloads.wordpress.org.evil.test/plugin/hello.1.zip','https://downloads.wordpress.org/plugin/other.1.zip','https://downloads.wordpress.org/plugin/hello.1.zip?x=y') as $url) { check(!SitePulse_Management::package_allowed($url,'plugin','hello'), 'Reject arbitrary package'); }
    check(SitePulse_Management::execute($command) === 'ok' && is_plugin_active('hello/hello.php'), 'Activate plugin');
    check(SitePulse_Management::execute(array_merge($command,array('action'=>'uninstall'))) === 'active', 'Never delete active plugin');
    $dependent = true;
    check(SitePulse_Management::execute(array_merge($command,array('action'=>'deactivate'))) === 'dependency', 'Protect dependencies');
    $dependent = false;
    check(SitePulse_Management::execute(array_merge($command,array('action'=>'deactivate'))) === 'ok', 'Deactivate plugin');
    check(SitePulse_Management::execute(array_merge($command,array('action'=>'uninstall'))) === 'ok', 'Delete inactive plugin');
    check(SitePulse_Management::execute(array_merge($command,array('slug'=>'sitepulse-connector'))) === 'unsupported', 'Protect Connector');
    $filesystem = 'ftpext';
    check(SitePulse_Management::execute(array_merge($command,array('action'=>'uninstall'))) === 'filesystem', 'No interactive filesystem credentials'); $filesystem = 'direct';
    check(SitePulse_Management::execute(array_merge($command,array('kind'=>'theme','slug'=>'theme-a','action'=>'uninstall'))) === 'active', 'Protect active theme');
    $theme = 'theme-b';
    check(SitePulse_Management::execute(array_merge($command,array('kind'=>'theme','slug'=>'theme-a','action'=>'uninstall'))) === 'dependency', 'Protect parent themes');
    check(SitePulse_Management::execute(array_merge($command,array('kind'=>'theme','slug'=>'theme-b','action'=>'deactivate','replacement'=>'theme-a'))) === 'ok' && $theme === 'theme-a', 'Switch replacement theme');
    $api_info = (object) array('slug'=>'new-plugin','version'=>'1.0','download_link'=>'https://downloads.wordpress.org/plugin/new-plugin.1.0.zip');
    check(SitePulse_Management::execute(array_merge($command,array('slug'=>'new-plugin','action'=>'install'))) === 'ok' && end($upgrader)[0] === 'plugin-install', 'Install official plugin package');
    $api_info = (object) array('slug'=>'hello','version'=>'2.0','download_link'=>'https://downloads.wordpress.org/plugin/hello.2.0.zip');
    check(SitePulse_Management::execute(array_merge($command,array('slug'=>'hello','action'=>'update'))) === 'ok' && end($upgrader) === array('plugin-update','hello/hello.php'), 'Update official plugin package');
    check($transients['update_plugins']->response['hello/hello.php']->package === $api_info->download_link, 'Pin official plugin update package');
    $api_info = (object) array('slug'=>'new-theme','version'=>'1.0','download_link'=>'https://downloads.wordpress.org/theme/new-theme.1.0.zip');
    check(SitePulse_Management::execute(array_merge($command,array('kind'=>'theme','slug'=>'new-theme','action'=>'install'))) === 'ok' && end($upgrader)[0] === 'theme-install', 'Install official theme package');
    $api_info = (object) array('slug'=>'wrong','version'=>'3.0','download_link'=>'https://downloads.wordpress.org/plugin/wrong.3.0.zip');
    check(SitePulse_Management::execute(array_merge($command,array('slug'=>'hello','action'=>'update'))) === 'package', 'Reject mismatched API package');
    update_option(SitePulse_Connector::OPTION, array('site_id'=>'11111111-1111-4111-8111-111111111111','origin'=>'https://pulse.example.com','credential'=>'secret'));
    $response_command = $command; $fail_ack = true;
    $before = $executions; SitePulse_Management::poll();
    check($executions === $before + 1, 'One execution');
    check(get_option(SitePulse_Management::RECEIPT)['code'] === 'ok', 'Receipt saved before ACK');
    SitePulse_Management::poll();
    check($executions === $before + 1, 'Lost ACK never repeats mutation');
    $fail_ack = false; $response_command = null; SitePulse_Management::poll();
    check(!get_option(SitePulse_Management::RECEIPT), 'Receipt cleared after ACK');
    update_option(SitePulse_Management::RECEIPT, array('identity'=>hash('sha256','secret'),'id'=>$command['id'],'token'=>$command['token']));
    SitePulse_Management::poll();
    check($GLOBALS['reported']['code'] === 'uncertain' && $executions === $before + 1, 'Crashed mutation reports unknown, not retry');
    check(isset($events[SitePulse_Management::HOOK]), 'Reschedule before execution');
    $inventory_request = '22222222-2222-4222-8222-222222222222';
    update_option(SitePulse_Management::OPTION, array('enabled' => false, 'user_id' => 7));
    $before = $executions;
    SitePulse_Management::poll();
    check(end($inventory_syncs) === $inventory_request && $executions === $before, 'Read-only inventory dispatch works without management opt-in');
    $_POST = array('enabled' => '1');
    try { SitePulse_Management::settings(); } catch (RuntimeException $error) { check($error->getMessage() === 'Redirect', 'Settings redirect'); }
    check($queued_syncs === 1, 'Enabling management immediately queues inventory');
    try { SitePulse_Management::settings(); } catch (RuntimeException $error) {}
    check($queued_syncs === 1, 'Saving unchanged consent does not duplicate inventory');
    echo $tests . " management checks passed (isolated WordPress doubles).\n";
} finally {
    foreach (glob($root . 'wp-admin/includes/*') as $path) { unlink($path); }
    rmdir($root . 'wp-admin/includes'); rmdir($root . 'wp-admin'); rmdir($root);
}
