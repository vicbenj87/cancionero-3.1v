import { asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { weeklyQuickSongs } from "@/db/schema";
import { semanaIsoActual } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * GET → lista de acceso rápido de la semana en curso (hasta 10 canciones).
 * Si nadie ha fijado una lista manual para esta semana ISO, se devuelve vacía
 * y la app pinta una selección automática (determinista, cambia cada semana)
 * calculada en el propio navegador a partir del repertorio cargado.
 */
export async function GET() {
  const semana = semanaIsoActual();

  const filas = await db
    .select({
      position: weeklyQuickSongs.position,
      songId: weeklyQuickSongs.songId,
      songTitle: weeklyQuickSongs.songTitle,
    })
    .from(weeklyQuickSongs)
    .where(eq(weeklyQuickSongs.weekKey, semana))
    .orderBy(asc(weeklyQuickSongs.position));

  return NextResponse.json({ week: semana, songs: filas });
}

/**
 * POST → fija manualmente la lista de la semana (hasta 10 canciones).
 * Pensado para usarse desde editor.html, protegido con una clave simple para
 * evitar que cualquier visitante la modifique.
 * body: { songs: [{ songId, songTitle }], key: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const claveEsperada = process.env.CANCIONERO_ADMIN_KEY || "cancionero-admin";
  const clave = typeof body?.key === "string" ? body.key : "";

  if (clave !== claveEsperada) {
    return NextResponse.json({ error: "Clave de administración incorrecta." }, { status: 403 });
  }

  const songs = Array.isArray(body?.songs) ? body.songs.slice(0, 10) : [];
  if (songs.length === 0) {
    return NextResponse.json({ error: "Envía al menos una canción." }, { status: 400 });
  }

  const semana = semanaIsoActual();

  await db.delete(weeklyQuickSongs).where(eq(weeklyQuickSongs.weekKey, semana));

  const valores = songs
    .map((s: { songId?: unknown; songTitle?: unknown }, i: number) => {
      const songId = Number(s?.songId);
      const songTitle = typeof s?.songTitle === "string" ? s.songTitle.slice(0, 200) : "";
      if (!Number.isFinite(songId) || !songTitle) return null;
      return { weekKey: semana, position: i + 1, songId, songTitle };
    })
    .filter((v: unknown): v is { weekKey: string; position: number; songId: number; songTitle: string } => v !== null);

  if (valores.length > 0) {
    await db.insert(weeklyQuickSongs).values(valores);
  }

  return NextResponse.json({ week: semana, saved: valores.length });
}
