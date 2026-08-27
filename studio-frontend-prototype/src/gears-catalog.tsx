import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { CatalogNode } from "./api";
import { errText } from "./format";

/** The gears catalog: our crates published to crates.io (keyword
 *  `constructorfabric`), pulled by the studio-gears-catalog gear and read back
 *  from the graph. Each gear expands to its published version history. A Sync
 *  button re-pulls from crates.io in the background. */
export function GearsCatalog({ token }: { token: string }) {
  const [gears, setGears] = useState<CatalogNode[] | null>(null);
  const [versions, setVersions] = useState<Record<string, CatalogNode[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<string>("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const { nodes } = await api.listGears(token);
      setGears(nodes ?? []);
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
          <table className="ptable">
            <thead>
              <tr>
                <th>Gear</th>
                <th>Kind</th>
                <th>Latest</th>
                <th>Versions</th>
                <th>Downloads</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((g) => {
                const name = String(g.value.name ?? g.instance_id);
                const open = expanded === name;
                return (
                  <Fragment key={g.instance_id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => void toggle(name)}
                      title="Show published versions"
                    >
                      <td>
                        <div className="name">
                          <span style={{ display: "inline-block", width: 14 }}>
                            {open ? "▾" : "▸"}
                          </span>{" "}
                          {name}
                        </div>
                        {g.value.description && <div className="sub">{String(g.value.description)}</div>}
                      </td>
                      <td>{String(g.value.kind ?? "gear")}</td>
                      <td>
                        <code>{String(g.value.max_stable_version ?? g.value.newest_version ?? "—")}</code>
                      </td>
                      <td>{numText(g.value.num_versions)}</td>
                      <td>{numText(g.value.downloads)}</td>
                      <td>{dateText(g.value.updated_at)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <GearVersions name={name} rows={versions[name]} gear={g} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
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
