import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { CatalogNode } from "./api";
import { errText } from "./format";

/** The gears catalog: our crates published to crates.io (keyword
 *  `constructorfabric`), pulled by the studio-gears-catalog gear and read back
 *  from the graph. Each gear expands to its published version history. A Sync
 *  button re-pulls from crates.io in the background. */
export function GearsCatalog({ token }: { token: string }) {
  const [gears, setGears] = useState<CatalogNode[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Record<string, unknown>>>({});
  const [versions, setVersions] = useState<Record<string, CatalogNode[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<string>("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [{ nodes }, profileResponse] = await Promise.all([
        api.listGears(token),
        // During a rolling release frontend can arrive before the backend that
        // owns profiles. A missing optional endpoint must not hide the whole
        // pre-existing catalog.
        api.listGearProfiles(token).catch((error): { nodes: CatalogNode[] } => {
          if (error instanceof ApiError && error.status === 404) return { nodes: [] };
          throw error;
        }),
      ]);
      setGears(nodes ?? []);
      const next: Record<string, Record<string, unknown>> = {};
      for (const node of profileResponse.nodes ?? []) {
        const name = typeof node.value.gear_name === "string" ? node.value.gear_name : "";
        if (name) next[name] = node.value as Record<string, unknown>;
      }
      setProfiles(next);
    } catch (e) {
      setErr(errText(e));
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runSync = async () => {
    setBusy(true);
    setSync("queued…");
    try {
      const { task_id } = await api.syncGears(token);
      const deadline = Date.now() + 10 * 60 * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const t = await api.gearsCatalogTask(token, task_id);
        if (t.status === "succeeded") {
          setSync(`${t.gears} gears · ${t.versions} versions`);
          await reload();
          break;
        }
        if (t.status === "failed") {
          setSync(t.message || "sync failed");
          break;
        }
        const phase = (t.message || t.status).replace(/…$/, "");
        setSync(`${phase} — ${t.gears} gears · ${t.versions} versions · ${t.stored} in graph…`);
        if (Date.now() > deadline) {
          setSync("timed out — still running server-side");
          break;
        }
      }
    } catch (e) {
      setSync(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (!versions[name]) {
      try {
        const { nodes } = await api.listGearVersions(token, name);
        setVersions((v) => ({ ...v, [name]: sortVersions(nodes ?? []) }));
      } catch (e) {
        setErr(errText(e));
      }
    }
  };

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const g of gears ?? []) set.add(String(g.value.kind ?? "gear"));
    return ["all", ...Array.from(set).sort()];
  }, [gears]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (gears ?? [])
      .filter((g) => kind === "all" || String(g.value.kind ?? "gear") === kind)
      .filter((g) => {
        if (!needle) return true;
        const name = String(g.value.name ?? "");
        const desc = String(g.value.description ?? "");
        return name.toLowerCase().includes(needle) || desc.toLowerCase().includes(needle);
      })
      .sort((a, b) => String(a.value.name ?? "").localeCompare(String(b.value.name ?? "")));
  }, [gears, q, kind]);

  const count = gears?.length ?? 0;
  const syncing = sync.endsWith("…");

  return (
    <>
      <h1>Gears</h1>
      <p className="subtitle">
        Our crates published to crates.io (keyword <code>constructorfabric</code>), stored in the
        graph with their full version history. {count > 0 ? `${count} gears.` : ""}
      </p>

      <div className="card">
        <div className="card-head">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Search gears…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k === "all" ? "All kinds" : k}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 2 }} aria-label="Gears view">
              <button
                className={viewMode === "cards" ? "primary" : ""}
                onClick={() => setViewMode("cards")}
                aria-pressed={viewMode === "cards"}
              >
                Cards
              </button>
              <button
                className={viewMode === "table" ? "primary" : ""}
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
              >
                Table
              </button>
            </div>
          </div>
          <button className="primary" disabled={busy} onClick={() => void runSync()}>
            {syncing ? "Syncing…" : "Sync from crates.io"}
          </button>
        </div>
        {sync && <p className="hint">Sync: {sync}</p>}
        {err && <p className="error">{err}</p>}

        {gears === null ? (
          <p className="empty">Loading gears…</p>
        ) : visible.length === 0 ? (
          <p className="empty">
            {count === 0
              ? "No gears yet — hit “Sync from crates.io” to pull the catalogue."
              : "No gears match the current filter."}
          </p>
        ) : (
          viewMode === "cards" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 12 }}>
            {visible.map((gear) => {
              const name = String(gear.value.name ?? gear.instance_id);
              return (
                <GearCard
                  key={gear.instance_id}
                  token={token}
                  gear={gear}
                  profile={profiles[name]}
                  open={expanded === name}
                  versions={versions[name]}
                  onToggle={() => void toggle(name)}
                  onSaved={(profile) => setProfiles((current) => ({ ...current, [name]: profile }))}
                />
              );
            })}
          </div> : <GearTable gears={visible} profiles={profiles} expanded={expanded} versions={versions} onToggle={toggle} />
        )}
      </div>
    </>
  );
}

