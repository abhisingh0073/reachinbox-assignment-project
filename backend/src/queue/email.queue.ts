import "dotenv/config";
import { Queue } from "bullmq";
// import IORedis from "ioredis";
import { Redis } from "ioredis";

export const redisConnection = new Redis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue("email-scheduler", {
  connection: redisConnection,
});


export async function scheduleEmail(emailId: string, scheduledAt: Date) {

  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  await emailQueue.add(
    "send-email",
    { emailId },
    {
      jobId: emailId,
      delay,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      // Retain completed jobs to help prevent duplicate
      // enqueueing with the same job ID.
      removeOnComplete: false,
      removeOnFail: false,
    }
  );
}