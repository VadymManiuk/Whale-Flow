import { Telegraf } from "telegraf";
import type { AppConfig } from "../../config/config.js";
import type { WhaleAlert } from "../../models/alert.js";
import { formatWhaleAlert } from "./format-alert.js";

export interface TelegramNotifier {
  sendAlert(alert: WhaleAlert): Promise<string | null>;
  sendTestMessage(): Promise<string>;
}

export class TelegrafNotifier implements TelegramNotifier {
  private readonly bot: Telegraf;
  public constructor(private readonly chatId: string, token: string) { this.bot = new Telegraf(token); }
  public async sendAlert(alert: WhaleAlert): Promise<string | null> {
    const message = await this.bot.telegram.sendMessage(this.chatId, formatWhaleAlert(alert), { link_preview_options: { is_disabled: true } });
    return String(message.message_id);
  }
  public async sendTestMessage(): Promise<string> {
    const message = await this.bot.telegram.sendMessage(this.chatId, "Whale Flow Telegram connection verified.");
    return String(message.message_id);
  }
}

export class DisabledTelegramNotifier implements TelegramNotifier {
  public async sendAlert(alert: WhaleAlert): Promise<string | null> { void alert; return null; }
  public async sendTestMessage(): Promise<string> { throw new Error("Telegram is disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."); }
}

export function createTelegramNotifier(config: AppConfig): TelegramNotifier {
  return config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID
    ? new TelegrafNotifier(config.TELEGRAM_CHAT_ID, config.TELEGRAM_BOT_TOKEN)
    : new DisabledTelegramNotifier();
}
