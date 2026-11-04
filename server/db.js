
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error.message);
});

async function testDatabaseConnection() {
  const result = await pool.query("SELECT NOW() AS database_time");
  return result.rows[0];
}

module.exports = {
  pool,
  testDatabaseConnection
};