function GearTable({
  gears,
  profiles,
  expanded,
  versions,
  onToggle,
}: {
  gears: CatalogNode[];
  profiles: Record<string, Record<string, unknown>>;
  expanded: string | null;
  versions: Record<string, CatalogNode[] | undefined>;
  onToggle: (name: string) => Promise<void>;
}) {
  return <table className="ptable">
    <thead><tr><th>Gear</th><th>Category</th><th>Lifecycle</th><th>Latest</th><th>Versions</th><th>Downloads</th><th>Coverage</th><th>Updated</th></tr></thead>
    <tbody>{gears.map((gear) => {
      const name = String(gear.value.name ?? gear.instance_id);
      const profile = profiles[name];
      const open = expanded === name;
      return <Fragment key={gear.instance_id}>
        <tr onClick={() => void onToggle(name)} style={{ cursor: "pointer" }} title="Show published versions">
          <td><div className="name">{open ? "▾" : "▸"} {name}</div>{gear.value.description && <div className="sub">{String(gear.value.description)}</div>}</td>
          <td>{displayValue(profile?.category ?? profile?.domain ?? gear.value.kind ?? "—")}</td>
          <td>{displayValue(profile?.lifecycle_status ?? "—")}</td>
          <td><code>{String(gear.value.max_stable_version ?? gear.value.newest_version ?? "—")}</code></td>
          <td>{numText(gear.value.num_versions)}</td>
          <td>{numText(gear.value.downloads)}</td>
          <td>{displayValue(profile?.code_coverage ?? "—")}</td>
          <td>{dateText(gear.value.updated_at)}</td>
        </tr>
        {open && <tr><td colSpan={8} style={{ padding: 0 }}><GearVersions name={name} rows={versions[name]} gear={gear} /></td></tr>}
      </Fragment>;
    })}</tbody>
  </table>;
}

