/**
 * Reserved extension point. It is intentionally disabled by default because a
 * reliable PnL estimate requires token-balance accounting and price history.
 */
export class DipBuyerAfterWhaleSellDetector {
  public readonly enabled: boolean;
  public constructor(enabled = false) { this.enabled = enabled; }
}
