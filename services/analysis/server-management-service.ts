import { getSupabaseClient } from '@/services/supabase/client';
import { createScopedLogger } from '@/utils/logger';

export type ServerState = 'stopped' | 'pending' | 'running' | 'stopping';
export type ServerAction = 'status' | 'start' | 'stop';
const log = createScopedLogger('ServerManagement');

export class ServerManagementError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = 'ServerManagementError';
  }
}

export function getServerManagementUrl(): string {
  const raw = process.env.EXPO_PUBLIC_SERVER_MANAGEMENT_API_URL?.trim();
  try {
    if (!raw) throw new Error('missing');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new ServerManagementError('Sunucu yönetim adresi yapılandırılmamış veya geçersiz.');
  }
}

// Mutations are never automatically retried: a lost response may follow an accepted operation.
export async function requestServerManagement(
  action: ServerAction, userId: string, signal?: AbortSignal,
): Promise<ServerState> {
  const base = getServerManagementUrl();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15_000);
  try {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error || !data.session?.access_token || data.session.user.id !== userId) {
      throw new ServerManagementError('Oturumunuzu yenileyin ve tekrar deneyin.', 401);
    }
    if (signal?.aborted || controller.signal.aborted) throw new Error('aborted');
    const response = await fetch(`${base}/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401) throw new ServerManagementError('Oturumunuzu yenileyin ve tekrar deneyin.', 401);
      if (response.status === 403) throw new ServerManagementError('Sunucu yönetimi için yetkiniz yok.', 403);
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        const code = body?.code ?? body?.error?.code ?? body?.error ?? body?.detail?.code ?? body?.detail;
        if (code === 'ANALYSIS_ACTIVE') throw new ServerManagementError('Bekleyen veya çalışan analiz var. Sunucu durdurulmadı.', 409);
      }
      throw new ServerManagementError('Sunucu durumu doğrulanamadı. Yeniden deneyin.', response.status);
    }
    const body = await response.json();
    if (!['stopped', 'pending', 'running', 'stopping'].includes(body?.state)) {
      throw new ServerManagementError('Sunucu yönetimi beklenmeyen bir yanıt döndürdü.');
    }
    return body.state as ServerState;
  } catch (error) {
    const failure = error instanceof ServerManagementError ? error : new ServerManagementError('Sunucu yönetimine erişilemiyor. Yeniden deneyin.');
    log[signal?.aborted ? 'debug' : 'warn']('server.management.failed', {
      message: 'Server management request failed.', context: { action, status: failure.status },
    });
    throw failure;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
