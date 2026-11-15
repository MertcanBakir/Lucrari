/**
 * Lucrari — Portfolio Error Formatter & Operation Error Unit Tests
 * 
 * Validates accurate translation of database RPC errors, network exceptions,
 * and auth errors into user-friendly Turkish messages, as well as the typed
 * `PortfolioOperationError` class and end-to-end transport retryability pipeline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPortfolioRpcError,
  isRetryablePortfolioTransportError,
  createPortfolioOperationError,
  PortfolioOperationError,
} from '../utils/portfolio-errors';
import { resetMyInvestments } from '../services/portfolio/portfolio-service';
import { getSupabaseClient } from '../services/supabase/client';

describe('Portfolio Error Formatter & Classifier', () => {
  it('should format domain-specific PostgreSQL RPC errors into localized Turkish', () => {
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_cash' }),
      'Yetersiz nakit bakiyesi. Lütfen nakit tutarınızı kontrol edin veya para yatırın.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_account_not_initialized' }),
      'Nakit hesabı henüz kurulmamış. Lütfen önce nakit bakiyenizi kurun.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_account_already_initialized' }),
      'Bu portföy için nakit hesapları zaten başlatılmış.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_invariant_violation' }),
      'Nakit bakiyesi negatif olamaz. İşlem finansal güvenlik kuralları gereği iptal edildi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_idempotency_conflict' }),
      'Bu işlem daha önce farklı parametrelerle gönderildi. Lütfen sayfayı yenileyip tekrar deneyin.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_idempotency_incomplete' }),
      'Bu işlem henüz tamamlanmadı. Lütfen biraz bekleyip tekrar kontrol edin.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_instrument_currency_mismatch' }),
      'İşlem para birimi ile varlık para birimi uyuşmuyor.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_cash_for_reversal' }),
      'Geri alma işlemi nakit bakiyesini negatife düşüreceği için gerçekleştirilemedi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_position_for_reversal' }),
      'Geri alma işlemi pozisyon miktarını negatife düşüreceği için gerçekleştirilemedi.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_insufficient_position' }),
      'Yetersiz pozisyon miktarı. Portföyünüzde bulunmayan veya sahip olduğunuzdan fazla miktarda satış yapamazsınız.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_transaction_already_reversed' }),
      'Bu işlem zaten geri alınmış.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'portfolio_cash_flow_already_reversed' }),
      'Bu nakit hareketi zaten geri alınmış.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ code: 'PGRST202' }),
      'Veritabanı güncellemesi gerekli: İstenen fonksiyon sunucuda bulunamadı.'
    );
  });

  it('should format network and timeout errors into friendly Turkish messages', () => {
    assert.strictEqual(
      formatPortfolioRpcError(new Error('TypeError: fetch failed')),
      'İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.'
    );
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'Network request timed out' }),
      'İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.'
    );
    assert.strictEqual(
      formatPortfolioRpcError('ECONNREFUSED 127.0.0.1:54321'),
      'İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.'
    );
  });

  it('should format session / JWT errors into friendly Turkish messages', () => {
    assert.strictEqual(
      formatPortfolioRpcError({ message: 'JWT expired' }),
      'Kullanıcı oturumu doğrulanamadı. Lütfen tekrar deneyiniz.'
    );
  });

  describe('PortfolioOperationError & createPortfolioOperationError', () => {
    it('should create a PortfolioOperationError with isRetryable=true for network errors', () => {
      const rawError = new Error('TypeError: fetch failed');
      const opError = createPortfolioOperationError('Yatırımlar sıfırlanamadı', rawError);

      assert.ok(opError instanceof PortfolioOperationError);
      assert.strictEqual(opError.name, 'PortfolioOperationError');
      assert.strictEqual(opError.isRetryable, true);
      assert.strictEqual(opError.message, 'Yatırımlar sıfırlanamadı: İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.');
      assert.strictEqual(opError.cause, rawError);
    });

    it('should create a PortfolioOperationError with isRetryable=false for domain/auth errors', () => {
      const rawError = { message: 'portfolio_insufficient_cash', code: 'P0001' };
      const opError = createPortfolioOperationError('İşlem kaydedilemedi', rawError);

      assert.ok(opError instanceof PortfolioOperationError);
      assert.strictEqual(opError.isRetryable, false);
      assert.strictEqual(opError.code, 'P0001');
      assert.strictEqual(opError.message, 'İşlem kaydedilemedi: Yetersiz nakit bakiyesi. Lütfen nakit tutarınızı kontrol edin veya para yatırın.');
    });
  });

  describe('isRetryablePortfolioTransportError', () => {
    it('should return true for network, timeout, and transport failures', () => {
      assert.strictEqual(isRetryablePortfolioTransportError(new Error('TypeError: fetch failed')), true);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'Network request timed out' }), true);
      assert.strictEqual(isRetryablePortfolioTransportError('ECONNREFUSED 127.0.0.1:54321'), true);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'The operation was aborted' }), true);
      assert.strictEqual(isRetryablePortfolioTransportError('Connection reset by peer'), true);
    });

    it('should return false for deterministic domain, auth, and database errors', () => {
      assert.strictEqual(isRetryablePortfolioTransportError({ code: 'PGRST202', message: 'Could not find function' }), false);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'JWT expired' }), false);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'portfolio_idempotency_conflict' }), false);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'portfolio_insufficient_cash' }), false);
      assert.strictEqual(isRetryablePortfolioTransportError({ message: 'portfolio_cash_account_not_initialized' }), false);
      assert.strictEqual(isRetryablePortfolioTransportError(null), false);
      assert.strictEqual(isRetryablePortfolioTransportError(undefined), false);
    });
  });

  describe('End-to-End Reset Transport Error Pipeline', () => {
    it('should classify resetMyInvestments thrown error as retryable=true on RPC fetch failure', async () => {
      const client = getSupabaseClient();
      const originalRpc = client.rpc;

      (client as any).rpc = () => {
        return Promise.resolve({
          data: null,
          error: { message: 'TypeError: fetch failed' },
        });
      };

      try {
        let caughtError: unknown = null;
        try {
          await resetMyInvestments({ clientRequestId: 'test-req-123' });
        } catch (err) {
          caughtError = err;
        }

        assert.ok(caughtError !== null, 'resetMyInvestments must throw an error');
        assert.ok(caughtError instanceof PortfolioOperationError);
        assert.strictEqual(isRetryablePortfolioTransportError(caughtError), true, 'Service-wrapped transport error must evaluate to isRetryable=true');
        assert.strictEqual(
          (caughtError as Error).message,
          'Yatırımlar sıfırlanamadı: İnternet bağlantısı kurulamadı. Lütfen ağınızı kontrol edip tekrar deneyiniz.'
        );
      } finally {
        client.rpc = originalRpc;
      }
    });

    it('should classify resetMyInvestments thrown error as retryable=false on RPC domain error', async () => {
      const client = getSupabaseClient();
      const originalRpc = client.rpc;

      (client as any).rpc = () => {
        return Promise.resolve({
          data: null,
          error: { message: 'portfolio_idempotency_conflict', code: 'P0001' },
        });
      };

      try {
        let caughtError: unknown = null;
        try {
          await resetMyInvestments({ clientRequestId: 'test-req-456' });
        } catch (err) {
          caughtError = err;
        }

        assert.ok(caughtError !== null);
        assert.ok(caughtError instanceof PortfolioOperationError);
        assert.strictEqual(isRetryablePortfolioTransportError(caughtError), false, 'Service-wrapped domain error must evaluate to isRetryable=false');
        assert.strictEqual(
          (caughtError as Error).message,
          'Yatırımlar sıfırlanamadı: Bu işlem daha önce farklı parametrelerle gönderildi. Lütfen sayfayı yenileyip tekrar deneyin.'
        );
      } finally {
        client.rpc = originalRpc;
      }
    });

    it('should classify resetMyInvestments thrown error as retryable=false on PGRST202 error', async () => {
      const client = getSupabaseClient();
      const originalRpc = client.rpc;

      (client as any).rpc = () => {
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function reset_my_investments' },
        });
      };

      try {
        let caughtError: unknown = null;
        try {
          await resetMyInvestments({ clientRequestId: 'test-req-789' });
        } catch (err) {
          caughtError = err;
        }

        assert.ok(caughtError !== null);
        assert.ok(caughtError instanceof PortfolioOperationError);
        assert.strictEqual(isRetryablePortfolioTransportError(caughtError), false);
        assert.strictEqual(
          (caughtError as Error).message,
          'Yatırımlar sıfırlanamadı: Veritabanı güncellemesi gerekli: İstenen fonksiyon sunucuda bulunamadı.'
        );
      } finally {
        client.rpc = originalRpc;
      }
    });
  });
});
