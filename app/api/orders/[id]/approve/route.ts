import { route } from '@/lib/api';
import { approveOrder } from '@/lib/service';
export const POST = route(({ db, user, params }) => approveOrder(db, user, Number(params.id)));
