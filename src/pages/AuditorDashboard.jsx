import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import {
  casesForAuditor,
  casesUnassigned,
  acceptCase,
  updateCaseStatus,
} from "../data/caseStore";
import DashboardHeader from "../components/DashboardHeader";
import CaseDetail from "../components/CaseDetail";
import PowerBIAnalytics from "../components/PowerBIAnalytics";

const TABS = [
  { key: "all", label: "All" },
  { key: "not-touched", label: "Not touched" },
  { key: "pending", label: "Pending" },
  { key: "high-risk", label: "High risk" },
  { key: "verified", label: "Verified" },
  { key: "flagged", label: "Flagged" },
];

const STATUS_LABEL = {
  pending: "pending review",
  "high-risk": "flagged as high risk",
  verified: "verified",
  flagged: "flagged for follow-up",
};

export default function AuditorDashboard({ session, onLogout }) {
  const [auditorRequests, setAuditorRequests] = useState([]);
  const [requestError, setRequestError] = useState("");

  const [cases, setCases] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [acceptingId, setAcceptingId] = useState(null);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    loadAuditorRequests();
  }, []);

  async function loadAuditorRequests() {
    try {
      const data = await apiFetch("/auditor-requests/incoming");
      setAuditorRequests(data);
    } catch (err) {
      setRequestError(err.message);
    }
  }

  // Accept / reject taxpayer request
  async function handleRequestAction(requestId, action) {
    try {
      setRequestError("");

      const result = await apiFetch(
        `/auditor-requests/${requestId}/${action}`,
        {
          method: "PATCH",
        }
      );

      const updated = await apiFetch("/auditor-requests/incoming");
      setAuditorRequests(updated);

      // If accepted, open the newly-created private conversation.
      if (action === "accept" && result.conversationId) {
        window.location.hash =
          `#/auditor/conversations/${result.conversationId}`;
      }
    } catch (err) {
      setRequestError(err.message);
    }
  }

  const filtered =
    tab === "all"
      ? cases
      : tab === "not-touched"
      ? cases.filter((c) => !c.reviewedAt)
      : cases.filter((c) => c.status === tab);

  const selected = cases.find((c) => c.id === selectedId) || null;

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      const [assigned, unassigned] = await Promise.all([
        casesForAuditor(),
        casesUnassigned(),
      ]);

      setCases(assigned);
      setRequests(unassigned);
    } catch (e) {
      setError(e.message || "Couldn't load cases.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptRequest(id) {
    setAcceptingId(id);
    setRequestError("");

    try {
      await acceptCase(id);
      await refresh();

      setActionMessage(
        "New client accepted — it's now in your Not touched queue."
      );
    } catch (e) {
      setRequestError(
        e.message || "Couldn't accept this client — try again."
      );
    } finally {
      setAcceptingId(null);
    }
  }

  function handleDeclineRequest(id) {
    setRequests((list) => list.filter((c) => c.id !== id));
  }

  async function handleApprove(note) {
    if (!selected) return;

    await updateCaseStatus(selected.id, "verified", note);

    setActionMessage(
      `${selected.taxpayerName}'s case has been marked as verified.`
    );

    refresh();
  }

  async function handleFlag(note) {
    if (!selected) return;

    await updateCaseStatus(selected.id, "flagged", note);

    setActionMessage(
      `${selected.taxpayerName}'s case has been marked as flagged.`
    );

    refresh();
  }

  function handleStatusPillClick(e, c) {
    e.stopPropagation();

    window.alert(
      `${c.taxpayerName}'s case is ${
        STATUS_LABEL[c.status] || c.status
      }.`
    );
  }

  const counts = {
    all: cases.length,
    "not-touched": cases.filter((c) => !c.reviewedAt).length,
    pending: cases.filter((c) => c.status === "pending").length,
    "high-risk": cases.filter((c) => c.status === "high-risk").length,
    verified: cases.filter((c) => c.status === "verified").length,
    flagged: cases.filter((c) => c.status === "flagged").length,
  };

  return (
    <div className="app app-wide">
      <DashboardHeader
        session={session}
        roleLabel="Auditor dashboard"
        onLogout={onLogout}
      />

      <main className="app-main">
        {!selected ? (
          <>
            {/* TAXPAYER -> AUDITOR REQUESTS */}
            <section className="card auditor-request-section">
              <div className="auditor-request-header">
                <div>
                  <span className="section-kicker">
                    AUDITOR WORKFLOW
                  </span>

                  <h1>Incoming Requests</h1>

                  <p className="muted">
                    Taxpayers who have requested your assistance.
                  </p>
                </div>

                <span className="request-count">
                  {auditorRequests.length}
                </span>
              </div>

              {requestError && (
                <div className="error">
                  {requestError}
                </div>
              )}

              {auditorRequests.length === 0 ? (
                <div className="auditor-empty-state">
                  No incoming auditor requests.
                </div>
              ) : (
                <div className="auditor-request-list">
                  {auditorRequests.map((request) => (
                    <article
                      key={request.id}
                      className="auditor-request-card"
                    >
                      <div>
                        <h3>{request.taxpayer_name}</h3>

                        <p>
                          <strong>Request:</strong>{" "}
                          {request.reason}
                        </p>

                        <small className="muted">
                          {new Date(
                            request.created_at
                          ).toLocaleString()}
                        </small>
                      </div>

                      <div className="auditor-request-actions">
                        {request.status === "Pending" ? (
                          <>
                            <button
                              type="button"
                              className="primary-btn"
                              onClick={() =>
                                handleRequestAction(
                                  request.id,
                                  "accept"
                                )
                              }
                            >
                              Accept
                            </button>

                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() =>
                                handleRequestAction(
                                  request.id,
                                  "reject"
                                )
                              }
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <div className="auditor-request-actions">
                            <span
                              className={`request-status ${request.status.toLowerCase()}`}
                            >
                              {request.status}
                            </span>

                            {request.status === "Accepted" &&
                              request.conversation_id && (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  onClick={() => {
                                    window.location.hash =
                                      `#/auditor/conversations/${request.conversation_id}`;
                                  }}
                                >
                                  Open Conversation
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* EXISTING UNASSIGNED CASE REQUESTS */}
            {requests.length > 0 && (
              <section className="card">
                <h1>New client requests</h1>

                <p className="muted">
                  These taxpayers haven't been assigned an auditor yet.
                  Accept one to add it to your queue, or decline to leave
                  it for another auditor.
                </p>

                {requestError && (
                  <div className="error">
                    {requestError}
                  </div>
                )}

                <div className="case-list">
                  {requests.map((c) => (
                    <div
                      className="case-row case-row-request"
                      key={c.id}
                    >
                      <div>
                        <strong>{c.taxpayerName}</strong>

                        <span className="muted small">
                          {" "}
                          · PAN {c.panMasked}
                        </span>

                        <div className="muted small">
                          {c.exchanges.join(", ")}
                        </div>
                      </div>

                      <div className="case-row-right">
                        <button
                          className="secondary-btn"
                          onClick={() =>
                            handleDeclineRequest(c.id)
                          }
                          disabled={acceptingId === c.id}
                        >
                          Decline
                        </button>

                        <button
                          className="primary-btn"
                          onClick={() =>
                            handleAcceptRequest(c.id)
                          }
                          disabled={acceptingId === c.id}
                        >
                          {acceptingId === c.id
                            ? "Accepting..."
                            : "Accept"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ASSIGNED CASES */}
            <section className="card">
              <h1>Assigned taxpayer cases</h1>

              <p className="muted">
                Cases reconciled and submitted by taxpayers, assigned to
                you for review.
              </p>

              {error && (
                <div className="error">
                  {error}
                </div>
              )}

              {loading && (
                <p className="muted">
                  Loading cases...
                </p>
              )}

              {actionMessage && (
                <div className="action-banner">
                  {actionMessage}

                  <button
                    className="link-btn"
                    onClick={() =>
                      setActionMessage("")
                    }
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <PowerBIAnalytics
                cases={cases}
                discrepancies={cases.flatMap(
                  (c) => c.discrepancies || []
                )}
                role="auditor"
              />

              <div className="tab-row">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    className={`tab-btn ${
                      tab === t.key ? "active" : ""
                    }`}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label}{" "}
                    <span className="tab-count">
                      {counts[t.key]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="case-list">
                {filtered.length === 0 && (
                  <p className="muted">
                    No cases in this category yet.
                  </p>
                )}

                {filtered.map((c) => (
                  <button
                    key={c.id}
                    className="case-row"
                    onClick={() =>
                      setSelectedId(c.id)
                    }
                  >
                    <div>
                      <strong>
                        {c.taxpayerName}
                      </strong>

                      <span className="muted small">
                        {" "}
                        · PAN {c.panMasked}
                      </span>

                      <div className="muted small">
                        {c.exchanges.join(", ")}
                      </div>
                    </div>

                    <div className="case-row-right">
                      {c.discrepancies.length > 0 && (
                        <span className="muted small">
                          {c.discrepancies.length}{" "}
                          discrepancy(ies)
                        </span>
                      )}

                      <span
                        className={`case-status-pill case-status-${c.status}`}
                        onClick={(e) =>
                          handleStatusPillClick(e, c)
                        }
                        title="Click for what this status means"
                      >
                        {c.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          /* CASE DETAIL */
          <section className="card">
            <button
              className="link-btn"
              onClick={() => {
                setSelectedId(null);
                setActionMessage("");
              }}
            >
              ← Back to case list
            </button>

            {actionMessage && (
              <div className="action-banner">
                {actionMessage}

                <button
                  className="link-btn"
                  onClick={() =>
                    setActionMessage("")
                  }
                >
                  Dismiss
                </button>
              </div>
            )}

            <CaseDetail
              case_={selected}
              onApprove={handleApprove}
              onFlag={handleFlag}
            />
          </section>
        )}
      </main>
    </div>
  );
}