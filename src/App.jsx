import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle, CircleDot, Phone, Settings, Search,
  ArrowLeft, Send, Plus, MoreVertical, Lock,
  CheckCheck, X, UserPlus, LogOut,
  User, Shield, Bell
} from "lucide-react";

import "./App.css";

const API = import.meta.env.VITE_API_URL || "";

async function api(path, options = {}) {
  const token = localStorage.getItem("belvia_access_token");

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

function Avatar({ name = "U", online = false }) {
  return (
    <div className="avatar">
      {String(name).charAt(0).toUpperCase()}
      {online && <span className="avatar-online" />}
    </div>
  );
}

function formatTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function App() {
  const [tab, setTab] = useState("chats");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const [chatsLoading, setChatsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const endRef = useRef(null);

  const activeChat = chats.find(
    chat => String(chat.id) === String(activeId)
  );

  // Load the logged-in user.
  const loadCurrentUser = useCallback(async () => {
    try {
      const data = await api("/api/auth/me");
      setCurrentUser(data.user || data);
    } catch {
      // Do not block the chat screen if this endpoint
      // returns a different response format.
    }
  }, []);

  // Load conversations from the server.
  const loadChats = useCallback(async (silent = false) => {
    try {
      if (!silent) setChatsLoading(true);

      const data = await api("/api/chats");
      setChats(Array.isArray(data.chats) ? data.chats : []);

      if (!silent) setError("");
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setChatsLoading(false);
    }
  }, []);

  // Load messages for one conversation.
  const loadMessages = useCallback(async (chatId, silent = false) => {
    if (!chatId) return;

    try {
      if (!silent) setMessagesLoading(true);

      const data = await api(
        `/api/chats/${encodeURIComponent(chatId)}/messages`
      );

      setMessages(
        Array.isArray(data.messages) ? data.messages : []
      );

      if (!silent) setError("");
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  // Initial loading.
  useEffect(() => {
    loadCurrentUser();
    loadChats();
  }, [loadCurrentUser, loadChats]);

  // Refresh conversations periodically for incoming chats.
  useEffect(() => {
    const interval = setInterval(() => {
      loadChats(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [loadChats]);

  // Load and refresh messages while a conversation is open.
  useEffect(() => {
    if (activeId === null) return;

    loadMessages(activeId);

    const interval = setInterval(() => {
      loadMessages(activeId, true);
    }, 5000);

    return () => clearInterval(interval);
  }, [activeId, loadMessages]);

  // Scroll to the latest message.
  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages]);

  // Determine whether a message belongs to the logged-in user.
  const isMine = message => {
    const senderId = message.sender_id || message.user_id;
    const myId = currentUser?.id || currentUser?.user?.id;

    if (senderId && myId) {
      return String(senderId) === String(myId);
    }

    return message.from === "me";
  };

  // Send a real message through the backend.
  const sendMessage = async () => {
    const value = text.trim();

    if (!value || !activeId || sending) return;

    try {
      setSending(true);
      setError("");

      const data = await api(
        `/api/chats/${encodeURIComponent(activeId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            content: value,
            message_type: "text"
          })
        }
      );

      setText("");

      if (data.message) {
        setMessages(previous => {
          const exists = previous.some(
            item => item.id && item.id === data.message.id
          );

          return exists
            ? previous
            : [...previous, data.message];
        });
      } else {
        await loadMessages(activeId, true);
      }

      await loadChats(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  // Start a conversation using an international phone number.
  const createChat = async () => {
    const number = phone.trim();

    if (!/^\+[1-9]\d{7,14}$/.test(number)) {
      setError("Enter a valid international phone number.");
      return;
    }

    try {
      setError("");

      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({
          phone_number: number
        })
      });

      const conversation =
        data.conversation || data.chat;

      if (!conversation?.id) {
        throw new Error(
          "The server did not return a conversation ID."
        );
      }

      await loadChats(true);

      setActiveId(conversation.id);
      setMessages([]);
      setPhone("");
      setNewChatOpen(false);
      setMenuOpen(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = () => {
    localStorage.removeItem("belvia_access_token");
    localStorage.removeItem("belvia_device_token");
    window.location.reload();
  };

  const goBack = () => {
    setActiveId(null);
    setMessages([]);
    setText("");
    setMoreOpen(false);
    setError("");
    loadChats(true);
  };

  const filteredChats = chats.filter(chat => {
    const name =
      chat.name ||
      chat.display_name ||
      chat.phone_number ||
      "BELVIA user";

    return String(name)
      .toLowerCase()
      .includes(search.toLowerCase());
  });

  const openChat = chat => {
    setActiveId(chat.id);
    setMessages([]);
    setMoreOpen(false);
    setError("");
  };

  const renderSettings = () => (
    <div className="list-scroll">
      <header className="list-header">
        <h1>Settings</h1>
      </header>

      <button
        className="chat-row"
        onClick={() => setNotice("Profile settings are not connected yet.")}
      >
        <User size={22} />
        <div className="chat-row-body">
          <strong>Profile</strong>
          <p>Manage your profile information</p>
        </div>
      </button>

      <button
        className="chat-row"
        onClick={() => setNotice("Privacy settings are not connected yet.")}
      >
        <Shield size={22} />
        <div className="chat-row-body">
          <strong>Privacy and security</strong>
          <p>Manage your account security</p>
        </div>
      </button>

      <button
        className="chat-row"
        onClick={() => setNotice("Notification settings are not connected yet.")}
      >
        <Bell size={22} />
        <div className="chat-row-body">
          <strong>Notifications</strong>
          <p>Manage notifications</p>
        </div>
      </button>

      <button className="chat-row" onClick={logout}>
        <LogOut size={22} />
        <div className="chat-row-body">
          <strong>Log out</strong>
          <p>Sign out of BELVIA CHAT</p>
        </div>
      </button>
    </div>
  );

  return (
    <div className="app">
      {activeId !== null ? (
        <div className="chat-screen">
          <header className="chat-header">
            <button className="icon-btn" onClick={goBack}>
              <ArrowLeft size={22} />
            </button>

            <Avatar
              name={
                activeChat?.name ||
                activeChat?.display_name ||
                "U"
              }
              online={activeChat?.online}
            />

            <div className="chat-header-info">
              <strong>
                {activeChat?.name ||
                  activeChat?.display_name ||
                  "BELVIA user"}
              </strong>
              <small>
                {activeChat?.online ? "online" : "BELVIA CHAT"}
              </small>
            </div>

            <button
              className="icon-btn"
              onClick={() =>
                setNotice("Calling is not connected yet.")
              }
              aria-label="Call"
            >
              <Phone size={19} />
            </button>

            <button
              className="icon-btn"
              onClick={() => setMoreOpen(value => !value)}
              aria-label="Conversation menu"
            >
              <MoreVertical size={20} />
            </button>
          </header>

          {moreOpen && (
            <div className="conversation-menu">
              <button
                className="chat-row"
                onClick={() => {
                  setMoreOpen(false);
                  setNotice("Conversation details are not connected yet.");
                }}
              >
                Conversation details
              </button>

              <button
                className="chat-row"
                onClick={() => {
                  setMoreOpen(false);
                  setNotice("Blocking needs a backend endpoint.");
                }}
              >
                Block contact
              </button>
            </div>
          )}

          <div className="chat-messages">
            {messagesLoading && messages.length === 0 && (
              <p>Loading messages...</p>
            )}

            {!messagesLoading && messages.length === 0 && (
              <p className="empty-messages">
                No messages yet. Say hello!
              </p>
            )}

            {messages.map((message, index) => {
              const mine = isMine(message);

              return (
                <div
                  key={message.id || index}
                  className={`bubble ${mine ? "me" : "them"}`}
                >
                  <span className="message-text">
                    {message.content || message.text || ""}
                  </span>

                  <small>
                    {formatTime(message.created_at) ||
                      message.time ||
                      ""}
                    {mine && <CheckCheck size={13} />}
                  </small>
                </div>
              );
            })}

            <div ref={endRef} />
          </div>

          <div className="chat-input-bar">
            <input
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Message"
              aria-label="Message"
            />

            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={!text.trim() || sending}
              aria-label="Send message"
            >
              <Send size={19} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="screen">
            {tab === "chats" && (
              <>
                <header className="list-header">
                  <div className="brand-row">
                    <h1>BELVIA</h1>

                    <button
                      className="icon-btn"
                      onClick={() => setMenuOpen(value => !value)}
                    >
                      <MoreVertical size={20} />
                    </button>
                  </div>

                  {menuOpen && (
                    <div className="header-menu">
                      <button
                        className="chat-row"
                        onClick={() => {
                          setTab("settings");
                          setMenuOpen(false);
                        }}
                      >
                        <Settings size={18} />
                        Settings
                      </button>

                      <button className="chat-row" onClick={logout}>
                        <LogOut size={18} />
                        Log out
                      </button>
                    </div>
                  )}

                  <div className="search">
                    <Search size={16} />

                    <input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Search chats"
                    />

                    {search && (
                      <button onClick={() => setSearch("")}>
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </header>

                <div className="list-scroll">
                  {chatsLoading && chats.length === 0 && (
                    <p>Loading chats...</p>
                  )}

                  {error && <p role="alert">{error}</p>}

                  {filteredChats.map(chat => {
                    const name =
                      chat.name ||
                      chat.display_name ||
                      chat.phone_number ||
                      "BELVIA user";

                    const last = chat.last_message;
                    const unread = Number(chat.unread_count || 0);

                    return (
                      <button
                        key={chat.id}
                        className="chat-row"
                        onClick={() => openChat(chat)}
                      >
                        <Avatar
                          name={name}
                          online={chat.online}
                        />

                        <div className="chat-row-body">
                          <div className="chat-row-top">
                            <strong>{name}</strong>

                            <small>
                              {formatTime(last?.created_at)}
                            </small>
                          </div>

                          <p>
                            {last?.content ||
                              last?.text ||
                              "Start a conversation"}
                          </p>
                        </div>

                        {unread > 0 && (
                          <span className="unread-count">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {!chatsLoading &&
                    !error &&
                    filteredChats.length === 0 && (
                      <p>
                        {search
                          ? "No matching conversations."
                          : "No conversations yet. Start a new chat."}
                      </p>
                    )}

                  <div className="e2e-note">
                    <Lock size={12} />
                    Your messages are private
                  </div>
                </div>

                <button
                  className="fab"
                  aria-label="New chat"
                  onClick={() => setNewChatOpen(true)}
                >
                  <Plus size={24} />
                </button>
              </>
            )}

            {tab === "settings" && renderSettings()}

            {tab === "status" && (
              <div className="list-scroll">
                <header className="list-header">
                  <h1>Status</h1>
                </header>
                <p>No status updates available.</p>
              </div>
            )}

            {tab === "calls" && (
              <div className="list-scroll">
                <header className="list-header">
                  <h1>Calls</h1>
                </header>
                <p>No calls yet.</p>
              </div>
            )}
          </div>

          <nav className="tabs">
            {[
              { key: "chats", label: "Chats", icon: MessageCircle },
              { key: "status", label: "Status", icon: CircleDot },
              { key: "calls", label: "Calls", icon: Phone },
              { key: "settings", label: "Settings", icon: Settings }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`tab ${tab === key ? "active" : ""}`}
                onClick={() => {
                  setTab(key);
                  setMenuOpen(false);
                }}
              >
                <Icon size={21} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {newChatOpen && (
        <div
          className="modal-overlay"
          onClick={event => {
            if (event.target === event.currentTarget) {
              setNewChatOpen(false);
            }
          }}
        >
          <div className="modal">
            <div className="brand-row">
              <h2>New conversation</h2>

              <button
                className="icon-btn"
                onClick={() => setNewChatOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <input
              value={phone}
              onChange={event => setPhone(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") createChat();
              }}
              placeholder="Phone number e.g. +2547XXXXXXXX"
            />

            <button
              className="send-btn"
              onClick={createChat}
              disabled={!phone.trim()}
            >
              <UserPlus size={18} />
              Start chat
            </button>
          </div>
        </div>
      )}

      {(error || notice) && (
        <div className="notice" role="status">
          <span>{notice || error}</span>

          <button
            onClick={() => {
              setNotice("");
              setError("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
