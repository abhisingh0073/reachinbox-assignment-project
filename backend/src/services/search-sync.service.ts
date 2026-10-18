
import "dotenv/config";
import { pool } from "../db.js";
import { indexEmail } from "./elasticsearch.service.js";

let running = false;

export async function syncPendingEmails() {
  // Prevent overlapping sync batches in this process.
  if (running) return;

  running = true;

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
        WHERE search_sync_pending = TRUE
        ORDER BY created_at ASC
        LIMIT 100;
        `
    );

    console.log(
  `Pending Elasticsearch sync records: ${result.rows.length}`
);

    for (const email of result.rows) {
      try {
        await indexEmail(email);

        console.log(`Indexed email ${email.id} in Elasticsearch`);

        // Clear the flag only if the email's indexed state
        // has not changed while indexing was in progress.
        const cleared = await pool.query(
          `UPDATE emails
           SET search_sync_pending = FALSE
           WHERE id = $1
             AND status = $2
             AND search_sync_pending = TRUE`,
          [email.id, email.status]
        );
        
        console.log(
          `Cleared pending flag for ${email.id}: ${cleared.rowCount} row(s)`
        );

        if (cleared.rowCount === 0) {
          console.log(
            `Email ${email.id} changed during sync; it remains pending`
          );
        }
      } catch (error) {
        // Leave the flag TRUE so a later batch retries it.
        console.error(
          `Search sync failed for ${email.id}; will retry:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Could not load pending search sync records:", error);
  } finally {
    running = false;
  }
}

