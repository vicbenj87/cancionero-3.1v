import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const OWNER_COOKIE = "cs_owner";
export const MAX_SESSIONS_PER_OWNER = 4;

// Sala especial de cierre: al "unirse" con estas credenciales exactas no se crea
// ni se entra a ninguna sesión, sino que se cierran todas las sesiones activas.
export const KILL_ROOM_NAME = "Cancionero2.5";
export const KILL_ROOM_CODE = "Cantar123";

/** Deriva un hash con sal aleatoria para no guardar el código secreto en claro. */
export function hashCode(code: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? randomBytes(16).toString("hex");
  const derived = scryptSync(code, useSalt, 64).toString("hex");
  return { hash: derived, salt: useSalt };
}

export function verifyCode(code: string, salt: string, expectedHash: string): boolean {
  const derived = scryptSync(code, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Compara dos cadenas cortas en tiempo constante (nombre de sala, etc). */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Igual se hace la comparación para no filtrar la longitud por tiempo.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function getOwnerTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(OWNER_COOKIE)?.value ?? null;
}

export function createOwnerToken(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Limitador de intentos muy simple en memoria, pensado para frenar fuerza
// bruta contra la sala especial de cierre y contra el código de las salas.
// ---------------------------------------------------------------------------
type Intento = { fallos: number; primerFallo: number; bloqueadoHasta: number };
const intentos = new Map<string, Intento>();

const VENTANA_MS = 60_000; // ventana de conteo
const MAX_FALLOS = 6; // fallos permitidos en la ventana
const BLOQUEO_MS = 5 * 60_000; // bloqueo tras superar el máximo

export function estaBloqueado(clave: string): boolean {
  const registro = intentos.get(clave);
  if (!registro) return false;
  if (registro.bloqueadoHasta && Date.now() < registro.bloqueadoHasta) return true;
  return false;
}

export function registrarFallo(clave: string): void {
  const ahora = Date.now();
  const registro = intentos.get(clave);
  if (!registro || ahora - registro.primerFallo > VENTANA_MS) {
    intentos.set(clave, { fallos: 1, primerFallo: ahora, bloqueadoHasta: 0 });
    return;
  }
  registro.fallos += 1;
  if (registro.fallos >= MAX_FALLOS) {
    registro.bloqueadoHasta = ahora + BLOQUEO_MS;
  }
}

export function registrarExito(clave: string): void {
  intentos.delete(clave);
}

export function obtenerIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "desconocido";
}

/** Semana ISO actual, p.ej. "2026-W06". Cambia automáticamente cada 7 días. */
export function semanaIsoActual(fecha: Date = new Date()): string {
  const copia = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const diaSemana = copia.getUTCDay() || 7;
  copia.setUTCDate(copia.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(copia.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((copia.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
  return `${copia.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`;
}
