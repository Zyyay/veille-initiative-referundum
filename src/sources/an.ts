import AdmZip from "adm-zip";
import type { Config, Sujet } from "../lib/config.js";
import { telechargerSiModifie, type Validateurs } from "../lib/http.js";
import { rattacher, normaliser } from "../lib/text.js";
import type { Store } from "../lib/store.js";

/* ---------- utilitaires de lecture du JSON de l'Assemblée ---------- */

export const liste = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const n = (x: unknown): number => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

/** Toutes les chaînes contenues dans un objet, quel que soit son niveau d'imbrication. */
export function chaines(o: unknown, acc: string[] = []): string[] {
  if (typeof o === "string") { if (o.trim().length > 3) acc.push(o.trim()); }
  else if (Array.isArray(o)) o.forEach((x) => chaines(x, acc));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => chaines(x, acc));
  return acc;
}

export function lireZip(contenu: Buffer): unknown[] {
  const zip = new AdmZip(contenu);
  const out: unknown[] = [];
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.endsWith(".json")) continue;
    try { out.push(JSON.parse(e.getData().toString("utf8"))); } catch { /* fichier illisible ignoré */ }
  }
  return out;
}

/* ---------- scrutins ---------- */

export type Pos = "pour" | "contre" | "abstention" | string;

export interface VoteGroupe {
  organeRef: string; sigle: string; membres: number;
  pour: number; contre: number; abstentions: number; nonVotants: number; absents: number;
  participation: number; positionMajoritaire: Pos; dissidents: number;
  participationMoyenne: number | null; sousParticipation: boolean; decisif: boolean;
  positionDeclaree: string | null; sourceDeclaree: string | null; ecart: string | null;
}

export interface AnalyseScrutin {
  uid: string; numero: string; date: string; titre: string; solennel: boolean; typeVote: string;
  adopte: boolean; pour: number; contre: number; abstentions: number; votants: number;
  groupes: VoteGroupe[]; lien: string;
}

export interface ScrutinBrut { uid: string; numero: string; date: string; texte: string; brut: any }

export function extraireScrutin(json: any): ScrutinBrut | null {
  const s = json?.scrutin;
  if (!s?.uid) return null;
  const texte = [s.titre, s.objet?.libelle, s.demandeur?.texte].filter((x) => typeof x === "string").join(" — ");
  return { uid: String(s.uid), numero: String(s.numero ?? ""), date: String(s.dateScrutin ?? ""), texte, brut: s };
}

function groupesBruts(s: any): any[] {
  return liste(s?.ventilationVotes?.organe?.groupes?.groupe);
}

export function participationGroupe(g: any): { ref: string; part: number } | null {
  const membres = n(g.nombreMembresGroupe);
  const d = g.vote?.decompteVoix ?? {};
  if (!membres) return null;
  return { ref: String(g.organeRef), part: (n(d.pour) + n(d.contre) + n(d.abstentions)) / membres };
}

/** Participation moyenne de chaque groupe sur l'ensemble des scrutins fournis. */
export function participationsMoyennes(scrutins: ScrutinBrut[]): Map<string, number> {
  const somme = new Map<string, { t: number; k: number }>();
  for (const s of scrutins) for (const g of groupesBruts(s.brut)) {
    const p = participationGroupe(g); if (!p) continue;
    const c = somme.get(p.ref) ?? { t: 0, k: 0 }; c.t += p.part; c.k++; somme.set(p.ref, c);
  }
  return new Map([...somme].map(([r, c]) => [r, c.t / c.k]));
}

/** Le résultat aurait-il changé si les absents et abstentionnistes du groupe avaient voté comme la majorité du groupe ? */
export function estDecisif(adopte: boolean, pour: number, contre: number, g: { positionMajoritaire: Pos; absents: number; abstentions: number }): boolean {
  if (g.positionMajoritaire !== "pour" && g.positionMajoritaire !== "contre") return false;
  const manquants = g.absents + g.abstentions;
  if (!manquants) return false;
  const p = pour + (g.positionMajoritaire === "pour" ? manquants : 0);
  const c = contre + (g.positionMajoritaire === "contre" ? manquants : 0);
  return (p > c) !== adopte;
}

