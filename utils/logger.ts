export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEvent = `${string}.${string}`;

export interface LogOptions {
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
}

export interface LogError {
  name: string;
  message: string;
  code: string | null;
  stack: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  event: string;
  message: string;
  context: Record<string, unknown>;
  error: LogError | null;
}

export interface ScopedLogger {
  debug: (event: LogEvent, options: LogOptions) => void;
  info: (event: LogEvent, options: LogOptions) => void;
  warn: (event: LogEvent, options: LogOptions) => void;
  error: (event: LogEvent, options: LogOptions) => void;
}

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const REDACTED = '[REDACTED]';
const PRIVATE_FIELDS = new Set([
  'password', 'passwd', 'secret', 'clientsecret', 'apikey', 'key',
  'token', 'accesstoken', 'refreshtoken', 'usertoken', 'authorization',
  'cookie', 'setcookie', 'anonkey', 'publishablekey', 'servicerolekey',
  'email', 'phone', 'address', 'name', 'username', 'fullname', 'user', 'title', 'notes',
  'body', 'payload', 'data', 'params', 'credentials', 'idempotencykey', 'clientrequestid',
]);

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, REDACTED)
    .replace(/\b(?:sb_(?:secret|publishable)_|sbp_|sk-)[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie|token)\s*["']?\s*[:=]\s*["']?)[^\s&"',;}]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED);
}

function sanitizeValue(value: unknown, ancestors = new Set<object>(), depth = 0): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object' || value === null) {
    return typeof value === 'function' || typeof value === 'symbol' ? '[Unsupported]' : value;
  }
  if (ancestors.has(value)) return '[Circular]';
  if (depth >= 8) return '[MaxDepth]';
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => sanitizeValue(item, ancestors, depth + 1));
  } else {
    const entries = Object.entries(value).map(([key, item]) => {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const privateField = PRIVATE_FIELDS.has(normalized) || normalized.endsWith('userid');
      return [key, privateField ? REDACTED : sanitizeValue(item, ancestors, depth + 1)];
    });
    result = Object.fromEntries(entries);
  }
  ancestors.delete(value);
  return result;
}

function normalizeError(error: unknown): LogError | null {
  if (error === undefined || error === null) return null;
  const details = typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    name: typeof details.name === 'string' ? sanitizeText(details.name) : 'Error',
    message: sanitizeText(typeof details.message === 'string' ? details.message : String(error)),
    code: typeof details.code === 'string' ? sanitizeText(details.code) : null,
    stack: typeof details.stack === 'string' ? sanitizeText(details.stack) : null,
  };
}

class AppLogger {
  private minLevel: LogLevel = typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info';
  private logBuffer: LogEntry[] = [];
  private isSilent = false;

  public setMinLevel(level: LogLevel): void { this.minLevel = level; }
  public setSilent(silent: boolean): void { this.isSilent = silent; }
  public sanitize(data: unknown): unknown { return sanitizeValue(data); }

  private log(level: LogLevel, scope: string, event: LogEvent, options: LogOptions): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope: sanitizeText(scope),
      event: sanitizeText(event),
      message: sanitizeText(options.message),
      context: sanitizeValue(options.context ?? {}) as Record<string, unknown>,
      error: normalizeError(options.error),
    };
    // Keep diagnostics in memory even when console output is filtered or silenced.
    this.logBuffer.push(entry);
    if (this.logBuffer.length > 100) this.logBuffer.shift();
    if (this.isSilent || SEVERITY[level] < SEVERITY[this.minLevel]) return;

    const context = JSON.stringify(entry.context);
    const failure = entry.error ? ` error=${JSON.stringify(entry.error)}` : '';
    const line = `${entry.timestamp} ${level.toUpperCase()} [${entry.scope}] ${entry.event} ${JSON.stringify(entry.message)} context=${context}${failure}`;
    const output = { debug: console.debug, info: console.info, warn: console.warn, error: console.error }[level];
    output(line);
  }

  public debug(scope: string, event: LogEvent, options: LogOptions): void { this.log('debug', scope, event, options); }
  public info(scope: string, event: LogEvent, options: LogOptions): void { this.log('info', scope, event, options); }
  public warn(scope: string, event: LogEvent, options: LogOptions): void { this.log('warn', scope, event, options); }
  public error(scope: string, event: LogEvent, options: LogOptions): void { this.log('error', scope, event, options); }

  public createScoped(scope: string): ScopedLogger {
    return {
      debug: (event, options) => this.debug(scope, event, options),
      info: (event, options) => this.info(scope, event, options),
      warn: (event, options) => this.warn(scope, event, options),
      error: (event, options) => this.error(scope, event, options),
    };
  }

  public getRecentLogs(limit = 50): LogEntry[] {
    if (!Number.isFinite(limit) || limit <= 0) return [];
    return JSON.parse(JSON.stringify(this.logBuffer.slice(-Math.floor(limit)))) as LogEntry[];
  }

  public exportLogs(): string { return JSON.stringify(this.logBuffer); }
  public clearLogs(): void { this.logBuffer = []; }
}

export const logger = new AppLogger();
export const createScopedLogger = (scope: string): ScopedLogger => logger.createScoped(scope);
