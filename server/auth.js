const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getPool } = require("./db");

const router = express.Router();

const CODE_LIFETIME_MINUTES = 3;
const MAX_CODE_ATTEMPTS = 5;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 72;

// --------------------
// HELPERS
// --------------------

function normalizePhone(phone) {
  return String(phone || "").replace(/[\s()-]/g, "");
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function cleanDeviceName(name) {
  if (typeof name !== "string") return "Unknown device";
  return name.trim().slice(0, 100) || "Unknown device";
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
  return crypto.createHash("sha256").update(code).digest("hex");
}

function safeHashCompare(first, second) {
  if (
    typeof first !== "string" ||
    typeof second !== "string" ||
    !/^[a-f0-9]{64}$/i.test(first) ||
    !/^[a-f0-9]{64}$/i.test(second)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(first, "hex"),
    Buffer.from(second, "hex")
  );
}

function checkJwtSecret() {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  ) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
}

function createAccessToken(userId, deviceId) {
  checkJwtSecret();

  return jwt.sign(
    { userId, deviceId },
    process.env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "15m"
    }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    phone_number: user.phone_number,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    about: user.about,
    auth_method: user.auth_method,
    created_at: user.created_at
  };
}

// --------------------
// AUTHENTICATION
// --------------------

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  try {
    checkJwtSecret();

    const token = header.slice(7);

    req.auth = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });

    if (!req.auth.userId || !req.auth.deviceId) {
      throw new Error("Invalid access token");
    }

    next();
  } catch (_) {
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

    const phone = normalizePhone(req.body?.phone_number);
    const authMethod = req.body?.auth_method;
    const password = req.body?.password;
    const deviceName = cleanDeviceName(req.body?.device_name);

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
      (
        typeof password !== "string" ||
        password.length < PASSWORD_MIN_LENGTH ||
        password.length > PASSWORD_MAX_LENGTH
      )
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
                 display_name, avatar_url, about,
                 auth_method, created_at`,
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
    const accessToken = createAccessToken(user.id, device.id);

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "BELVIA account created successfully",
      user: publicUser(user),
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

    if (error.code === "23514") {
      return res.status(400).json({
        success: false,
        message: "Account authentication details are invalid"
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

    const phone = normalizePhone(req.body?.phone_number);
    const password = req.body?.password;
    const suppliedDeviceToken = req.body?.device_token;
    const deviceName = cleanDeviceName(req.body?.device_name);

    if (
      !validPhone(phone) ||
      typeof password !== "string" ||
      password.length > PASSWORD_MAX_LENGTH
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid login details"
      });
    }

    const result = await getPool().query(
      `SELECT id, phone_number, username, display_name,
              avatar_url, about, password_hash, auth_method,
              created_at
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

    // Check whether this is an already trusted device.
    if (
      typeof suppliedDeviceToken === "string" &&
      /^[a-f0-9]{64}$/i.test(suppliedDeviceToken)
    ) {
      const existingDevice = await getPool().query(
        `UPDATE devices
         SET last_seen = NOW()
         WHERE user_id = $1
           AND device_token_hash = $2
           AND is_active = TRUE
         RETURNING id, device_name`,
        [user.id, hashToken(suppliedDeviceToken)]
      );

      if (existingDevice.rowCount) {
        const device = existingDevice.rows[0];

        return res.json({
          success: true,
          message: "Login successful",
          user: publicUser(user),
          device,
          accessToken: createAccessToken(user.id, device.id)
        });
      }
    }

    // A new device is allowed after the chosen
    // phone + password method succeeds.
    const newDeviceToken = createDeviceToken();

    const newDevice = await getPool().query(
      `INSERT INTO devices
       (user_id, device_name, device_token_hash)
       VALUES ($1, $2, $3)
       RETURNING id, device_name`,
      [user.id, deviceName, hashToken(newDeviceToken)]
    );

    const device = newDevice.rows[0];

    return res.json({
      success: true,
      message: "Login successful on new device",
      user: publicUser(user),
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
// REFRESH ACCESS TOKEN
// --------------------

router.post("/refresh", async (req, res) => {
  try {
    checkJwtSecret();

    const deviceToken = req.body?.device_token;

    if (
      typeof deviceToken !== "string" ||
      !/^[a-f0-9]{64}$/i.test(deviceToken)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid device token required"
      });
    }

    const result = await getPool().query(
      `UPDATE devices
       SET last_seen = NOW()
       WHERE device_token_hash = $1
         AND is_active = TRUE
       RETURNING id, user_id, device_name`,
      [hashToken(deviceToken)]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        success: false,
        message: "Device is not trusted"
      });
    }

    const device = result.rows[0];

    return res.json({
      success: true,
      device: {
        id: device.id,
        device_name: device.device_name
      },
      accessToken: createAccessToken(device.user_id, device.id)
    });

  } catch (error) {
    console.error("Token refresh error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not refresh access token"
    });
  }
});