export function analyserScrutin(sc: ScrutinBrut, sujet: Sujet, cfg: Config, moyennes: Map<string, number>): AnalyseScrutin {
  const s = sc.brut;
  const dec = s.syntheseVote?.decompte ?? {};
  const pour = n(dec.pour), contre = n(dec.contre);
  const codeSort = normaliser(String(s.sort?.code ?? s.sort?.libelle ?? ""));
  const adopte = codeSort.includes(" adopte") && !codeSort.includes("pas adopte");
  const typeVote = String(s.typeVote?.libelleTypeVote ?? s.typeVote?.codeTypeVote ?? "");
  const solennel = /solennel/i.test(typeVote) || s.typeVote?.codeTypeVote === "SPS";
  const seuil = cfg.regles.scrutins.seuil_sous_participation;

  const groupes: VoteGroupe[] = groupesBruts(s).map((g) => {
    const d = g.vote?.decompteVoix ?? {};
    const membres = n(g.nombreMembresGroupe);
    const gp = n(d.pour), gc = n(d.contre), ga = n(d.abstentions), gnv = n(d.nonVotants) + n(d.nonVotantsVolontaires);
    const absents = Math.max(0, membres - gp - gc - ga - gnv);
    const positionMajoritaire = String(g.vote?.positionMajoritaire ?? "").toLowerCase();
    const majo = positionMajoritaire === "pour" ? gp : positionMajoritaire === "contre" ? gc : positionMajoritaire === "abstention" ? ga : 0;
    const participation = membres ? (gp + gc + ga) / membres : 0;
    const ref = String(g.organeRef);
    const moy = moyennes.get(ref) ?? null;
    const sigle = cfg.groupes[ref] ?? ref;
    const decl = sujet.positions_declarees?.[sigle];
    const declaree = decl && decl.position !== "non_declaree" ? decl.position : null;
    let ecart: string | null = null;
    if (declaree) {
      if ((positionMajoritaire === "pour" || positionMajoritaire === "contre") && positionMajoritaire !== declaree) ecart = `vote ${positionMajoritaire}`;
      else if (positionMajoritaire === "abstention") ecart = "abstention";
    }
    const base = { positionMajoritaire, absents, abstentions: ga };
    return {
      organeRef: ref, sigle, membres, pour: gp, contre: gc, abstentions: ga, nonVotants: gnv, absents,
      participation, positionMajoritaire, dissidents: gp + gc + ga - majo,
      participationMoyenne: moy, sousParticipation: moy !== null && participation < seuil * moy,
      decisif: estDecisif(adopte, pour, contre, base),
      positionDeclaree: declaree, sourceDeclaree: decl?.source || null, ecart,
    };
  }).sort((a, b) => b.membres - a.membres);

  return {
    uid: sc.uid, numero: sc.numero, date: sc.date, titre: sc.texte, solennel, typeVote, adopte, pour, contre,
    abstentions: n(dec.abstentions), votants: n(s.syntheseVote?.nombreVotants), groupes,
    lien: cfg.sources.an_page_scrutin.replace("{numero}", sc.numero),
  };
}

export interface ResultatScrutins { analyses: { sujet: Sujet; analyse: AnalyseScrutin }[]; refsInconnues: string[]; inchange: boolean }

