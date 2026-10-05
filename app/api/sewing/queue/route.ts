import { route } from '@/lib/api';
import { sewingQueue } from '@/lib/service';
export const dynamic = 'force-dynamic';
// Query params are deliberately ignored: the VERIFIED filter lives in SQL.
export const GET = route(({ db, user }) => sewingQueue(db, user));
