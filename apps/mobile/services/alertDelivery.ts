/**
 * alertDelivery.ts
 *
 * Delivers triggered alerts via:
 *   push        — Expo push notifications (local, via expo-notifications)
 *   webhook     — HTTP POST JSON to a user-supplied URL
 *   telegram    — Telegram Bot API `sendMessage`
 *   in_app      — Store-only (no external delivery; UI reads unreadCount)
 *
 * Usage:
 *   await deliverAlert(alert, 'AAPL', 'Price crossed $180.00');
 */

// expo-notifications must be installed before push delivery works:
// pnpm add expo-notifications && npx expo install expo-notifications
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
try {
  // Dynamic require so tsc doesn't fail when the package is not yet installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  // Not installed — push notifications silently no-op
}

import type { Alert } from '../stores/alerts';

export interface DeliveryContext {
  ticker:  string;
  message: string;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function deliverAlert(
  alert:   Alert,
  context: DeliveryContext,
): Promise<void> {
  const { channels } = alert.delivery;
  const promises: Promise<void>[] = [];

  if (channels.includes('push')) {
    promises.push(sendPush(alert, context));
  }
  if (channels.includes('webhook') && alert.delivery.webhookUrl) {
    promises.push(sendWebhook(alert, context));
  }
  if (
    channels.includes('telegram') &&
    alert.delivery.telegramBotToken &&
    alert.delivery.telegramChatId
  ) {
    promises.push(sendTelegram(alert, context));
  }
  // 'in_app' requires no external call — the store handles unreadCount.

  await Promise.allSettled(promises);
}

// ── Push notification ─────────────────────────────────────────────────────────

async function sendPush(alert: Alert, ctx: DeliveryContext): Promise<void> {
  if (!Notifications) {
    console.warn('[alertDelivery] expo-notifications not installed — push skipped');
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚡ ${ctx.ticker} Alert — ${alert.label}`,
      body:  ctx.message,
      data:  { alertId: alert.id },
    },
    trigger: null, // immediate
  });
}

// ── Webhook POST ──────────────────────────────────────────────────────────────

async function sendWebhook(alert: Alert, ctx: DeliveryContext): Promise<void> {
  const url = alert.delivery.webhookUrl!;
  const template = alert.delivery.webhookPayloadTemplate;

  let body: string;
  if (template) {
    body = template
      .replace('{{ticker}}',    ctx.ticker)
      .replace('{{message}}',   ctx.message)
      .replace('{{alertId}}',   alert.id)
      .replace('{{label}}',     alert.label)
      .replace('{{timestamp}}', String(Date.now()));
  } else {
    body = JSON.stringify({
      alertId:   alert.id,
      label:     alert.label,
      ticker:    ctx.ticker,
      message:   ctx.message,
      timestamp: Date.now(),
    });
  }

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    console.warn(`[alertDelivery] Webhook POST to ${url} returned ${response.status}`);
  }
}

// ── Telegram Bot API ──────────────────────────────────────────────────────────

async function sendTelegram(alert: Alert, ctx: DeliveryContext): Promise<void> {
  const token  = alert.delivery.telegramBotToken!;
  const chatId = alert.delivery.telegramChatId!;
  const text   = `*⚡ ${ctx.ticker} — ${alert.label}*\n${ctx.message}`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn(`[alertDelivery] Telegram API error ${response.status}: ${body}`);
  }
}

// ── Notification permission helper ────────────────────────────────────────────

/** Call once at app startup to request push permission. */
export async function requestPushPermission(): Promise<boolean> {
  if (!Notifications) return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}
