import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Create a standard ZIP using Node built-ins; no platform-specific archiver is needed.
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error('扩展版本与项目版本不一致');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const entries = [], directory = [];
let offset = 0;
for (const file of pkg.files) {
  const name = Buffer.from(file, 'utf8');
  const content = await readFile(join(root, file));
  const compressed = deflateRawSync(content);
  const crc = crc32(content);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); // 1980-01-01; stable metadata keeps packages reproducible.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  entries.push(header, name, compressed);
  directory.push(central, name);
  offset += header.length + name.length + compressed.length;
}
const centralDirectory = Buffer.concat(directory);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(pkg.files.length, 8);
end.writeUInt16LE(pkg.files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
const destination = join(root, 'dist', `${pkg.name}-v${manifest.version}.zip`);
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(destination, Buffer.concat([...entries, centralDirectory, end]));
console.log(`Packaged ${pkg.files.length} extension files: ${destination}`);
