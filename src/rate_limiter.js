/**
 * IPアドレス単位の簡易レート制限（固定ウィンドウ）。単一インスタンス運用のデモ規模を想定した
 * インメモリ実装（プロセス再起動でリセットされる、複数インスタンス間では共有されない）。
 * バックエンドのみで使用（n8n Codeノードには複製しない）。
 */
export function createRateLimiter({ windowMs, maxRequests }) {
  const hitsByKey = new Map();

  return {
    /** @returns {{allowed: boolean, retryAfterMs?: number}} */
    check(key) {
      const now = Date.now();
      const existing = (hitsByKey.get(key) ?? []).filter((t) => now - t < windowMs);

      if (existing.length >= maxRequests) {
        hitsByKey.set(key, existing);
        return { allowed: false, retryAfterMs: windowMs - (now - existing[0]) };
      }

      existing.push(now);
      hitsByKey.set(key, existing);
      return { allowed: true };
    },
  };
}
