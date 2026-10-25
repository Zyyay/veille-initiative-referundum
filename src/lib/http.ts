import { env } from "./config.js";

const UA = () => `VeilleDoleances/1.0 (+https://doleances-france.fr; ${env.contact})`;

export async function attendre(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function requete(url: string, init: RequestInit = {}, essais = 3, delaiMs = 20_000): Promise<Response> {
  let derniere: unknown;
  for (let i = 0; i < essais; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), delaiMs);
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA(), ...(init.headers ?? {}) } });
      clearTimeout(t);
      if (r.status === 429 || r.status >= 500) {
        derniere = new Error(`HTTP ${r.status} sur ${url}`);
        await attendre(1500 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(t);
      derniere = e;
      await attendre(1500 * (i + 1));
    }
  }
  throw derniere instanceof Error ? derniere : new Error(String(derniere));
}

export async function texte(url: string): Promise<string> {
  const r = await requete(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.text();
}

export interface Validateurs { etag?: string; lastModified?: string }

/**
 * Téléchargement conditionnel : ne télécharge le fichier que s'il a changé depuis la dernière fois.
 * Renvoie null si inchangé (HTTP 304).
 */
export async function telechargerSiModifie(url: string, v: Validateurs | null, delaiMs = 120_000):
  Promise<{ contenu: Buffer; validateurs: Validateurs } | null> {
  const headers: Record<string, string> = {};
  if (v?.etag) headers["If-None-Match"] = v.etag;
  if (v?.lastModified) headers["If-Modified-Since"] = v.lastModified;
  const r = await requete(url, { headers }, 3, delaiMs);
  if (r.status === 304) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  const contenu = Buffer.from(await r.arrayBuffer());
  return {
    contenu,
    validateurs: { etag: r.headers.get("etag") ?? undefined, lastModified: r.headers.get("last-modified") ?? undefined },
  };
}
