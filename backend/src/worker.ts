import nodemailer from "nodemailer";
import "dotenv/config";
import { Worker } from "bullmq";
import { pool } from "./db.js";
import { redisConnection } from "./queue/email.queue.js";
import { getMailer } from "./services/mailer.js";
import { emailQueue } from "./queue/email.queue.js";
import { reserveHourlySlot } from "./services/rate-limit.service.js";
import { notifyHourlyLimitReached } from "./services/slack-notification.service.js";
import { indexEmail } from "./services/elasticsearch.service.js";
import { syncPendingEmails } from "./services/search-sync.service.js";

interface EmailJob {
  emailId: string;
}

const concurrency = Math.max(
  1,
  Number(process.env.WORKER_CONCURRENCY ?? 5)
);

const minDelayMs = Math.max(
  0,
  Number(process.env.MIN_DELAY_MS ?? 2000)
);

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));



async function syncEmailToSearch(emailId: string) {
  try {
    const result = await pool.query(
      `SELECT
         id,
         user_id,
         recipient,
         subject,
         body,
         sender_id,
         status,
         scheduled_at,
         sent_at,
         created_at,
         attempts
       FROM emails
       WHERE id = $1`,
      [emailId]
    );

    if (result.rows[0]) {
      await indexEmail(result.rows[0]);
    }
  } catch (error) {
    console.error(
      `Elasticsearch sync failed for email ${emailId}:`,
      error
    );
  }
}




async function waitForSendSlot(sendDelayMs = 0) {
  const effectiveDelayMs = Math.max(minDelayMs, sendDelayMs);

  if (effectiveDelayMs === 0) return;

  while (true) {
    const acquired = await redisConnection.set(
      "email-scheduler:last-send-slot",
      "1",
      "PX",
      effectiveDelayMs,
      "NX"
    );

    if (acquired === "OK") return;

    await sleep(Math.min(100, effectiveDelayMs));
  }
}


const worker = new Worker<EmailJob>(
  "email-scheduler",
  async (job) => {
    const { emailId } = job.data;

    const result = await pool.query(
      `SELECT
          id,
          user_id,
          recipient,
          subject,
          body,
          status,
          sender_id,
          hourly_limit,
          send_delay_ms
        FROM emails
        WHERE id = $1`,
      [emailId]
    );

    const email = result.rows[0];

    if (!email) {
      throw new Error(`Email ${emailId} was not found`);
    }

    // A retry or recovered job must never resend an email
    // that has already been recorded as sent.
    // if (email.status === "sent") {
    //   console.log(`Email ${emailId} was already sent; skipping`);
    //   return;
    // }



// Never send an email that has already been sent.
    if (email.status === "sent") {
      console.log(`Email ${emailId} was already sent; skipping`);
      return;
    }
    
    // Claim the email so another job cannot send it simultaneously.
    const claimResult = await pool.query(
      `UPDATE emails
       SET status = 'sending',
           sending_started_at = NOW(),
           attempts = attempts + 1,
           error = NULL
       WHERE id = $1
        AND (
          status IN ('scheduled', 'failed')
          OR (
            status = 'sending'
            AND sending_started_at < NOW() - INTERVAL '5 minutes'
          )
        )
       RETURNING id`,
      [emailId]
    );
    
    if (claimResult.rowCount === 0) {
      console.log(
        `Email ${emailId} is already being processed or is not eligible; skipping`
      );
      return;
    }


    const rateLimit = await reserveHourlySlot(
       email.sender_id,
       Number(email.hourly_limit)
     );


if (!rateLimit.allowed) {
  await pool.query(
    `UPDATE emails
     SET status = 'scheduled',
         sending_started_at = NULL
     WHERE id = $1
       AND status <> 'sent'`,
    [emailId]
  );

  const deferUntil = Date.now() + rateLimit.retryAfterMs + 1000;

  await emailQueue.add(
    "send-email",
    { emailId },
    {
      jobId: `${emailId}-deferred-${deferUntil}`,
      delay: deferUntil - Date.now(),
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: false,
      removeOnFail: false,
    }
  );

  console.log(
    `Hourly limit reached for sender ${email.sender_id}; email deferred`
  );

  return;
}


    await pool.query(
      `UPDATE emails
       SET status = 'sending',
           attempts = attempts + 1,
           error = NULL
       WHERE id = $1`,
      [emailId]
    );

    await waitForSendSlot(Number(email.send_delay_ms ?? 0));

    const mailer = await getMailer();

    const info = await mailer.sendMail({
      from: "ReachInbox Demo <no-reply@example.com>",
      to: email.recipient,
      subject: email.subject,
      text: email.body,
    });

    await pool.query(
      `UPDATE emails
       SET status = 'sent',
           sent_at = NOW(),
           error = NULL
       WHERE id = $1`,
      [emailId]
    );

    await syncEmailToSearch(emailId);

    const previewUrl = nodemailer.getTestMessageUrl(info);

    console.log(`Email sent: ${emailId} -> ${email.recipient}`);

    if (previewUrl) {
      console.log(`Ethereal preview: ${previewUrl}`);
    }
  },
  {
    connection: redisConnection,
    concurrency,
  }
);

function nodemailerPreview(
  info: { messageId?: string; response?: string }
) {
  // The worker logs the message ID. We'll add the actual
  // Ethereal preview URL in the next small correction below.
  return undefined;
}

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});


worker.on("failed", async (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);

  if (!job) return;

  const maxAttempts = Number(job.opts.attempts ?? 1);
  const isFinalAttempt = job.attemptsMade >= maxAttempts;

  const nextStatus = isFinalAttempt ? "failed" : "scheduled";

  await pool.query(
    `UPDATE emails
     SET status = $2,
         error = $3,
         sending_started_at = NULL
     WHERE id = $1
       AND status <> 'sent'`,
    [
      job.data.emailId,
      nextStatus,
      error.message.slice(0, 2000),
    ]
  );

  await syncEmailToSearch(job.data.emailId);

  if (!isFinalAttempt) {
    console.log(
      `Email ${job.data.emailId} will retry (${job.attemptsMade}/${maxAttempts})`
    );
  } else {
    console.log(
      `Email ${job.data.emailId} failed after ${maxAttempts} attempts`
    );
  }
});


worker.on("error", (error) => {
  console.error("Worker error:", error);
});

console.log(
  `Email worker started (concurrency=${concurrency}, minimum delay=${minDelayMs}ms)`
);

void syncPendingEmails();

setInterval(() => {
  void syncPendingEmails();
}, 5000);
