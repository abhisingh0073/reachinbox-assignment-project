
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { scheduleEmail } from "../queue/email.queue.js";
import { indexEmail } from "./elasticsearch.service.js";

interface ScheduleEmailInput {
  userId: string;
  recipients: string[];
  subject: string;
  body: string;
  scheduledAt: Date;
  senderId?: string;
  hourlyLimit?: number;
  sendDelayMs?: number;
}

export async function createScheduledEmails(
  input: ScheduleEmailInput
) {
  const ids: string[] = [];

  for (const recipient of input.recipients) {
    const id = randomUUID();

    const result = await pool.query(
      `INSERT INTO emails (
         id, user_id, recipient, subject, body, sender_id,
         scheduled_at, hourly_limit, send_delay_ms
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, recipient, subject, body,
                 sender_id, status, scheduled_at, sent_at, created_at`,
      [
        id,
        input.userId,
        recipient,
        input.subject,
        input.body,
        input.senderId ?? "default",
        input.scheduledAt,
        input.hourlyLimit ?? 100,
        input.sendDelayMs ?? 0,
      ]
    );

    
    const email = result.rows[0];
    ids.push(id);

    // Search indexing must not prevent email scheduling.
    try {
      await indexEmail(email);
    } catch (error) {
      console.error(
        `Failed to index email ${id}; PostgreSQL remains the source of truth:`,
        error
      );
    }
  }

  // Keep the existing BullMQ scheduling behavior.
  for (const id of ids) {
    await scheduleEmail(id, input.scheduledAt);
  }

  return ids;
}
