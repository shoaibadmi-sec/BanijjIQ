/**
 * Cloudflare Workers Builds "Deploy command" for its production branch.
 * Deliberately uploads/deploys NOTHING. Preview branch has a different
 * "Preview command" using 'wrangler preview' and is the ONLY published path.
 */
console.log('PRODUCTION BUILD DISABLED for the hisabiq-pr-preview Worker.');
console.log('Cloudflare preview deploys only via the Preview command, not from main.');
