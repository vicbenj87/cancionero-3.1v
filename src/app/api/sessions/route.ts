import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cancioneroSessions } from "@/db/schema";
import {
  KILL_ROOM_NAME,
  MAX_SESSIONS_PER_OWNER,
  OWNER_COOKIE,
  createOwnerToken,
  getOwnerTokenFromRequest,
  hashCode,
} from "@/lib/sessions";


export const dynamic = "force-dynamic";
export const runtime = 'nodejs';
function withOwnerCookie(res: NextResponse, token: string) {
  res.cookies.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

/** GET → lista las sesiones activas creadas por este mismo dispositivo. */
export async function GET(req: NextRequest) {
  let ownerToken = getOwnerTokenFromRequest(req);
  const isNew = !ownerToken;
  if (!ownerToken) ownerToken = createOwnerToken();

  const propias = await db
    .select({
      id: cancioneroSessions.id,
      name: cancioneroSessions.name,
      currentHash: cancioneroSessions.currentHash,
      createdAt: cancioneroSessions.createdAt,
      updatedAt: cancioneroSessions.updatedAt,
    })
    .from(cancioneroSessions)
    .where(and(eq(cancioneroSessions.ownerToken, ownerToken), eq(cancioneroSessions.closed, false)));

  const res = NextResponse.json({ sessions: propias, limit: MAX_SESSIONS_PER_OWNER });
  return isNew ? withOwnerCookie(res, ownerToken) : res;
}

/** POST → crea una sesión nueva (el creador queda como director). */
export async function POST(req: NextRequest) {
  let ownerToken = getOwnerTokenFromRequest(req);
  const isNew = !ownerToken;
  if (!ownerToken) ownerToken = createOwnerToken();

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!name || name.length > 60) {
    return NextResponse.json({ error: "El nombre de la sesión no es válido." }, { status: 400 });
  }
  if (!code || code.length < 4 || code.length > 40) {
    return NextResponse.json(
      { error: "El código secreto debe tener entre 4 y 40 caracteres." },
      { status: 400 },
    );
  }
  if (name.toLowerCase() === KILL_ROOM_NAME.toLowerCase()) {
    return NextResponse.json({ error: "Ese nombre está reservado." }, { status: 400 });
  }

  const activas = await db
    .select({ id: cancioneroSessions.id })
    .from(cancioneroSessions)
    .where(and(eq(cancioneroSessions.ownerToken, ownerToken), eq(cancioneroSessions.closed, false)));

  if (activas.length >= MAX_SESSIONS_PER_OWNER) {
    return NextResponse.json(
      { error: `Ya tienes ${MAX_SESSIONS_PER_OWNER} salas activas. Cierra alguna para crear otra.` },
      { status: 400 },
    );
  }

  const existente = await db
    .select({ id: cancioneroSessions.id })
    .from(cancioneroSessions)
    .where(and(eq(cancioneroSessions.name, name), eq(cancioneroSessions.closed, false)));

  if (existente.length > 0) {
    return NextResponse.json(
      { error: "Ya existe una sesión activa con ese nombre. Elige otro." },
      { status: 409 },
    );
  }

  const { hash, salt } = hashCode(code);

  const [creada] = await db
    .insert(cancioneroSessions)
    .values({
      name,
      codeHash: hash,
      codeSalt: salt,
      ownerToken,
      currentHash: "#/",
    })
    .returning({
      id: cancioneroSessions.id,
      name: cancioneroSessions.name,
      currentHash: cancioneroSessions.currentHash,
    });

  const res = NextResponse.json({ session: creada });
  return isNew ? withOwnerCookie(res, ownerToken) : res;
}
