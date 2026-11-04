const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    pool.on("error", (error) => {
      console.error("PostgreSQL error:", error.message);
    });
  }

  return pool;
}

async function testDatabaseConnection() {
  const result = await getPool().query(
    "SELECT NOW() AS database_time"
  );

  return result.rows[0];
}

module.exports = {
  getPool,
  testDatabaseConnection
};
