const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { getPool } = require("./db");

const router = express.Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MESSAGE_TYPES = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "voice",
  "location"
];

// --------------------
// AUTHENTICATION
// --------------------

function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required"
      });
    }

    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
      return res.status(500).json({
        success: false,
        message: "Server authentication is not configured"
      });
    }

    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"]
    });

    if (!payload.userId || !payload.deviceId) {
      return res.status(401).json({
        success: false,
        message: "Invalid access token"
      });
    }

    req.auth = {
      userId: payload.userId,
      deviceId: payload.deviceId
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired access token"
    });
  }
}

async function verifyActiveDevice(client, userId, deviceId) {
  const result = await client.query(
    `SELECT id
     FROM devices
     WHERE id = $1
       AND user_id = $2
       AND is_active = TRUE`,
    [deviceId, userId]
  );

  return result.rowCount > 0;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[\s()-]/g, "");
}

function validUuid(value) {
  return UUID_REGEX.test(String(value || ""));
}

// All chat routes require authentication.
router.use(authenticate);

// --------------------
// CREATE OR OPEN DIRECT CHAT
// --------------------

router.post("/conversations/direct", async (req, res) => {
  const phoneNumber = normalizePhone(req.body.phoneNumber);

  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid international phone number"
    });
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const active = await verifyActiveDevice(
      client,
      req.auth.userId,
      req.auth.deviceId
    );

    if (!active) {
      await client.query("ROLLBACK");

      return res.status(401).json({
        success: false,
        message: "This device is no longer active"
      });
    }

    const targetResult = await client.query(
      `SELECT id, username, display_name, avatar_url, about
       FROM users
       WHERE phone_number = $1`,
      [phoneNumber]
    );

    if (targetResult.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        message: "This user does not have a BELVIA CHAT account"
      });
    }

    const target = targetResult.rows[0];

    if (target.id === req.auth.userId) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "You cannot create a chat with yourself"
      });
    }

    const sortedIds = [
      req.auth.userId,
      target.id
    ].sort();

    const lockKey = crypto
      .createHash("sha256")
      .update(sortedIds.join(":"))
      .digest("hex")
      .slice(0, 15);

    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [BigInt("0x" + lockKey).toString()]
    );

    const existing = await client.query(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id = c.id
       WHERE c.conversation_type = 'direct'
         AND cm.user_id = ANY($1::uuid[])
       GROUP BY c.id
       HAVING COUNT(DISTINCT cm.user_id) = 2
          AND COUNT(*) = 2
       LIMIT 1`,
      [sortedIds]
    );

    let conversationId;

    if (existing.rowCount > 0) {
      conversationId = existing.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO conversations (conversation_type)
         VALUES ('direct')
         RETURNING id`,
      );

      conversationId = created.rows[0].id;

      await client.query(
        `INSERT INTO conversation_members
           (conversation_id, user_id)
         VALUES
           ($1, $2),
           ($1, $3)`,
        [conversationId, req.auth.userId, target.id]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      conversation: {
        id: conversationId,
        type: "direct"
      },
      participant: {
        id: target.id,
        username: target.username,
        displayName: target.display_name,
        avatarUrl: target.avatar_url,
        about: target.about
      }
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Create direct conversation:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not open conversation"
    });
  } finally {
    client.release();
  }
});

// --------------------
// LIST USER CONVERSATIONS
// --------------------

router.get("/conversations", async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.query(
      `SELECT
         c.id,
         c.conversation_type,
         c.title,
         c.created_at,
         (
           SELECT m.encrypted_content
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT m.message_type
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message_type,
         (
           SELECT m.created_at
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message_at,
         (
           SELECT json_build_object(
             'id', u.id,
             'username', u.username,
             'displayName', u.display_name,
             'avatarUrl', u.avatar_url
           )
           FROM conversation_members other_member
           JOIN users u ON u.id = other_member.user_id
           WHERE other_member.conversation_id = c.id
             AND other_member.user_id <> $1
           LIMIT 1
         ) AS participant
       FROM conversations c
       JOIN conversation_members mine
         ON mine.conversation_id = c.id
       WHERE mine.user_id = $1
       ORDER BY COALESCE(
         (
           SELECT MAX(m.created_at)
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
         ),
         c.created_at
       ) DESC`,
      [req.auth.userId]
    );

    return res.json({
      success: true,
      conversations: result.rows
    });
  } catch (error) {
    console.error("List conversations:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load conversations"
    });
  }
});

// --------------------
// READ CONVERSATION MESSAGES
// --------------------

router.get(
  "/conversations/:conversationId/messages",
  async (req, res) => {
    const { conversationId } = req.params;

    if (!validUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID"
      });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 30, 1),
      100
    );

    const before = req.query.before || null;

    if (before && !validUuid(before)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message cursor"
      });
    }

    try {
      const pool = getPool();

      const membership = await pool.query(
        `SELECT 1
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id = $2`,
        [conversationId, req.auth.userId]
      );

      if (membership.rowCount === 0) {
        return res.status(403).json({
          success: false,
          message: "You are not a member of this conversation"
        });
      }

      const result = await pool.query(
        `SELECT
           m.id,
           m.conversation_id,
           m.sender_id,
           m.encrypted_content,
           m.message_type,
           m.created_at,
           m.edited_at
         FROM messages m
         WHERE m.conversation_id = $1
           AND m.deleted_at IS NULL
           AND (
             $2::uuid IS NULL
             OR m.created_at < (
               SELECT cursor_message.created_at
               FROM messages cursor_message
               WHERE cursor_message.id = $2
                 AND cursor_message.conversation_id = $1
             )
           )
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT $3`,
        [conversationId, before, limit]
      );

      return res.json({
        success: true,
        messages: result.rows.reverse(),
        limit
      });
    } catch (error) {
      console.error("Read messages:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not load messages"
      });
    }
  }
);

// --------------------
// SEND MESSAGE
// --------------------

router.post(
  "/conversations/:conversationId/messages",
  async (req, res) => {
    const { conversationId } = req.params;
    const encryptedContent = req.body.encryptedContent;
    const messageType = req.body.messageType || "text";

    if (!validUuid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID"
      });
    }

    if (
      typeof encryptedContent !== "string" ||
      encryptedContent.length === 0 ||
      Buffer.byteLength(encryptedContent, "utf8") > 1024 * 1024
    ) {
      return res.status(400).json({
        success: false,
        message: "Message content is invalid or too large"
      });
    }

    if (!ALLOWED_MESSAGE_TYPES.includes(messageType)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported message type"
      });
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const active = await verifyActiveDevice(
        client,
        req.auth.userId,
        req.auth.deviceId
      );

      if (!active) {
        await client.query("ROLLBACK");

        return res.status(401).json({
          success: false,
          message: "This device is no longer active"
        });
      }

      const membership = await client.query(
        `SELECT 1
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id = $2`,
        [conversationId, req.auth.userId]
      );

      if (membership.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          success: false,
          message: "You cannot send messages to this conversation"
        });
      }

      const result = await client.query(
        `INSERT INTO messages (
           conversation_id,
           sender_id,
           encrypted_content,
           message_type
         )
         VALUES ($1, $2, $3, $4)
         RETURNING
           id,
           conversation_id,
           sender_id,
           encrypted_content,
           message_type,
           created_at`,
        [
          conversationId,
          req.auth.userId,
          encryptedContent,
          messageType
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        message: result.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      console.error("Send message:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not send message"
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
