const fs = require('fs');
const path = require('path');

const legacyFiles = [
  'StakeStreetApp.tsx',
  'page.tsx',
  path.join('components', 'StakeStreetApp.tsx')
];

for (const relativePath of legacyFiles) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { force: true });
    console.log(`Removed legacy file: ${relativePath}`);
  }
}

const componentsDir = path.join(process.cwd(), 'components');
if (fs.existsSync(componentsDir) && fs.readdirSync(componentsDir).length === 0) {
  fs.rmdirSync(componentsDir);
}
