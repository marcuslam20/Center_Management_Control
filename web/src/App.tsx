import { useEffect, useRef, useState } from 'react';
import { api, type AuditEntry, type Settings, type Snapshot, type SwitchView } from './api';

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // SSE stream snapshot.
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        setSnap(JSON.parse(e.data) as Snapshot);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  // Poll audit log.
  useEffect(() => {
    let alive = true;
    const tick = () => api.audit().then((a) => alive && setAudit(a)).catch(() => undefined);
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!snap) return <div className="loading">Connecting to control panel…</div>;

  const busy = snap.orchestrator.busy;

  return (
    <div className="app">
      <Header snap={snap} />
      <div className="grid">
        <PriceCard snap={snap} />
        <GlobalControls busy={busy} />
      </div>
      <SwitchGrid switches={snap.switches} busy={busy} />
      <div className="grid">
        <SettingsCard settings={snap.settings} />
        <AuditCard audit={audit} />
      </div>
    </div>
  );
}

function Header({ snap }: { snap: Snapshot }) {
  return (
    <header className="header">
      <div>
        <h1>Osprey Fingerbot Control Panel</h1>
        <span className="sub">Phase 1 · 6 switches · price source: {snap.priceSource.toUpperCase()}</span>
      </div>
      <div className="badges">
        <span className={`badge ${snap.live ? 'badge-live' : 'badge-dry'}`}>
          {snap.live ? '● LIVE — real control' : '○ DRY-RUN — no commands sent'}
        </span>
        {snap.orchestrator.busy && <span className="badge badge-busy">⏳ {snap.orchestrator.campaign}</span>}
      </div>
    </header>
  );
}

function PriceCard({ snap }: { snap: Snapshot }) {
  const p = snap.price;
  const rec = snap.decision.recommendation;
  const recLabel = rec === 'off' ? 'OFF (price high)' : rec === 'on' ? 'ON (price normal)' : 'HOLD';
  const [mock, setMock] = useState(120);

  return (
    <section className="card">
      <h2>ERCOT Power Price</h2>
      <div className="price">{p ? `$${p.price.toFixed(2)}` : '—'}<span className="unit">/MWh</span></div>
      <div className="muted">
        {snap.settings.settlementPoint} · {p?.intervalEnding ?? 'no data yet'}
      </div>
      <div className="thresholds">
        <span className="th th-on">ON ≤ ${snap.settings.switchOnCost}</span>
        <span className="th th-off">OFF ≥ ${snap.settings.switchOffCost}</span>
      </div>
      <div className={`rec rec-${rec}`}>Recommendation: {recLabel}</div>
      {snap.priceSource === 'mock' && (
        <div className="mock-ctl">
          <label>Mock price: ${mock}</label>
          <input type="range" min={0} max={300} value={mock} onChange={(e) => setMock(Number(e.target.value))} />
          <div className="row">
            <button onClick={() => api.mockPrice(mock)}>Set price</button>
            <button className="ghost" onClick={() => api.mockPrice(null)}>Clear (auto)</button>
          </div>
        </div>
      )}
    </section>
  );
}

function GlobalControls({ busy }: { busy: boolean }) {
  return (
    <section className="card">
      <h2>Global Controls</h2>
      <div className="row">
        <button className="btn-on big" disabled={busy} onClick={() => api.all('on')}>
          Turn ON all
        </button>
        <button className="btn-off big" disabled={busy} onClick={() => api.all('off')}>
          Turn OFF all
        </button>
      </div>
      <button
        className="btn-emergency"
        disabled={busy}
        onClick={() => {
          if (confirm('EMERGENCY SHUTDOWN of all switches (parallel)?')) api.emergency();
        }}
      >
        ⚠️ EMERGENCY — SHUT DOWN
      </button>
      <p className="muted small">Shutdown: one switch at a time (reduce clock → soft-off → fingerbot). Emergency: parallel.</p>
    </section>
  );
}

function SwitchGrid({ switches, busy }: { switches: SwitchView[]; busy: boolean }) {
  return (
    <section>
      <h2 className="section-title">6 Switches (breakers)</h2>
      <div className="switches">
        {switches.map((sw) => (
          <SwitchCard key={sw.id} sw={sw} busy={busy} />
        ))}
      </div>
    </section>
  );
}

function SwitchCard({ sw, busy }: { sw: SwitchView; busy: boolean }) {
  const state = sw.desired;
  return (
    <div className={`switch-card state-${state}`}>
      <div className="switch-head">
        <strong>{sw.name}</strong>
        <span className={`pill pill-${state}`}>{state.toUpperCase()}</span>
      </div>
      <div className="muted small">
        {sw.minerId ?? '—'} · preset {sw.preset} · {sw.fireMode}
      </div>
      <div className="devices">
        {sw.devices.map((d) => (
          <div key={d.deviceId} className="device">
            <span className={`dot ${d.online === false ? 'dot-off' : d.online ? 'dot-on' : 'dot-unknown'}`} />
            <code>{d.deviceId}</code>
            <span className="bat">{d.battery !== null ? `${d.battery}%` : '—'}</span>
            <span className="sw">{d.switchValue === null ? '' : d.switchValue ? '⊥' : '⊤'}</span>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn-on" disabled={busy} onClick={() => api.switch(sw.id, 'on')}>ON</button>
        <button className="btn-off" disabled={busy} onClick={() => api.switch(sw.id, 'off')}>OFF</button>
      </div>
    </div>
  );
}

function SettingsCard({ settings }: { settings: Settings }) {
  const [s, setS] = useState<Settings>(settings);
  const dirtyRef = useRef(false);
  // Sync when the server updates, unless the user is currently editing.
  useEffect(() => {
    if (!dirtyRef.current) setS(settings);
  }, [settings]);

  const upd = (patch: Partial<Settings>) => {
    dirtyRef.current = true;
    setS((prev) => ({ ...prev, ...patch }));
  };
  const save = async () => {
    await api.putSettings(s);
    dirtyRef.current = false;
  };

  return (
    <section className="card">
      <h2>Thresholds & Configuration</h2>
      <div className="field">
        <label>Switch OFF cost ($/MWh)</label>
        <input type="number" value={s.switchOffCost} onChange={(e) => upd({ switchOffCost: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>Switch ON cost ($/MWh)</label>
        <input type="number" value={s.switchOnCost} onChange={(e) => upd({ switchOnCost: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>Confirm minutes (stability)</label>
        <input type="number" value={s.confirmMinutes} onChange={(e) => upd({ confirmMinutes: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>Settlement Point</label>
        <input value={s.settlementPoint} onChange={(e) => upd({ settlementPoint: e.target.value })} />
      </div>
      <div className="field">
        <label>Delay between switches (ms)</label>
        <input type="number" value={s.delaySwitchMs} onChange={(e) => upd({ delaySwitchMs: Number(e.target.value) })} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={s.autoControl} onChange={(e) => upd({ autoControl: e.target.checked })} />
        Auto-control by price (autoControl)
      </label>
      <button className="save" onClick={save}>Save configuration</button>
    </section>
  );
}

function AuditCard({ audit }: { audit: AuditEntry[] }) {
  return (
    <section className="card audit">
      <h2>Audit Log</h2>
      <div className="log">
        {[...audit].reverse().map((e, i) => (
          <div key={i} className={`log-line lv-${e.level}`}>
            <span className="log-time">{e.ts.slice(11, 19)}</span>
            <span className="log-src">[{e.source}]</span>
            <span className="log-msg">{e.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
