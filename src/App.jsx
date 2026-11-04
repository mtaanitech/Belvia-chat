
import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle, CircleDot, Phone, Settings, Search,
  ArrowLeft, Send, Plus, MoreVertical, Lock,
  CheckCheck, X, UserPlus, LogOut, Trash2,
  User, Shield, Bell, RefreshCw
} from "lucide-react";

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
    throw new Error(data.message || "Request failed");
  }

  return data;
}

const timeNow = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

function Avatar({ name = "U", online }) {
  return (
    <div className="avatar">
      {name.charAt(0).toUpperCase()}
      {online && <span className="avatar-online" />}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState("chats");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef(null);

  const activeChat = chats.find(
    chat => String(chat.id) === String(activeId)
  );

  const loadChats = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const data = await api("/api/chats");

      setChats(data.chats || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    try {
      const data = await api(
        `/api/chats/${encodeURIComponent(chatId)}/messages`
      );

      setMessages(data.messages || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (activeId !== null) {
      loadMessages(activeId);
    }
  }, [activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const value = text.trim();

    if (!value || !activeId || loading) return;

    try {
      setLoading(true);
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

      if (data.message) {
        setMessages(prev => [...prev, data.message]);
      } else {
        await loadMessages(activeId);
      }

      setText("");
      await loadChats();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createChat = async () => {
    const number = phone.trim();

    if (!number.startsWith("+")) {
      setError("Enter an international phone number.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ phone_number: number })
      });

      await loadChats();

      if (data.conversation) {
        setActiveId(data.conversation.id);
      } else if (data.chat) {
        setActiveId(data.chat.id);
      }

      setNewChatOpen(false);
      setPhone("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("belvia_access_token");
    localStorage.removeItem("belvia_device_token");
    window.location.reload();
  };

  const filteredChats = chats.filter(chat => {
    const name = chat.name || chat.display_name || "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const goBack = () => {
    setActiveId(null);
    setMessages([]);
    setError("");
  };

  const renderSettings = () => (
    <div className="list-scroll">
      <header className="list-header">
        <h1>Settings</h1>
      </header>

      <button className="chat-row" onClick={() => setNotice("Profile settings")}>
        <User size={22} />
        <div className="chat-row-body">
          <strong>Profile</strong>
          <p>Manage your profile information</p>
        </div>
      </button>

      <button className="chat-row" onClick={() => setNotice("Privacy settings")}>
        <Shield size={22} />
        <div className="chat-row-body">
          <strong>Privacy and security</strong>
          <p>Manage your account security</p>
        </div>
      </button>

      <button className="chat-row" onClick={() => setNotice("Notification settings")}>
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
      {activeChat ? (
        <div className="chat-screen">
          <header className="chat-header">
            <button className="icon-btn" onClick={goBack}>
              <ArrowLeft size={22} />
            </button>

            <Avatar name={activeChat.name || activeChat.display_name || "U"} online={activeChat.online} />

            <div className="chat-header-info">
              <strong>{activeChat.name || activeChat.display_name || "BELVIA user"}</strong>
              <small>{activeChat.online ? "online" : "BELVIA CHAT"}</small>
            </div>

            <button className="icon-btn" onClick={() => setNotice("Voice calling will be connected to the calling service.")}>
              <Phone size={19} />
            </button>

            <button className="icon-btn" onClick={() => setMoreOpen(!moreOpen)}>
              <MoreVertical size={20} />
            </button>
          </header>

          {moreOpen && (
            <div className="list-scroll">
              <button className="chat-row" onClick={() => setNotice("Conversation details")}>
                Conversation details
              </button>
              <button className="chat-row" onClick={() => setNotice("Blocking requires the backend block endpoint.")}>
                Block contact
              </button>
            </div>
          )}

          <div className="chat-messages">
            {messages.map((message, index) => {
              const mine = message.sender_id === message.user_id ||
                message.from === "me";

              return (
                <div
                  key={message.id || index}
                  className={`bubble ${mine ? "me" : "them"}`}
                >
                  <span className="message-text">
                    {message.content || message.text}
                  </span>
                  <small>
                    {message.created_at
                      ? new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit"
                        })
                      : message.time || ""}
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
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Message"
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={!text.trim() || loading}
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
                      onClick={() => setMenuOpen(!menuOpen)}
                    >
                      <MoreVertical size={20} />
                    </button>
                  </div>

                  {menuOpen && (
                    <div>
                      <button className="chat-row" onClick={() => setTab("settings")}>
                        <Settings size={18} /> Settings
                      </button>
                      <button className="chat-row" onClick={logout}>
                        <LogOut size={18} /> Log out
                      </button>
                    </div>
                  )}

                  <div className="search">
                    <Search size={16} />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
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
                  {loading && <p>Loading chats...</p>}
                  {error && <p role="alert">{error}</p>}

                  {filteredChats.map(chat => {
                    const name = chat.name || chat.display_name || "BELVIA user";
                    const last = chat.last_message;

                    return (
                      <button
                        key={chat.id}
                        className="chat-row"
                        onClick={() => setActiveId(chat.id)}
                      >
                        <Avatar name={name} online={chat.online} />
                        <div className="chat-row-body">
                          <div className="chat-row-top">
                            <strong>{name}</strong>
                            <small>{last?.created_at ? new Date(last.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</small>
                          </div>
                          <p>{last?.content || last?.text || "Start a conversation"}</p>
                        </div>
                      </button>
                    );
                  })}

                  {!loading && !error && filteredChats.length === 0 && (
                    <p>No conversations found.</p>
                  )}

                  <div className="e2e-note">
                    <Lock size={12} /> Your messages are private
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
                <button className="fab" onClick={() => setNotice("Status publishing requires the status API.")}>
                  <Plus size={24} />
                </button>
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
        <div className="modal-overlay">
          <div className="modal">
            <div className="brand-row">
              <h2>New conversation</h2>
              <button className="icon-btn" onClick={() => setNewChatOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Phone number e.g. +2547XXXXXXXX"
            />
            <button className="send-btn" onClick={createChat} disabled={loading}>
              <UserPlus size={18} /> Start chat
            </button>
          </div>
        </div>
      )}

      {(error || notice) && (
        <div className="notice" role="status">
          <span>{notice || error}</span>
          <button onClick={() => {
            setNotice("");
            setError("");
          }}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
