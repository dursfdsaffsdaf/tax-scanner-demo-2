import { useState, useEffect, useCallback, useRef } from "react";

const API_URL    = "http://localhost:3001";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

const JURIDS = [
  { code:"AU", name:"Australia", auth:"ATO",  bg:"#E6F1FB", bd:"#B5D4F4", tx:"#0C447C" },
  { code:"IN", name:"India",     auth:"CBIC", bg:"#FAEEDA", bd:"#FAC775", tx:"#633806" },
  { code:"ID", name:"Indonesia", auth:"DGT",  bg:"#EAF3DE", bd:"#C0DD97", tx:"#27500A" },
  { code:"VN", name:"Vietnam",   auth:"GDT",  bg:"#FBEAF0", bd:"#F4C0D1", tx:"#72243E" },
  { code:"JP", name:"Japan",     auth:"NTA",  bg:"#EEEDFE", bd:"#CECBF6", tx:"#3C3489" },
  { code:"SG", name:"Singapore", auth:"IRAS", bg:"#E1F5EE", bd:"#9FE1CB", tx:"#085041" },
  { code:"MY", name:"Malaysia",  auth:"LHDN", bg:"#FAECE7", bd:"#F5C4B3", tx:"#712B13" },
];
const JM   = Object.fromEntries(JURIDS.map(j => [j.code, j]));
const PACC = { HIGH:"#E24B4A", MEDIUM:"#BA7517", LOW:"#639922" };
const PORD = { HIGH:0, MEDIUM:1, LOW:2 };

