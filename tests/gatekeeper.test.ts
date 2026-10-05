import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, Db } from '../lib/db';
import { approveOrder, createOrder, listOrders, rejectOrder, saveCounts, sewingQueue, startSewing, User } from '../lib/service';
import { flagFor, wastagePct } from '../lib/domain';

let db: Db;
let sup: User, ver: User, sew: User;
const user = async (email: string) => (await db.query<User>('SELECT id, email, role, full_name FROM users WHERE email=$1', [email]))[0];

beforeEach(async () => {
  db = await createDb({ memory: true });
  sup = await user('supervisor@apparelflow.demo');
  ver = await user('verifier@apparelflow.demo');
  sew = await user('sewing@apparelflow.demo');
});

const blouseOrder = (qty = 50, yds = 95) => createOrder(db, sup, { recipe_id: 1, target_qty: qty, fabric_roll_id: 'FAB-ROLL-882', actual_fabric_yds: yds });
const countAll = (o: any, override: Record<string, number> = {}) =>
  saveCounts(db, ver, o.id, { counts: o.items.map((i: any) => ({ component_id: i.component_id, actual_qty: override[i.component_name] ?? i.expected_qty })) });
const status = async (id: number) => (await db.query('SELECT status FROM cutting_orders WHERE id=$1', [id]))[0].status;
const rejects = async (p: Promise<unknown>, code: number) => { await expect(p).rejects.toMatchObject({ status: code }); };

describe('domain engine', () => {
  it('derives expected counts with the multiplier engine (50 x 2 cuffs = 100)', async () => {
    const o = await blouseOrder();
    expect(o.items.find((i: any) => i.component_name === 'Sleeve Cuffs').expected_qty).toBe(100);
    expect(o.status).toBe('PENDING_VERIFICATION');
  });
  it('flags GREEN / YELLOW / RED and computes wastage', () => {
    expect([flagFor(10, 10), flagFor(11, 10), flagFor(9, 10)]).toEqual(['GREEN', 'YELLOW', 'RED']);
    expect(wastagePct(94.5, 90)).toBe(5);
  });
});

