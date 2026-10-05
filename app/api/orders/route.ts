import { route, readJson } from '@/lib/api';
import { createOrder, listOrders } from '@/lib/service';
export const dynamic = 'force-dynamic';
export const GET = route(({ db, user }) => listOrders(db, user));
export const POST = route(async ({ db, user, req }) => createOrder(db, user, await readJson(req)));
