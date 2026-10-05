import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { getDb } from './db';
import { HttpError } from './domain';
import type { User } from './service';

const COOKIE = 'af_session';
const secret = () => new TextEncoder().encode(process.env.JWT_SECRET || 'dev-only-secret-change-me-please-32chars');

export async function login(email: unknown, password: unknown): Promise<User> {
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
    throw new HttpError(400, 'Email and password are required');
  const db = await getDb();
  const [u] = await db.query('SELECT id, email, role, full_name, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'Invalid email or password');
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(String(u.id))
    .setExpirationTime('8h').sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.VERCEL === '1' || process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 8 * 3600 });
  return { id: u.id, email: u.email, role: u.role, full_name: u.full_name };
}

export async function logout() { (await cookies()).delete(COOKIE); }

/** Identity AND role are re-read from the DB on every request, never trusted from the token payload. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const [u] = await (await getDb()).query('SELECT id, email, role, full_name FROM users WHERE id = $1', [Number(payload.sub)]);
    return u ?? null;
  } catch { return null; }
}
