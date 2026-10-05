import { route } from '@/lib/api';
import { resubmitOrder } from '@/lib/service';
export const POST = route(({ db, user, params }) => resubmitOrder(db, user, Number(params.id)));
