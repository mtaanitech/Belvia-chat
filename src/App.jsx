import { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  CircleDot,
  Phone,
  Settings,
  Search,
  ArrowLeft,
  Send,
  Plus,
  MoreVertical,
  Lock,
  CheckCheck
} from "lucide-react";

const now = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Demo data only. Later this will come from the backend.
const initialChats = [
  {
    id: 1,
    name: "Belvia Team",
    online: true,
    messages: [
      { id: 1, from: "them", text: "Welcome to BELVIA CHAT 👋", time: "09:00" },
      { id: 2, from: "them", text: "Connect beyond boundaries.", time: "09:01" }
    ]
  },
  {
    id: 2,
    name: "Amina",
    online: true,
    messages: [{ id: 1, from: "them", text: "Hey, are you free today?", time: "08:12" }]
  },
  {
    id: 3,
    name: "Brian",
    online: false,
    messages: [{ id: 1, from: "me", text: "Sent the files 👍", time: "Yesterday" }]
  }
];

const tabs = [
  { key: "chats", label: "Chats", icon: MessageCircle },
  { key: "status", label: "Status", icon: CircleDot },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "settings", label: "Settings", icon: Settings }
];

function Avatar({ name, online }) {
  return (
    <div className="avatar">
      {name.charAt(0).toUpperCase()}
      {online && <span className="avatar-online" />}
    </div>
  );
}

function ChatList({ chats, onOpen }) {
  return (
    <>
      <header className="list-header">
        <div className="brand-row">
          <h1>BELVIA</h1>
          <button className="icon-btn" aria-label="Menu">
            <MoreVertical size={20} />
          </button>
        </div>
        <div className="search">
          <Search size={16} />
          <input placeholder="Search chats" />
        </div>
      </header>

      <div className="list-scroll">
        {chats.map((chat) => {
          const last = chat.messages[chat.messages.length - 1];
          return (
            <button key={chat.id} className="chat-row" onClick={() => onOpen(chat.id)}>
              <Avatar name={chat.name} online={chat.online} />
              <div className="chat-row-body">
                <div className="chat-row-top">
                  <strong>{chat.name}</strong>
                  <small>{last?.time}</small>
                </div>
                <p>{last?.text}</p>
              </div>
            </button>
          );
        })}
        <div className="e2e-note">
          <Lock size={12} /> Your messages are private
        </div>
      </div>

      <button className="fab" aria-label="New chat">
        <Plus size={24} />
      </button>
    </>
  );
}

function ChatScreen({ chat, onBack, onSend }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onSend(chat.id, value);
    setText("");
  };

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <Avatar name={chat.name} online={chat.online} />
        <div className="chat-header-info">
          <strong>{chat.name}</strong>
          <small>{chat.online ? "online" : "offline"}</small>
        </div>
        <button className="icon-btn" aria-label="Call">
          <Phone size={19} />
        </button>
        <button className="icon-btn" aria-label="More">
          <MoreVertical size={20} />
        </button>
      </header>

      <div className="chat-messages">
        {chat.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from === "me" ? "me" : "them"}`}>
            <span className="message-text">{m.text}</span>
            <small>
              {m.time}
              {m.from === "me" && <CheckCheck size={13} />}
            </small>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="chat-input-bar">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Message"
        />
        <button className="send-btn" onClick={submit} aria-label="Send">
          <Send size={19} />
        </button>
      </div>
    </div>
  );
}

function EmptyTab({ title }) {
  return (
    <div className="empty-tab">
      <h2>{title}</h2>
      <p>Coming soon.</p>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("chats");
  const [chats, setChats] = useState(initialChats);
  const [activeId, setActiveId] = useState(null);

  const activeChat = chats.find((c) => c.id === activeId);

  const sendMessage = (id, text) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              messages: [...c.messages, { id: Date.now(), from: "me", text, time: now() }]
            }
          : c
      )
    );
  };

  return (
    <div className="app">
      {activeChat ? (
        <ChatScreen
          chat={activeChat}
          onBack={() => setActiveId(null)}
          onSend={sendMessage}
        />
      ) : (
        <>
          <div className="screen">
            {tab === "chats" && <ChatList chats={chats} onOpen={setActiveId} />}
            {tab === "status" && <EmptyTab title="Status" />}
            {tab === "calls" && <EmptyTab title="Calls" />}
            {tab === "settings" && <EmptyTab title="Settings" />}
          </div>

          <nav className="tabs">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`tab ${tab === key ? "active" : ""}`}
                onClick={() => setTab(key)}
              >
                <Icon size={21} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
              }
