import { NextResponse } from 'next/server';
import { currentUser } from './auth';
import { getDb, Db } from './db';
import { HttpError } from './domain';
import type { User } from './service';

type Ctx = { db: Db; user: User; req: Request; params: Record<string, string> };

/** Wraps a route: authenticates (401), runs the handler, maps HttpError to its status. */
export function route(fn: (c: Ctx) => Promise<unknown>) {
  return async (req: Request, { params }: { params: Promise<Record<string, string>> }) => {
    try {
      const user = await currentUser();
      if (!user) throw new HttpError(401, 'Authentication required');
      return NextResponse.json(await fn({ db: await getDb(), user, req, params: await params }));
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

export const readJson = async (req: Request) => { try { return await req.json(); } catch { return null; } };
