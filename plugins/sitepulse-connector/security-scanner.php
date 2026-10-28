<?php
if (!defined('ABSPATH')) { exit; }

final class SitePulse_Security_Scanner {
    const MAX_FILES = 500;
    const MAX_BYTES = 524288;
    const MAX_FINDINGS = 100;

    public static function scan($content_dir, $uploads_dir) {
        $root = realpath($content_dir);
        if (!$root || !is_readable($root)) { return array('status' => 'unavailable', 'scannedFiles' => 0, 'skippedFiles' => 0, 'findings' => array()); }
        $root = rtrim(str_replace('\\', '/', $root), '/');
        $uploads = $uploads_dir ? realpath($uploads_dir) : false;
        $uploads = $uploads ? rtrim(str_replace('\\', '/', $uploads), '/') : '';
        $scanned = 0; $skipped = 0; $visited = 0; $findings = array(); $partial = false; $started = microtime(true);
        try {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                $visited++;
                if (microtime(true) - $started > 2 || $visited > 5000 || count($findings) >= self::MAX_FINDINGS || $scanned >= self::MAX_FILES) { $partial = true; break; }
                if ($file->isLink()) { $skipped++; $partial = true; continue; }
                if (!$file->isFile()) { continue; }
                $path = str_replace('\\', '/', $file->getRealPath() ?: '');
                if (!$path || !str_starts_with($path . '/', $root . '/') || !$file->isReadable()) { $skipped++; $partial = true; continue; }
                $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
                if (!in_array($extension, array('php', 'phtml', 'php5', 'php7', 'php8', 'inc', 'js', 'mjs'), true)) { continue; }
                $scanned++;
                $relative = ltrim(substr($path, strlen($root)), '/');
                if ($uploads && str_starts_with($path . '/', $uploads . '/') && !in_array($extension, array('js','mjs'), true)) { self::add($findings, 'php_in_uploads', $relative); }
                if ($file->getSize() > self::MAX_BYTES) { $skipped++; $partial = true; continue; }
                $contents = @file_get_contents($path, false, null, 0, self::MAX_BYTES);
                if (!is_string($contents)) { $skipped++; $partial = true; continue; }
                $flat = preg_replace('/\s+/', '', strtolower($contents));
                if (preg_match('/eval\((base64_decode|gzinflate|gzuncompress|str_rot13)\(/', $flat)) { self::add($findings, 'encoded_eval', $relative); }
                if (preg_match('/(gzinflate|gzuncompress)\(base64_decode\(/', $flat)) { self::add($findings, 'encoded_inflate', $relative); }
                if (preg_match('/(shell_exec|system|exec|passthru|proc_open|popen)\([^;]{0,250}(base64_decode|\$_(get|post|request|cookie))/', $flat) || preg_match('/eval\([^;]{0,250}\$_(get|post|request|cookie)/', $flat)) { self::add($findings, 'command_execution', $relative); }
                if (in_array($extension, array('js','mjs'), true) && preg_match('/eval\((atob|unescape)\(/', $flat)) { self::add($findings, 'encoded_eval', $relative); }
            }
        } catch (UnexpectedValueException $error) { $partial = true; }
        return array('status' => $partial ? 'partial' : 'complete', 'scannedFiles' => $scanned, 'skippedFiles' => $skipped, 'findings' => $findings);
    }
    private static function add(&$findings, $rule, $path) {
        if (strlen($path) > 300 || preg_match('/[\x00-\x1f\x7f:]/', $path)) { $path = '[path omitted]'; }
        if (count($findings) < self::MAX_FINDINGS) { $findings[] = array('rule' => $rule, 'path' => $path); }
    }
}
