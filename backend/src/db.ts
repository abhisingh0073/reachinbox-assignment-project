import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initializeDatabase() {
  await pool.query(`
    -- 1. Create independent master tables first
    CREATE TABLE IF NOT EXISTS oauth_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS slack_integrations (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      team_id TEXT NOT NULL,
      team_name TEXT,
      bot_token TEXT NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 2. Create dependent tables after their foreign key targets exist
    CREATE TABLE IF NOT EXISTS emails (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES oauth_users(id),
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      sender_id TEXT NOT NULL DEFAULT 'default',
      scheduled_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      sending_started_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN (
          'scheduled', 'sending', 'sent', 'failed'
        )),
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      hourly_limit INTEGER NOT NULL DEFAULT 100,
      search_sync_pending BOOLEAN NOT NULL DEFAULT TRUE,
      send_delay_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 3. Create indices for performance
    CREATE INDEX IF NOT EXISTS idx_emails_status_schedule
      ON emails(status, scheduled_at);

    CREATE INDEX IF NOT EXISTS idx_emails_user_created
      ON emails(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_emails_recipient
      ON emails(recipient);
  `);

  console.log("Database schema initialized successfully");
}