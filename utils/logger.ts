/**
 * Centralized Application Logger
 * 
 * Provides leveled, structured, and scoped logging with automatic sanitization
 * of sensitive credentials, compact 1-line terminal output, and an in-memory buffer.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string; // ISO 8601
  level: LogLevel;
  scope: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  error?: Error | unknown | null;
}

export interface ScopedLogger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadataOrError?: Record<string, unknown> | unknown) => void;
  error: (message: string, error?: unknown, metadata?: Record<string, unknown>) => void;
}

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEY_PATTERNS = [
  /key/i,
  /secret/i,
  /token/i,
  /password/i,
  /authorization/i,
  /auth/i,
  /apikey/i,
  /anon/i,
  /service_role/i,
];

// Maximum log entries kept in memory buffer
const MAX_LOG_BUFFER_SIZE = 100;

/**
 * Formats metadata into a clean, compact single-line string (e.g. " • events=39, days=17")
 */
function formatCompactMetadata(metadata?: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  const entries = Object.entries(metadata)
    .filter(([_, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => {
      if (typeof v === 'string') {
        const shortVal = v.length > 20 ? `${v.slice(0, 12)}..` : v;
        return `${k}=${shortVal}`;
      }
      return `${k}=${v}`;
    });

  return entries.length > 0 ? ` • ${entries.join(', ')}` : '';
}

function formatErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    if ('message' in err && typeof (err as any).message === 'string') {
      return (err as any).message;
    }
    if ('error' in err) {
      return formatErrorMessage((err as any).error);
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

class AppLogger {
  private minLevel: LogLevel = typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info';
  private logBuffer: LogEntry[] = [];
  private isSilent: boolean = false;

  /**
   * Sets minimum log level to output to console
   */
  public setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Disables console output (useful during unit tests)
   */
  public setSilent(silent: boolean): void {
    this.isSilent = silent;
  }

  /**
   * Sanitizes objects and primitives to prevent credential leakage
   */
  public sanitize(data: unknown): unknown {
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object') {
      if (typeof data === 'string' && data.length > 30 && (data.includes('eyJ') || data.startsWith('sbp_'))) {
        return `${data.slice(0, 6)}...***`;
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(k));
      if (isSensitive) {
        sanitizedObj[k] = typeof v === 'string' && v.length > 0 ? `${v.slice(0, 4)}...***` : '***';
      } else {
        sanitizedObj[k] = this.sanitize(v);
      }
    }
    return sanitizedObj;
  }

  private log(
    level: LogLevel,
    scope: string,
    message: string,
    metadata?: Record<string, unknown> | null,
    error?: unknown
  ): void {
    const errorStr = formatErrorMessage(error);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
      metadata: metadata ? (this.sanitize(metadata) as Record<string, unknown>) : null,
      error: error ? (error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : errorStr) : null,
    };

    // Store in memory ring buffer
    this.logBuffer.push(entry);
    if (this.logBuffer.length > MAX_LOG_BUFFER_SIZE) {
      this.logBuffer.shift();
    }

    // Check level gate
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.minLevel]) {
      return;
    }

    if (this.isSilent) {
      return;
    }

    // Compact single-line console output
    const metaSuffix = formatCompactMetadata(entry.metadata);
    const line = `[${scope}] ${message}${metaSuffix}`;

    switch (level) {
      case 'debug':
        console.debug(line);
        break;
      case 'info':
        console.log(line);
        break;
      case 'warn':
        console.warn(line, errorStr ? `• Error: ${errorStr}` : '');
        break;
      case 'error':
        console.error(line, errorStr ? `• Error: ${errorStr}` : '');
        break;
    }
  }

  public debug(scope: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', scope, message, metadata);
  }

  public info(scope: string, message: string, metadata?: Record<string, unknown>): void {
    this.log('info', scope, message, metadata);
  }

  public warn(scope: string, message: string, metadataOrError?: Record<string, unknown> | unknown): void {
    if (metadataOrError instanceof Error || typeof metadataOrError === 'string') {
      this.log('warn', scope, message, null, metadataOrError);
    } else {
      this.log('warn', scope, message, metadataOrError as Record<string, unknown>);
    }
  }

  public error(scope: string, message: string, errorOrMeta?: unknown, metadata?: Record<string, unknown>): void {
    if (errorOrMeta instanceof Error || typeof errorOrMeta === 'string') {
      this.log('error', scope, message, metadata, errorOrMeta);
    } else if (typeof errorOrMeta === 'object' && errorOrMeta !== null && 'error' in errorOrMeta) {
      const { error: embeddedErr, ...restMeta } = errorOrMeta as { error: unknown; [key: string]: unknown };
      this.log('error', scope, message, restMeta, embeddedErr);
    } else {
      this.log('error', scope, message, errorOrMeta as Record<string, unknown>, null);
    }
  }

  public createScoped(scope: string): ScopedLogger {
    return {
      debug: (msg, meta) => this.debug(scope, msg, meta),
      info: (msg, meta) => this.info(scope, msg, meta),
      warn: (msg, metaOrErr) => this.warn(scope, msg, metaOrErr),
      error: (msg, err, meta) => this.error(scope, msg, err, meta),
    };
  }

  public getRecentLogs(limit = 50): LogEntry[] {
    return this.logBuffer.slice(-limit);
  }

  public clearLogs(): void {
    this.logBuffer = [];
  }
}

export const logger = new AppLogger();
export const createScopedLogger = (scope: string) => logger.createScoped(scope);
