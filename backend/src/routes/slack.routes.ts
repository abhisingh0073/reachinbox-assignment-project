
import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { redisConnection } from "../queue/email.queue.js";

export const slackRouter = Router();

const DEV_USER_ID = "local-dev-user";
const STATE_TTL_SECONDS = 600;

function getSlackConfig() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Slack OAuth environment variables are missing");
  }

  return { clientId, clientSecret, redirectUri };
}

// GET /api/slack/connect
slackRouter.get("/connect", async (_req, res) => {
  try {
    const { clientId, redirectUri } = getSlackConfig();
    const state = randomBytes(32).toString("hex");

    await redisConnection.set(
      `slack-oauth-state:${state}`,
      DEV_USER_ID,
      "EX",
      STATE_TTL_SECONDS,
      "NX"
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "chat:write,channels:read",
    });

    return res.redirect(
      `https://slack.com/oauth/v2/authorize?${params.toString()}`
    );
  } catch (error) {
    console.error("Slack connect error:", error);
    return res.status(500).json({ error: "Could not start Slack OAuth" });
  }
});

// GET /api/slack/callback
slackRouter.get("/callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state) {
      return res.status(400).json({ error: "Missing OAuth code or state" });
    }

    // Atomically consume state so it cannot be reused.
    const userId = await redisConnection.getdel(`slack-oauth-state:${state}`);

    if (!userId || userId !== DEV_USER_ID) {
      return res.status(400).json({
        error: "Invalid or expired OAuth state. Please reconnect.",
      });
    }

    const { clientId, clientSecret, redirectUri } = getSlackConfig();

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const data = (await response.json()) as {
      ok?: boolean;
      error?: string;
      team?: { id?: string; name?: string };
      access_token?: string;
      bot_user_id?: string;
    };

    if (!response.ok || !data.ok || !data.access_token || !data.team?.id) {
      console.error("Slack OAuth exchange failed:", data.error ?? response.status);
      return res.status(400).json({
        error: "Slack authorization failed. Check the app configuration.",
      });
    }

    await pool.query(
      `INSERT INTO slack_integrations
         (id, user_id, team_id, team_name, bot_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         team_id = EXCLUDED.team_id,
         team_name = EXCLUDED.team_name,
         bot_token = EXCLUDED.bot_token,
         connected_at = NOW()`,
      [
        randomUUID(),
        userId,
        data.team.id,
        data.team.name ?? null,
        data.access_token,
      ]
    );

    return res.json({
      connected: true,
      workspace: data.team.name ?? data.team.id,
      message: "Slack connected successfully.",
    });
  } catch (error) {
    console.error("Slack callback error:", error);
    return res.status(500).json({ error: "Could not complete Slack OAuth" });
  }
});

// GET /api/slack/status
slackRouter.get("/status", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT team_id, team_name, connected_at
       FROM slack_integrations
       WHERE user_id = $1`,
      [DEV_USER_ID]
    );

    if (result.rowCount === 0) {
      return res.json({ connected: false });
    }

    return res.json({
      connected: true,
      workspace: result.rows[0].team_name,
      teamId: result.rows[0].team_id,
      connectedAt: result.rows[0].connected_at,
    });
  } catch (error) {
    console.error("Slack status error:", error);
    return res.status(500).json({ error: "Could not check Slack status" });
  }
});

// POST /api/slack/disconnect
slackRouter.post("/disconnect", async (_req, res) => {
  try {
    await pool.query(
      "DELETE FROM slack_integrations WHERE user_id = $1",
      [DEV_USER_ID]
    );

    return res.json({ connected: false, message: "Slack disconnected." });
  } catch (error) {
    console.error("Slack disconnect error:", error);
    return res.status(500).json({ error: "Could not disconnect Slack" });
  }
});
