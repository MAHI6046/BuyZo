const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'vendor', 'pg-protocol-dist');
const targetDir = path.join(__dirname, '..', 'node_modules', 'pg-protocol', 'dist');
const targetIndex = path.join(targetDir, 'index.js');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(sourceDir)) {
  console.error('[bootstrap] Missing vendor pg-protocol dist files');
  process.exit(1);
}

if (!fs.existsSync(targetIndex)) {
  copyDirRecursive(sourceDir, targetDir);
}
