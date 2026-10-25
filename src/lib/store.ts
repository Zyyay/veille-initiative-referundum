import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { env } from "./config.js";

export interface Article {
  sujet_id: string; guid: string; titre: string; source_nom: string; source_domaine: string; lien: string; publie_le: string;
}
export interface Alerte {
  cle: string; sujet_id: string | null; type: string; niveau: string; mention: boolean;
  statut: "envoyee" | "en_attente" | "ecartee"; payload: Record<string, unknown>; cree_le?: string; envoyee_le?: string | null;
}
export interface ScoreLigne {
  sujet_id: string; articles_fenetre: number; histoires: number; medias: number; reference: number; ratio: number;
  bonus_wiki: boolean; historique_jours: number; niveau: string | null;
}
export interface AgendaLigne {
  uid: string; debut: string; lieu: string; type: string; objet: string; sujets: string[]; etat: string;
}

export interface Store {
  lireEtat<T>(cle: string): Promise<T | null>;
  ecrireEtat(cle: string, valeur: unknown): Promise<void>;
  ajouterArticles(a: Article[]): Promise<number>;
  articlesDepuis(sujetId: string, depuis: Date): Promise<Article[]>;
  premierArticle(sujetId: string): Promise<Date | null>;
  ajouterWiki(lignes: { article: string; jour: string; vues: number }[]): Promise<void>;
  wikiDepuis(article: string, depuisJour: string): Promise<{ jour: string; vues: number }[]>;
  ajouterScores(s: ScoreLigne[]): Promise<void>;
  derniereAlerte(sujetId: string, type: string): Promise<Alerte | null>;
  alerteExiste(cle: string): Promise<boolean>;
  mentionsDepuis(depuis: Date): Promise<number>;
  enregistrerAlerte(a: Alerte): Promise<void>;
  alertesEnAttente(): Promise<Alerte[]>;
  marquerAlertes(cles: string[], statut: Alerte["statut"]): Promise<void>;
  agendaTous(): Promise<AgendaLigne[]>;
  enregistrerAgenda(l: AgendaLigne): Promise<void>;
  purger(): Promise<void>;
}

/* ---------------- Supabase ---------------- */

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }
  private ok<T>(r: { data: T; error: { message: string } | null }, ctx: string): T {
    if (r.error) throw new Error(`Supabase (${ctx}) : ${r.error.message}`);
    return r.data;
  }
  async lireEtat<T>(cle: string) {
    const r = await this.db.from("veille_etat").select("valeur").eq("cle", cle).maybeSingle();
    return (this.ok(r, "lireEtat")?.valeur as T) ?? null;
  }
  async ecrireEtat(cle: string, valeur: unknown) {
    this.ok(await this.db.from("veille_etat").upsert({ cle, valeur, maj_le: new Date().toISOString() }), "ecrireEtat");
  }
  async ajouterArticles(a: Article[]) {
    if (!a.length) return 0;
    const r = await this.db.from("veille_articles").upsert(a, { onConflict: "sujet_id,guid", ignoreDuplicates: true }).select("id");
    return (this.ok(r, "ajouterArticles") ?? []).length;
  }
  async articlesDepuis(sujetId: string, depuis: Date) {
    const r = await this.db.from("veille_articles").select("sujet_id,guid,titre,source_nom,source_domaine,lien,publie_le")
      .eq("sujet_id", sujetId).gte("publie_le", depuis.toISOString()).order("publie_le", { ascending: false }).limit(5000);
    return this.ok(r, "articlesDepuis") as Article[];
  }
  async premierArticle(sujetId: string) {
    const r = await this.db.from("veille_articles").select("collecte_le").eq("sujet_id", sujetId)
      .order("collecte_le", { ascending: true }).limit(1);
    const d = this.ok(r, "premierArticle") as { collecte_le: string }[];
    return d.length ? new Date(d[0].collecte_le) : null;
  }
  async ajouterWiki(l: { article: string; jour: string; vues: number }[]) {
    if (l.length) this.ok(await this.db.from("veille_wiki").upsert(l, { onConflict: "article,jour" }), "ajouterWiki");
  }
  async wikiDepuis(article: string, depuisJour: string) {
    const r = await this.db.from("veille_wiki").select("jour,vues").eq("article", article).gte("jour", depuisJour).order("jour");
    return this.ok(r, "wikiDepuis") as { jour: string; vues: number }[];
  }
  async ajouterScores(s: ScoreLigne[]) {
    if (s.length) this.ok(await this.db.from("veille_scores").insert(s), "ajouterScores");
  }
  async derniereAlerte(sujetId: string, type: string) {
    const r = await this.db.from("veille_alertes").select("*").eq("sujet_id", sujetId).eq("type", type)
      .neq("statut", "ecartee").order("cree_le", { ascending: false }).limit(1);
    const d = this.ok(r, "derniereAlerte") as Alerte[];
    return d[0] ?? null;
  }
  async alerteExiste(cle: string) {
    const r = await this.db.from("veille_alertes").select("cle").eq("cle", cle).limit(1);
    return (this.ok(r, "alerteExiste") as unknown[]).length > 0;
  }
  async mentionsDepuis(depuis: Date) {
    const r = await this.db.from("veille_alertes").select("cle", { count: "exact", head: true })
      .eq("mention", true).eq("statut", "envoyee").gte("envoyee_le", depuis.toISOString());
    if (r.error) throw new Error(`Supabase (mentionsDepuis) : ${r.error.message}`);
    return r.count ?? 0;
  }
  async enregistrerAlerte(a: Alerte) {
    const ligne = { ...a, envoyee_le: a.statut === "envoyee" ? new Date().toISOString() : null };
    this.ok(await this.db.from("veille_alertes").upsert(ligne, { onConflict: "cle" }), "enregistrerAlerte");
  }
  async alertesEnAttente() {
    const r = await this.db.from("veille_alertes").select("*").eq("statut", "en_attente").order("cree_le");
    return this.ok(r, "alertesEnAttente") as Alerte[];
  }
  async marquerAlertes(cles: string[], statut: Alerte["statut"]) {
    if (!cles.length) return;
    const maj = { statut, envoyee_le: statut === "envoyee" ? new Date().toISOString() : null };
    this.ok(await this.db.from("veille_alertes").update(maj).in("cle", cles), "marquerAlertes");
  }
  async agendaTous() {
    const r = await this.db.from("veille_agenda").select("uid,debut,lieu,type,objet,sujets,etat")
      .gte("debut", new Date(Date.now() - 2 * 86400_000).toISOString());
    return this.ok(r, "agendaTous") as AgendaLigne[];
  }
  async enregistrerAgenda(l: AgendaLigne) {
    this.ok(await this.db.from("veille_agenda").upsert({ ...l, maj_le: new Date().toISOString() }, { onConflict: "uid" }), "enregistrerAgenda");
  }
  async purger() {
    this.ok(await this.db.rpc("veille_purge"), "purger");
  }
}

