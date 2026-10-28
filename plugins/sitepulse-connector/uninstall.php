<?php
if (!defined('WP_UNINSTALL_PLUGIN')) { exit; }
wp_clear_scheduled_hook('sitepulse_heartbeat');
wp_clear_scheduled_hook('sitepulse_management_poll');
delete_option('sitepulse_management');
delete_option('sitepulse_management_receipt');
delete_option('sitepulse_management_lock');
delete_option('sitepulse_connection');
delete_option('sitepulse_heartbeat_lock');
delete_option('sitepulse_display');
delete_option('sitepulse_security_scan');
