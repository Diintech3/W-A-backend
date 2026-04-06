const isProd = process.env.NODE_ENV === 'production';

const COLORS = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

const ICONS = {
  info:  '✔',
  warn:  '⚠',
  error: '✖',
};

function timestamp() {
  return new Date().toLocaleTimeString('en-IN', { hour12: false });
}

function formatMeta(meta) {
  if (!meta || !Object.keys(meta).length) return '';
  return (
    '  ' +
    COLORS.dim +
    Object.entries(meta)
      .map(([k, v]) => `${k}: ${v}`)
      .join('  |  ') +
    COLORS.reset
  );
}

function log(level, message, meta = {}) {
  if (isProd) {
    // production: structured JSON for log aggregators
    console[level === 'error' ? 'error' : 'log'](
      JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta })
    );
    return;
  }

  const color =
    level === 'error' ? COLORS.red : level === 'warn' ? COLORS.yellow : COLORS.green;

  const icon  = ICONS[level] || '•';
  const badge = color + icon + COLORS.reset;
  const msg   = COLORS.white + message + COLORS.reset;

  console.log(`  ${badge}  ${msg}${formatMeta(meta)}`);
}

module.exports = {
  info:  (message, meta) => log('info',  message, meta),
  warn:  (message, meta) => log('warn',  message, meta),
  error: (message, meta) => log('error', message, meta),
};
