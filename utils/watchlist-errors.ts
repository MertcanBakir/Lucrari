/**
 * Lucrari — Watchlist Error Formatting, Localization & Typed Error Hierarchy
 * 
 * Provides:
 * - Structured, typed `WatchlistOperationError` class.
 * - Dedicated `WatchlistPageOutOfBoundsError` and `isWatchlistPageOutOfRangeError` type guard.
 * - Localized Turkish formatting for domain RPC exceptions, authentication issues, and network failures.
 * - Sanitizes raw PostgreSQL / Supabase / JWT error strings to prevent leaking technical details to UI.
 */

export const WATCHLIST_PAGE_OUT_OF_RANGE = 'WATCHLIST_PAGE_OUT_OF_RANGE';

export class WatchlistOperationError extends Error {
  readonly isRetryable: boolean;
  readonly code: string | null;
  readonly originalError: unknown;

  constructor(
    message: string,
    options?: {
      isRetryable?: boolean;
      code?: string | null;
      cause?: unknown;
      originalError?: unknown;
    }
  ) {
    super(message);
    this.name = 'WatchlistOperationError';
    this.isRetryable = options?.isRetryable ?? false;
    this.code = options?.code ?? null;
    this.originalError = options?.originalError ?? options?.cause ?? null;
    if (options?.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, WatchlistOperationError.prototype);
  }
}

export class WatchlistPageOutOfBoundsError extends WatchlistOperationError {
  readonly requestedOffset: number;

  constructor(requestedOffset: number) {
    super('İzleme listesi sayfası aralık dışında.', {
      code: WATCHLIST_PAGE_OUT_OF_RANGE,
      isRetryable: false,
    });
    this.name = 'WatchlistPageOutOfBoundsError';
    this.requestedOffset = requestedOffset;
    Object.setPrototypeOf(this, WatchlistPageOutOfBoundsError.prototype);
  }
}

export function isWatchlistPageOutOfRangeError(error: unknown): error is WatchlistPageOutOfBoundsError {
  return (
    error instanceof WatchlistPageOutOfBoundsError ||
    (error instanceof WatchlistOperationError && error.code === WATCHLIST_PAGE_OUT_OF_RANGE) ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === WATCHLIST_PAGE_OUT_OF_RANGE)
  );
}

export function createWatchlistPageOutOfBoundsError(requestedOffset: number): WatchlistPageOutOfBoundsError {
  return new WatchlistPageOutOfBoundsError(requestedOffset);
}

/**
 * Maps PostgreSQL/Supabase RPC error messages and codes to user-friendly Turkish descriptions.
 */
export function formatWatchlistRpcError(error: unknown): string {
  if (!error) {
    return 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.';
  }

  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '';

  const lower = rawMessage.toLowerCase();

  // 1. Specific RPC error codes
  if (lower.includes('watchlist_authentication_required') || lower.includes('auth') || lower.includes('session')) {
    return 'İzleme listesini görüntülemek ve düzenlemek için oturum açılması gerekmektedir.';
  }
  if (lower.includes('watchlist_limit_out_of_range')) {
    return 'Geçersiz sayfalama limiti belirtildi.';
  }
  if (lower.includes('watchlist_offset_out_of_range') || lower.includes('aralık dışında')) {
    return 'Geçersiz sayfalama aralığı belirtildi.';
  }
  if (lower.includes('watchlist_instrument_id_required')) {
    return 'Geçerli bir varlık/enstrüman seçilmelidir.';
  }
  if (lower.includes('watchlist_state_required')) {
    return 'İzleme durumu parametresi eksik.';
  }
  if (lower.includes('watchlist_instrument_not_found')) {
    return 'İlgili finansal varlık sistemde bulunamadı.';
  }
  if (lower.includes('watchlist_instrument_inactive')) {
    return 'Bu finansal varlık artık aktif işlem görmüyor.';
  }

  // 2. Network & Transport failures
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('timeout') ||
    lower.includes('offline') ||
    lower.includes('failed to fetch') ||
    lower.includes('abort')
  ) {
    return 'Ağ bağlantısı kurulamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyiniz.';
  }

  // 3. Fallback sanitized Turkish error message
  return 'İzleme listesi işlemi gerçekleştirilemedi. Lütfen tekrar deneyiniz.';
}

export function createWatchlistOperationError(
  customMessage: string,
  cause?: unknown,
  code?: string
): WatchlistOperationError {
  const isRetryable = Boolean(
    cause &&
      typeof cause === 'object' &&
      'message' in cause &&
      typeof (cause as { message: unknown }).message === 'string' &&
      ((cause as { message: string }).message.toLowerCase().includes('network') ||
        (cause as { message: string }).message.toLowerCase().includes('timeout') ||
        (cause as { message: string }).message.toLowerCase().includes('fetch'))
  );

  return new WatchlistOperationError(customMessage, {
    cause,
    code: code ?? null,
    isRetryable,
  });
}
