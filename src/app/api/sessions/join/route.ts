import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cancioneroSessions } from "@/db/schema";
import {
  KILL_ROOM_CODE,
  KILL_ROOM_NAME,
  constantTimeEquals,
  estaBloqueado,
  obtenerIp,
  registrarExito,
  registrarFallo,
  verifyCode,
} from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * POST → un oyente se une a una sesión con el mismo nombre y código secreto
 * que usó el director al crearla. Si las credenciales coinciden exactamente
 * con la sala especial de cierre, no se entra a ninguna sesión: se cierran
 * todas las sesiones activas.
 */
export async function POST(req: NextRequest) {
  const ip = obtenerIp(req);
  const claveLimite = `join:${ip}`;

  if (estaBloqueado(claveLimite)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!name || !code) {
    registrarFallo(claveLimite);
    return NextResponse.json({ error: "Nombre o código incorrecto." }, { status: 401 });
  }

  // Sala especial de cierre: exige coincidencia exacta (sensible a mayúsculas)
  // de nombre y contraseña. No crea ni une a ninguna sesión.
  if (
    constantTimeEquals(name, KILL_ROOM_NAME) &&
    constantTimeEquals(code, KILL_ROOM_CODE)
  ) {
    registrarExito(claveLimite);
    const cerradas = await db
      .update(cancioneroSessions)
      .set({ closed: true, updatedAt: sql`now()` })
      .where(eq(cancioneroSessions.closed, false))
      .returning({ id: cancioneroSessions.id });

    return NextResponse.json({ special: true, closedCount: cerradas.length });
  }

  const candidatas = await db
    .select()
    .from(cancioneroSessions)
    .where(and(eq(cancioneroSessions.closed, false)));

  const sesion = candidatas.find((s) => s.name.toLowerCase() === name.toLowerCase());

  if (!sesion || !verifyCode(code, sesion.codeSalt, sesion.codeHash)) {
    registrarFallo(claveLimite);
    return NextResponse.json({ error: "Nombre o código incorrecto." }, { status: 401 });
  }

  registrarExito(claveLimite);
  return NextResponse.json({
    special: false,
    session: {
      id: sesion.id,
      name: sesion.name,
      currentHash: sesion.currentHash,
    },
  });
}
