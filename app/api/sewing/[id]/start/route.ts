import { route } from '@/lib/api';
import { startSewing } from '@/lib/service';
export const POST = route(({ db, user, params }) => startSewing(db, user, Number(params.id)));
