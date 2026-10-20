import { Logger } from '@nestjs/common';
import type { SubscriptionChargerService } from './subscription-charger.service.js';
import { SubscriptionsScheduler } from './subscriptions.scheduler.js';

describe('SubscriptionsScheduler', () => {
  const original = process.env.SUBSCRIPTION_CHARGES_DISABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SUBSCRIPTION_CHARGES_DISABLED;
    } else {
      process.env.SUBSCRIPTION_CHARGES_DISABLED = original;
    }
    vi.restoreAllMocks();
  });

  const setup = () => {
    let release: () => void = () => undefined;
    const run = vi.fn(
      () => new Promise<number>((resolve) => (release = () => resolve(0))),
    );
    const scheduler = new SubscriptionsScheduler({
      run,
    } as unknown as SubscriptionChargerService);
    return { scheduler, run, release: () => release() };
  };

  it('skips a run while the previous one is still going', async () => {
    process.env.SUBSCRIPTION_CHARGES_DISABLED = 'false';
    const { scheduler, run, release } = setup();

    const first = scheduler.chargeDue();
    await scheduler.chargeDue();
    release();
    await first;

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does nothing when charges are disabled', async () => {
    process.env.SUBSCRIPTION_CHARGES_DISABLED = 'true';
    const { scheduler, run } = setup();

    await scheduler.chargeDue();
    scheduler.onApplicationBootstrap();

    expect(run).not.toHaveBeenCalled();
  });

  it('never rejects when a run fails', async () => {
    process.env.SUBSCRIPTION_CHARGES_DISABLED = 'false';
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const scheduler = new SubscriptionsScheduler({
      run: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as SubscriptionChargerService);

    await expect(scheduler.chargeDue()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
