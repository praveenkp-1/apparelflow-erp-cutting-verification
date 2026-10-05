import { Db } from './db';
import { HttpError, Role, expectedFabric, expectedQty, flagFor, isNonNegInt, isPosInt, isPosYards, wastagePct } from './domain';

export interface User { id: number; role: Role; full_name: string; email: string }

export const requireRole = (u: User, ...roles: Role[]) => {
  if (!roles.includes(u.role)) throw new HttpError(403, `Forbidden: role '${u.role}' cannot perform this action`);
};

const ORDER_SQL = `
  SELECT o.id, o.order_no, o.target_qty, o.fabric_roll_id, o.actual_fabric_yds::float8 AS actual_fabric_yds,
         o.status, o.created_at, o.updated_at, r.recipe_code, r.name AS recipe_name,
         r.std_fabric_yards::float8 AS std_fabric_yards, r.wastage_cap::float8 AS wastage_cap,
         (SELECT rejection_note FROM verification_logs l WHERE l.order_id = o.id AND l.decision = 'REJECTED'
            ORDER BY l.id DESC LIMIT 1) AS rejection_note
  FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id`;

async function withItems(db: Db, rows: any[]) {
  if (!rows.length) return rows;
  const items = await db.query(
    `SELECT vi.order_id, vi.component_id, rc.component_name, vi.expected_qty, vi.actual_qty, vi.status
     FROM verification_items vi JOIN recipe_components rc ON rc.id = vi.component_id
     WHERE vi.order_id = ANY($1::int[]) ORDER BY rc.id`, [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, items: items.filter((i: any) => i.order_id === r.id) }));
}

export async function listRecipes(db: Db) {
  const recipes = await db.query(`SELECT id, recipe_code, name, category, std_fabric_yards::float8 AS std_fabric_yards,
    wastage_cap::float8 AS wastage_cap FROM recipes ORDER BY id`);
  const comps = await db.query('SELECT id, recipe_id, component_name, pieces_per_garment FROM recipe_components ORDER BY id');
  return recipes.map((r: any) => ({ ...r, components: comps.filter((c: any) => c.recipe_id === r.id) }));
}

export async function createOrder(db: Db, user: User, body: any) {
  requireRole(user, 'cutting_supervisor');
  const { recipe_id, target_qty, fabric_roll_id, actual_fabric_yds } = body ?? {};
  if (!isPosInt(recipe_id)) throw new HttpError(400, 'recipe_id must be a positive whole number');
  if (!isPosInt(target_qty) || target_qty > 100000) throw new HttpError(400, 'target_qty must be a whole number between 1 and 100000');
  if (typeof fabric_roll_id !== 'string' || !/^[A-Za-z0-9-]{3,40}$/.test(fabric_roll_id.trim()))
    throw new HttpError(400, 'fabric_roll_id must be 3-40 letters, digits or dashes');
  if (!isPosYards(actual_fabric_yds)) throw new HttpError(400, 'actual_fabric_yds must be a positive number with at most 2 decimals');

  return db.tx(async (t) => {
    const comps = await t.query('SELECT id, pieces_per_garment FROM recipe_components WHERE recipe_id = $1', [recipe_id]);
    if (!comps.length) throw new HttpError(404, 'Recipe not found');
    const [{ id }] = await t.query<{ id: number }>(`SELECT nextval('cutting_orders_id_seq')::int AS id`);
    await t.query(
      `INSERT INTO cutting_orders(id, order_no, recipe_id, target_qty, fabric_roll_id, actual_fabric_yds, status, created_by)
       VALUES($1,$2,$3,$4,$5,$6,'PENDING_VERIFICATION',$7)`,
      [id, `CO-${String(id).padStart(5, '0')}`, recipe_id, target_qty, fabric_roll_id.trim(), actual_fabric_yds, user.id]);
    for (const c of comps)
      await t.query('INSERT INTO verification_items(order_id, component_id, expected_qty) VALUES($1,$2,$3)',
        [id, c.id, expectedQty(target_qty, c.pieces_per_garment)]);
    return (await withItems(t, await t.query(`${ORDER_SQL} WHERE o.id = $1`, [id])))[0];
  });
}

/** Supervisors and verifiers only. Sewing supervisors must use the queue endpoint. */
export async function listOrders(db: Db, user: User) {
  requireRole(user, 'cutting_supervisor', 'cutting_verifier');
  return withItems(db, await db.query(`${ORDER_SQL} ORDER BY o.id DESC`));
}

