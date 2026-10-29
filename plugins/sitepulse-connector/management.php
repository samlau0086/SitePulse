<?php
if (!defined('ABSPATH')) { exit; }

/** Bounded pull-only operations. No inbound execution endpoint or arbitrary package URLs. */
final class SitePulse_Management {
    const OPTION = 'sitepulse_management';
    const HOOK = 'sitepulse_management_poll';
    const LOCK = 'sitepulse_management_lock';
    const RECEIPT = 'sitepulse_management_receipt';

    public static function boot() {
        add_action(self::HOOK, array(__CLASS__, 'poll'));
        add_action('admin_post_sitepulse_management', array(__CLASS__, 'settings'));
    }
    public static function schedule() {
        if (get_option(SitePulse_Connector::OPTION) && !wp_next_scheduled(self::HOOK)) {
            wp_schedule_single_event(time() + 60, self::HOOK);
        }
    }
    public static function settings() {
        if (!current_user_can('manage_options') || !current_user_can('install_plugins') || !current_user_can('switch_themes')) { wp_die('Administrator access is required.', '', array('response' => 403)); }
        check_admin_referer('sitepulse_management');
        $enabled = isset($_POST['enabled']) && wp_unslash($_POST['enabled']) === '1';
        $previous = self::enabled();
        update_option(self::OPTION, array('enabled' => $enabled, 'packages' => $enabled && isset($_POST['packages']) && wp_unslash($_POST['packages']) === '1', 'user_id' => get_current_user_id()), false);
        if ($enabled && !$previous) { SitePulse_Connector::queue_inventory(); }
        self::schedule();
        wp_safe_redirect(admin_url('options-general.php?page=sitepulse'));
        exit;
    }
    public static function enabled() {
        $setting = get_option(self::OPTION, array());
        if (empty($setting['enabled']) || empty($setting['user_id']) || is_multisite()) { return false; }
        $user = get_user_by('id', (int) $setting['user_id']);
        return $user && user_can($user, 'manage_options') && user_can($user, 'install_plugins') && user_can($user, 'switch_themes');
    }
    public static function poll() {
        $lock = get_option(self::LOCK);
        if ($lock && (int) $lock < time() - 900) { delete_option(self::LOCK); }
        if (!add_option(self::LOCK, time(), '', false)) { return; }
        try {
            $state = get_option(SitePulse_Connector::OPTION, array());
            if (!$state || is_multisite()) { return; }
            // Schedule before work: a fatal plugin error must not stop future reconciliation.
            wp_clear_scheduled_hook(self::HOOK);
            wp_schedule_single_event(time() + 60, self::HOOK);
            $receipt = get_option(self::RECEIPT, array());
            $identity = hash('sha256', $state['credential']);
            if ($receipt && ($receipt['identity'] ?? '') !== $identity) {
                delete_option(self::RECEIPT); $receipt = array();
            }
            if ($receipt) {
                // A crash after start may have changed WordPress: NEVER run it again.
                $code = $receipt['code'] ?? 'uncertain';
                $result = SitePulse_Connector::request($state['origin'], 'software-result', array('siteId' => $state['site_id'], 'operationId' => $receipt['id'], 'token' => $receipt['token'], 'code' => $code), $state['credential']);
                if (is_wp_error($result)) {
                    // Revocation/rotation invalidates the receipt, but never executes it again.
                    if (($result->get_error_data()['status'] ?? 0) === 401) { delete_option(self::RECEIPT); }
                    return;
                }
                delete_option(self::RECEIPT);
                SitePulse_Connector::sync_inventory();
                return;
            }
            $poll = array('siteId' => $state['site_id'], 'enabled' => (bool) self::enabled());
            if (self::packages_enabled()) { $poll['packageSupport'] = 1; }
            $response = SitePulse_Connector::request($state['origin'], 'software-poll', $poll, $state['credential']);
            if (is_wp_error($response)) { return; }
            if (!empty($response['inventoryRequestId'])) { SitePulse_Connector::sync_inventory($response['inventoryRequestId']); return; }
            if (empty($response['command'])) { return; }
            $command = $response['command'];
            if (!self::valid($command)) { return; }
            $current = get_option(SitePulse_Connector::OPTION, array());
            if (!$current || $current['credential'] !== $state['credential']) { return; }
            $receipt = array('identity' => $identity, 'id' => $command['id'], 'token' => $command['token']);
            // Durable reservation before any mutation. A lost acknowledgement is not a retry.
            if (!add_option(self::RECEIPT, $receipt, '', false)) { return; }
            $original_user = get_current_user_id();
            $setting = get_option(self::OPTION, array());
            try {
                if (!self::enabled()) { $code = 'disabled'; }
                elseif (strtotime($command['executeBefore']) < time()) { $code = 'uncertain'; }
                else {
                    wp_set_current_user((int) $setting['user_id']);
                    $code = self::execute($command);
                }
            } catch (Throwable $error) {
                // Do not transmit exception text, paths, plugin output or credentials.
                $code = 'uncertain';
            } finally { wp_set_current_user($original_user); }
            $receipt['code'] = $code;
            update_option(self::RECEIPT, $receipt, false);
            $result = SitePulse_Connector::request($state['origin'], 'software-result', array('siteId' => $state['site_id'], 'operationId' => $receipt['id'], 'token' => $receipt['token'], 'code' => $code), $state['credential']);
            if (!is_wp_error($result)) { delete_option(self::RECEIPT); }
            SitePulse_Connector::sync_inventory();
        } finally { delete_option(self::LOCK); }
    }
    public static function valid($command) {
        if (!is_array($command)) { return false; }
        if (isset($command['attachmentId']) || isset($command['packageSha256'])) {
            if (($command['action'] ?? '') !== 'install' || !is_string($command['attachmentId'] ?? null) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/Di', $command['attachmentId']) || !is_string($command['packageSha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $command['packageSha256'])) { return false; }
        }
        foreach (array('slug', 'replacement') as $key) {
            if (isset($command[$key]) && (!is_string($command[$key]) || strlen($command[$key]) > 100 || !preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $command[$key]))) { return false; }
        }
        $theme_deactivation = ($command['kind'] ?? '') === 'theme' && ($command['action'] ?? '') === 'deactivate';
        $replacement_valid = $theme_deactivation
            ? isset($command['replacement']) && $command['replacement'] !== $command['slug']
            : !isset($command['replacement']);
        return isset($command['slug'], $command['id'], $command['token'], $command['executeBefore']) && is_string($command['id']) && preg_match('/^[a-f0-9-]{36}$/Di', $command['id']) && is_string($command['token']) && preg_match('/^[A-Za-z0-9_-]{43}$/D', $command['token']) && is_string($command['executeBefore']) && strtotime($command['executeBefore']) !== false && strtotime($command['executeBefore']) <= time() + 120 && in_array($command['kind'] ?? '', array('plugin', 'theme'), true) && in_array($command['action'] ?? '', array('install', 'uninstall', 'activate', 'deactivate', 'update'), true) && $replacement_valid;
    }
    public static function package_allowed($url, $kind, $slug) {
        return is_string($url) && preg_match('~^https://downloads\.wordpress\.org/' . ($kind === 'plugin' ? 'plugin' : 'theme') . '/' . preg_quote($slug, '~') . '\.[0-9A-Za-z._-]+\.zip$~D', $url) === 1;
    }
    public static function packages_enabled() {
        $setting = get_option(self::OPTION, array());
        return self::enabled() && !empty($setting['packages']);
    }
    public static function install_attachment($command) {
        if (!self::packages_enabled()) { return 'disabled'; }
        $state = get_option(SitePulse_Connector::OPTION, array());
        $origin = $state['origin'] ?? '';
        $parts = wp_parse_url($origin);
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || !empty($parts['path']) || isset($parts['query']) || isset($parts['fragment'])) { return 'package_download'; }
        $temp = wp_tempnam('sitepulse-attachment.zip');
        if (!$temp) { return 'filesystem'; }
        try {
            $response = wp_safe_remote_post($origin . '/api/v1/connector/software-package', array(
                'headers' => array('Content-Type' => 'application/json', 'Origin' => $origin, 'Authorization' => 'Bearer ' . $state['credential']),
                'body' => wp_json_encode(array('siteId' => $state['site_id'], 'operationId' => $command['id'], 'token' => $command['token'])),
                'timeout' => 30, 'redirection' => 0, 'sslverify' => true, 'stream' => true, 'filename' => $temp, 'limit_response_size' => 8388609,
            ));
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) { return 'package_download'; }
            if (!is_file($temp) || filesize($temp) > 8388608) { return 'package_size'; }
            $digest = hash_file('sha256', $temp);
            if (!is_string($digest) || !hash_equals($command['packageSha256'], $digest)) { return 'package_checksum'; }
            $current = get_option(SitePulse_Connector::OPTION, array());
            if (!self::packages_enabled() || ($current['credential'] ?? '') !== $state['credential'] || strtotime($command['executeBefore']) < time()) { return 'disabled'; }
            $upgrader = $command['kind'] === 'plugin' ? new Plugin_Upgrader(new Automatic_Upgrader_Skin()) : new Theme_Upgrader(new Automatic_Upgrader_Skin());
            return $upgrader->install($temp) === true ? 'ok' : 'wordpress_error';
        } finally { wp_delete_file($temp); }
    }
    public static function execute($command) {
        if (!self::valid($command) || !self::enabled() || !current_user_can('manage_options') || is_multisite()) { return 'disabled'; }
        $slug = $command['slug']; $kind = $command['kind']; $action = $command['action'];
        if ($slug === 'sitepulse-connector') { return 'unsupported'; }
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/theme.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/update.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $caps = array('install' => 'install_', 'update' => 'update_', 'uninstall' => 'delete_');
        $cap = isset($caps[$action]) ? $caps[$action] . ($kind === 'plugin' ? 'plugins' : 'themes') : ($kind === 'plugin' ? 'activate_plugins' : 'switch_themes');
        if (!current_user_can($cap) || ((defined('DISALLOW_FILE_MODS') && DISALLOW_FILE_MODS) && isset($caps[$action]))) { return 'disabled'; }
        if (isset($caps[$action]) && get_filesystem_method() !== 'direct') { return 'filesystem'; }
        $file = null; $data = null;
        if ($kind === 'plugin') {
            foreach (get_plugins() as $basename => $plugin) {
                $identifier = dirname($basename) === '.' ? basename($basename, '.php') : dirname($basename);
                if ($identifier === $slug) {
                    if ($file !== null) { return 'unsupported'; }
                    $file = $basename; $data = $plugin;
                }
            }
            if ($file === plugin_basename(__DIR__ . '/sitepulse-connector.php')) { return 'unsupported'; }
            if ($action !== 'install' && $file === null) { return 'not_installed'; }
            if ($action === 'install' && $file !== null) { return 'already_installed'; }
            if (in_array($action, array('deactivate', 'uninstall'), true) && class_exists('WP_Plugin_Dependencies')) {
                WP_Plugin_Dependencies::initialize();
                if (WP_Plugin_Dependencies::has_active_dependents($file)) { return 'dependency'; }
            }
            if ($action === 'activate') { return is_wp_error(activate_plugin($file, '', false, false)) ? 'wordpress_error' : (is_plugin_active($file) ? 'ok' : 'wordpress_error'); }
            if ($action === 'deactivate') { deactivate_plugins($file, false, false); return is_plugin_active($file) ? 'wordpress_error' : 'ok'; }
            if ($action === 'uninstall') {
                if (is_plugin_active($file)) { return 'active'; }
                return delete_plugins(array($file)) === true ? 'ok' : 'wordpress_error';
            }
        } else {
            $theme = wp_get_theme($slug);
            if ($action === 'install' && $theme->exists()) { return 'already_installed'; }
            if ($action !== 'install' && !$theme->exists()) { return 'not_installed'; }
            $active = wp_get_theme();
            if ($action === 'uninstall') {
                if ($slug === $active->get_stylesheet() || $slug === $active->get_template()) { return 'active'; }
                foreach (wp_get_themes() as $other) { if ($other->get('Template') === $slug) { return 'dependency'; } }
                return delete_theme($slug) === true ? 'ok' : 'wordpress_error';
            }
            if ($action === 'activate' || $action === 'deactivate') {
                if ($action === 'deactivate' && $active->get_stylesheet() !== $slug) { return 'ok'; }
                $target = $action === 'activate' ? $slug : ($command['replacement'] ?? '');
                $replacement = wp_get_theme($target);
                if (!$target || !$replacement->exists() || $replacement->errors() || !$replacement->is_allowed()) { return 'dependency'; }
                switch_theme($target);
                return wp_get_theme()->get_stylesheet() === $target ? 'ok' : 'wordpress_error';
            }
            $data = array('UpdateURI' => $theme->get('UpdateURI'));
        }
        if (isset($command['attachmentId'])) { return self::install_attachment($command); }
        if ($action === 'update' && !empty($data['UpdateURI'])) { return 'unsupported'; }
        // Resolve only official API metadata; packages must match this exact slug and fixed host.
        if ($kind === 'plugin') {
            require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
            $info = plugins_api('plugin_information', array('slug' => $slug, 'fields' => array('sections' => false)));
        } else {
            require_once ABSPATH . 'wp-admin/includes/theme-install.php';
            $info = themes_api('theme_information', array('slug' => $slug, 'fields' => array('sections' => false)));
        }
        if (is_wp_error($info) || !is_object($info) || ($info->slug ?? '') !== $slug || !self::package_allowed($info->download_link ?? '', $kind, $slug)) { return 'package_source'; }
        if ($action === 'update') {
            $current_version = $kind === 'plugin' ? ($data['Version'] ?? '') : $theme->get('Version');
            if (!version_compare($info->version ?? '0', $current_version, '>')) { return 'ok'; }
        }
        $package = $info->download_link;
        // No redirect to arbitrary network targets, no credentials, bounded streamed response.
        $download = static function ($reply, $url) use ($package) {
            if ($url !== $package) { return new WP_Error('sitepulse_package', 'Unsupported package.'); }
            $temp = wp_tempnam('sitepulse-package.zip');
            if (!$temp) { return new WP_Error('sitepulse_filesystem', 'Temporary file unavailable.'); }
            $response = wp_safe_remote_get($url, array('timeout' => 60, 'redirection' => 0, 'sslverify' => true, 'stream' => true, 'filename' => $temp, 'limit_response_size' => 52428800));
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200 || filesize($temp) >= 52428800) { wp_delete_file($temp); return new WP_Error('sitepulse_package', 'Package download failed.'); }
            return $temp;
        };
        add_filter('upgrader_pre_download', $download, 10, 2);
        try {
            $upgrader = $kind === 'plugin' ? new Plugin_Upgrader(new Automatic_Upgrader_Skin()) : new Theme_Upgrader(new Automatic_Upgrader_Skin());
            if ($action === 'install') { $result = $upgrader->install($package); }
            else {
                // Native upgrade flow with a freshly resolved official package, not an arbitrary update URL.
                $transient_name = $kind === 'plugin' ? 'update_plugins' : 'update_themes';
                $updates = get_site_transient($transient_name);
                if (!is_object($updates)) { $updates = (object) array(); }
                if (!isset($updates->response) || !is_array($updates->response)) { $updates->response = array(); }
                $key = $kind === 'plugin' ? $file : $slug;
                $entry = array('slug' => $slug, 'new_version' => $info->version, 'package' => $package);
                $updates->response[$key] = $kind === 'plugin' ? (object) $entry : $entry;
                set_site_transient($transient_name, $updates);
                $result = $upgrader->upgrade($key);
            }
            return $result === true ? 'ok' : 'wordpress_error';
        } finally { remove_filter('upgrader_pre_download', $download, 10); }
    }
    public static function page() {
        $enabled = self::enabled();
        echo '<h2>Remote plugin and theme management</h2><p>Optional: allow verified SitePulse workspace administrators to manage plugins/themes. Updates use WordPress.org. Uploaded package installation requires separate permission below. Static scans cannot prove code is safe. Back up this site before changes; no automatic rollback. WordPress Cron should run every minute for timely operations.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="sitepulse_management">';
        wp_nonce_field('sitepulse_management');
        echo '<label><input type="checkbox" name="enabled" value="1" ' . ($enabled ? 'checked' : '') . '> Enable remote management for this paired site</label>';
        echo '<p><label><input type="checkbox" name="packages" value="1" ' . (self::packages_enabled() ? 'checked' : '') . '> Also allow installation of workspace ZIP attachments that passed the current static scan</label></p>';
        submit_button('Save remote management permission');
        echo '</form>';
    }
}
