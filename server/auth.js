
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getPool } = require("./db");

const router = express.Router();

const CODE_LIFETIME_MINUTES = 3;
const MAX_CODE_ATTEMPTS = 5;

// --------------------
// BASIC HELPERS
// --------------------

function normalizePhone(phone) {
  return String(phone || "").replace(/[\s()-]/g, "");
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function validDeviceName(name) {
  return typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 100;
}

function createDeviceToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createVerificationCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashCode(code) {
  return crypto
    .createHash("sha256")
    .update(String(code))
    .digest("hex");
}

function checkJwtSecret() {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  ) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters"
    );
  }
}

function createAccessToken(userId, deviceId) {
  checkJwtSecret();

  return jwt.sign(
    { userId, deviceId },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  try {
    checkJwtSecret();

    req.auth = jwt.verify(token, process.env.JWT_SECRET);

    if (!req.auth.userId || !req.auth.deviceId) {
      throw new Error("Invalid token");
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired access token"
    });
  }
}

async function getAuthenticatedDevice(req) {
  const result = await getPool().query(
    `SELECT id, user_id, device_name
     FROM devices
     WHERE id = $1
       AND user_id = $2
       AND is_active = TRUE`,
    [req.auth.deviceId, req.auth.userId]
  );

  return result.rows[0] || null;
}

// --------------------
// REGISTER
// --------------------

router.post("/register", async (req, res) => {
  let client;

  try {
    checkJwtSecret();

    const phone = normalizePhone(req.body.phone_number);
    const authMethod = req.body.auth_method;
    const password = req.body.password;
    const deviceName = String(
      req.body.device_name || "Unknown device"
    ).trim().slice(0, 100);

    if (!validPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: "Use international phone format, for example +2547XXXXXXXX"
      });
    }

    if (!["phone_password", "device_verification"].includes(authMethod)) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid authentication method"
      });
    }

    if (
      authMethod === "phone_password" &&
      (typeof password !== "string" ||
        password.length < 10 ||
        password.length > 72)
    ) {
      return res.status(400).json({
        success: false,
        message: "Password must contain 10 to 72 characters"
      });
    }

    if (
      authMethod === "device_verification" &&
      password !== undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "This authentication method does not use a password"
      });
    }

    const passwordHash =
      authMethod === "phone_password"
        ? await bcrypt.hash(password, 12)
        : null;

    const deviceToken = createDeviceToken();

    client = await getPool().connect();

    await client.query("BEGIN");

    const userResult = await client.query(
      `INSERT INTO users
       (phone_number, password_hash, auth_method)
       VALUES ($1, $2, $3)
       RETURNING id, phone_number, username,
                 display_name, auth_method, created_at`,
      [phone, passwordHash, authMethod]
    );

    const user = userResult.rows[0];

    const deviceResult = await client.query(
      `INSERT INTO devices
       (user_id, device_name, device_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, device_name`,
      [user.id, deviceName, hashToken(deviceToken)]
    );

    const device = deviceResult.rows[0];

    // Create token BEFORE committing the account.
    const accessToken = createAccessToken(user.id, device.id);

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "BELVIA account created successfully",
      user,
      device,
      accessToken,
      deviceToken
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This phone number or username already exists"
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });

  } finally {
    if (client) client.release();
  }
});

// --------------------
// PHONE + PASSWORD LOGIN
// --------------------

router.post("/login", async (req, res) => {
  try {
    checkJwtSecret();

    const phone = normalizePhone(req.body.phone_number);
    const password = req.body.password;
    const deviceToken = req.body.device_token;
    const deviceName = String(
      req.body.device_name || "Unknown device"
    ).trim().slice(0, 100);

    if (!validPhone(phone) || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid login details"
      });
    }

    const result = await getPool().query(
      `SELECT id, phone_number, password_hash,
              auth_method, username, display_name
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

    if (
      user.auth_method !== "phone_password" ||
      !user.password_hash
    ) {
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

    // Existing trusted device.
    if (deviceToken) {
      const deviceResult = await getPool().query(
        `SELECT id, device_name
         FROM devices
         WHERE user_id = $1
           AND device_token_hash = $2
           AND is_active = TRUE`,
        [user.id, hashToken(deviceToken)]
      );

      if (deviceResult.rowCount) {
        const device = deviceResult.rows[0];

        await getPool().query(
          "UPDATE devices SET last_seen = NOW() WHERE id = $1",
          [device.id]
        );

        return res.json({
          success: true,
          message: "Login successful",
          user,
          device,
          accessToken: createAccessToken(user.id, device.id)
        });
      }
    }

    // New device: password authentication is sufficient.
    // The phone number and password remain the chosen method.
    const newDeviceToken = createDeviceToken();

    const newDevice = await getPool().query(
      `INSERT INTO devices
       (user_id, device_name, device_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, device_name`,
      [user.id, deviceName, hashToken(newDeviceToken)]
    );

    const device = newDevice.rows[0];

    return res.status(200).json({
      success: true,
      message: "Login successful on new device",
      user,
      device,
      accessToken: createAccessToken(user.id, device.id),
      deviceToken: newDeviceToken,
      syncAvailable: true
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

// --------------------
// REQUEST DEVICE LINK
// New phone requests permission.
// --------------------

router.post("/device-link/request", async (req, res) => {
  let client;

  try {
    const phone = normalizePhone(req.body.phone_number);
    const deviceName = String(
      req.body.device_name || ""
    ).trim();

    const deviceToken = req.body.device_token;

    if (
      !validPhone(phone) ||
      !validDeviceName(deviceName) ||
      typeof deviceToken !== "string" ||
      !/^[a-f0-9]{64}$/i.test(deviceToken)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid device link request"
      });
    }

    client = await getPool().connect();

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, auth_method
       FROM users
       WHERE phone_number = $1
       FOR UPDATE`,
      [phone]
    );

    if (
      !userResult.rowCount ||
      userResult.rows[0].auth_method !== "device_verification"
    ) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Account could not be verified for device linking"
      });
    }

    const user = userResult.rows[0];

    const sourceResult = await client.query(
      `SELECT id
       FROM devices
       WHERE user_id = $1
         AND is_active = TRUE
       ORDER BY last_seen DESC
       LIMIT 1`,
      [user.id]
    );

    if (!sourceResult.rowCount) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        success: false,
        message: "No trusted device is available"
      });
    }

    // A new request invalidates previous unused requests.
    await client.query(
      `UPDATE device_link_codes
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [user.id]
    );

    const placeholder = hashToken(createDeviceToken());

    const requestResult = await client.query(
      `INSERT INTO device_link_codes
       (user_id, source_device_id, code_hash,
        expires_at, target_device_name,
        target_device_token_hash)
       VALUES ($1, $2, $3,
               NOW() + INTERVAL '3 minutes',
               $4, $5)
       RETURNING id, expires_at`,
      [
        user.id,
        sourceResult.rows[0].id,
        placeholder,
        deviceName,
        hashToken(deviceToken)
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Request sent. Approve it using your old device.",
      request_id: requestResult.rows[0].id,
      expires_at: requestResult.rows[0].expires_at
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }

    console.error("Device request error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not create device link request"
    });

  } finally {
    if (client) client.release();
  }
});

// --------------------
// OLD DEVICE: VIEW REQUESTS
// --------------------

router.get(
  "/device-link/pending",
  authenticate,
  async (req, res) => {
    try {
      const device = await getAuthenticatedDevice(req);

      if (!device) {
        return res.status(401).json({
          success: false,
          message: "Trusted device not found"
        });
      }

      const result = await getPool().query(
        `SELECT id, target_device_name, created_at, expires_at
         FROM device_link_codes
         WHERE user_id = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [req.auth.userId]
      );

      return res.json({
        success: true,
        requests: result.rows
      });

    } catch (error) {
      console.error("Pending device error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not load device requests"
      });
    }
  }
);

