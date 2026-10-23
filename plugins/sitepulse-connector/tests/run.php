<?php
// Isolated WordPress API contract doubles. This is not a live WordPress acceptance test.
define('ABSPATH', __DIR__);
class WP_Error {
    public function __construct(public $code, public $message, public $data = null) {}
    public function get_error_message() { return $this->message; }
    public function get_error_data() { return $this->data; }
}
$options = array(); $events = array(); $calls = array(); $allowed = true; $nonce = true; $multisite = false; $response = array('status' => 200, 'body' => '{"success":true}'); $tests = 0;
function is_multisite() { return $GLOBALS['multisite']; }
function add_action(...$args) {}
function register_activation_hook(...$args) {}
function register_deactivation_hook(...$args) {}
function register_setting(...$args) {}
function add_options_page(...$args) {}
function current_user_can($capability) { return $GLOBALS['allowed'] && $capability === 'manage_options'; }
function check_admin_referer($action) { if (!$GLOBALS['nonce'] || $action !== 'sitepulse_connect') { throw new RuntimeException('Nonce denied'); } }
function wp_die($message, ...$args) { throw new RuntimeException($message); }
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function add_option($key, $value, $deprecated = '', $autoload = null) { if (isset($GLOBALS['options'][$key])) { return false; } $GLOBALS['options'][$key] = $value; if ($key === SitePulse_Connector::OPTION && $autoload !== false) { throw new RuntimeException('Secret must not autoload'); } return true; }
function update_option($key, $value, $autoload = null) { $GLOBALS['options'][$key] = $value; }
function delete_option($key) { unset($GLOBALS['options'][$key]); }
function wp_clear_scheduled_hook($hook) { unset($GLOBALS['events'][$hook]); }
function wp_next_scheduled($hook) { return $GLOBALS['events'][$hook] ?? false; }
function wp_schedule_single_event($when, $hook) { $GLOBALS['events'][$hook] = $when; }
function wp_parse_url($url) { return parse_url($url); }
function wp_json_encode($body) { return json_encode($body); }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_safe_remote_post($url, $args) { $GLOBALS['calls'][] = array('url' => $url, 'args' => $args); return $GLOBALS['response']; }
function wp_remote_retrieve_response_code($response) { return $response['status']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
function untrailingslashit($value) { return rtrim($value, '/'); }
function home_url($path) { return 'https://wp.customer-domain.com/blog' . $path; }
function esc_html($value) { return htmlspecialchars($value, ENT_QUOTES); }
function esc_url($value) { return esc_html($value); }
function admin_url($path) { return 'https://wp.customer-domain.com/wp-admin/' . $path; }
function wp_nonce_field($action) { echo '<input name="_wpnonce" value="nonce">'; }
function submit_button($label) { echo '<button>' . esc_html($label) . '</button>'; }
require dirname(__DIR__) . '/sitepulse-connector.php';
function verify($condition, $description) { if (!$condition) { throw new RuntimeException('FAIL: ' . $description); } $GLOBALS['tests']++; }
function denied($callback, $description) { try { $callback(); } catch (RuntimeException $error) { verify(true, $description); return; } verify(false, $description); }

$allowed = false; denied(fn() => SitePulse_Connector::admin_action(), 'capability enforcement');
$allowed = true; $nonce = false; denied(fn() => SitePulse_Connector::admin_action(), 'nonce enforcement'); $nonce = true;
$multisite = true; denied(fn() => SitePulse_Connector::activate(), 'multisite activation guard'); $multisite = false;
foreach (array('http://pulse.customer-domain.com', 'https://user:pass@pulse.customer-domain.com', 'https://pulse.customer-domain.com/path', 'https://pulse.customer-domain.com:8443', 'https://pulse.customer-domain.com?q=x') as $url) {
    verify(is_wp_error(SitePulse_Connector::request($url, 'pair', array())), 'reject unsafe API origin');
}
$origin = 'https://pulse.customer-domain.com'; $secret = str_repeat('S', 43); $site_id = '12345678-1234-1234-1234-123456789abc';
$response = new WP_Error('timeout', 'secret provider internals');
$result = SitePulse_Connector::pair($origin, str_repeat('C', 43));
verify(is_wp_error($result) && !str_contains($result->get_error_message(), 'internals'), 'sanitize network failure');
verify(!get_option(SitePulse_Connector::OPTION), 'failed pairing stores nothing');
$response = array('status' => 200, 'body' => '{}');
verify(is_wp_error(SitePulse_Connector::pair($origin, str_repeat('C', 43))), 'reject malformed pairing response');
$response = array('status' => 200, 'body' => json_encode(array('siteId' => $site_id, 'credential' => $secret)));
verify(SitePulse_Connector::pair($origin, str_repeat('C', 43)) === true, 'pairing stores site credential');
$pair_call = end($calls);
verify(json_decode($pair_call['args']['body'], true)['canonicalUrl'] === 'https://wp.customer-domain.com/blog', 'pair identity preserves subdirectory');
verify($pair_call['args']['headers']['Origin'] === $origin && $pair_call['args']['redirection'] === 0 && $pair_call['args']['sslverify'] && $pair_call['args']['timeout'] === 15 && $pair_call['args']['limit_response_size'] === 8192, 'bounded safe HTTPS client');
ob_start(); SitePulse_Connector::page(); $html = ob_get_clean();
verify(!str_contains($html, $secret), 'settings HTML does not expose credential');
$response = array('status' => 200, 'body' => '{"success":true}');
SitePulse_Connector::heartbeat();
$state = get_option(SitePulse_Connector::OPTION);
verify($state['sequence'] === 1 && $state['last_success'] > 0, 'successful heartbeat updates state');
verify($events[SitePulse_Connector::HOOK] >= time() + 899, '15 minute heartbeat');
verify(end($calls)['args']['headers']['Authorization'] === 'Bearer ' . $secret, 'site bearer authentication');
$response = new WP_Error('timeout', 'timeout');
for ($attempt = 1; $attempt <= 7; $attempt++) { SitePulse_Connector::heartbeat(); verify($events[SitePulse_Connector::HOOK] <= time() + 900 && $events[SitePulse_Connector::HOOK] >= time() + 59, 'bounded exponential retries'); }
verify(get_option(SitePulse_Connector::OPTION)['sequence'] === 8, 'timeouts never reuse sequence');
$count = count($calls); add_option(SitePulse_Connector::LOCK, time()); SitePulse_Connector::heartbeat();
verify(count($calls) === $count, 'concurrent heartbeat lock'); delete_option(SitePulse_Connector::LOCK);
verify(is_wp_error(SitePulse_Connector::disconnect(get_option(SitePulse_Connector::OPTION))) && !!get_option(SitePulse_Connector::OPTION), 'failed disconnect retains secret for revocation');
$response = array('status' => 200, 'body' => '{"success":true}');
verify(SitePulse_Connector::disconnect(get_option(SitePulse_Connector::OPTION)) === true && !get_option(SitePulse_Connector::OPTION) && !isset($events[SitePulse_Connector::HOOK]), 'disconnect revokes then clears credential and schedule');
$response = array('status' => 200, 'body' => json_encode(array('siteId' => $site_id, 'credential' => $secret)));
SitePulse_Connector::pair($origin, str_repeat('C', 43)); SitePulse_Connector::activate();
verify(isset($events[SitePulse_Connector::HOOK]), 'reactivation resumes schedule');
SitePulse_Connector::deactivate();
verify(!isset($events[SitePulse_Connector::HOOK]) && !!get_option(SitePulse_Connector::OPTION), 'deactivation removes events and preserves revocable credential');
$response = array('status' => 401, 'body' => '{}');
verify(SitePulse_Connector::disconnect(get_option(SitePulse_Connector::OPTION)) === true && !get_option(SitePulse_Connector::OPTION), 'already revoked credential can be forgotten and paired again');
echo $tests . " plugin contract checks passed. Live WordPress acceptance remains separate.\n";
