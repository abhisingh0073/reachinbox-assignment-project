
import { redisConnection } from "../queue/email.queue.js";

export async function reserveHourlySlot(
  senderId: string,
  hourlyLimit: number
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const now = Date.now();
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const nextHour = hourStart + 3_600_000;
  const key = `email-hourly:${senderId}:${hourStart}`;

  const result = await redisConnection.eval(
    `
      local current = tonumber(redis.call("GET", KEYS[1]) or "0")
      local limit = tonumber(ARGV[1])

      if current >= limit then
        return 0
      end

      current = redis.call("INCR", KEYS[1])

      if current == 1 then
        redis.call("PEXPIREAT", KEYS[1], ARGV[2])
      end

      return 1
    `,
    1,
    key,
    hourlyLimit,
    nextHour
  );

  if (Number(result) === 1) {
    return { allowed: true };
  }

  return {
    allowed: false,
    retryAfterMs: nextHour - now,
  };
}
