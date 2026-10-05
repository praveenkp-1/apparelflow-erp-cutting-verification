import { NextResponse } from 'next/server';
import { login } from '@/lib/auth';
import { HttpError } from '@/lib/domain';
import { readJson } from '@/lib/api';

export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    return NextResponse.json({ user: await login(b?.email, b?.password) });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
