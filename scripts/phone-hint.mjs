#!/usr/bin/env node
// Run by `pnpm phone` before the servers start: says how to reach the build from a phone with Tailscale,
// and whether the tailscale command is there. Never fails, so the servers always start.
import { execFileSync } from 'node:child_process';

const PORT = 4173;
// The Mac App Store and standalone apps ship the command inside the app instead of on the PATH.
const COMMANDS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
const SETUP = 'Setup: README.md, "Use it on your phone".';

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
  } catch {
    return null;
  }
}

const tailscale = COMMANDS.find((command) => run(command, ['version']) !== null);
const lines = [`Phone: the app is built and served on http://127.0.0.1:${PORT}.`];

if (!tailscale) {
  lines.push(
    "The tailscale command wasn't found. Install Tailscale on this Mac and your phone (free for personal use),",
    'sign in to the same account on both: https://tailscale.com/download',
    `Then run \`tailscale serve --bg ${PORT}\` and open the https://….ts.net address on your phone. ${SETUP}`,
  );
} else {
  const status = run(tailscale, ['serve', 'status']) ?? '';
  const address = status.includes(`127.0.0.1:${PORT}`) ? status.match(/https:\/\/\S+\.ts\.net\S*/)?.[0] : undefined;
  if (address) {
    lines.push(`Already shared through Tailscale: open ${address} on your phone.`);
  } else {
    lines.push(
      `To open it on your phone, run \`tailscale serve --bg ${PORT}\` in another terminal`,
      `and open the https://….ts.net address it prints. ${SETUP}`,
    );
  }
}

console.log(`\n${lines.join('\n')}\n`);
