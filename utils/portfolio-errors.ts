/**
 * Lucrari — Portfolio Error Formatting, Localization & Typed Error Hierarchy
 * 
 * Provides:
 * - Structured, typed `PortfolioOperationError` class preserving transport retryability,
 *   PostgreSQL/Supabase error codes, cause, and localized user-facing messages.
 * - Deterministic, pure error categorization for idempotent retry decisions.
 * - Localized Turkish formatting for domain RPC exceptions and network failures.
 */

export class PortfolioOperationError extends Error {
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
    this.name = 'PortfolioOperationError';
    this.isRetryable = options?.isRetryable ?? false;
    this.code = options?.code ?? null;
    this.originalError = options?.originalError ?? options?.cause ?? null;
    if (options?.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, PortfolioOperationError.prototype);
  }
}

/**
 * Checks if a raw error object, string, or exception indicates a network/transport failure
 * that warrants an idempotent retry. Rejects deterministic server/domain errors.
 */
function isRawTransportError(err: unknown): boolean {
  if (!err) return false;
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const msg =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);

  const combined = `${code} ${msg}`.toLowerCase();

  // Explicitly reject deterministic domain, PostgreSQL, and auth errors
  if (
    combined.includes('pgrst') ||
    combined.includes('jwt') ||
    combined.includes('auth') ||
    combined.includes('session') ||
    combined.includes('oturum') ||
    combined.includes('expired') ||
    combined.includes('portfolio_') ||
    combined.includes('idempotency') ||
    combined.includes('reset_my_investments') ||
    combined.includes('duplicate key')
  ) {
    return false;
  }

  // Check for network/transport indicators
  return (
    combined.includes('fetch failed') ||
    combined.includes('network') ||
    combined.includes('timeout') ||
    combined.includes('timed out') ||
    combined.includes('abort') ||
    combined.includes('econnrefused') ||
    combined.includes('connection') ||
    combined.includes('offline')
  );
}

/**
 * Formats a Postgres / Supabase RPC error or network error into a localized, user-friendly Turkish message.
 */
export function formatPortfolioRpcError(err: unknown): string {
  if (!err) return 'Bilinmeyen bir hata oluştu.';
  const code =
    typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const msg =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);

  const combined = `${code} ${msg}`;

  // Network & Transport errors
  if (
    combined.includes('fetch failed') ||
    combined.includes('Network') ||
    combined.includes('network') ||
    combined.includes('timeout') ||
    combined.includes('Timeout') ||
    combined.includes('abort') ||
    combined.includes('ECONNREFUSED')
  ) {
    return 'İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.';
  }

  // Auth / Session errors
  if (
    combined.includes('JWT') ||
    combined.includes('auth') ||
    combined.includes('oturum') ||
    combined.includes('session')
  ) {
    return 'Kullanıcı oturumu doğrulanamadı. Lütfen tekrar deneyiniz.';
  }

  // Activity-specific RPC errors
  if (combined.includes('portfolio_activity_authentication_required')) {
    return 'Portföy hareketlerini görüntülemek için oturum açılması gerekmektedir.';
  }
  if (combined.includes('portfolio_activity_portfolio_required')) {
    return 'Geçerli bir portföy seçilmelidir.';
  }
  if (combined.includes('portfolio_activity_not_found_or_access_denied')) {
    return 'Portföy bulunamadı veya bu portföye erişim yetkiniz yok.';
  }
  if (combined.includes('portfolio_activity_limit_out_of_range')) {
    return 'Geçersiz sayfa boyutu belirtildi (1-100 arasında olmalıdır).';
  }
  if (combined.includes('portfolio_activity_invalid_filter')) {
    return 'Geçersiz hareket filtresi seçildi.';
  }
  if (combined.includes('portfolio_activity_search_too_long')) {
    return 'Arama metni çok uzun (en fazla 100 karakter olabilir).';
  }
  if (combined.includes('portfolio_activity_incomplete_cursor')) {
    return 'Sayfalama imleci eksik veya geçersiz.';
  }
  if (combined.includes('portfolio_activity_invalid_cursor_source')) {
    return 'Geçersiz sayfalama kaynak türü.';
  }

  if (combined.includes('portfolio_invalid_cash_amount')) return 'Nakit tutarı sıfır veya pozitif bir sayı olmalıdır.';

  if (combined.includes('portfolio_chart_invalid_filter')) return 'Geçersiz grafik filtresi seçildi.';
  if (combined.includes('portfolio_instrument_price_missing')) return 'Bazı varlıkların fiyatları alınamadığı için güncel değer kaydedilemedi.';
  if (combined.includes('portfolio_fx_price_missing')) return 'Dolar kuru alınamadığı için güncel değer kaydedilemedi.';

  // Domain-specific PostgreSQL RPC errors
  if (combined.includes('42501') || combined.includes('permission denied')) {
    return 'Bu işlemi gerçekleştirmek için yetkiniz bulunmuyor.';
  }
  if (combined.includes('portfolio_insufficient_position_for_reversal')) {
    return 'Geri alma işlemi pozisyon miktarını negatife düşüreceği için gerçekleştirilemedi.';
  }
  if (combined.includes('portfolio_insufficient_position')) {
    return 'Yetersiz pozisyon miktarı. Portföyünüzde bulunmayan veya sahip olduğunuzdan fazla miktarda satış yapamazsınız.';
  }
  if (combined.includes('portfolio_idempotency_conflict')) {
    return 'Bu işlem daha önce farklı parametrelerle gönderildi. Lütfen sayfayı yenileyip tekrar deneyin.';
  }
  if (combined.includes('portfolio_idempotency_incomplete')) {
    return 'Bu işlem henüz tamamlanmadı. Lütfen biraz bekleyip tekrar kontrol edin.';
  }
  if (combined.includes('portfolio_instrument_currency_mismatch')) {
    return 'İşlem para birimi ile varlık para birimi uyuşmuyor.';
  }
  if (combined.includes('portfolio_transaction_already_reversed')) {
    return 'Bu işlem zaten geri alınmış.';
  }
  if (combined.includes('PGRST202') || combined.includes('Could not find the function')) {
    return 'Veritabanı güncellemesi gerekli: İstenen fonksiyon sunucuda bulunamadı.';
  }

  // If msg is raw technical SQL / PostgreSQL exception, return safe fallback
  if (
    combined.includes('pgrst') ||
    combined.includes('syntax error') ||
    combined.includes('duplicate key') ||
    combined.includes('violates') ||
    combined.includes('column') ||
    combined.includes('relation') ||
    combined.includes('null value') ||
    combined.includes('function') ||
    combined.includes('get_my_portfolio_activity') ||
    combined.includes('details') ||
    combined.includes('hint')
  ) {
    return 'Veritabanı işlemi sırasında bir hata oluştu. Lütfen tekrar deneyiniz.';
  }

  return msg && msg.trim() ? msg.trim() : 'İşlem sırasında bir hata oluştu. Lütfen tekrar deneyiniz.';
}

