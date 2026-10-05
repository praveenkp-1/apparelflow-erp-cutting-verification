'use client';
import { useCallback, useEffect, useState } from 'react';
import { expectedFabric, expectedQty, flagFor, wastagePct } from '@/lib/domain';

type Item = { component_id: number; component_name: string; expected_qty: number; actual_qty: number | null; status: string | null };
type Order = { id: number; order_no: string; target_qty: number; fabric_roll_id: string; actual_fabric_yds: number; status: string; recipe_code: string; recipe_name: string; std_fabric_yards: number; wastage_cap: number; rejection_note: string | null; items: Item[]; verifier_name?: string; verified_at?: string; wastage_pct?: number };
type Recipe = { id: number; recipe_code: string; name: string; std_fabric_yards: number; components: { id: number; component_name: string; pieces_per_garment: number }[] };
type User = { id: number; role: string; full_name: string; email: string };

const DEMO = [
  { label: 'Cutting Supervisor', email: 'supervisor@apparelflow.demo' },
  { label: 'Cutting Verifier', email: 'verifier@apparelflow.demo' },
  { label: 'Sewing Supervisor', email: 'sewing@apparelflow.demo' },
];
const PASSWORD = 'Demo@1234';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const fmt = (d?: string) => (d ? new Date(d).toLocaleString() : '');
const Badge = ({ s }: { s: string }) => <span className={`badge ${['GREEN', 'YELLOW', 'RED'].includes(s) ? s : 'st'}`}>{s.replace(/_/g, ' ')}</span>;

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => { api('/api/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null)); }, []);
  const signIn = async (email: string, password: string) => {
    setError('');
    try { setUser((await api('/api/auth/login', 'POST', { email, password })).user); } catch (e) { setError((e as Error).message); }
  };
  const signOut = async () => { await api('/api/auth/logout', 'POST'); setUser(null); };

  if (user === undefined) return <div className="shell"><p>Loading…</p></div>;
  if (!user) return <Login signIn={signIn} error={error} />;

  return (
    <div className="shell">
      <div className="bar">
        <div><strong>ApparelFlow</strong> Cutting Gatekeeper<div className="who">{user.full_name}</div></div>
        <div className="row" role="group" aria-label="Switch demo role">
          {DEMO.map((d) => (
            <button key={d.email} aria-pressed={user.email === d.email} onClick={() => signIn(d.email, PASSWORD)}>{d.label}</button>
          ))}
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {user.role === 'cutting_supervisor' && <Supervisor />}
      {user.role === 'cutting_verifier' && <Verifier />}
      {user.role === 'sewing_supervisor' && <Sewing />}
    </div>
  );
}

function Login({ signIn, error }: { signIn: (e: string, p: string) => void; error: string }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  return (
    <div className="shell" style={{ maxWidth: 480 }}>
      <div className="panel">
        <h1>ApparelFlow cutting gatekeeper</h1>
        <p className="muted">Sign in, or pick a demo persona below.</p>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@apparelflow.demo" autoComplete="username" />
        <div style={{ height: '.75rem' }} />
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <div className="err" role="alert">{error}</div>}
        <div style={{ height: '.75rem' }} />
        <button onClick={() => signIn(email, password)}>Sign in</button>
      </div>
      <div className="panel">
        <h2>Demo credentials</h2>
        <p className="muted">Password for all three: <strong>{PASSWORD}</strong></p>
        <div className="demo">
          {DEMO.map((d) => <button key={d.email} className="secondary" onClick={() => signIn(d.email, PASSWORD)}>{d.label}<br /><span className="muted">{d.email}</span></button>)}
        </div>
      </div>
    </div>
  );
}

function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setOrders(await api('/api/orders')); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { orders, error, reload, setError };
}

