import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cancioneroSessions } from "@/db/schema";
import { getOwnerTokenFromRequest } from "@/lib/sessions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET → estado público de la sesión (lo usan director y oyentes para sondear). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const [sesion] = await db
    .select({
      id: cancioneroSessions.id,
      name: cancioneroSessions.name,
      currentHash: cancioneroSessions.currentHash,
      closed: cancioneroSessions.closed,
      updatedAt: cancioneroSessions.updatedAt,
    })
    .from(cancioneroSessions)
    .where(eq(cancioneroSessions.id, id));

  if (!sesion) {
    return NextResponse.json({ error: "La sesión no existe." }, { status: 404 });
  }

  return NextResponse.json({ session: sesion });
}

/** PATCH → solo el director (dueño) puede publicar su navegación actual. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ownerToken = getOwnerTokenFromRequest(req);
  if (!ownerToken) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const hash = typeof body?.hash === "string" ? body.hash.slice(0, 200) : null;
  if (!hash) {
    return NextResponse.json({ error: "Falta el estado de navegación." }, { status: 400 });
  }

  const [sesion] = await db
    .select({ ownerToken: cancioneroSessions.ownerToken, closed: cancioneroSessions.closed })
    .from(cancioneroSessions)
    .where(eq(cancioneroSessions.id, id));

  if (!sesion) {
    return NextResponse.json({ error: "La sesión no existe." }, { status: 404 });
  }
  if (sesion.ownerToken !== ownerToken) {
    return NextResponse.json({ error: "No eres el director de esta sesión." }, { status: 403 });
  }
  if (sesion.closed) {
    return NextResponse.json({ error: "La sesión está cerrada." }, { status: 410 });
  }

  const [actualizada] = await db
    .update(cancioneroSessions)
    .set({ currentHash: hash, updatedAt: new Date() })
    .where(eq(cancioneroSessions.id, id))
    .returning({
      id: cancioneroSessions.id,
      currentHash: cancioneroSessions.currentHash,
      closed: cancioneroSessions.closed,
    });

  return NextResponse.json({ session: actualizada });
}

/** DELETE → el director cierra su propia sesión manualmente. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ownerToken = getOwnerTokenFromRequest(req);
  if (!ownerToken) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const [sesion] = await db
    .select({ ownerToken: cancioneroSessions.ownerToken })
    .from(cancioneroSessions)
    .where(eq(cancioneroSessions.id, id));

  if (!sesion) {
    return NextResponse.json({ error: "La sesión no existe." }, { status: 404 });
  }
  if (sesion.ownerToken !== ownerToken) {
    return NextResponse.json({ error: "No eres el dueño de esta sesión." }, { status: 403 });
  }

  await db
    .update(cancioneroSessions)
    .set({ closed: true, updatedAt: new Date() })
    .where(eq(cancioneroSessions.id, id));

  return NextResponse.json({ closed: true });
}
