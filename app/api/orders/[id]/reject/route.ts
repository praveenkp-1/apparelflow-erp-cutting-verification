import { route, readJson } from '@/lib/api';
import { rejectOrder } from '@/lib/service';
export const POST = route(async ({ db, user, req, params }) => rejectOrder(db, user, Number(params.id), await readJson(req)));