function Supervisor() {
  const { orders, error, reload, setError } = useOrders();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [f, setF] = useState({ recipe_id: '', target_qty: '', fabric_roll_id: '', actual_fabric_yds: '' });
  const [fe, setFe] = useState<Record<string, string>>({});
  useEffect(() => { api('/api/recipes').then(setRecipes).catch(() => {}); }, []);
  const recipe = recipes.find((r) => String(r.id) === f.recipe_id);
  const qty = /^\d+$/.test(f.target_qty) ? Number(f.target_qty) : 0;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.recipe_id) e.recipe_id = 'Choose a recipe.';
    if (!/^[1-9]\d*$/.test(f.target_qty)) e.target_qty = 'Enter a whole number of 1 or more (no decimals or negatives).';
    if (!/^[A-Za-z0-9-]{3,40}$/.test(f.fabric_roll_id)) e.fabric_roll_id = 'Use 3-40 letters, digits or dashes, e.g. FAB-ROLL-882.';
    if (!/^(?!0+(\.0+)?$)\d+(\.\d{1,2})?$/.test(f.actual_fabric_yds)) e.actual_fabric_yds = 'Enter yards greater than 0, up to 2 decimals.';
    setFe(e);
    if (Object.keys(e).length) return;
    try {
      await api('/api/orders', 'POST', { recipe_id: Number(f.recipe_id), target_qty: Number(f.target_qty), fabric_roll_id: f.fabric_roll_id, actual_fabric_yds: Number(f.actual_fabric_yds) });
      setF({ recipe_id: '', target_qty: '', fabric_roll_id: '', actual_fabric_yds: '' });
      reload();
    } catch (x) { setError((x as Error).message); }
  };
  const field = (k: keyof typeof f, label: string, ph: string, mode: 'numeric' | 'decimal' | 'text' = 'text') => (
    <div><label htmlFor={k}>{label}</label>
      <input id={k} inputMode={mode} placeholder={ph} value={f[k]} aria-invalid={!!fe[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {fe[k] && <div className="err" role="alert">{fe[k]}</div>}</div>
  );

  return (<>
    <div className="panel">
      <h2>New cutting order</h2>
      <div className="grid">
        <div><label htmlFor="recipe">Recipe</label>
          <select id="recipe" value={f.recipe_id} aria-invalid={!!fe.recipe_id} onChange={(e) => setF({ ...f, recipe_id: e.target.value })}>
            <option value="">Select a recipe…</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.recipe_code} · {r.name}</option>)}
          </select>{fe.recipe_id && <div className="err" role="alert">{fe.recipe_id}</div>}</div>
        {field('target_qty', 'Target batch quantity', 'e.g. 50', 'numeric')}
        {field('fabric_roll_id', 'Fabric roll ID', 'e.g. FAB-ROLL-882')}
        {field('actual_fabric_yds', 'Actual fabric used (yards)', 'e.g. 94.5', 'decimal')}
      </div>
      {recipe && qty > 0 && (
        <div className="tablewrap" style={{ marginTop: '1rem' }}>
          <p className="muted">Expected fabric: {expectedFabric(qty, recipe.std_fabric_yards).toFixed(2)} yds</p>
          <table><thead><tr><th>Component</th><th>Per garment</th><th>Expected cut pieces</th></tr></thead>
            <tbody>{recipe.components.map((c) => <tr key={c.id}><td>{c.component_name}</td><td>{c.pieces_per_garment}</td><td><strong>{expectedQty(qty, c.pieces_per_garment)}</strong></td></tr>)}</tbody></table>
        </div>)}
      <div style={{ marginTop: '1rem' }}><button onClick={submit}>Submit for verification</button></div>
    </div>
    <div className="panel">
      <h2>Cutting orders</h2>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tablewrap"><table>
        <thead><tr><th>Order</th><th>Recipe</th><th>Qty</th><th>Roll</th><th>Status</th><th></th></tr></thead>
        <tbody>{orders.map((o) => (
          <tr key={o.id}><td>{o.order_no}</td><td>{o.recipe_code} · {o.recipe_name}</td><td>{o.target_qty}</td><td>{o.fabric_roll_id}</td>
            <td><Badge s={o.status} />{o.status === 'REJECTED' && <div className="err">Reason: {o.rejection_note}</div>}</td>
            <td>{o.status === 'REJECTED' && <button onClick={async () => { try { await api(`/api/orders/${o.id}/resubmit`, 'POST'); reload(); } catch (x) { setError((x as Error).message); } }}>Resubmit after re-cut</button>}</td></tr>))}
          {!orders.length && <tr><td colSpan={6} className="muted">No orders yet. Create the first one above.</td></tr>}</tbody></table></div>
    </div></>);
}

