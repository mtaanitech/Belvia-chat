const express = require("express");
const cors = require("cors");

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "BELVIA CHAT API",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found"
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BELVIA CHAT API running on port ${PORT}`);
});
