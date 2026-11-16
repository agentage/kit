import { expect, it, vi } from 'vitest';

it('a vi.waitFor with no bound waits past the 1 s default', async () => {
  const at = Date.now() + 1_500;
  await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(at));
});

it('a vi.waitFor with its own bound keeps it', async () => {
  const never = vi.waitFor(() => expect(true).toBe(false), { timeout: 100 });
  await expect(never).rejects.toThrow();
});