// --------------------
// OLD DEVICE: APPROVE REQUEST
// Old phone displays the generated code.
// --------------------

router.post(
  "/device-link/approve/:requestId",
  authenticate,
  async (req, res) => {
    try {
      checkJwtSecret();

      const device = await getAuthenticatedDevice(req);

      if (!device) {
        return res.status(401).json({
          success: false,
          message: "Trusted device not found"
        });
      }

      const code = createVerificationCode();

      const result = await getPool().query(
        `UPDATE device_link_codes
         SET source_device_id = $1,
             code_hash = $2,
             expires_at = NOW() + INTERVAL '3 minutes',
             attempts = 0
         WHERE id = $3
           AND user_id = $4
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING id, expires_at`,
        [
          device.id,
          hashCode(code),
          req.params.requestId,
          req.auth.userId
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Request expired or no longer available"
        });
      }

      return res.json({
        success: true,
        message: "Show this code on your old device",
        verification_code: code,
        expires_at: result.rows[0].expires_at
      });

    } catch (error) {
      console.error("Device approval error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not approve device"
      });
    }
  }
);

// --------------------
// NEW DEVICE: VERIFY CODE
// --------------------

router.post("/device-link/verify", async (req, res) => {
  let client;

  try {
    checkJwtSecret();

    const requestId = req.body.request_id;
    const code = String(req.body.code || "");

    if (
      typeof requestId !== "string" ||
      !/^\d{6}$/.test(code)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification details"
      });
    }

    client = await getPool().connect();

    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, user_id, source_device_id,
              code_hash, target_device_name,
              target_device_token_hash,
              expires_at, consumed_at, attempts
       FROM device_link_codes
       WHERE id = $1
       FOR UPDATE`,
      [requestId]
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "Device request not found"
      });
    }

    const request = result.rows[0];

    if (
      request.consumed_at ||
      new Date(request.expires_at).getTime() <= Date.now() ||
      request.attempts >= MAX_CODE_ATTEMPTS
    ) {
      await client.query(
        `UPDATE device_link_codes
         SET consumed_at = NOW()
         WHERE id = $1`,
        [requestId]
      );

      await client.query("COMMIT");

      return res.status(410).json({
        success: false,
        message: "Verification code expired. Request a new one."
      });
    }

    if (hashCode(code) !== request.code_hash) {
      const attempts = request.attempts + 1;

      await client.query(
        `UPDATE device_link_codes
         SET attempts = $1,
             consumed_at = CASE
               WHEN $1 >= $2 THEN NOW()
               ELSE consumed_at
             END
         WHERE id = $3`,
        [attempts, MAX_CODE_ATTEMPTS, requestId]
      );

      await client.query("COMMIT");

      return res.status(401).json({
        success: false,
        message: "Incorrect verification code",
        attempts_remaining: Math.max(
          0,
          MAX_CODE_ATTEMPTS - attempts
        )
      });
    }

    const deviceResult = await client.query(
      `INSERT INTO devices
       (user_id, device_name, device_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, device_name`,
      [
        request.user_id,
        request.target_device_name,
        request.target_device_token_hash
      ]
    );

    const device = deviceResult.rows[0];

    const accessToken = createAccessToken(
      request.user_id,
      device.id
    );

    await client.query(
      `UPDATE device_link_codes
       SET consumed_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "New device linked successfully",
      device,
      accessToken
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }

    console.error("Device verification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Device verification failed"
    });

  } finally {
    if (client) client.release();
  }
});

module.exports = router;
