import { useState, useEffect } from "react";
import DashboardHeader from "../components/DashboardHeader";
import { fetchProfile, updateProfile } from "../api/profile";

const DEDUCTOR_OPTIONS = [
  {
    value: "specified_person",
    label: "Yes — Specified Person",
  },
  {
    value: "other_person",
    label: "No — Other Person",
  },
  {
    value: "unknown",
    label: "I don't know",
  },
];

export default function AccountSettings({ session, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [deductorCategory, setDeductorCategory] = useState("unknown");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const data = await fetchProfile();
        if (cancelled) return;
        setProfile(data);
        setDeductorCategory(data.deductorCategory || "unknown");
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Couldn't load your profile.");
        // Fall back to session display fields only — never invent a category.
        if (session) {
          setProfile({
            role: session.role,
            externalId: session.id,
            name: session.name || "",
            email: session.email || "",
            deductorCategory: "unknown",
          });
          setDeductorCategory("unknown");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSave(e) {
    e.preventDefault();
    setSuccess("");
    setError("");
    setSaving(true);

    try {
      const updated = await updateProfile({ deductorCategory });
      setProfile(updated);
      setDeductorCategory(updated.deductorCategory || "unknown");
      setSuccess("Section 194S deductor category saved.");
    } catch (err) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="app app-wide">
        <DashboardHeader session={session} roleLabel="Account Settings" onLogout={onLogout} />
        <main className="app-main">
          <section className="card">
            <p className="muted">Loading account details...</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Account Settings" onLogout={onLogout} />
      <main className="app-main">
        <section className="card" style={{ maxWidth: "600px" }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => window.history.back()}
            style={{ marginBottom: "24px" }}
          >
            ← Back
          </button>

          <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", color: "var(--paper)" }}>
            Account Settings
          </h1>
          <p className="muted" style={{ marginBottom: "24px" }}>
            View and manage your account profile and preferences.
          </p>

          {error && <div className="error" style={{ marginBottom: "16px" }}>{error}</div>}
          {success && (
            <div
              className="success"
              style={{
                marginBottom: "16px",
                color: "var(--green)",
                border: "1px solid var(--green)",
                padding: "12px",
                borderRadius: "6px",
              }}
            >
              {success}
            </div>
          )}

          <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", fontWeight: "600" }}>
              Full Name
              <input
                type="text"
                value={profile?.name || ""}
                readOnly
                style={{
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.2)",
                  color: "white",
                }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", fontWeight: "600" }}>
              Email Address
              <input
                type="email"
                value={profile?.email || ""}
                readOnly
                style={{
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.2)",
                  color: "white",
                }}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "8px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="muted" style={{ fontSize: "12px" }}>Account Role</span>
                <span
                  style={{
                    fontSize: "14px",
                    textTransform: "capitalize",
                    padding: "6px 12px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                    border: "1px solid var(--line)",
                  }}
                >
                  {profile?.role || session?.role}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="muted" style={{ fontSize: "12px" }}>Account ID</span>
                <span
                  style={{
                    fontSize: "14px",
                    padding: "6px 12px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                    border: "1px solid var(--line)",
                    fontFamily: "monospace",
                  }}
                >
                  {profile?.externalId || session?.id}
                </span>
              </div>
            </div>

            <fieldset
              style={{
                margin: "8px 0 0 0",
                padding: "16px",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <legend style={{ fontSize: "14px", fontWeight: "600", padding: "0 6px" }}>
                Section 194S
              </legend>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "600" }}>
                Are you a specified person under Section 194S?
              </p>
              <p className="muted" style={{ margin: 0, fontSize: "12px" }}>
                Choose based on your own declaration. T-REX does not infer this from PAN, KYC, or wallet activity.
              </p>
              {DEDUCTOR_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "14px",
                    fontWeight: "500",
                    cursor: saving ? "default" : "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="deductorCategory"
                    value={option.value}
                    checked={deductorCategory === option.value}
                    disabled={saving}
                    onChange={() => {
                      setSuccess("");
                      setDeductorCategory(option.value);
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <div style={{ marginTop: "8px" }}>
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Saving..." : "Save Section 194S category"}
              </button>
            </div>

            <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid var(--line)" }}>
              <p className="muted" style={{ fontSize: "12px", marginBottom: "16px" }}>
                Name and email are shown from your verified account record. Only your Section 194S
                deductor category can be updated here.
              </p>
              <button type="button" className="secondary-btn" onClick={onLogout}>
                Log out of all devices
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
