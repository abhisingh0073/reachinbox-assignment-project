
import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { redisConnection } from "../queue/email.queue.js";

const DEV_USER_ID = "local-dev-user";

export async function notifyHourlyLimitReached(
  senderId: string,
  hourlyLimit: number,
  retryAfterMs: number
): Promise<void> {
  const channel = process.env.SLACK_ALERT_CHANNEL_ID;

  if (!channel) {
    console.warn("Slack alert skipped: SLACK_ALERT_CHANNEL_ID is not configured");
    return;
  }

  const now = Date.now();
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const dedupeKey = `slack-limit-alert:${senderId}:${hourStart}`;

  // Reserve one notification per sender per hour.
  const reserved = await redisConnection.set(
    dedupeKey,
    randomUUID(),
    "PX",
    Math.max(retryAfterMs + 60_000, 60_000),
    "NX"
  );

  if (reserved !== "OK") return;

  try {
    const result = await pool.query(
      `SELECT bot_token
       FROM slack_integrations
       WHERE user_id = $1`,
      [DEV_USER_ID]
    );

    if (!result.rows[0]?.bot_token) {
      console.log("Slack alert skipped: no Slack workspace connected");
      await redisConnection.del(dedupeKey);
      return;
    }

    const slack = new WebClient(result.rows[0].bot_token);

    await slack.chat.postMessage({
      channel,
      text:
        `:warning: *ReachInbox hourly email limit reached*\n` +
        `Sender: \`${senderId}\`\n` +
        `Hourly limit: ${hourlyLimit} emails\n` +
        `Queued emails will be deferred for approximately ` +
        `${Math.max(1, Math.ceil(retryAfterMs / 60_000))} minute(s).`,
    });

    console.log(`Slack hourly-limit notification sent for ${senderId}`);
  } catch (error) {
    // Slack must never cause the email job to fail.
    console.error("Slack notification failed:", error);
    await redisConnection.del(dedupeKey).catch(() => undefined);
  }
}
