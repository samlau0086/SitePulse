import { createHash } from 'node:crypto';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import type { AttachmentScan } from '@sitepulse/api-contracts';
import { softwareSlug } from '@sitepulse/api-contracts';

export const SCANNER_VERSION = 'sitepulse-static-1';
export const PACKAGE_LIMIT = 8 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return (value ^ 0xffffffff) >>> 0;
}
export function codeFindings(source: string): string[] {
  const flat = source.toLowerCase().replace(/\s+/g, '');
  const rules: [string, RegExp][] = [
    [
      'encoded_eval',
      /eval\((base64_decode|gzinflate|gzuncompress|str_rot13)\(/,
    ],
    ['encoded_inflate', /(gzinflate|gzuncompress)\(base64_decode\(/],
    [
      'command_execution',
      /(shell_exec|system|exec|passthru|proc_open|popen)\([^;]{0,250}(base64_decode|\$_(get|post|request|cookie))/,
    ],
    ['request_eval', /eval\([^;]{0,250}\$_(get|post|request|cookie)/],
    ['encoded_javascript', /eval\((atob|unescape)\(/],
  ];
  return rules.filter(([, rule]) => rule.test(flat)).map(([id]) => id);
}
export async function scanPackage(
  bytes: Buffer,
  kind: 'plugin' | 'theme',
  expectedSlug?: string,
) {
  let slug: string | undefined;
  if (!bytes.length || bytes.length > PACKAGE_LIMIT)
    throw new Error('Invalid package size or protected slug.');
  // Restrict to a single ordinary ZIP directory. Match local and central headers
  // so the scanner and WordPress cannot interpret different filenames/payloads.
  let end = -1;
  for (
    let pos = bytes.length - 22;
    pos >= Math.max(0, bytes.length - 65557);
    pos--
  ) {
    if (
      bytes.readUInt32LE(pos) === 0x06054b50 &&
      pos + 22 + bytes.readUInt16LE(pos + 20) === bytes.length
    ) {
      end = pos;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10)
  )
    throw new Error('Unsupported archive directory.');
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (
    centralOffset + bytes.readUInt32LE(end + 12) !== end ||
    bytes.readUInt16LE(end + 10) > 2000
  )
    throw new Error('Unsupported archive directory.');
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, value) => (error ? reject(error) : resolve(value!)),
    ),
  );
  let count = 0;
  let total = 0;
  let scannedFiles = 0;
  const paths = new Set<string>();
  const regularPaths = new Set<string>();
  const ranges: Array<[number, number]> = [];
  const findings: AttachmentScan['findings'] = [];
  let metadata: { name: string; version: string } | undefined;
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      zip.close();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('Package inspection timed out.')),
      5000,
    );
    zip.on('error', (error) => finish(error));
    zip.on('end', () => finish());
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        const path = entry.fileName;
        const root = path.split('/')[0];
        if (
          !softwareSlug.safeParse(root).success ||
          root === 'sitepulse-connector' ||
          (expectedSlug !== undefined && root !== expectedSlug) ||
          (slug !== undefined && root !== slug)
        )
          throw new Error(
            'A single valid WordPress root directory is required.',
          );
        slug = root!;
        const canonical = path.toLowerCase().replace(/\/$/, '');
        const mode = entry.externalFileAttributes >>> 16;
        const fileType = mode & 0xf000;
        const offset = entry.relativeOffsetOfLocalHeader;
        if (
          offset < 0 ||
          offset + 30 > centralOffset ||
          bytes.readUInt32LE(offset) !== 0x04034b50
        )
          throw new Error('Invalid local archive header.');
        const nameLength = bytes.readUInt16LE(offset + 26);
        const dataOffset =
          offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
        const dataEnd = dataOffset + entry.compressedSize;
        const hasDataDescriptor = Boolean(entry.generalPurposeBitFlag & 8);
        if (
          dataEnd > centralOffset ||
          dataOffset > centralOffset ||
          bytes
            .subarray(offset + 30, offset + 30 + nameLength)
            .toString('utf8') !== path ||
          bytes.readUInt16LE(offset + 6) !== entry.generalPurposeBitFlag ||
          bytes.readUInt16LE(offset + 8) !== entry.compressionMethod ||
          (!hasDataDescriptor &&
            (bytes.readUInt32LE(offset + 14) !== entry.crc32 ||
              bytes.readUInt32LE(offset + 18) !== entry.compressedSize ||
              bytes.readUInt32LE(offset + 22) !== entry.uncompressedSize)) ||
          ranges.some(([start, stop]) => offset < stop && dataEnd > start)
        )
          throw new Error('Mismatched or overlapping archive entry.');
        ranges.push([offset, dataEnd]);
        const ancestors = canonical.split('/');
        ancestors.pop();
        while (ancestors.length) {
          if (regularPaths.has(ancestors.join('/')))
            throw new Error('File used as a directory.');
          ancestors.pop();
        }
        if (
          !path.endsWith('/') &&
          [...paths].some((existing) => existing.startsWith(`${canonical}/`))
        )
          throw new Error('File used as a directory.');
        total += entry.uncompressedSize;
        if (
          ++count > 2000 ||
          total > 40 * 1024 * 1024 ||
          entry.uncompressedSize > 2 * 1024 * 1024 ||
          path.length > 240 ||
          !/^[a-zA-Z0-9_./@+ -]+$/.test(path) ||
          !path.startsWith(`${slug}/`) ||
          path
            .replace(/\/$/, '')
            .split('/')
            .some((part) => !part || /[. ]$/.test(part)) ||
          paths.has(canonical) ||
          // ZIPs created on Windows commonly omit Unix mode bits entirely.
          // Treat mode 0 as an ordinary entry, while still rejecting declared
          // symlinks and other special file types.
          (mode !== 0 && ![0x8000, 0x4000].includes(fileType)) ||
          entry.generalPurposeBitFlag & 1 ||
          ![0, 8].includes(entry.compressionMethod)
        )
          throw new Error('Unsupported or unsafe archive structure.');
        paths.add(canonical);
        if (!path.endsWith('/')) regularPaths.add(canonical);
        if (path.endsWith('/')) {
          if (entry.compressedSize || entry.uncompressedSize)
            throw new Error('Directory entries cannot contain data.');
          zip.readEntry();
          return;
        }
        const stream = await new Promise<import('node:stream').Readable>(
          (res, rej) =>
            zip.openReadStream(entry, (error, value) =>
              error ? rej(error) : res(value!),
            ),
        );
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024 || done) {
            stream.destroy();
            throw new Error('Package inspection limit exceeded.');
          }
          chunks.push(chunk);
        }
        if (size !== entry.uncompressedSize)
          throw new Error('Invalid entry size.');
        const contentBytes = Buffer.concat(chunks);
        if (crc32(contentBytes) !== entry.crc32)
          throw new Error('Invalid entry checksum.');
        const contents = contentBytes.toString('utf8');
        if (
          /\.(php\d*|phtml|inc|js|mjs|html?|svg)(\.|$)/i.test(path) ||
          /<\?(php|=)/i.test(contents)
        ) {
          scannedFiles++;
          for (const rule of codeFindings(contents)) {
            if (findings.length < 100) findings.push({ rule, path });
          }
        }
        if (
          /\.(zip|gz|tar|phar|exe|dll|so)$/i.test(path) &&
          findings.length < 100
        )
          findings.push({ rule: 'embedded_executable_or_archive', path });
        const isHeader =
          kind === 'plugin'
            ? new RegExp(`^[^/]+/.+\\.php$`, 'i').test(path)
            : path === `${slug}/style.css`;
        if (isHeader) {
          const header = contents.slice(0, 8192);
          const name = header
            .match(
              kind === 'plugin'
                ? /^[ \t/*#]*Plugin Name:\s*([^\r\n]+)/im
                : /^[ \t/*#]*Theme Name:\s*([^\r\n]+)/im,
            )?.[1]
            ?.trim();
          const version = header.match(
            /^[ \t/*#]*Version:\s*([0-9a-zA-Z._+-]{1,80})/im,
          )?.[1];
          if (name && version) {
            if (metadata) throw new Error('Ambiguous package headers.');
            metadata = { name: name.slice(0, 150), version };
          }
        }
        if (!done) zip.readEntry();
      })().catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error('Invalid archive.')),
      );
    });
    zip.readEntry();
  });
  if (!metadata)
    throw new Error(
      'A single matching WordPress name/version header is required.',
    );
  return {
    slug: slug!,
    ...metadata,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    scan: {
      version: SCANNER_VERSION,
      status: findings.length ? 'blocked' : 'complete',
      scannedFiles,
      findings,
    } satisfies AttachmentScan,
  };
}