async function fetchIntel() {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API_URL}/api/tax-intel`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

function daysFrom(ds) {
  if (!ds) return 999;
  const d = new Date(ds);
  return isNaN(d) ? 999 : Math.ceil((d - new Date()) / 86_400_000);
}

function JBadge({ code }) {
  const j = JM[code];
  if (!j) return null;
  return (
    <span style={{ fontSize:11, fontFamily:"var(--font-mono)", fontWeight:500,
      padding:"2px 7px", borderRadius:4, background:j.bg, color:j.tx,
      border:`0.5px solid ${j.bd}`, flexShrink:0 }}>
      {code}
    </span>
  );
}

function PBadge({ p }) {
  const MAP = {
    HIGH:   { bg:"var(--color-background-danger)",  tx:"var(--color-text-danger)",  bd:"var(--color-border-danger)"  },
    MEDIUM: { bg:"var(--color-background-warning)", tx:"var(--color-text-warning)", bd:"var(--color-border-warning)" },
    LOW:    { bg:"var(--color-background-success)", tx:"var(--color-text-success)", bd:"var(--color-border-success)" },
  };
  const s = MAP[p] || { bg:"var(--color-background-secondary)", tx:"var(--color-text-tertiary)", bd:"var(--color-border-tertiary)" };
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", fontWeight:500,
      padding:"2px 6px", borderRadius:4, background:s.bg, color:s.tx, border:`0.5px solid ${s.bd}` }}>
      {p}
    </span>
  );
}

function Chip({ label }) {
  return (
    <span style={{ fontSize:10, fontFamily:"var(--font-mono)", padding:"2px 5px", borderRadius:3,
      background:"var(--color-background-secondary)", color:"var(--color-text-tertiary)",
      border:"0.5px solid var(--color-border-tertiary)" }}>
      {label}
    </span>
  );
}

function NewsCard({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(o => !o)} style={{ background:"var(--color-background-primary)",
      border:"0.5px solid var(--color-border-tertiary)",
      borderLeft:`3px solid ${PACC[item.priority] || "#888780"}`,
      borderRadius:0, padding:"12px 14px", cursor:"pointer" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:7, flexWrap:"wrap" }}>
        <JBadge code={item.jurisdiction} />
        <PBadge p={item.priority} />
        {item.tags?.slice(0,3).map(t => <Chip key={t} label={t} />)}
        <span style={{ marginLeft:"auto", fontSize:11, fontFamily:"var(--font-mono)",
          color:"var(--color-text-tertiary)", flexShrink:0 }}>{item.date}</span>
      </div>
      <div style={{ fontWeight:500, fontSize:13, lineHeight:1.45, color:"var(--color-text-primary)" }}>
        {item.url
          ? <a href={item.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color:"var(--color-text-primary)", textDecoration:"none" }}>{item.title}</a>
          : item.title}
      </div>
      {open && item.summary && (
        <div style={{ marginTop:8 }}>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.65, marginBottom:6 }}>
            {item.summary}
          </div>
          {item.source && (
            <div style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>
              via {item.source}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DLCard({ dl }) {
  const days = daysFrom(dl.deadline);
  const urg  = days <= 7 ? "danger" : days <= 21 ? "warning" : null;
  return (
    <div style={{ background:"var(--color-background-primary)",
      border:`0.5px solid ${urg ? `var(--color-border-${urg})` : "var(--color-border-tertiary)"}`,
      borderRadius:"var(--border-radius-md)", padding:"10px 12px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          <JBadge code={dl.jurisdiction} />
          <Chip label={dl.tax_type} />
        </div>
        <span style={{ fontSize:11, fontFamily:"var(--font-mono)", fontWeight:500,
          color: urg ? `var(--color-text-${urg})` : "var(--color-text-secondary)",
          whiteSpace:"nowrap", marginLeft:8 }}>
          {days > 0 ? `+${days}d` : days === 0 ? "TODAY" : "PAST"}
        </span>
      </div>
      <div style={{ fontWeight:500, fontSize:12, color:"var(--color-text-primary)", lineHeight:1.4, marginBottom:4 }}>
        {dl.description}
      </div>
      <div style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>
        {dl.deadline} · {dl.authority}{dl.period ? ` · ${dl.period}` : ""}
      </div>
      {dl.notes && (
        <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:4, fontStyle:"italic" }}>
          {dl.notes}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [filter,    setFilter]   = useState("ALL");
  const [news,      setNews]     = useState([]);
  const [deadlines, setDL]       = useState([]);
  const [scanning,  setScanning] = useState(false);
  const [lastScan,  setLastScan] = useState(null);
  const [error,     setError]    = useState(null);
  const timerRef                = useRef(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const data = await fetchIntel();
      const rawNews = Array.isArray(data.news) ? data.news : [];
      setNews(rawNews.sort((a, b) => (PORD[a.priority] ?? 1) - (PORD[b.priority] ?? 1)));
      setDL(Array.isArray(data.deadlines)
        ? data.deadlines.sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
        : []);
      setLastScan(new Date());
    } catch (e) {
      setError(e.name === "AbortError" ? "Request timed out (15 s)" : e.message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    runScan();
    timerRef.current = setInterval(runScan, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [runScan]);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch {} };
  }, []);

  const fNews   = filter === "ALL" ? news      : news.filter(n => n.jurisdiction === filter);
  const fDL     = filter === "ALL" ? deadlines : deadlines.filter(d => d.jurisdiction === filter);
  const highN   = news.filter(n => n.priority === "HIGH").length;
  const hasData = news.length > 0 || deadlines.length > 0;

  return (
    <div style={{ padding:"1.25rem 1rem" }}>
      <h2 className="sr-only">Razer tax intelligence dashboard</h2>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:16, paddingBottom:14, borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
        <div>
          <div style={{ fontWeight:500, fontSize:16, color:"var(--color-text-primary)" }}>
            <i className="ti ti-satellite" aria-hidden="true"
               style={{ fontSize:15, verticalAlign:-1, marginRight:7, color:"var(--color-text-info)" }}></i>
            Razer Tax Intel
          </div>
          <div style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)", marginTop:3 }}>
            {scanning
              ? "Fetching latest intelligence…"
              : lastScan
                ? `Updated ${lastScan.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })} · auto-refreshes every 6h`
                : "Awaiting first load…"
            } · 7 jurisdictions · RSS + Big4
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!scanning && highN > 0 && (
            <span style={{ fontSize:11, fontFamily:"var(--font-mono)", fontWeight:500,
              color:"var(--color-text-danger)", background:"var(--color-background-danger)",
              padding:"3px 9px", borderRadius:4, border:"0.5px solid var(--color-border-danger)" }}>
              <i className="ti ti-alert-triangle" aria-hidden="true"
                 style={{ fontSize:12, verticalAlign:-1, marginRight:4 }}></i>
              {highN} HIGH
            </span>
          )}
          <button onClick={runScan} disabled={scanning}>
            <i className={`ti ${scanning ? "ti-loader" : "ti-refresh"}`} aria-hidden="true"
               style={{ fontSize:13, verticalAlign:-1, marginRight:5 }}></i>
            {scanning ? "Fetching…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize:12, fontFamily:"var(--font-mono)", color:"var(--color-text-danger)",
          background:"var(--color-background-danger)", border:"0.5px solid var(--color-border-danger)",
          borderRadius:"var(--border-radius-md)", padding:"8px 12px", marginBottom:14 }}>
          <i className="ti ti-alert-circle" aria-hidden="true"
             style={{ fontSize:13, verticalAlign:-1, marginRight:6 }}></i>
          Backend unreachable: {error}. Check API_URL constant (currently {API_URL}).
        </div>
      )}

      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:18 }}>
        {[{ code:"ALL" }, ...JURIDS].map(j => {
          const active = filter === j.code;
          const jd = JM[j.code];
          return (
            <button key={j.code} onClick={() => setFilter(j.code)} style={{
              padding:"4px 11px", borderRadius:"var(--border-radius-md)",
              border:`0.5px solid ${active && jd ? jd.bd : active ? "var(--color-border-info)" : "var(--color-border-secondary)"}`,
              background: active && jd ? jd.bg : active ? "var(--color-background-info)" : "transparent",
              color: active && jd ? jd.tx : active ? "var(--color-text-info)" : "var(--color-text-secondary)",
              cursor:"pointer", fontFamily:"var(--font-mono)", fontSize:11, fontWeight: active ? 500 : 400,
            }}>
              {j.code}
            </button>
          );
        })}
      </div>

      {scanning && !hasData && (
        <div style={{ textAlign:"center", padding:"4rem 0", color:"var(--color-text-tertiary)" }}>
          <i className="ti ti-loader" aria-hidden="true" style={{ fontSize:28, display:"block", marginBottom:10 }}></i>
          <div style={{ fontSize:12, fontFamily:"var(--font-mono)" }}>Fetching RSS feeds…</div>
        </div>
      )}

      {!scanning && !hasData && !error && (
        <div style={{ textAlign:"center", padding:"5rem 0", color:"var(--color-text-tertiary)" }}>
          <i className="ti ti-satellite" aria-hidden="true"
             style={{ fontSize:32, display:"block", marginBottom:12 }}></i>
          <div style={{ fontSize:13, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:6 }}>
            No data loaded
          </div>
          <div style={{ fontSize:12, fontFamily:"var(--font-mono)" }}>
            Ensure backend is running at {API_URL}
          </div>
        </div>
      )}

      {hasData && (
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 300px", gap:20, alignItems:"start" }}>
          <div>
            <div style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)",
              marginBottom:10, letterSpacing:"0.05em" }}>
              Regulatory updates — {fNews.length} items{filter !== "ALL" ? ` · ${filter}` : ""}
            </div>
            {fNews.length === 0 && (
              <div style={{ fontSize:12, color:"var(--color-text-tertiary)", padding:"16px 0" }}>
                No items for {filter}.
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {fNews.map((item, i) => <NewsCard key={i} item={item} />)}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)",
              marginBottom:10, letterSpacing:"0.05em" }}>
              June 2026 deadlines — {fDL.length}
            </div>
            {fDL.length === 0 && (
              <div style={{ fontSize:12, color:"var(--color-text-tertiary)", padding:"16px 0" }}>
                No deadlines for {filter}.
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {fDL.map((dl, i) => <DLCard key={i} dl={dl} />)}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop:32, paddingTop:10, borderTop:"0.5px solid var(--color-border-tertiary)",
        fontSize:11, fontFamily:"var(--font-mono)", color:"var(--color-text-tertiary)" }}>
        For internal review only · Verify all items against official sources before acting
      </div>
    </div>
  );
}
