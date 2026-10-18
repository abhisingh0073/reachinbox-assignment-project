
import "dotenv/config";
import { app } from "./app.js";
import { initializeDatabase, pool } from "./db.js";
import { initializeElasticsearch } from "./services/elasticsearch.service.js";

const port = Number(process.env.PORT ?? 4000);

async function startServer() {
  await initializeDatabase();
  await initializeElasticsearch();

  const server = app.listen(port, () => {
    console.log(`API running at http://localhost:${port}`);
  });

  async function shutdown() {
    server.close();
    await pool.end();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start API:", error);
  process.exit(1);
});
