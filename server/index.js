
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { testDatabaseConnection } = require("./db");
const authRoutes = require("./auth");

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "BELVIA CHAT API",
    status: "online"
  });
});

app.get("/api/health/database", async (req, res) => {
  try {
    const result = await testDatabaseConnection();

    res.json({
      success: true,
      database: "connected",
      databaseTime: result.database_time
    });
  } catch (error) {
    console.error("Database check failed:", error.message);

    res.status(503).json({
      success: false,
      database: "disconnected"
    });
  }
});

app.use("/api/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BELVIA CHAT API running on port ${PORT}`);
});
