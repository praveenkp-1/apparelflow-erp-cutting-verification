import { route } from '@/lib/api';
import { listRecipes, requireRole } from '@/lib/service';
export const GET = route(async ({ db, user }) => {
  requireRole(user, 'cutting_supervisor', 'cutting_verifier');
  return listRecipes(db);
});