function Verifier() {
  const { orders, error, reload, setError } = useOrders();
  const pending = orders.filter((o) => o.status === 'PENDING_VERIFICATION');
  const [sel, setSel] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState(''); const [noteErr, setNoteErr] = useState(''); const [ok, setOk] = useState('');
  const order = pending.find((o) => o.id === sel) ?? null;

  const pick = (o: Order) => { setSel(o.id); setNote(''); setNoteErr(''); setOk('');
    setCounts(Object.fromEntries(o.items.map((i) => [i.component_id, i.actual_qty === null ? '' : String(i.actual_qty)]))); };

  const parsed = order ? order.items.map((i) => {
    const raw = counts[i.component_id] ?? '';
    const valid = /^\d+$/.test(raw);
    return { i, raw, valid, flag: valid ? flagFor(Number(raw), i.expected_qty) : null };
  }) : [];
  const allCounted = parsed.length > 0 && parsed.every((p) => p.valid);
  const anyRed = parsed.some((p) => p.flag === 'RED');
  const canApprove = allCounted && !anyRed;

  const save = async () => order && api(`/api/orders/${order.id}/counts`, 'PUT', { counts: parsed.filter((p) => p.valid).map((p) => ({ component_id: p.i.component_id, actual_qty: Number(p.raw) })) });
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); setSel(null); setOk(msg); setError(''); await reload(); } catch (x) { setError((x as Error).message); }
  };
  const fabricPct = order ? wastagePct(order.actual_fabric_yds, expectedFabric(order.target_qty, order.std_fabric_yards)) : 0;

  return (<>
    {ok && <div className="banner ok" role="status">{ok}</div>}
    {error && <div className="banner bad" role="alert">{error}</div>}
    <div className="panel">
      <h2>Batches awaiting verification</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Order</th><th>Recipe</th><th>Qty</th><th></th></tr></thead>
        <tbody>{pending.map((o) => <tr key={o.id}><td>{o.order_no}</td><td>{o.recipe_name}</td><td>{o.target_qty}</td><td><button className="secondary" onClick={() => pick(o)}>Open</button></td></tr>)}
          {!pending.length && <tr><td colSpan={4} className="muted">No batches waiting at the QC station.</td></tr>}</tbody></table></div>
    </div>
    {order && (
      <div className="panel">
        <h2>{order.order_no} · {order.recipe_name} × {order.target_qty}</h2>
        <p className="muted">Roll {order.fabric_roll_id} · fabric used {order.actual_fabric_yds} yds · wastage {fabricPct}% (cap {order.wastage_cap}%)</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Component</th><th>Expected</th><th>Counted</th><th>Status</th></tr></thead>
          <tbody>{parsed.map(({ i, raw, valid, flag }) => (
            <tr key={i.component_id}><td>{i.component_name}</td><td>{i.expected_qty}</td>
              <td><input aria-label={`Counted ${i.component_name}`} inputMode="numeric" value={raw} aria-invalid={raw !== '' && !valid}
                onChange={(e) => setCounts({ ...counts, [i.component_id]: e.target.value })} />
                {raw !== '' && !valid && <div className="err" role="alert">Whole numbers only.</div>}</td>
              <td>{flag ? <Badge s={flag} /> : <span className="muted">Not counted</span>}</td></tr>))}</tbody></table></div>
        {anyRed && <div className="banner bad" style={{ marginTop: '1rem' }} role="alert">Shortage detected. Approval is blocked. Reject the batch with a reason.</div>}
        <div className="row" style={{ marginTop: '1rem' }}>
          <button disabled={!canApprove} onClick={() => run(async () => { await save(); await api(`/api/orders/${order.id}/approve`, 'POST'); }, `${order.order_no} verified and released to the sewing queue.`)}>Approve batch</button>
          <button className="secondary" disabled={!parsed.some((p) => p.valid)} onClick={() => run(async () => { await save(); }, 'Counts saved.')}>Save counts</button>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <label htmlFor="note">Rejection reason (required to reject)</label>
          <textarea id="note" rows={2} value={note} aria-invalid={!!noteErr} onChange={(e) => { setNote(e.target.value); setNoteErr(''); }} placeholder="e.g. 10 collars cut with fabric defect" />
          {noteErr && <div className="err" role="alert">{noteErr}</div>}
          <div style={{ marginTop: '.5rem' }}><button className="danger" onClick={() => {
            if (note.trim().length < 3) { setNoteErr('Enter a reason of at least 3 characters.'); return; }
            run(async () => { await save(); await api(`/api/orders/${order.id}/reject`, 'POST', { note }); }, `${order.order_no} rejected and returned to the supervisor.`);
          }}>Reject batch</button></div>
        </div>
      </div>)}
  </>);
}

function Sewing() {
  const [data, setData] = useState<{ queue: Order[]; inAssembly: Order[] }>({ queue: [], inAssembly: [] });
  const [error, setError] = useState('');
  const reload = useCallback(async () => { try { setData(await api('/api/sewing/queue')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { reload(); }, [reload]);
  const card = (o: Order, start: boolean) => (
    <div className="panel" key={o.id}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{o.order_no} · {o.recipe_name} × {o.target_qty}</h3><Badge s={o.status} />
      </div>
      <p className="muted">Verified by {o.verifier_name} on {fmt(o.verified_at)} · fabric wastage {o.wastage_pct}% (cap {o.wastage_cap}%)</p>
      <div className="tablewrap"><table><thead><tr><th>Component</th><th>Expected</th><th>Counted</th></tr></thead>
        <tbody>{o.items.map((i) => <tr key={i.component_id}><td>{i.component_name}</td><td>{i.expected_qty}</td><td>{i.actual_qty} {i.status && <Badge s={i.status} />}</td></tr>)}</tbody></table></div>
      {start && <div style={{ marginTop: '.75rem' }}><button onClick={async () => { try { await api(`/api/sewing/${o.id}/start`, 'POST'); reload(); } catch (x) { setError((x as Error).message); } }}>Start sewing assembly</button></div>}
    </div>);
  return (<>
    {error && <div className="banner bad" role="alert">{error}</div>}
    <h2>Sewing queue</h2>
    {data.queue.map((o) => card(o, true))}
    {!data.queue.length && <div className="panel muted">No verified batches are waiting.</div>}
    {data.inAssembly.length > 0 && <><h2>In assembly</h2>{data.inAssembly.map((o) => card(o, false))}</>}
  </>);
}
