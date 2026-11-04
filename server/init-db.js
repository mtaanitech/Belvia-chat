require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getPool } = require("./db");

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  try {
    await getPool().query(schema);
    console.log("BELVIA CHAT database initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    process.exitCode = 1;
  } finally {
    await getPool().end();
  }
}

initializeDatabase();
