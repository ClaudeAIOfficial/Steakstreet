const fs = require('fs');
const path = require('path');

const required = [
  'app/page.tsx',
  'app/layout.tsx',
  'app/globals.css',
  'app/lib/abi.ts',
  'app/lib/chain.ts'
];
for (const file of required) {
  if (!fs.existsSync(path.join(process.cwd(), file))) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}
console.log('StakeStreet project structure verified.');
