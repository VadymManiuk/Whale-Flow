import type { GradualWhaleFlowDetector } from "../detectors/gradual-whale-flow-detector.js";
import type { AlertRepository, SwapRepository } from "../db/repositories.js";
import { formatWhaleAlert } from "../integrations/telegram/format-alert.js";
import type { TelegramNotifier } from "../integrations/telegram/telegram-notifier.js";
import type { NormalizedSwap } from "../models/swap.js";
import { isStablecoinBuy } from "../models/stablecoin.js";
import type { Logger } from "../utils/logger.js";

export class SwapProcessingService {
  public constructor(
    private readonly swaps: SwapRepository,
    private readonly detector: GradualWhaleFlowDetector,
    private readonly alerts: AlertRepository,
    private readonly telegram: TelegramNotifier,
    private readonly logger: Logger,
    private readonly alertCooldownMinutes: number,
    private readonly ignoreStablecoinBuys: boolean
  ) {}

  public async process(swap: NormalizedSwap): Promise<void> {
    if (!(await this.swaps.createIfNew(swap))) {
      this.logger.debug({ txHash: swap.txHash, chain: swap.chain }, "Duplicate swap ignored by database");
      return;
    }
    if (this.ignoreStablecoinBuys && isStablecoinBuy(swap)) {
      this.logger.debug({ chain: swap.chain, token: swap.tokenSymbol, txHash: swap.txHash }, "Stablecoin buy ignored for alert detection");
      return;
    }
    const result = await this.detector.process(swap);
    if (!result.alert) {
      this.logger.debug({ reason: result.ignoredReason, txHash: swap.txHash }, "Swap did not create a whale alert");
      return;
    }
    // Alert delivery time, not on-chain timestamp, defines cooldown. This also
    // works when a provider returns an older event after a process restart.
    const cooldownStart = new Date(Date.now() - this.alertCooldownMinutes * 60_000);
    if (await this.alerts.existsSince(result.alert, cooldownStart)) {
      this.logger.info({ chain: result.alert.chain, wallet: result.alert.wallet, token: result.alert.tokenAddress }, "Whale alert suppressed by persistent cooldown");
      return;
    }
    const message = formatWhaleAlert(result.alert);
    const telegramMessageId = await this.telegram.sendAlert(result.alert);
    await this.alerts.create(result.alert, message, telegramMessageId);
    this.logger.info({ chain: result.alert.chain, wallet: result.alert.wallet, token: result.alert.tokenAddress, severity: result.alert.severity }, "Whale alert delivered");
  }
}