/* ---------------- Mémoire locale (essais sans Supabase) ---------------- */

interface Donnees {
  etat: Record<string, unknown>; articles: (Article & { collecte_le: string })[]; wiki: { article: string; jour: string; vues: number }[];
  scores: ScoreLigne[]; alertes: Alerte[]; agenda: AgendaLigne[];
}

export class MemoireStore implements Store {
  private d: Donnees = { etat: {}, articles: [], wiki: [], scores: [], alertes: [], agenda: [] };
  constructor(private fichier?: string) {
    if (fichier && existsSync(fichier)) this.d = JSON.parse(readFileSync(fichier, "utf8"));
  }
  private save() {
    if (!this.fichier) return;
    mkdirSync(this.fichier.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(this.fichier, JSON.stringify(this.d));
  }
  async lireEtat<T>(cle: string) { return (this.d.etat[cle] as T) ?? null; }
  async ecrireEtat(cle: string, v: unknown) { this.d.etat[cle] = v; this.save(); }
  async ajouterArticles(a: Article[]) {
    let n = 0;
    for (const x of a) {
      if (this.d.articles.some((y) => y.sujet_id === x.sujet_id && y.guid === x.guid)) continue;
      this.d.articles.push({ ...x, collecte_le: new Date().toISOString() }); n++;
    }
    this.save(); return n;
  }
  async articlesDepuis(sujetId: string, depuis: Date) {
    return this.d.articles.filter((a) => a.sujet_id === sujetId && new Date(a.publie_le) >= depuis);
  }
  async premierArticle(sujetId: string) {
    const xs = this.d.articles.filter((a) => a.sujet_id === sujetId).map((a) => +new Date(a.collecte_le));
    return xs.length ? new Date(Math.min(...xs)) : null;
  }
  async ajouterWiki(l: { article: string; jour: string; vues: number }[]) {
    for (const x of l) {
      this.d.wiki = this.d.wiki.filter((y) => !(y.article === x.article && y.jour === x.jour));
      this.d.wiki.push(x);
    }
    this.save();
  }
  async wikiDepuis(article: string, depuisJour: string) {
    return this.d.wiki.filter((w) => w.article === article && w.jour >= depuisJour).sort((a, b) => a.jour.localeCompare(b.jour));
  }
  async ajouterScores(s: ScoreLigne[]) { this.d.scores.push(...s); this.save(); }
  async derniereAlerte(sujetId: string, type: string) {
    const xs = this.d.alertes.filter((a) => a.sujet_id === sujetId && a.type === type && a.statut !== "ecartee");
    return xs[xs.length - 1] ?? null;
  }
  async alerteExiste(cle: string) { return this.d.alertes.some((a) => a.cle === cle); }
  async mentionsDepuis(depuis: Date) {
    return this.d.alertes.filter((a) => a.mention && a.statut === "envoyee" && a.envoyee_le && new Date(a.envoyee_le) >= depuis).length;
  }
  async enregistrerAlerte(a: Alerte) {
    const now = new Date().toISOString();
    this.d.alertes = this.d.alertes.filter((x) => x.cle !== a.cle);
    this.d.alertes.push({ ...a, cree_le: a.cree_le ?? now, envoyee_le: a.statut === "envoyee" ? now : null });
    this.save();
  }
  async alertesEnAttente() { return this.d.alertes.filter((a) => a.statut === "en_attente"); }
  async marquerAlertes(cles: string[], statut: Alerte["statut"]) {
    const now = new Date().toISOString();
    for (const a of this.d.alertes) if (cles.includes(a.cle)) { a.statut = statut; a.envoyee_le = statut === "envoyee" ? now : null; }
    this.save();
  }
  async agendaTous() { return this.d.agenda; }
  async enregistrerAgenda(l: AgendaLigne) {
    this.d.agenda = this.d.agenda.filter((x) => x.uid !== l.uid); this.d.agenda.push(l); this.save();
  }
  async purger() {}
}

/** En mode essai, tout reste en local (.etat-local/) pour ne pas polluer la base. DRY_RUN_SUPABASE=1 force Supabase. */
export function creerStore(): Store {
  if (env.dryRun && process.env.DRY_RUN_SUPABASE !== "1") return new MemoireStore(".etat-local/store.json");
  if (env.supabaseUrl && env.supabaseKey) return new SupabaseStore(env.supabaseUrl, env.supabaseKey);
  throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont obligatoires hors mode essai (DRY_RUN=1).");
}
