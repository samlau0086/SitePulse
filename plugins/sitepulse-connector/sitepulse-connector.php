<?php
/**
 * Plugin Name: SitePulse Connector
 * Description: Pairs this site with SitePulse and sends periodic heartbeats. No remote execution.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * License: GPL-2.0-or-later
 */
if (!defined('ABSPATH')) { exit; }

final class SitePulse_Connector {
    const OPTION = 'sitepulse_connection';
    const HOOK = 'sitepulse_heartbeat';
    const LOCK = 'sitepulse_heartbeat_lock';

    public static function boot() {
        if (is_multisite()) { return; }
        add_action('admin_menu', array(__CLASS__, 'menu'));
        add_action('admin_init', array(__CLASS__, 'settings'));
        add_action('admin_post_sitepulse_connect', array(__CLASS__, 'admin_action'));
        add_action(self::HOOK, array(__CLASS__, 'heartbeat'));
    }
    public static function activate() {
        if (is_multisite()) { wp_die('SitePulse currently supports single-site WordPress only.'); }
        if (get_option(self::OPTION) && !wp_next_scheduled(self::HOOK)) { wp_schedule_single_event(time() + 60, self::HOOK); }
    }
    public static function deactivate() {
        wp_clear_scheduled_hook(self::HOOK);
        // Preserve the credential so an administrator can revoke it after reactivation.
    }
    public static function settings() {
        // Connection secrets are deliberately excluded from options.php and rendered fields.
        register_setting('sitepulse', 'sitepulse_display', array('type' => 'string', 'sanitize_callback' => 'sanitize_text_field', 'show_in_rest' => false));
        if (get_option(self::OPTION) && !wp_next_scheduled(self::HOOK)) { wp_schedule_single_event(time() + 60, self::HOOK); }
    }
    public static function menu() {
        add_options_page('SitePulse', 'SitePulse', 'manage_options', 'sitepulse', array(__CLASS__, 'page'));
    }
    public static function request($origin, $path, $body, $credential = '') {
        $parts = wp_parse_url($origin);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) || !empty($parts['path']) || isset($parts['port'])) {
            return new WP_Error('sitepulse_url', 'Use an HTTPS SitePulse origin without a path or port.');
        }
        if (!in_array($path, array('pair', 'heartbeat', 'inventory', 'disconnect'), true)) { return new WP_Error('sitepulse_path', 'Invalid endpoint.'); }
        $headers = array('Content-Type' => 'application/json', 'Origin' => $origin);
        if ($credential) { $headers['Authorization'] = 'Bearer ' . $credential; }
        $response = wp_safe_remote_post($origin . '/api/v1/connector/' . $path, array('headers' => $headers, 'body' => wp_json_encode($body), 'timeout' => 15, 'redirection' => 0, 'sslverify' => true, 'limit_response_size' => 8192));
        if (is_wp_error($response)) { return new WP_Error('sitepulse_network', 'SitePulse could not be reached.'); }
        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) { return new WP_Error('sitepulse_rejected', 'SitePulse rejected the request. Check the connection in your workspace.', array('status' => $status)); }
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($data)) { return new WP_Error('sitepulse_response', 'Invalid SitePulse response.'); }
        return $data;
    }
    public static function admin_action() {
        if (!current_user_can('manage_options')) { wp_die('Administrator access is required.', '', array('response' => 403)); }
        check_admin_referer('sitepulse_connect');
        if (!self::acquire_lock()) { wp_die('A SitePulse request is in progress. Try again shortly.'); }
        try {
        $operation = sanitize_text_field(wp_unslash($_POST['operation'] ?? ''));
        $state = get_option(self::OPTION, array());
        if ($operation === 'disconnect') {
            $result = self::disconnect($state);
            if (is_wp_error($result)) { wp_die(esc_html($result->get_error_message())); }
        } elseif ($operation === 'pair') {
            if ($state) { wp_die('Disconnect the existing connection before pairing again.'); }
            $origin = untrailingslashit(trim(wp_unslash($_POST['origin'] ?? '')));
            $challenge = trim(wp_unslash($_POST['challenge'] ?? ''));
            if (!preg_match('/^[A-Za-z0-9_-]{43}$/D', $challenge)) { wp_die('Invalid pairing code.'); }
            $result = self::pair($origin, $challenge);
            if (is_wp_error($result)) { wp_die(esc_html($result->get_error_message())); }
        } else { wp_die('Invalid action.'); }
        } finally { delete_option(self::LOCK); }
        if ($operation === 'pair') { self::heartbeat(); }
        wp_safe_redirect(admin_url('options-general.php?page=sitepulse'));
        exit;
    }
    public static function pair($origin, $challenge) {
        $result = self::request($origin, 'pair', array('challenge' => $challenge, 'canonicalUrl' => untrailingslashit(home_url('/'))));
        if (is_wp_error($result)) { return $result; }
        if (!preg_match('/^[a-f0-9-]{36}$/Di', $result['siteId'] ?? '') || !preg_match('/^[A-Za-z0-9_-]{43}$/D', $result['credential'] ?? '')) { return new WP_Error('sitepulse_response', 'Invalid SitePulse response.'); }
        if (!add_option(self::OPTION, array('origin' => $origin, 'site_id' => $result['siteId'], 'credential' => $result['credential'], 'sequence' => 0, 'failures' => 0, 'last_success' => 0), '', false)) { return new WP_Error('sitepulse_existing', 'A connection already exists.'); }
        return true;
    }
    public static function disconnect($state) {
        if ($state) {
            $result = self::request($state['origin'], 'disconnect', array('siteId' => $state['site_id']), $state['credential']);
            // A 401 means rotation/revocation has already invalidated this local credential.
            if (is_wp_error($result) && ($result->get_error_data()['status'] ?? 0) !== 401) { return $result; }
            delete_option(self::OPTION);
        }
        self::deactivate();
        return true;
    }
    public static function heartbeat() {
        // Serialize cron/manual execution. Requests time out in 15 seconds; abandoned locks expire after 2 minutes.
        if (!self::acquire_lock()) { return; }
        try {
            $state = get_option(self::OPTION, array());
            if (!$state) { return; }
            $state['sequence']++;
            update_option(self::OPTION, $state, false); // Reserve before sending, including on timeouts.
            $result = self::request($state['origin'], 'heartbeat', array('siteId' => $state['site_id'], 'sequence' => $state['sequence'], 'connectorVersion' => '0.1.0'), $state['credential']);
            if (!is_wp_error($result) && function_exists('get_bloginfo')) { self::inventory($state); }
            // Do not resurrect a connection removed while the request was in flight.
            $current = get_option(self::OPTION, array());
            if (!$current || $current['credential'] !== $state['credential']) { return; }
            $state['failures'] = is_wp_error($result) ? min(5, $state['failures'] + 1) : 0;
            if (!is_wp_error($result)) { $state['last_success'] = time(); }
            update_option(self::OPTION, $state, false);
            $delay = $state['failures'] ? min(900, 60 * (2 ** ($state['failures'] - 1))) : 900;
            wp_clear_scheduled_hook(self::HOOK);
            wp_schedule_single_event(time() + $delay, self::HOOK);
        } finally { delete_option(self::LOCK); }
    }
    public static function inventory($state) {
        if (function_exists('plugin_basename') && defined('ABSPATH')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
        $plugins = array();
        foreach ((array) get_option('active_plugins', array()) as $file) {
            $data = get_plugin_data(WP_PLUGIN_DIR . '/' . $file, false, false);
            if (count($plugins) >= 200 || empty($data['Name']) || empty($data['Version'])) { continue; }
            $plugins[] = array('identifier' => sanitize_key(dirname($file) === '.' ? basename($file, '.php') : dirname($file)), 'name' => sanitize_text_field($data['Name']), 'version' => sanitize_text_field($data['Version']));
        }
        $theme = wp_get_theme();
        $themes = array(array('identifier' => sanitize_key($theme->get_stylesheet()), 'name' => sanitize_text_field($theme->get('Name')), 'version' => sanitize_text_field($theme->get('Version') ?: '0.0.0')));
        $updates = get_site_transient('update_plugins');
        $themeUpdates = get_site_transient('update_themes');
        $coreUpdates = get_core_updates(array('dismissed' => false));
        self::request($state['origin'], 'inventory', array('siteId' => $state['site_id'], 'wordpressVersion' => get_bloginfo('version'), 'phpVersion' => PHP_VERSION, 'activePlugins' => $plugins, 'activeThemes' => $themes, 'updateCounts' => array('plugins' => is_object($updates) && !empty($updates->response) ? count($updates->response) : 0, 'themes' => is_object($themeUpdates) && !empty($themeUpdates->response) ? count($themeUpdates->response) : 0, 'core' => is_array($coreUpdates) ? count($coreUpdates) : 0)), $state['credential']);
    }
    private static function acquire_lock() {
        $lock = get_option(self::LOCK);
        if ($lock && (int) $lock < time() - 120) { delete_option(self::LOCK); }
        return add_option(self::LOCK, time(), '', false);
    }
    public static function page() {
        if (!current_user_can('manage_options')) { return; }
        $state = get_option(self::OPTION, array());
        echo '<div class="wrap"><h1>SitePulse</h1><p>Pairs this WordPress installation and sends a heartbeat every 15 minutes. No customer content or administrator passwords are collected.</p>';
        if ($state) {
            echo '<p>Site: ' . esc_html($state['site_id']) . '</p><p>Last successful heartbeat: ' . esc_html($state['last_success'] ? gmdate('Y-m-d H:i:s', $state['last_success']) . ' UTC' : 'Not received') . '</p>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="sitepulse_connect">';
        wp_nonce_field('sitepulse_connect');
        if ($state) {
            echo '<input type="hidden" name="operation" value="disconnect">';
            submit_button('Disconnect and revoke credential');
        } else {
            echo '<input type="hidden" name="operation" value="pair"><p><label>SitePulse HTTPS origin <input type="url" name="origin" required placeholder="https://pulse.your-domain.com"></label></p><p><label>Pairing code <input type="password" name="challenge" required autocomplete="off" maxlength="43"></label></p>';
            submit_button('Pair site');
        }
        echo '</form></div>';
    }
}
register_activation_hook(__FILE__, array('SitePulse_Connector', 'activate'));
register_deactivation_hook(__FILE__, array('SitePulse_Connector', 'deactivate'));
SitePulse_Connector::boot();
