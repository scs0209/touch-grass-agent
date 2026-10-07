const THIS_COMPUTER = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The app is open on the Mac running Gemma, not on a phone reaching it through Tailscale. */
export const isOnThisComputer = (hostname: string) => THIS_COMPUTER.has(hostname);
