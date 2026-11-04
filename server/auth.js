const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getPool } = require("./db");

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || "").replace(/[\s()-]/g, "");
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function createDeviceToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createAccessToken(userId, deviceId) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  return jwt.sign(
    { userId, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

// REGISTER
router.post("/register", async (req, res) => {
  const phone = normalizePhone(req.body.phone_number);
  const password = req.body.password;
  const deviceName = String(req.body.device_name || "Unknown device").slice(0, 100);

  if (!validPhone(phone)) {
    return res.status(400).json({
      success: false,
      message: "Use international phone format, for example +2547XXXXXXXX"
    });
  }

  if (typeof password !== "string" || password.length < 10 || password.length > 72) {
    return res.status(400).json({
      success: false,
      message: "Password must contain 10 to 72 characters"
    });
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM users WHERE phone_number = $1",
      [phone]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This phone number already has a BELVIA account"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      `INSERT INTO users
       (phone_number, password_hash, auth_method)
       VALUES ($1, $2, 'phone_password')
       RETURNING id, phone_number, username, display_name, created_at`,
      [phone, passwordHash]
    );

    const user = userResult.rows[0];
    const deviceToken = createDeviceToken();

    const deviceResult = await client.query(
      `INSERT INTO devices
       (user_id, device_name, device_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, device_name`,
      [user.id, deviceName, hashToken(deviceToken)]
    );

    const device = deviceResult.rows[0];

    await client.query("COMMIT");

    const accessToken = createAccessToken(user.id, device.id);

    return res.status(201).json({
      success: true,
      message: "BELVIA account created successfully",
      user,
      device,
      accessToken,
      deviceToken
    });

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This phone number or device already exists"
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });

  } finally {
    client.release();
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  const phone = normalizePhone(req.body.phone_number);
  const password = req.body.password;
  const deviceToken = req.body.device_token;

  if (!validPhone(phone) || typeof password !== "string") {
    return res.status(400).json({
      success: false,
      message: "Invalid login details"
    });
  }

  try {
    const result = await getPool().query(
      `SELECT id, phone_number, password_hash, auth_method,
              username, display_name
       FROM users
       WHERE phone_number = $1`,
      [phone]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password"
      });
    }

    const user = result.rows[0];

    if (user.auth_method !== "phone_password" || !user.password_hash) {
      return res.status(403).json({
        success: false,
        message: "This account uses device verification"
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password"
      });
    }

    if (!deviceToken) {
      return res.status(403).json({
        success: false,
        message: "Device verification is required for this device"
      });
    }

    const deviceResult = await getPool().query(
      `SELECT id, device_name
       FROM devices
       WHERE user_id = $1
       AND device_token_hash = $2
       AND is_active = TRUE`,
      [user.id, hashToken(deviceToken)]
    );

    if (!deviceResult.rowCount) {
      return res.status(403).json({
        success: false,
        message: "This device is not linked. Link it using your old device."
      });
    }

    const device = deviceResult.rows[0];

    await getPool().query(
      "UPDATE devices SET last_seen = NOW() WHERE id = $1",
      [device.id]
    );

    const accessToken = createAccessToken(user.id, device.id);

    return res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        phone_number: user.phone_number,
        username: user.username,
        display_name: user.display_name
      },
      device,
      accessToken
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

module.exports = router;
