
import React from "react";
import ReactDOM from "react-dom/client";
import {
  MessageCircle,
  Phone,
  Users,
  Heart,
  Settings,
  Search,
  Plus,
  Lock,
  Bell,
  ArrowUpRight
} from "lucide-react";
import "./style.css";

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">B</div>
          <div>
            <h2>BELVIA</h2>
            <span>Connect Beyond Boundaries</span>
          </div>
        </div>

        <div className="profile">
          <div className="avatar">B</div>
          <div>
            <strong>Your account</strong>
            <small>Welcome to BELVIA</small>
          </div>
          <span className="online-dot" />
        </div>

        <nav>
          <a className="active"><MessageCircle /> Messages</a>
          <a><Phone /> Calls</a>
          <a><Users /> Groups</a>
          <a><Heart /> Singles</a>
          <a><Settings /> Settings</a>
        </nav>

        <div className="security">
          <Lock />
          <div>
            <strong>Privacy first</strong>
            <p>Your conversations deserve protection.</p>
          </div>
        </div>

        <div className="sidebar-bottom">
          <span>© 2026 BELVIA CHAT</span>
          <span>Global messaging</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR PRIVATE SPACE</span>
            <h1>Messages</h1>
            <p>Connect with people beyond boundaries.</p>
          </div>
          <button className="icon-button" aria-label="Notifications">
            <Bell />
          </button>
        </header>

        <section className="welcome">
          <div className="welcome-content">
            <span className="welcome-label">
              <span className="online-dot" /> BELVIA CHAT
            </span>
            <h2>Your world.<br />Your conversations.</h2>
            <p>
              A new way to stay close, communicate freely
              and keep your privacy in control.
            </p>
            <button className="start-button">
              Explore BELVIA <ArrowUpRight />
            </button>
          </div>
          <div className="welcome-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="chat-symbol">
              <MessageCircle />
              <span />
            </div>
            <div className="floating-lock"><Lock /></div>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-heading">
              <div>
                <h3>Your conversations</h3>
                <p>Your private messaging space</p>
              </div>
              <button className="new-button"><Plus /> New chat</button>
            </div>

            <div className="empty-state">
              <div className="empty-icon"><MessageCircle /></div>
              <h3>No conversations yet</h3>
              <p>Your real conversations will appear here when you connect with people.</p>
            </div>
          </div>

          <div className="panel privacy-panel">
            <div className="privacy-icon"><Lock /></div>
            <h3>Privacy matters</h3>
            <p>
              BELVIA is being built around secure communication
              and control over your personal conversations.
            </p>
            <div className="privacy-status">
              <span className="status-dot" />
              Privacy features in development
            </div>
          </div>
        </section>

        <footer>
          <span>BELVIA CHAT</span>
          <span>Connect Beyond Boundaries.</span>
        </footer>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
