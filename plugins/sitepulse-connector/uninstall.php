<?php
if (!defined('WP_UNINSTALL_PLUGIN')) { exit; }
wp_clear_scheduled_hook('sitepulse_heartbeat');
delete_option('sitepulse_connection');
delete_option('sitepulse_heartbeat_lock');
delete_option('sitepulse_display');