export async function collecterScrutins(cfg: Config, store: Store, joursRecents = 3): Promise<ResultatScrutins> {
  const cle = "an_scrutins_validateurs";
  const dl = await telechargerSiModifie(cfg.sources.an_scrutins_zip, await store.lireEtat<Validateurs>(cle));
  if (!dl) return { analyses: [], refsInconnues: [], inchange: true };
  const tous = lireZip(dl.contenu).map(extraireScrutin).filter((x): x is ScrutinBrut => !!x);
  const now = Date.now();
  const ref = tous.filter((s) => now - +new Date(s.date) < cfg.regles.scrutins.jours_reference_participation * 86400_000);
  const moyennes = participationsMoyennes(ref);
  const recents = tous.filter((s) => now - +new Date(s.date) < joursRecents * 86400_000);
  const analyses: ResultatScrutins["analyses"] = [];
  const inconnues = new Set<string>();
  for (const sc of recents) for (const sujet of cfg.sujets) {
    if (!rattacher(sc.texte, sujet, true).ok) continue;
    const a = analyserScrutin(sc, sujet, cfg, moyennes);
    a.groupes.forEach((g) => { if (!cfg.groupes[g.organeRef]) inconnues.add(g.organeRef); });
    analyses.push({ sujet, analyse: a });
  }
  await store.ecrireEtat(cle, dl.validateurs);
  return { analyses, refsInconnues: [...inconnues], inchange: false };
}

/* ---------- agenda ---------- */

export interface Reunion { uid: string; debut: string; lieu: string; type: "seance" | "commission" | "autre"; objet: string; etat: string }

export function extraireReunion(json: any): Reunion | null {
  const r = json?.reunion;
  if (!r?.uid || !r?.timeStampDebut) return null;
  const uid = String(r.uid);
  const xsi = String(r["@xsi:type"] ?? r["xsi:type"] ?? "");
  const type = /seance/i.test(xsi) || /IDS\d/.test(uid) ? "seance" : /commission/i.test(xsi) || /IDC\d/.test(uid) ? "commission" : "autre";
  // Séances : les intitulés sont dans pointsODJ (on ignore les points supprimés) ; sinon convocation ou résumé.
  const points = liste(r.ODJ?.pointsODJ?.pointODJ)
    .filter((p: any) => !/suppr|annul/i.test(String(p?.cycleDeVie?.etat ?? "")))
    .map((p: any) => String(p?.objet ?? "").trim()).filter(Boolean);
  const objet = [...new Set(points.length ? points : chaines([r.ODJ?.convocationODJ, r.ODJ?.resumeODJ]))].join(" | ");
  return {
    uid, debut: new Date(String(r.timeStampDebut)).toISOString(),
    lieu: String(r.lieu?.libelleLong ?? r.lieu?.libelleCourt ?? ""),
    type, objet, etat: String(r.cycleDeVie?.etat ?? ""),
  };
}

const BUDGET = /projet de loi de finances|financement de la securite sociale|\bplf\b|\bplfss\b/;
export const estBudgetaire = (t: string) => BUDGET.test(normaliser(t));

export interface EvenementAgenda { reunion: Reunion; sujets: Sujet[]; budget: boolean }

export async function collecterAgenda(cfg: Config, store: Store): Promise<EvenementAgenda[] | null> {
  const cle = "an_agenda_validateurs";
  const dl = await telechargerSiModifie(cfg.sources.an_agenda_zip, await store.lireEtat<Validateurs>(cle));
  if (!dl) return null;
  const now = Date.now();
  const horizon = now + cfg.regles.agenda.horizon_jours * 86400_000;
  const evts: EvenementAgenda[] = [];
  for (const j of lireZip(dl.contenu)) {
    const r = extraireReunion(j);
    if (!r || !r.objet) continue;
    const t = +new Date(r.debut);
    if (t < now - 86400_000 || t > horizon) continue;
    const budget = cfg.regles.agenda.exclure_textes_budgetaires && estBudgetaire(r.objet);
    const sujets = budget ? [] : cfg.sujets.filter((s) => rattacher(r.objet, s, true).ok);
    if (budget || sujets.length) evts.push({ reunion: r, sujets, budget });
  }
  await store.ecrireEtat(cle, dl.validateurs);
  return evts;
}
