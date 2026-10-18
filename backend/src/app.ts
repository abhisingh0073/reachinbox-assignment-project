import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { createScheduledEmails } from "./services/email.service.js";
import { slackRouter } from "./routes/slack.routes.js";
import { searchEmails } from "./services/elasticsearch.service.js";
import queueDashboardRouter from "./routes/queue-dashboard.routes.js";

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "./auth/passport.js";
import authRouter from "./routes/auth.routes.js";
import { requireAuth } from "./middleware/require-auth.js";


export const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  })
);

const PgSession = connectPgSimple(session);

app.use(
  session({
    name: "reachinbox.sid",
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use("/api/auth", authRouter);

app.use(express.json({ limit: "1mb" }));
app.use("/api/slack", slackRouter);
app.use("/api/queues", queueDashboardRouter);



app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error" });
  }
});

app.post("/api/emails/schedule", requireAuth, async (req, res) => {
  try {
    const { recipients, subject, body, scheduledAt, senderId, hourlyLimit} =
      req.body;

    const sendDelayMs = Number(req.body.sendDelayMs ?? 0);

      if (
          !Number.isInteger(sendDelayMs) ||
          sendDelayMs < 0 ||
          sendDelayMs > 3_600_000
        ) {
          return res.status(400).json({
            error: "Send delay must be an integer between 0 and 3600000 milliseconds.",
          });
        }

      if (
          hourlyLimit !== undefined &&
          (!Number.isInteger(hourlyLimit) ||
            hourlyLimit < 1 ||
            hourlyLimit > 10000)
        ) {
          return res.status(400).json({
            error: "hourlyLimit must be an integer from 1 to 10000",
          });
        }

    if (
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      recipients.length > 1000 ||
      !recipients.every(
        (email: unknown) =>
          typeof email === "string" &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) ||
      typeof subject !== "string" ||
      !subject.trim() ||
      typeof body !== "string" ||
      !body.trim() ||
      typeof scheduledAt !== "string" ||
      Number.isNaN(Date.parse(scheduledAt)) ||
      Date.parse(scheduledAt) < Date.now()
    ) {
      return res.status(400).json({
        error: "Invalid email scheduling request",
      });
    }

    const ids = await createScheduledEmails({
      userId: req.user!.id,
      recipients,
      subject,
      body,
      scheduledAt: new Date(scheduledAt),
      senderId,
      hourlyLimit,
      sendDelayMs,
    });

    return res.status(201).json({
      message: "Emails scheduled",
      count: ids.length,
      ids,
    });
  } catch (error) {
    console.error("Scheduling failed:", error);
    return res.status(500).json({
      error: "Unable to schedule emails",
    });
  }
});

app.get("/api/emails", requireAuth, async (req, res) => {
  try {
    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : null;

    const userId = req.user!.id;
    
    const result = status
      ? await pool.query(
          `SELECT id, recipient, subject, scheduled_at,
                  sent_at, status, attempts, error
           FROM emails
           WHERE user_id = $1 AND status = $2
           ORDER BY scheduled_at ASC
           LIMIT 200`,
          [userId, status]
        )
      : await pool.query(
          `SELECT id, recipient, subject, scheduled_at,
                  sent_at, status, attempts, error
           FROM emails
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [userId]
        );

    return res.json({ emails: result.rows });
  } catch (error) {
    console.error("Fetching emails failed:", error);
    return res.status(500).json({
      error: "Unable to fetch emails",
    });
  }
});



app.get("/api/emails/search", requireAuth, async (req, res) => {
  try {
    const query =
      typeof req.query.q === "string" ? req.query.q.trim() : "";

    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : undefined;

    const allowedStatuses = [
      "scheduled",
      "sending",
      "sent",
      "failed",
    ];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status filter",
      });
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        error: "page must be positive and limit must be between 1 and 100",
      });
    }

    const result = await searchEmails(query, {
      userId: req.user!.id,
      page,
      limit,
      ...(status !== undefined && { status }),
    });

    return res.json({
      emails: result.emails,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error("Email search failed:", error);

    return res.status(503).json({
      error: "Email search is temporarily unavailable",
    });
  }
});


app.get("/api/emails/stats", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE status = 'scheduled'
         )::int AS scheduled,
         COUNT(*) FILTER (
           WHERE status = 'sent'
         )::int AS sent,
         COUNT(*) FILTER (
           WHERE status = 'failed'
         )::int AS failed
       FROM emails
       WHERE user_id = $1`,
      [req.user!.id]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Failed to fetch email statistics:", error);
    return res.status(500).json({
      error: "Failed to fetch email statistics",
    });
  }
});