async function lockPendingOrder(t: Db, orderId: number) {
  if (!isPosInt(orderId)) throw new HttpError(400, 'Invalid order id');
  const [o] = await t.query(
    `SELECT o.id, o.status, o.target_qty, o.actual_fabric_yds::float8 AS yds, r.std_fabric_yards::float8 AS std
     FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status !== 'PENDING_VERIFICATION') throw new HttpError(409, `Order is ${o.status}, not PENDING_VERIFICATION`);
  return o;
}

export async function saveCounts(db: Db, user: User, orderId: number, body: any) {
  requireRole(user, 'cutting_verifier');
  const counts = body?.counts;
  if (!Array.isArray(counts) || !counts.length) throw new HttpError(400, 'counts must be a non-empty array');
  for (const c of counts)
    if (!isPosInt(c?.component_id) || !isNonNegInt(c?.actual_qty))
      throw new HttpError(400, 'Each count needs a component_id and a whole-number actual_qty of 0 or more');

  return db.tx(async (t) => {
    await lockPendingOrder(t, orderId);
    for (const c of counts) {
      const [item] = await t.query('SELECT id, expected_qty FROM verification_items WHERE order_id=$1 AND component_id=$2', [orderId, c.component_id]);
      if (!item) throw new HttpError(422, `Component ${c.component_id} does not belong to this order`);
      await t.query('UPDATE verification_items SET actual_qty=$1, status=$2 WHERE id=$3',
        [c.actual_qty, flagFor(c.actual_qty, item.expected_qty), item.id]);
    }
    return (await withItems(t, await t.query(`${ORDER_SQL} WHERE o.id = $1`, [orderId])))[0];
  });
}

async function writeDecision(t: Db, user: User, o: any, decision: 'APPROVED' | 'REJECTED', note: string | null) {
  const items = await t.query(
    `SELECT rc.component_name AS component, vi.expected_qty AS expected, vi.actual_qty AS actual
     FROM verification_items vi JOIN recipe_components rc ON rc.id = vi.component_id WHERE vi.order_id = $1 ORDER BY rc.id`, [o.id]);
  const variances = items.map((i: any) => ({ ...i, variance: i.actual == null ? null : i.actual - i.expected }));
  const pct = wastagePct(o.yds, expectedFabric(o.target_qty, o.std));
  // verifier_id comes from the authenticated session, timestamp from the DB clock.
  await t.query(
    `INSERT INTO verification_logs(order_id, verifier_id, decision, rejection_note, wastage_pct, variances)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [o.id, user.id, decision, note, pct, JSON.stringify(variances)]);
  await t.query(`UPDATE cutting_orders SET status=$1, updated_at=now() WHERE id=$2`,
    [decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED', o.id]);
}

export async function approveOrder(db: Db, user: User, orderId: number) {
  requireRole(user, 'cutting_verifier');
  return db.tx(async (t) => {
    const o = await lockPendingOrder(t, orderId);
    // Re-derive every flag from stored counts: the client's opinion is never consulted.
    const items = await t.query('SELECT component_id, expected_qty, actual_qty FROM verification_items WHERE order_id=$1', [orderId]);
    if (items.some((i: any) => i.actual_qty === null)) throw new HttpError(422, 'Cannot approve: every component must be counted first');
    if (items.some((i: any) => flagFor(i.actual_qty, i.expected_qty) === 'RED'))
      throw new HttpError(422, 'Cannot approve: at least one component has a shortage (RED). Reject the batch instead');
    await writeDecision(t, user, o, 'APPROVED', null);
    return (await withItems(t, await t.query(`${ORDER_SQL} WHERE o.id = $1`, [orderId])))[0];
  });
}

export async function rejectOrder(db: Db, user: User, orderId: number, body: any) {
  requireRole(user, 'cutting_verifier');
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length < 3 || note.length > 500) throw new HttpError(400, 'A rejection reason of 3-500 characters is required');
  return db.tx(async (t) => {
    const o = await lockPendingOrder(t, orderId);
    await writeDecision(t, user, o, 'REJECTED', note);
    return (await withItems(t, await t.query(`${ORDER_SQL} WHERE o.id = $1`, [orderId])))[0];
  });
}

/** Supervisor re-cuts a rejected batch and sends it back to QC with counts cleared. */
export async function resubmitOrder(db: Db, user: User, orderId: number) {
  requireRole(user, 'cutting_supervisor');
  return db.tx(async (t) => {
    const [o] = await t.query('SELECT status FROM cutting_orders WHERE id=$1 FOR UPDATE', [orderId]);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status !== 'REJECTED') throw new HttpError(409, 'Only REJECTED orders can be resubmitted');
    await t.query('UPDATE verification_items SET actual_qty=NULL, status=NULL WHERE order_id=$1', [orderId]);
    await t.query(`UPDATE cutting_orders SET status='PENDING_VERIFICATION', updated_at=now() WHERE id=$1`, [orderId]);
    return (await withItems(t, await t.query(`${ORDER_SQL} WHERE o.id = $1`, [orderId])))[0];
  });
}

const SEWING_SELECT = `
  SELECT o.id, o.order_no, o.target_qty, o.fabric_roll_id, o.actual_fabric_yds::float8 AS actual_fabric_yds, o.status,
         r.recipe_code, r.name AS recipe_name, r.wastage_cap::float8 AS wastage_cap,
         l.verifier_id, u.full_name AS verifier_name, l."timestamp" AS verified_at,
         l.wastage_pct::float8 AS wastage_pct, l.variances
  FROM cutting_orders o JOIN recipes r ON r.id = o.recipe_id
  JOIN verification_logs l ON l.order_id = o.id AND l.decision = 'APPROVED'
  JOIN users u ON u.id = l.verifier_id`;

/** Status is hard-coded in SQL: no request parameter can widen what the sewing floor sees. */
export async function sewingQueue(db: Db, user: User) {
  requireRole(user, 'sewing_supervisor');
  const queue = await db.query(`${SEWING_SELECT} WHERE o.status = 'VERIFIED' ORDER BY l.id`);
  const inAssembly = await db.query(`${SEWING_SELECT} WHERE o.status = 'SEWING_IN_PROGRESS' ORDER BY o.updated_at DESC`);
  return { queue: await withItems(db, queue), inAssembly: await withItems(db, inAssembly) };
}

export async function startSewing(db: Db, user: User, orderId: number) {
  requireRole(user, 'sewing_supervisor');
  if (!isPosInt(orderId)) throw new HttpError(400, 'Invalid order id');
  return db.tx(async (t) => {
    const [o] = await t.query('SELECT status FROM cutting_orders WHERE id=$1 FOR UPDATE', [orderId]);
    if (!o || o.status !== 'VERIFIED') throw new HttpError(404, 'No verified order with that id in the sewing queue');
    await t.query(`UPDATE cutting_orders SET status='SEWING_IN_PROGRESS', updated_at=now() WHERE id=$1`, [orderId]);
    return { id: orderId, status: 'SEWING_IN_PROGRESS' };
  });
}
