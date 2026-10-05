import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const exportManifest = path.join(root, '.pages-export.json');

// Keep both supported Pages sources usable: branch main / root and the
// Actions artifact. Neither published entry can point to TypeScript source.
await rename(path.join(dist, 'dev.html'), path.join(dist, 'index.html'));
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (html.includes('/src/') || !/src="\.\/assets\/[^"\s]+\.js"/.test(html)) {
  throw new Error('Pages HTML must reference a compiled relative JavaScript bundle.');
}
await writeFile(path.join(dist, '.nojekyll'), '');

async function collect(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collect(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

// User music can be uploaded straight to the published root folder. Preserve
// those two files on future builds, including the GitHub Actions artifact.
for(const name of ['menu.mp3','game.mp3']){
  const source=path.join(root,'assets','audio',name);
  const destination=path.join(dist,'assets','audio',name);
  try{await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination)}
  catch(error){if(error.code!=='ENOENT')throw error}
}
const assetFiles = (await collect(path.join(dist, 'assets'), 'assets')).sort();
const exportFiles = ['index.html', '.nojekyll', ...assetFiles];
let previousFiles = [];
try {
  previousFiles = JSON.parse(await readFile(exportManifest, 'utf8')).files ?? [];
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

for (const relative of exportFiles) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root)) throw new Error(`Unsafe Pages export path: ${relative}`);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(dist, relative), target);
}

// Delete only obsolete files recorded by a previous export. Never recursively
// remove the assets directory or touch source public/assets.
for (const relative of previousFiles) {
  if (exportFiles.includes(relative)) continue;
  if (typeof relative !== 'string' || !relative.startsWith('assets/')) {
    throw new Error(`Unexpected obsolete Pages export: ${relative}`);
  }
  const target = path.resolve(root, relative);
  const assetRoot = path.join(root, 'assets') + path.sep;
  if (!target.startsWith(assetRoot)) throw new Error(`Unsafe obsolete export path: ${relative}`);
  await rm(target, { force: true });
}
await writeFile(exportManifest, `${JSON.stringify({ files: exportFiles }, null, 2)}\n`);
console.log(`Pages export ready: index.html and ${assetFiles.length} compiled/runtime asset files.`);
