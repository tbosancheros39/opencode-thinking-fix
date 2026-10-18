'use strict'
// CommonJS shim → boots the real ESM proxy.js (installed units call proxy.cjs)
import('./proxy.js').catch((err) => { console.error('[shim] failed to load proxy.js:', err); process.exit(1) })
