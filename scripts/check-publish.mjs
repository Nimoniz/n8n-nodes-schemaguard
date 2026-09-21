import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const serialized = JSON.stringify(pkg);
const placeholders = ['YOUR_NAME', 'YOUR_EMAIL', 'YOUR_GITHUB_USERNAME'];
const found = placeholders.filter((token) => serialized.includes(token));

if (found.length) {
  console.error(`Publish blocked: replace package.json placeholders: ${found.join(', ')}`);
  process.exit(1);
}

console.log('Publish metadata check passed.');
