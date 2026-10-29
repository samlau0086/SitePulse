<?php
// Isolated WordPress doubles. No network or real WordPress changes.
$root = sys_get_temp_dir() . '/sitepulse-management-' . bin2hex(random_bytes(6)) . '/';
mkdir($root . 'wp-admin/includes', 0700, true);
foreach (array('plugin.php','theme.php','file.php','update.php','class-wp-upgrader.php','plugin-install.php','theme-install.php') as $name) { file_put_contents($root . 'wp-admin/includes/' . $name, '<?php'); }
define('ABSPATH', $root);
$options = array(); $tests = 0; $allowed = true; $user = 7; $multi = false; $active = array(); $installed = array('hello/hello.php' => array('Name' => 'Hello', 'Version' => '1.0', 'UpdateURI' => '')); $theme = 'theme-a'; $deleted = array(); $executions = 0; $fail_ack = false; $response_command = null; $dependent = false; $filesystem = 'direct'; $events = array(); $upgrader = array(); $transients = array(); $api_info = null; $poll_body = null; $package_bytes = 'attachment-zip-fixture'; $package_status = 200; $package_error_header = ''; $package_transport_error = false; $package_mutation = null; $package_request = null; $deleted_temp_files = array();
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
function wp_parse_url($value) { return parse_url($value); }
function wp_json_encode($value) { return json_encode($value); }
function wp_tempnam($name) { return tempnam(sys_get_temp_dir(), 'sitepulse-'); }
function wp_safe_remote_post($url, $args) {
    $GLOBALS['package_request'] = array($url, $args);
    if ($GLOBALS['package_transport_error']) { return new WP_Error(); }
    file_put_contents($args['filename'], $GLOBALS['package_bytes']);
    if (is_callable($GLOBALS['package_mutation'])) { ($GLOBALS['package_mutation'])(); }
    return array('status' => $GLOBALS['package_status'], 'headers' => array('x-sitepulse-error-code' => $GLOBALS['package_error_header']));
}
function wp_remote_retrieve_response_code($response) { return $response['status'] ?? 0; }
function wp_remote_retrieve_header($response, $header) { return $response['headers'][$header] ?? ''; }
function wp_delete_file($path) { $GLOBALS['deleted_temp_files'][] = $path; if (is_file($path)) { unlink($path); } }
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
    public function install($package) { $GLOBALS['upgrader'][] = array('plugin-install', $package, is_file($package) ? file_get_contents($package) : null); return true; }
    public function upgrade($key) { $GLOBALS['upgrader'][] = array('plugin-update', $key); return true; }
}
class Theme_Upgrader {
    public function __construct(...$args) {}
    public function install($package) { $GLOBALS['upgrader'][] = array('theme-install', $package, is_file($package) ? file_get_contents($package) : null); return true; }
    public function upgrade($key) { $GLOBALS['upgrader'][] = array('theme-update', $key); return true; }
}
class SitePulse_Connector {
    const OPTION = 'connection';
    public static function sync_inventory($request_id = '') { $GLOBALS['inventory_syncs'][] = $request_id; }
    public static function queue_inventory() { $GLOBALS['queued_syncs'] = ($GLOBALS['queued_syncs'] ?? 0) + 1; }
    public static function request($origin, $path, $body, $credential) {
        if ($path === 'software-result') { $GLOBALS['reported'] = $body; return $GLOBALS['fail_ack'] ? new WP_Error() : array('success' => true); }
        $GLOBALS['poll_body'] = $body;
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
    $attachment = array_merge($command, array('action'=>'install','slug'=>'uploaded','attachmentId'=>'22222222-2222-4222-8222-222222222222','packageSha256'=>hash('sha256',$package_bytes)));
    check(SitePulse_Management::valid($attachment), 'Accept bounded attachment command');
    check(!SitePulse_Management::valid(array_merge($attachment,array('packageSha256'=>'bad'))), 'Reject invalid attachment digest');
    check(!SitePulse_Management::valid(array_merge($command,array('attachmentId'=>$attachment['attachmentId']))), 'Require complete attachment reference');
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
    check(SitePulse_Management::execute(array_merge($command,array('slug'=>'hello','action'=>'update'))) === 'package_source', 'Reject mismatched API package');
    update_option(SitePulse_Connector::OPTION, array('site_id'=>'11111111-1111-4111-8111-111111111111','origin'=>'https://pulse.example.com','credential'=>'secret'));
    update_option(SitePulse_Management::OPTION, array('enabled'=>true,'packages'=>true,'user_id'=>7));
    $attachment_result = SitePulse_Management::execute($attachment); $uploaded_install = end($upgrader);
    check($attachment_result === 'ok' && $uploaded_install[0] === 'plugin-install' && $uploaded_install[2] === $package_bytes, 'Install authenticated attachment through native upgrader');
    check($package_request[0] === 'https://pulse.example.com/api/v1/connector/software-package' && $package_request[1]['redirection'] === 0 && $package_request[1]['sslverify'] === true && $package_request[1]['stream'] === true && $package_request[1]['limit_response_size'] === 8388609 && $package_request[1]['headers']['Authorization'] === 'Bearer secret', 'Use bounded authenticated TLS package request without redirects');
    check(!is_file(end($deleted_temp_files)), 'Always remove downloaded attachment temp file');
    $theme_attachment = array_merge($attachment,array('kind'=>'theme','slug'=>'uploaded-theme'));
    check(SitePulse_Management::execute($theme_attachment) === 'ok' && end($upgrader)[0] === 'theme-install', 'Install authenticated theme attachment through native upgrader');
    $bad_hash = array_merge($attachment,array('packageSha256'=>str_repeat('0',64)));
    check(SitePulse_Management::execute($bad_hash) === 'package_checksum', 'Reject attachment digest mismatch');
    $package_status = 503;
    check(SitePulse_Management::execute($attachment) === 'package_download' && !is_file(end($deleted_temp_files)), 'Reject non-success package response and clean temporary file');
    $package_error_header = 'package_storage';
    check(SitePulse_Management::execute($attachment) === 'package_storage' && !is_file(end($deleted_temp_files)), 'Expose Drive package storage failure');
    $package_error_header = '';
    $package_status = 200; $package_transport_error = true;
    check(SitePulse_Management::execute($attachment) === 'package_download' && !is_file(end($deleted_temp_files)), 'Reject package transport failure and clean temporary file');
    $package_transport_error = false; $package_bytes = str_repeat('x', 8388609);
    $oversized = array_merge($attachment,array('packageSha256'=>hash('sha256',$package_bytes)));
    check(SitePulse_Management::execute($oversized) === 'package_size' && !is_file(end($deleted_temp_files)), 'Reject oversized package response and clean temporary file');
    $package_bytes = 'attachment-zip-fixture';
    $before_upgrades = count($upgrader);
    $package_mutation = static function () { update_option(SitePulse_Management::OPTION, array('enabled'=>true,'packages'=>false,'user_id'=>7)); };
    check(SitePulse_Management::execute($attachment) === 'disabled' && count($upgrader) === $before_upgrades, 'Recheck package consent after download');
    $package_mutation = null;
    update_option(SitePulse_Management::OPTION, array('enabled'=>true,'packages'=>true,'user_id'=>7));
    $response_command = null; SitePulse_Management::poll();
    check(($poll_body['packageSupport'] ?? null) === 1, 'Advertise package support only with separate consent');
    update_option(SitePulse_Management::OPTION, array('enabled'=>true,'packages'=>false,'user_id'=>7));
    SitePulse_Management::poll();
    check(!isset($poll_body['packageSupport']), 'Do not advertise package support without separate consent');
    update_option(SitePulse_Management::OPTION, array('enabled'=>true,'packages'=>true,'user_id'=>7));
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
    check(empty(get_option(SitePulse_Management::OPTION)['packages']), 'Remote management does not imply uploaded-package consent');
    check($queued_syncs === 1, 'Enabling management immediately queues inventory');
    $_POST = array('enabled' => '1', 'packages' => '1');
    try { SitePulse_Management::settings(); } catch (RuntimeException $error) {}
    check(!empty(get_option(SitePulse_Management::OPTION)['packages']), 'Uploaded-package consent can be enabled separately');
    check($queued_syncs === 1, 'Saving unchanged consent does not duplicate inventory');
    echo $tests . " management checks passed (isolated WordPress doubles).\n";
} finally {
    foreach (glob($root . 'wp-admin/includes/*') as $path) { unlink($path); }
    rmdir($root . 'wp-admin/includes'); rmdir($root . 'wp-admin'); rmdir($root);
}