describe('required tests', () => {
  it('1. all-GREEN order can be approved by a verifier, with audit data written', async () => {
    const o = await countAll(await blouseOrder(50, 94.5));
    const done = await approveOrder(db, ver, o.id);
    expect(done.status).toBe('VERIFIED');
    const [log] = await db.query('SELECT verifier_id, decision, wastage_pct::float8 AS w, timestamp FROM verification_logs WHERE order_id=$1', [o.id]);
    expect(log).toMatchObject({ verifier_id: ver.id, decision: 'APPROVED', w: 5 });
    expect(log.timestamp).toBeTruthy();
  });

  it('1b. YELLOW (excess) may still be approved', async () => {
    const o = await countAll(await blouseOrder(), { 'Sleeve Cuffs': 104 });
    expect((await approveOrder(db, ver, o.id)).status).toBe('VERIFIED');
  });

  it('2. any RED component blocks approval with 422 and the order stays pending', async () => {
    const o = await countAll(await blouseOrder(), { 'Sleeve Cuffs': 99 });
    await rejects(approveOrder(db, ver, o.id), 422);
    expect(await status(o.id)).toBe('PENDING_VERIFICATION');
  });

  it('2b. uncounted components also block approval with 422', async () => {
    const o = await blouseOrder();
    await rejects(approveOrder(db, ver, o.id), 422);
  });

  it('3. rejecting without a reason is refused; with a reason it is logged', async () => {
    const o = await countAll(await blouseOrder(), { 'Collar & Stand': 40 });
    await rejects(rejectOrder(db, ver, o.id, { note: '   ' }), 400);
    await rejects(rejectOrder(db, ver, o.id, {}), 400);
    expect(await status(o.id)).toBe('PENDING_VERIFICATION');
    expect((await rejectOrder(db, ver, o.id, { note: 'Collar shortage: 10 pieces defective' })).status).toBe('REJECTED');
  });

  it('4. non-verifier roles receive 403 on approve, reject and count', async () => {
    const o = await countAll(await blouseOrder());
    for (const u of [sup, sew]) {
      await rejects(approveOrder(db, u, o.id), 403);
      await rejects(rejectOrder(db, u, o.id, { note: 'nope nope' }), 403);
      await rejects(saveCounts(db, u, o.id, { counts: [{ component_id: 1, actual_qty: 1 }] }), 403);
    }
    expect(await status(o.id)).toBe('PENDING_VERIFICATION');
  });

  it('4b. only a supervisor can create orders; sewing cannot list cutting orders', async () => {
    await rejects(createOrder(db, ver, { recipe_id: 1, target_qty: 5, fabric_roll_id: 'FAB-1', actual_fabric_yds: 9 }), 403);
    await rejects(listOrders(db, sew), 403);
    await rejects(sewingQueue(db, sup), 403);
    await rejects(sewingQueue(db, ver), 403);
  });

  it('5. unapproved orders never appear in the sewing queue', async () => {
    const pending = await blouseOrder();
    const rejected = await rejectOrder(db, ver, (await blouseOrder()).id, { note: 'Defective fabric' });
    const red = await countAll(await blouseOrder(), { 'Sleeve Cuffs': 1 });
    await rejects(approveOrder(db, ver, red.id), 422);
    const good = await approveOrder(db, ver, (await countAll(await blouseOrder())).id);

    const { queue } = await sewingQueue(db, sew);
    const ids = queue.map((q: any) => q.id);
    expect(ids).toEqual([good.id]);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(rejected.id);
    expect(queue[0]).toMatchObject({ verifier_id: ver.id, verifier_name: ver.full_name });
  });
});

describe('defensive guards', () => {
  it('rejects negatives, decimals, strings and empty payloads', async () => {
    const bad = [{}, null, { recipe_id: 1, target_qty: -5, fabric_roll_id: 'FAB-1', actual_fabric_yds: 9 },
      { recipe_id: 1, target_qty: 2.5, fabric_roll_id: 'FAB-1', actual_fabric_yds: 9 },
      { recipe_id: 1, target_qty: '50', fabric_roll_id: 'FAB-1', actual_fabric_yds: 9 },
      { recipe_id: 1, target_qty: 5, fabric_roll_id: '', actual_fabric_yds: 9 },
      { recipe_id: 1, target_qty: 5, fabric_roll_id: 'FAB-1', actual_fabric_yds: -1 }];
    for (const b of bad) await rejects(createOrder(db, sup, b), 400);
    const o = await blouseOrder();
    for (const q of [-1, 1.5, '3', null]) await rejects(saveCounts(db, ver, o.id, { counts: [{ component_id: o.items[0].component_id, actual_qty: q }] }), 400);
  });

  it('cannot decide an order twice, and the audit log is immutable', async () => {
    const o = await approveOrder(db, ver, (await countAll(await blouseOrder())).id);
    await rejects(approveOrder(db, ver, o.id), 409);
    await rejects(rejectOrder(db, ver, o.id, { note: 'too late now' }), 409);
    await expect(db.query(`UPDATE verification_logs SET wastage_pct = 0`)).rejects.toThrow(/immutable/);
    await expect(db.query(`DELETE FROM verification_logs`)).rejects.toThrow(/immutable/);
  });

  it('start sewing only works on VERIFIED orders', async () => {
    const pending = await blouseOrder();
    await rejects(startSewing(db, sew, pending.id), 404);
    const ok = await approveOrder(db, ver, (await countAll(await blouseOrder())).id);
    expect((await startSewing(db, sew, ok.id)).status).toBe('SEWING_IN_PROGRESS');
    expect((await sewingQueue(db, sew)).queue).toHaveLength(0);
  });
});
