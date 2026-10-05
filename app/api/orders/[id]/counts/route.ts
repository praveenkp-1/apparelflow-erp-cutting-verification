import { route, readJson } from '@/lib/api';
import { saveCounts } from '@/lib/service';
export const PUT = route(async ({ db, user, req, params }) => saveCounts(db, user, Number(params.id), await readJson(req)));
