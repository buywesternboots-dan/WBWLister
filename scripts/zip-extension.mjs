// Packs extension/ into public/wbw-importer.zip (stored, uncompressed) so the app can offer the extension for download.
// Runs before every build (package.json "build").
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { crc32 } from 'zlib';

const files = readdirSync('extension').map(name => [Buffer.from(`wbw-importer/${name}`), readFileSync(`extension/${name}`)]);
const local = [], central = [];
let offset = 0;
for (const [name, data] of files) {
  const crc = crc32(data), head = Buffer.alloc(30), dir = Buffer.alloc(46);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
  dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
  local.push(head, name, data); central.push(dir, name);
  offset += 30 + name.length + data.length;
}
const dir = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync('public', { recursive: true });
writeFileSync('public/wbw-importer.zip', Buffer.concat([...local, dir, end]));
console.log(`public/wbw-importer.zip: ${files.length} files`);
