/**
 * patch-expo-fingerprint.js
 *
 * EAS CLI 7.x resolves `expo/fingerprint` from the project's node_modules.
 * expo@51 doesn't export this path (it was added in SDK 52). This script
 * creates a shim so EAS CLI can resolve it via @expo/fingerprint, which
 * IS installed as a direct dependency.
 *
 * Runs automatically via the `postinstall` script in package.json.
 */

const fs   = require('fs');
const path = require('path');

const expoDir  = path.resolve(__dirname, '../node_modules/expo');
const shimPath  = path.join(expoDir, 'fingerprint.js');
const shimTypes = path.join(expoDir, 'fingerprint.d.ts');

if (!fs.existsSync(expoDir)) {
  console.log('[patch-expo-fingerprint] expo not yet installed, skipping.');
  process.exit(0);
}

if (!fs.existsSync(shimPath)) {
  fs.writeFileSync(shimPath, "module.exports = require('@expo/fingerprint');\n");
  console.log('[patch-expo-fingerprint] Created expo/fingerprint.js shim.');
} else {
  console.log('[patch-expo-fingerprint] expo/fingerprint.js already exists.');
}

if (!fs.existsSync(shimTypes)) {
  fs.writeFileSync(shimTypes, "export * from '@expo/fingerprint';\n");
  console.log('[patch-expo-fingerprint] Created expo/fingerprint.d.ts shim.');
}