// --------------------
// CURRENT USER
// --------------------

router.get("/me", authenticate, async (req, res) => {
  try {
    const device = await getAuthenticatedDevice(req);

    if (!device) {
      return res.status(401).json({
        success: false,
        message: "Trusted device not found"
      });
    }

    const result = await getPool().query(
      `SELECT id, phone_number, username, display_name,
              avatar_url, about, auth_method, created_at
       FROM users
       WHERE id = $1`,
      [req.auth.userId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }

    return res.json({
      success: true,
      user: result.rows[0],
      device
    });

  } catch (error) {
    console.error("Current user error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load account"
    });
  }
});

// --------------------
// REQUEST DEVICE LINK
// --------------------

router.post("/device-link/request", async (req, res) => {
  let client;

  try {
    const phone = normalizePhone(req.body?.phone_number);
    const deviceName = req.body?.device_name;
    const deviceToken = req.body?.device_token;

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

    const targetTokenHash = hashToken(deviceToken);

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

    // Do not reuse a device token that already belongs to a device.
    const existingDevice = await client.query(
      `SELECT id
       FROM devices
       WHERE device_token_hash = $1`,
      [targetTokenHash]
    );

    if (existingDevice.rowCount) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message: "This device is already linked"
      });
    }

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

    // Invalidate previous pending requests and release old
    // target hashes so the same new device can retry later.
    await client.query(
      `UPDATE device_link_codes
       SET consumed_at = COALESCE(consumed_at, NOW()),
           target_device_token_hash = NULL
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [user.id]
    );

    // A completed request may still hold this target hash.
    // Clear it because its device token is now being reused.
    await client.query(
      `UPDATE device_link_codes
       SET target_device_token_hash = NULL
       WHERE target_device_token_hash = $1`,
      [targetTokenHash]
    );

    const placeholderHash = hashToken(createDeviceToken());

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
        placeholderHash,
        deviceName.trim(),
        targetTokenHash
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
// --------------------

router.post(
  "/device-link/approve/:requestId",
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

    const requestId = req.body?.request_id;
    const code = String(req.body?.code || "");

    if (
      typeof requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(requestId) ||
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
      `SELECT dlc.id, dlc.user_id, dlc.source_device_id,
              dlc.code_hash, dlc.target_device_name,
              dlc.target_device_token_hash,
              dlc.expires_at, dlc.consumed_at, dlc.attempts,
              u.auth_method,
              d.id AS active_source_device_id
       FROM device_link_codes dlc
       JOIN users u ON u.id = dlc.user_id
       LEFT JOIN devices d
         ON d.id = dlc.source_device_id
        AND d.user_id = dlc.user_id
        AND d.is_active = TRUE
       WHERE dlc.id = $1
       FOR UPDATE OF dlc`,
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
      request.auth_method !== "device_verification" ||
      !request.active_source_device_id ||
      !request.target_device_name ||
      !request.target_device_token_hash ||
      request.consumed_at ||
      new Date(request.expires_at).getTime() <= Date.now() ||
      request.attempts >= MAX_CODE_ATTEMPTS
    ) {
      await client.query(
        `UPDATE device_link_codes
         SET consumed_at = COALESCE(consumed_at, NOW())
         WHERE id = $1`,
        [requestId]
      );

      await client.query("COMMIT");

      return res.status(410).json({
        success: false,
        message: "Verification request expired or is no longer available"
      });
    }

    if (!safeHashCompare(hashCode(code), request.code_hash)) {
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

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This device token is already linked"
      });
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
