
import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../queue/email.queue.js";

const router = Router();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/api/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

router.use("/", serverAdapter.getRouter());

export default router;

