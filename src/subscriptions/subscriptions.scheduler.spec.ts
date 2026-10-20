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

  it('runs once more after the current run when asked while it is going', async () => {
    process.env.SUBSCRIPTION_CHARGES_DISABLED = 'false';
    const { scheduler, run, release } = setup();

    const first = scheduler.chargeDue();
    await scheduler.chargeDue();
    await scheduler.chargeDue();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await first;

    expect(run).toHaveBeenCalledTimes(2);
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
