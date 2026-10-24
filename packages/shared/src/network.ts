import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address: string) {
  if (!isIP(address)) return false;
  const parsed = ipaddr.process(address);
  if (parsed.range() !== 'unicast') return false;
  // Fail closed for IPv6 outside global unicast, including translation ranges.
  return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
}