function GearCard({
  token,
  gear,
  profile,
  open,
  versions,
  onToggle,
  onSaved,
}: {
  token: string;
  gear: CatalogNode;
  profile: Record<string, unknown> | undefined;
  open: boolean;
  versions: CatalogNode[] | undefined;
  onToggle: () => void;
  onSaved: (profile: Record<string, unknown>) => void;
}) {
  const name = String(gear.value.name ?? gear.instance_id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = String(gear.value.max_stable_version ?? gear.value.newest_version ?? "—");
  const fields: Array<[string, unknown]> = [
    ["Category / domain", profile?.category ?? profile?.domain ?? gear.value.kind],
    ["Lifecycle", profile?.lifecycle_status],
    ["Maintainers", profile?.maintainers],
    ["Repository", profile?.repository ?? gear.value.repository],
    ["PRD / DESIGN / ADR", profile?.architecture_links ?? profile?.prd_links],
    ["API specification", profile?.api_spec_link],
    ["Configuration", profile?.config_file ?? profile?.configuration_guideline_link],
    ["Dependencies", profile?.dependencies],
    ["Supported DBs", profile?.supported_databases],
    ["Plugins", profile?.plugins],
    ["Feature flags", profile?.feature_flags],
    ["Events published", profile?.events_published],
    ["Observability", profile?.observability_metrics],
    ["Security advisories", profile?.security_advisories],
    ["Delivery health", profile?.delivery_health],
    ["Spec LOC", profile?.spec_loc],
    ["Code LOC", profile?.code_loc],
    ["Unit / E2E test LOC", profile?.unit_test_loc ?? profile?.e2e_test_loc],
    ["Coverage", profile?.code_coverage],
  ];
  const startEditing = () => {
    setError(null);
    setDraft(JSON.stringify(profile ?? defaultGearProfile(), null, 2));
    setEditing(true);
  };
  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      const parsed: unknown = JSON.parse(draft);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Profile must be a JSON object");
      }
      const saved = await api.saveGearProfile(token, name, parsed as Record<string, unknown>);
      onSaved(saved.value as Record<string, unknown>);
      setEditing(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="card" style={{ margin: 0 }}>
      <div className="card-head">
        <div>
          <div className="name">{name}</div>
          <div className="sub">{String(profile?.category ?? profile?.domain ?? gear.value.kind ?? "gear")} · {latest}</div>
        </div>
        <button onClick={onToggle}>{open ? "Hide details" : "Details"}</button>
      </div>
      {gear.value.description && <p className="sub">{String(gear.value.description)}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
        <Metric label="Downloads" value={numText(gear.value.downloads)} />
        <Metric label="Versions" value={numText(gear.value.num_versions)} />
        <Metric label="Updated" value={dateText(gear.value.updated_at)} />
      </div>
      {open && <>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px 16px" }}>
          {fields.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => (
            <div key={label}><div className="sub">{label}</div><div>{displayValue(value)}</div></div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={startEditing}>Edit profile</button>
          {gear.value.repository && <a href={String(gear.value.repository)} target="_blank" rel="noreferrer">Repository</a>}
          {gear.value.documentation && <a href={String(gear.value.documentation)} target="_blank" rel="noreferrer">Docs</a>}
        </div>
        {editing && <div style={{ marginTop: 12 }}>
          <p className="hint">Profile is stored separately from crates.io data and survives catalogue sync.</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: "100%", minHeight: 220, fontFamily: "monospace" }} />
          {error && <p className="error">{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save profile"}</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>}
        <GearVersions name={name} rows={versions} gear={gear} />
      </>}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="sub">{label}</div><strong>{value}</strong></div>;
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function defaultGearProfile(): Record<string, unknown> {
  return {
    category: "",
    maintainers: [],
    lifecycle_status: "in development",
    repository: "",
    prd_links: [],
    architecture_links: [],
    api_spec_link: "",
    config_file: "",
    configuration_guideline_link: "",
    uml_diagrams: [],
    spec_loc: null,
    code_loc: null,
    unit_test_loc: null,
    e2e_test_loc: null,
    changelog_link: "",
    events_published: [],
    feature_flags: [],
    observability_metrics: [],
    security_advisories: [],
    github_issues_link: "",
    extension_points: [],
    base_data_types: [],
    delivery_health: {},
    security_compliance_metrics: {},
    unit_test_count: null,
    code_coverage: null,
    dependencies: [],
    supported_databases: [],
    plugins: [],
  };
}

/** The expanded version history for one gear. */
function GearVersions({
  name,
  rows,
  gear,
}: {
  name: string;
  rows: CatalogNode[] | undefined;
  gear: CatalogNode;
}) {
  return (
    <div style={{ padding: "8px 12px", background: "var(--panel, rgba(127,127,127,0.06))" }}>
      <div className="sub" style={{ marginBottom: 6 }}>
        {gear.value.repository && (
          <a href={String(gear.value.repository)} target="_blank" rel="noreferrer">
            repository
          </a>
        )}
        {gear.value.documentation && (
          <>
            {" · "}
            <a href={String(gear.value.documentation)} target="_blank" rel="noreferrer">
              docs
            </a>
          </>
        )}
        {" · "}
        <a
          href={`https://crates.io/crates/${encodeURIComponent(name)}`}
          target="_blank"
          rel="noreferrer"
        >
          crates.io
        </a>
      </div>
      {rows === undefined ? (
        <p className="empty">Loading versions…</p>
      ) : rows.length === 0 ? (
        <p className="empty">No versions.</p>
      ) : (
        <table className="ptable">
          <thead>
            <tr>
              <th>Version</th>
              <th>Published</th>
              <th>License</th>
              <th>Rust</th>
              <th>Size</th>
              <th>Downloads</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.instance_id}>
                <td>
                  <code>{String(v.value.num ?? "—")}</code>
                  {v.value.yanked ? <span className="sub"> · yanked</span> : ""}
                </td>
                <td>{dateText(v.value.created_at)}</td>
                <td>{String(v.value.license ?? "—")}</td>
                <td>{String(v.value.rust_version ?? "—")}</td>
                <td>{sizeText(v.value.crate_size)}</td>
                <td>{numText(v.value.downloads)}</td>
                <td>{String(v.value.published_by ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Newest first: crates.io returns them that way, but be defensive and sort by
 *  semver-ish descending on the numeric parts. */
function sortVersions(rows: CatalogNode[]): CatalogNode[] {
  const parts = (s: string) => s.split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
  return [...rows].sort((a, b) => {
    const pa = parts(String(a.value.num ?? ""));
    const pb = parts(String(b.value.num ?? ""));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

function numText(n: unknown): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

function sizeText(n: unknown): string {
  if (typeof n !== "number") return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function dateText(s: unknown): string {
  if (typeof s !== "string" || !s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}
