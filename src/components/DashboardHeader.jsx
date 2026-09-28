import React, { useState, useEffect } from "react";
import { apiFetch } from "../api/client";

export default function DashboardHeader({ session, roleLabel, onLogout, children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (session) {
      apiFetch("/notifications").then((data) => setNotifications(data || [])).catch(() => {});
    }
  }, [session]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleNotifClick = async () => {
    setIsNotifOpen(!isNotifOpen);
    if (!isNotifOpen && unreadCount > 0) {
      try {
        await apiFetch("/notifications/read", { method: "POST" });
        setNotifications(notifications.map(n => ({ ...n, read: true })));
      } catch (err) {}
    }
  };

  const isTaxpayer = roleLabel?.toLowerCase().includes("taxpayer") || session?.role === "taxpayer";
  const isAuditor = roleLabel?.toLowerCase().includes("auditor") || session?.role === "auditor";

  return (
    <header className="dash-nav-wrap">
      <nav className="dash-nav">
        <div className="dash-nav-left">
          {(isTaxpayer || isAuditor) && (
            <button
              className="hamburger-menu"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open Menu"
            >
              ☰
            </button>
          )}
          <button
            className="brand"
            onClick={() => {
              window.location.hash = "#/";
            }}
            aria-label="T-REX home"
            title="Return to T-REX Landing Page"
          >
            <span className="brand-mark">T</span>
            <span>T-REX</span>
          </button>
          <div className="dash-role-tag">
            <span>LIVE</span>
            <span>{roleLabel || session.role}</span>
          </div>
        </div>

        {children && <div className="dash-nav-center">{children}</div>}

        <div className="dash-nav-right">
          <button
            className="home-nav-link"
            onClick={() => {
              window.location.hash = "#/";
            }}
          >
            LANDING PAGE
          </button>
          
          <div className="header-actions">
            <div className="profile-menu-wrap">
              <button 
                className="notification-btn" 
                aria-label="Notifications"
                onClick={handleNotifClick}
                style={{ position: 'relative' }}
              >
                🔔
                {unreadCount > 0 && (
                  <span className="badge" style={{ position: 'absolute', top: -4, right: -4, fontSize: '10px', padding: '2px 5px' }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              {isNotifOpen && (
                <div className="profile-dropdown" style={{ right: 0, left: 'auto', width: '300px', maxHeight: '400px', overflowY: 'auto' }}>
                  <div className="dropdown-header">
                    <strong>Notifications</strong>
                  </div>
                  <hr />
                  {notifications.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center' }} className="muted small">No notifications</div>
                  ) : (
                    notifications.map(n => (
                      <button 
                        key={n.id} 
                        onClick={() => { 
                          setIsNotifOpen(false); 
                          if (n.link) window.location.hash = n.link; 
                        }}
                        style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px', opacity: n.read ? 0.7 : 1 }}
                      >
                        <strong>{n.title}</strong>
                        <span className="muted small" style={{ whiteSpace: 'normal' }}>{n.message}</span>
                        <span className="muted" style={{ fontSize: '10px' }}>{new Date(n.created_at).toLocaleString()}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            
            <div className="profile-menu-wrap">
              <button 
                className="profile-btn" 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-label="User Menu"
              >
                <div className="avatar">
                  {(session?.name || session?.pan || session?.id || "U")[0].toUpperCase()}
                </div>
              </button>
              
              {isDropdownOpen && (
                <div className="profile-dropdown">
                  <div className="dropdown-header">
                    <strong>{session?.name || session?.pan || session?.id}</strong>
                    <span className="muted small">{session?.role}</span>
                  </div>
                  <hr />
                  <button onClick={() => { setIsDropdownOpen(false); window.location.hash = "#/account"; }}>⚙ Account Settings</button>
                  <button onClick={() => { setIsDropdownOpen(false); onLogout(); setTimeout(() => { window.location.hash = "#/"; setTimeout(() => { const el = document.getElementById("portals"); if (el) el.scrollIntoView(); }, 100); }, 0); }}>🔄 Switch Account</button>
                  <hr />
                  <button onClick={() => { setIsDropdownOpen(false); onLogout(); }} className="logout-action">
                    🚪 Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Sidebar Overlay and Content */}
      {isSidebarOpen && (isTaxpayer || isAuditor) && (
        <>
          <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />
          <div className="slide-out-sidebar">
            <div className="sidebar-header">
              <h3>Menu</h3>
              <button className="close-btn" onClick={() => setIsSidebarOpen(false)}>×</button>
            </div>
            <div className="sidebar-nav">
              {isTaxpayer && (
                <>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/taxpayer/auditors"; }}>
                    FIND AN AUDITOR
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/taxpayer/auditor-requests"; }}>
                    MY REQUESTS
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/taxpayer/conversations"; }}>
                    ACTIVE CONVERSATION
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/taxpayer/reconciliation-verification"; }}>
                    RECONCILIATION & VERIFICATION
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/taxpayer/previous-ca-records"; }}>
                    PREVIOUS CA RECORDS
                  </button>
                </>
              )}
              {isAuditor && (
                <>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/auditor/incoming-requests"; }}>
                    INCOMING REQUESTS
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/auditor/chats"; }}>
                    CHATS
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/auditor/closed-requests"; }}>
                    CLOSED REQUESTS
                  </button>
                  <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/auditor"; }}>
                    REPORT HISTORY
                  </button>
                </>
              )}
              <button onClick={() => { setIsSidebarOpen(false); window.location.hash = "#/account"; }}>
                ACCOUNT
              </button>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
