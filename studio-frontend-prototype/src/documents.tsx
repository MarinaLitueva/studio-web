// Documents tab (prototype). Two modes:
//  • Documents — a project's effective documents (own + inherited from the
//    workspace); create from a type template (at project or workspace level),
//    edit markdown, and see the live section checklist + conformance.
//  • Types — the workspace's effective document types (built-in ∪
//    workspace-defined); define or override a type (template, sections, rules).
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, Doc, DocRules, DocSection, DocType, DocValidation } from "./api";

/** Human-readable message from an ApiError (title/detail) or any Error. */
function errText(e: unknown): string {
  const x = e as { detail?: string; title?: string; message?: string } | null;
  return x?.detail || x?.title || x?.message || String(e);
}

const STATUSES: Doc["status"][] = ["draft", "review", "approved"];
const card = { border: "1px solid var(--border,#e2e4e9)", borderRadius: 10, padding: 12 } as const;
const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "section";

export function DocumentsTab({
  token,
  workspaceId,
  projectTenantId,
}: {
  token: string;
  /** The parent workspace tenant — the storage scope for documents and types. */
  workspaceId: string;
  /** The open project tenant. */
  projectTenantId: string;
}) {
  const [mode, setMode] = useState<"docs" | "types">("docs");
  const [types, setTypes] = useState<DocType[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadTypes = useCallback(async () => {
    try {
      setTypes((await api.docTypes(token, workspaceId)).items);
    } catch (e) {
      setErr(errText(e));
    }
  }, [token, workspaceId]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  return (
    <div className="documents">
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["docs", "types"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={mode === m ? "active" : ""}
            style={{
              padding: "4px 12px",
              borderRadius: 8,
              border: "1px solid var(--border,#e2e4e9)",
              background: mode === m ? "var(--accent-soft,#eef2ff)" : "transparent",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {m === "docs" ? "Documents" : "Types"}
          </button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      {mode === "docs" ? (
        <DocumentsView
          token={token}
          workspaceId={workspaceId}
          projectTenantId={projectTenantId}
          types={types}
        />
      ) : (
        <TypesView token={token} workspaceId={workspaceId} types={types} onSaved={loadTypes} />
      )}
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

function DocumentsView({
  token,
  workspaceId,
  projectTenantId,
  types,
}: {
  token: string;
  workspaceId: string;
  projectTenantId: string;
  types: DocType[];
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [report, setReport] = useState<DocValidation | null>(null);
  const [newType, setNewType] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [wsLevel, setWsLevel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(() => docs.find((d) => d.id === selectedId) ?? null, [docs, selectedId]);
  const editable = !!selected && !selected.inherited;

  const reload = useCallback(async () => {
    setErr(null);
    try {
      setDocs((await api.projectDocuments(token, workspaceId, projectTenantId)).items);
    } catch (e) {
      setErr(errText(e));
    }
  }, [token, workspaceId, projectTenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (types.length > 0 && !newType) setNewType(types[0].key);
  }, [types, newType]);

  useEffect(() => {
    if (!selected) {
      setDraftTitle("");
      setDraftBody("");
      setReport(null);
      return;
    }
    setDraftTitle(selected.title);
    setDraftBody(selected.content);
    setReport(null);
    api.validateDocument(token, workspaceId, selected.id).then(setReport).catch(() => setReport(null));
  }, [selectedId, selected, token, workspaceId]);

  const create = async () => {
    if (!newType || !newTitle.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { type_key: newType, title: newTitle.trim() };
      const doc = wsLevel
        ? await api.createWorkspaceDocument(token, workspaceId, body)
        : await api.createProjectDocument(token, workspaceId, projectTenantId, body);
      setNewTitle("");
      await reload();
      setSelectedId(doc.id);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || !editable) return;
    setBusy(true);
    setErr(null);
    try {
      await api.updateDocument(token, workspaceId, selected.id, { title: draftTitle, content: draftBody });
      setReport(await api.validateDocument(token, workspaceId, selected.id));
      await reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: Doc["status"]) => {
    if (!selected || !editable) return;
    setBusy(true);
    try {
      await api.updateDocument(token, workspaceId, selected.id, { status });
      await reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !editable) return;
    setBusy(true);
    try {
      await api.deleteDocument(token, workspaceId, selected.id);
      setSelectedId(null);
      await reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const typeName = (key: string) => types.find((t) => t.key === key)?.name ?? key;

  return (
    <>
      {err && <div className="error">{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>New document</div>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ width: "100%", marginBottom: 6 }}>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                  {t.owner === "workspace" ? " · workspace" : ""}
                </option>
              ))}
            </select>
            <input
              placeholder="Title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ width: "100%", marginBottom: 6 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
              <input type="checkbox" checked={wsLevel} onChange={(e) => setWsLevel(e.target.checked)} />
              Workspace level (inherited by all projects)
            </label>
            <button className="primary" onClick={create} disabled={busy || !newTitle.trim()} style={{ width: "100%" }}>
              Create from template
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {docs.length === 0 && <p className="empty">No documents yet — create one from a type.</p>}
            {docs.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border,#e2e4e9)",
                  background: d.id === selectedId ? "var(--accent-soft,#eef2ff)" : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.title || "(untitled)"}
                  </span>
                  <span title={d.conforms ? "conforms" : "incomplete"} style={{ marginLeft: "auto", fontSize: 11 }}>
                    {d.conforms ? "✓" : "•"}
                  </span>
                </span>
                <span style={{ fontSize: 11, opacity: 0.7, display: "flex", gap: 6 }}>
                  <code>{typeName(d.type_key)}</code>
                  <span>· {d.status}</span>
                  {d.inherited && <span style={{ color: "var(--muted,#6b7280)" }}>· inherited</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected ? (
            <p className="empty">Select a document, or create one.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} disabled={!editable} style={{ flex: 1, fontWeight: 600 }} />
                  <select value={selected.status} onChange={(e) => setStatus(e.target.value as Doc["status"])} disabled={!editable || busy}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  disabled={!editable}
                  spellCheck={false}
                  style={{ width: "100%", minHeight: 420, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.5, padding: 10, borderRadius: 8, border: "1px solid var(--border,#e2e4e9)", resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="primary" onClick={save} disabled={!editable || busy}>
                    Save &amp; validate
                  </button>
                  <button onClick={remove} disabled={!editable || busy}>
                    Delete
                  </button>
                  {selected.inherited && (
                    <span className="subtitle" style={{ margin: 0 }}>
                      Inherited from the workspace — read-only here.
                    </span>
                  )}
                </div>
              </div>
              <Checklist report={report} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Checklist({ report }: { report: DocValidation | null }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Checklist</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 20,
            background: report?.conforms ? "#dcfce7" : "#fef3c7",
            color: report?.conforms ? "#166534" : "#92400e",
          }}
        >
          {report ? (report.conforms ? "conforms" : "incomplete") : "—"}
        </span>
      </div>
      {!report ? (
        <p className="empty" style={{ fontSize: 12 }}>
          Save to validate.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {report.sections.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{ width: 14, color: s.ok ? "#16a34a" : s.required ? "#dc2626" : "#9ca3af" }}>
                  {s.ok ? "✓" : s.required ? "✕" : "○"}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                <span style={{ marginLeft: "auto", opacity: 0.6 }}>{s.word_count}w</span>
              </div>
            ))}
          </div>
          {report.issues.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#92400e" }}>Issues</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--muted,#6b7280)" }}>
                {report.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

type SectionRow = { title: string; required: boolean; minWords: number };

function TypesView({
  token,
  workspaceId,
  types,
  onSaved,
}: {
  token: string;
  workspaceId: string;
  types: DocType[];
  onSaved: () => Promise<void> | void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [frontMatter, setFrontMatter] = useState("");
  const [minTitle, setMinTitle] = useState(1);
  const [forbid, setForbid] = useState(true);
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirtyKey, setDirtyKey] = useState<string | null>(null);

  const load = (t: DocType) => {
    setDirtyKey(t.key);
    setKey(t.key);
    setName(t.name);
    setDesc(t.description);
    setBody(t.body);
    setSections(
      t.sections.map((s) => ({ title: s.title, required: s.required, minWords: s.min_words ?? 0 })),
    );
    setFrontMatter(t.rules.front_matter.join(", "));
    setMinTitle(t.rules.min_title_words);
    setForbid(t.rules.forbid_placeholders);
    setWarn(t.rules.warn_unknown_sections);
    setErr(null);
  };

  const blank = () => {
    setDirtyKey(null);
    setKey("");
    setName("");
    setDesc("");
    setBody("# <title>\n\n## Section\n");
    setSections([{ title: "Section", required: true, minWords: 0 }]);
    setFrontMatter("status");
    setMinTitle(1);
    setForbid(true);
    setWarn(false);
    setErr(null);
  };

  const setRow = (i: number, patch: Partial<SectionRow>) =>
    setSections((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!key.trim() || !name.trim()) {
      setErr("Key and name are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const secs: DocSection[] = sections
        .filter((s) => s.title.trim())
        .map((s) => ({
          key: slug(s.title),
          title: s.title.trim(),
          required: s.required,
          min_words: s.minWords > 0 ? s.minWords : null,
        }));
      const rules: DocRules = {
        warn_unknown_sections: warn,
        front_matter: frontMatter.split(",").map((x) => x.trim()).filter(Boolean),
        forbid_placeholders: forbid,
        min_title_words: minTitle,
      };
      await api.upsertDocType(token, workspaceId, { key: key.trim(), name: name.trim(), description: desc, body, sections: secs, rules });
      await onSaved();
      setDirtyKey(key.trim());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="primary" onClick={blank} style={{ marginBottom: 4 }}>
          + New type
        </button>
        {types.map((t) => (
          <button
            key={t.key}
            onClick={() => load(t)}
            style={{
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border,#e2e4e9)",
              background: dirtyKey === t.key ? "var(--accent-soft,#eef2ff)" : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
            <div style={{ fontSize: 11, opacity: 0.7, display: "flex", gap: 6 }}>
              <code>{t.key}</code>
              <span style={{ color: t.owner === "workspace" ? "#2563eb" : "var(--muted,#6b7280)" }}>· {t.owner}</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {err && <div className="error">{err}</div>}
        {!dirtyKey && sections.length === 0 ? (
          <p className="empty">Pick a type to view or override, or create a new one. Saving always writes a workspace-owned type (overriding a built-in of the same key).</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8 }}>
              <input placeholder="key (slug)" value={key} onChange={(e) => setKey(e.target.value)} />
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />

            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Sections (checklist)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sections.map((s, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 28px", gap: 6, alignItems: "center" }}>
                    <input placeholder="Section title" value={s.title} onChange={(e) => setRow(i, { title: e.target.value })} />
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" checked={s.required} onChange={(e) => setRow(i, { required: e.target.checked })} /> req
                    </label>
                    <input
                      type="number"
                      min={0}
                      title="min words (0 = none)"
                      value={s.minWords}
                      onChange={(e) => setRow(i, { minWords: Number(e.target.value) || 0 })}
                    />
                    <button onClick={() => setSections((r) => r.filter((_, k) => k !== i))} title="remove">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button style={{ marginTop: 8 }} onClick={() => setSections((r) => [...r, { title: "", required: false, minWords: 0 }])}>
                + Add section
              </button>
            </div>

            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Rules</div>
              <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                Required front-matter keys (comma-separated)
                <input value={frontMatter} onChange={(e) => setFrontMatter(e.target.value)} style={{ width: "100%" }} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginRight: 16 }}>
                Min title words
                <input type="number" min={0} value={minTitle} onChange={(e) => setMinTitle(Number(e.target.value) || 0)} style={{ width: 60 }} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginRight: 16 }}>
                <input type="checkbox" checked={forbid} onChange={(e) => setForbid(e.target.checked)} /> forbid placeholders
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> warn unknown sections
              </label>
            </div>

            <label style={{ fontSize: 12, fontWeight: 600 }}>Template body (markdown)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              style={{ width: "100%", minHeight: 220, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, lineHeight: 1.5, padding: 10, borderRadius: 8, border: "1px solid var(--border,#e2e4e9)", resize: "vertical" }}
            />

            <div>
              <button className="primary" onClick={save} disabled={busy}>
                Save workspace type
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