export interface CreatePortfolioOperationErrorOptions {
  isRetryable?: boolean;
  code?: string | null;
  userMessageIsFinal?: boolean;
}

/**
 * Creates a typed `PortfolioOperationError` that bundles user-facing localized message,
 * transport retryability flag, and original cause metadata without technical backend leaks.
 */
export function createPortfolioOperationError(
  actionDescription: string,
  rawError?: unknown,
  options?: CreatePortfolioOperationErrorOptions
): PortfolioOperationError {
  if (rawError instanceof PortfolioOperationError && !actionDescription) {
    return rawError;
  }

  if (rawError === undefined || rawError === null) {
    return new PortfolioOperationError(actionDescription || 'İşlem sırasında bir hata oluştu.', {
      isRetryable: options?.isRetryable ?? false,
      code: options?.code ?? null,
      cause: null,
      originalError: null,
    });
  }

  const isRetryable = options?.isRetryable ?? isRawTransportError(rawError);

  const code =
    options?.code ??
    (typeof rawError === 'object' && rawError !== null && 'code' in rawError && typeof (rawError as { code: unknown }).code === 'string'
      ? (rawError as { code: string }).code
      : null);

  // If userMessageIsFinal is specified, actionDescription is the exact final message for the user.
  if (options?.userMessageIsFinal && actionDescription && actionDescription.trim()) {
    return new PortfolioOperationError(actionDescription.trim(), {
      isRetryable,
      code,
      cause: rawError,
      originalError: rawError,
    });
  }

  const formattedMsg = formatPortfolioRpcError(rawError);
  let fullMessage = actionDescription ? actionDescription.trim() : formattedMsg;

  if (actionDescription && formattedMsg && formattedMsg !== actionDescription) {
    const isTechnical =
      formattedMsg.includes('portfolio_activity_') ||
      formattedMsg.includes('syntax') ||
      formattedMsg.includes('violates') ||
      formattedMsg.includes('permission denied') ||
      formattedMsg.includes('get_my_portfolio_activity');

    const isActionTransport =
      isRawTransportError(actionDescription) ||
      actionDescription.includes('bağlantı') ||
      actionDescription.includes('İnternet');
    const isMsgTransport =
      isRawTransportError(formattedMsg) ||
      formattedMsg.includes('bağlantı') ||
      formattedMsg.includes('İnternet');

    if (isActionTransport && isMsgTransport) {
      fullMessage = actionDescription.trim();
    } else if (
      !isTechnical &&
      !formattedMsg.includes(actionDescription) &&
      !actionDescription.includes(formattedMsg)
    ) {
      fullMessage = `${actionDescription.trim()}: ${formattedMsg.trim()}`;
    }
  }

  return new PortfolioOperationError(fullMessage, {
    isRetryable,
    code,
    cause: rawError,
    originalError: rawError,
  });
}

/**
 * Determines whether an error is a retryable network / transport failure whose server-side
 * outcome may be uncertain (timeout, fetch failed, aborted request, offline).
 * Checks PortfolioOperationError metadata, cause/originalError chains, and raw error patterns.
 * Returns false for deterministic domain errors (auth, RPC not found, idempotency conflict, validation).
 */
export function isRetryablePortfolioTransportError(err: unknown): boolean {
  if (!err) return false;

  // 1. Direct typed error inspection
  if (err instanceof PortfolioOperationError) {
    return err.isRetryable;
  }

  // 2. Structured error object with isRetryable property
  if (typeof err === 'object' && err !== null && 'isRetryable' in err && typeof (err as any).isRetryable === 'boolean') {
    return (err as any).isRetryable;
  }

  // 3. Inspect cause or originalError chain if present
  if (typeof err === 'object' && err !== null && ('cause' in err || 'originalError' in err)) {
    const nested = (err as any).cause || (err as any).originalError;
    if (nested && nested !== err && isRetryablePortfolioTransportError(nested)) {
      return true;
    }
  }

  // 4. Raw transport fallback
  return isRawTransportError(err);
}
