import { env, type Reseau } from "./config.js";

const UA = () => `VeilleDoleances/1.0 (+https://doleances-france.fr; ${env.contact})`;

export async function attendre(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

let reglages: Reseau | null = null;

/** Appelé par loadConfig() : délais et relances viennent de config/regles.json (bloc « reseau »). */
export function configurerReseau(r: Reseau) { reglages = r; }

function reseau(): Reseau {
  if (!reglages) throw new Error("Réglages réseau non chargés : appeler loadConfig() avant toute requête.");
  return reglages;
}

export interface Reponse {
  status: number; ok: boolean; headers: Headers; corps: Buffer;
  dureeMs: number;   // durée totale, relances comprises
  tentatives: number;
  texte(): string;
  json<T>(): T;
}

export interface OptionsRequete { timeoutMs?: number; relances?: number }

const message = (e: unknown) => {
  const err = e as Error & { cause?: { message?: string; code?: string } };
  const cause = err?.cause?.message ?? err?.cause?.code;
  return `${err?.message ?? String(e)}${cause ? ` (${cause})` : ""}`;
};

const hote = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/**
 * fetch avec délai maximal par tentative, corps compris (un téléchargement coupé en cours de route,
 * « terminated », est donc relancé), relances sur erreur réseau, HTTP 429 et 5xx, et attente croissante
 * entre les tentatives (backoff_ms, puis ×2). Après la dernière tentative, une réponse HTTP en erreur
 * est renvoyée telle quelle (à l'appelant de tester ok) ; une erreur réseau est levée.
 */
export async function recuperer(url: string, init: RequestInit = {}, o: OptionsRequete = {}): Promise<Reponse> {
  const r = reseau();
  const timeout = o.timeoutMs ?? r.timeout_ms;
  const relances = o.relances ?? r.relances;
  const debut = Date.now();
  let derniere: unknown;
  for (let i = 0; i <= relances; i++) {
    if (i > 0) await attendre(r.backoff_ms * 2 ** (i - 1));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error(`délai de ${Math.round(timeout / 1000)} s dépassé`)), timeout);
    try {
      const rep = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA(), ...(init.headers ?? {}) } });
      const corps = Buffer.from(await rep.arrayBuffer());
      if ((rep.status === 429 || rep.status >= 500) && i < relances) { derniere = new Error(`HTTP ${rep.status}`); continue; }
      return {
        status: rep.status, ok: rep.ok, headers: rep.headers, corps, dureeMs: Date.now() - debut, tentatives: i + 1,
        texte: () => corps.toString("utf8"),
        json: <T>() => JSON.parse(corps.toString("utf8")) as T,
      };
    } catch (e) {
      derniere = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`${message(derniere)} — ${relances + 1} tentative(s) sur ${hote(url)} en ${Math.round((Date.now() - debut) / 1000)} s`);
}

export async function texte(url: string): Promise<string> {
  const r = await recuperer(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${hote(url)} après ${r.tentatives} tentative(s)`);
  return r.texte();
}

export interface Validateurs { etag?: string; lastModified?: string }

export interface Telechargement {
  contenu: Buffer | null;   // null si inchangé (HTTP 304)
  validateurs: Validateurs;
  octets: number; dureeMs: number; tentatives: number;
}

/** Téléchargement conditionnel : ne télécharge le fichier que s'il a changé depuis la dernière fois. */
export async function telechargerSiModifie(url: string, v: Validateurs | null): Promise<Telechargement> {
  const headers: Record<string, string> = {};
  if (v?.etag) headers["If-None-Match"] = v.etag;
  if (v?.lastModified) headers["If-Modified-Since"] = v.lastModified;
  const r = await recuperer(url, { headers }, { timeoutMs: reseau().timeout_telechargement_ms });
  const mesure = { octets: r.corps.length, dureeMs: r.dureeMs, tentatives: r.tentatives };
  if (r.status === 304) return { contenu: null, validateurs: v ?? {}, ...mesure };
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${hote(url)} après ${r.tentatives} tentative(s)`);
  return {
    contenu: r.corps, ...mesure,
    validateurs: { etag: r.headers.get("etag") ?? undefined, lastModified: r.headers.get("last-modified") ?? undefined },
  };
}

/** « 12,3 Mo en 8,2 s (1 tentative) » : pour surveiller la taille et la durée des fichiers de l'Assemblée. */
export function decrireTelechargement(t: Pick<Telechargement, "octets" | "dureeMs" | "tentatives" | "contenu">): string {
  const fr = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const taille = t.contenu === null ? "inchangé (304)" : `${fr(t.octets / 1e6)} Mo`;
  return `${taille} en ${fr(t.dureeMs / 1000)} s (${t.tentatives} tentative${t.tentatives > 1 ? "s" : ""})`;
}
