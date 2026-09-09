import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/rate_limiter.js';

test('createRateLimiter: 上限内は許可される', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip1').allowed, true);
});

test('createRateLimiter: 上限を超えると拒否され、retryAfterMsが返る', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
  limiter.check('ip1');
  limiter.check('ip1');
  const result = limiter.check('ip1');
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0);
});

test('createRateLimiter: キー（IP）が異なれば互いに影響しない', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip2').allowed, true);
  assert.equal(limiter.check('ip1').allowed, false);
});

test('createRateLimiter: ウィンドウ経過後は再度許可される', async () => {
  const limiter = createRateLimiter({ windowMs: 50, maxRequests: 1 });
  assert.equal(limiter.check('ip1').allowed, true);
  assert.equal(limiter.check('ip1').allowed, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(limiter.check('ip1').allowed, true);
});
