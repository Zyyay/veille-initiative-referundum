import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

process.env.DRY_RUN = "1";
process.env.CONFIG_DIR = "config";
process.env.SUJETS_FILE = "test/fixtures/sujets.json";

const { loadConfig } = await import("../src/lib/config.js");
const { rattacher, regrouper, normaliser, nettoyerTitre } = await import("../src/lib/text.js");
const { enPlageSilencieuse, parisParts, mediane } = await import("../src/lib/time.js");
const { analyserRss } = await import("../src/sources/gnews.js");
const { calculerRatio } = await import("../src/sources/wikipedia.js");
const { extraireScrutin, analyserScrutin, estDecisif, extraireReunion, estBudgetaire, participationsMoyennes } = await import("../src/sources/an.js");
const { scorerPresse, reference } = await import("../src/scoring.js");
const { publier } = await import("../src/alerts.js");
const { MemoireStore } = await import("../src/lib/store.js");

const cfg = loadConfig();
const sujet = cfg.sujets[0];

describe("texte", () => {
  it("normalise accents et apostrophes", () => expect(normaliser("L'Âge légal")).toBe(" l age legal "));
  it("rattache avec un terme fort", () => expect(rattacher("Débat sur l'âge de départ", sujet).ok).toBe(true));
  it("rattache avec deux termes faibles", () => expect(rattacher("Pension et cotisation en hausse", sujet).ok).toBe(true));
  it("refuse un seul terme faible", () => expect(rattacher("La retraite de Zidane", sujet).ok).toBe(false));
  it("n'accepte pas un mot partiel", () => expect(rattacher("Les pensionnats et cotisations", sujet).ok).toBe(false));
  it("utilise les termes législatifs seulement si demandé", () => {
    expect(rattacher("Projet de loi relatif à l'assurance vieillesse", sujet).ok).toBe(false);
    expect(rattacher("Projet de loi relatif à l'assurance vieillesse", sujet, true).ok).toBe(true);
  });
  it("regroupe les titres proches", () => {
    const g = regrouper(["Retraites : le gouvernement recule sur l'âge de départ", "Le gouvernement recule sur l'âge de départ des retraites", "Budget de la défense en hausse"]);
    expect(g[0]).toBe(g[1]); expect(g[2]).not.toBe(g[0]);
  });
  it("retire le nom du média du titre", () => expect(nettoyerTitre("Titre - Le Monde", "Le Monde")).toBe("Titre"));
});

describe("temps", () => {
  it("plage silencieuse 21h-8h en heure de Paris (hiver)", () => {
    expect(enPlageSilencieuse(new Date("2026-10-26T20:30:00Z"))).toBe(true);  // 21h30 Paris
    expect(enPlageSilencieuse(new Date("2026-10-26T06:59:00Z"))).toBe(true);  // 7h59 Paris
    expect(enPlageSilencieuse(new Date("2026-10-26T07:00:00Z"))).toBe(false); // 8h00 Paris
  });
  it("gère l'heure d'été", () => expect(parisParts(new Date("2026-07-01T06:00:00Z")).h).toBe(8));
  it("médiane", () => { expect(mediane([3, 1, 2])).toBe(2); expect(mediane([1, 2, 3, 4])).toBe(2.5); });
});

describe("Google News", () => {
  const items = analyserRss(readFileSync("test/fixtures/gnews.xml", "utf8"));
  it("lit titre, média et domaine", () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ guid: "AAA", source_nom: "Le Monde", source_domaine: "lemonde.fr" });
    expect(items[0].titre).toBe("Retraites : l'âge de départ au cœur du débat");
  });
});

describe("Wikipédia", () => {
  it("calcule le ratio sur la médiane", () => {
    const serie = Array.from({ length: 29 }, (_, i) => ({ jour: `2026-10-${String(i + 1).padStart(2, "0")}`, vues: i === 28 ? 600 : 200 }));
    expect(calculerRatio(serie, 28)?.ratio).toBe(3);
  });
  it("refuse un historique trop court", () => expect(calculerRatio([{ jour: "x", vues: 1 }], 28)).toBeNull());
});

describe("scrutins", () => {
  const sc = extraireScrutin(JSON.parse(readFileSync("test/fixtures/scrutin.json", "utf8")))!;
  const c = { ...cfg, groupes: { POA: "GA", POB: "GB", POC: "GC" } };
  const s = { ...sujet, positions_declarees: { GB: { position: "pour" as const, source: "https://exemple", date: "2026" } } };
  const a = analyserScrutin(sc, s, c, participationsMoyennes([sc]));
  it("lit le résultat", () => { expect(a.adopte).toBe(true); expect(a.pour).toBe(42); expect(a.solennel).toBe(false); });
  it("calcule les absents", () => {
    expect(a.groupes.find((g) => g.sigle === "GA")!.absents).toBe(57);
    expect(a.groupes.find((g) => g.sigle === "GB")!.absents).toBe(45);
  });
  it("compte les dissidents", () => expect(a.groupes.find((g) => g.sigle === "GA")!.dissidents).toBe(2));
  it("détecte un vote décisif", () => expect(a.groupes.find((g) => g.sigle === "GB")!.decisif).toBe(true));
  it("détecte l'écart avec la position déclarée", () => expect(a.groupes.find((g) => g.sigle === "GB")!.ecart).toBe("vote contre"));
  it("pas de vote décisif pour un groupe majoritairement abstentionniste", () => expect(a.groupes.find((g) => g.sigle === "GC")!.decisif).toBe(false));
  it("règle du vote décisif", () => {
    expect(estDecisif(true, 42, 38, { positionMajoritaire: "contre", absents: 3, abstentions: 1 })).toBe(true);  // 42 contre 42 : rejeté
    expect(estDecisif(true, 42, 38, { positionMajoritaire: "contre", absents: 2, abstentions: 1 })).toBe(false); // 42 contre 41
    expect(estDecisif(false, 30, 40, { positionMajoritaire: "pour", absents: 11, abstentions: 0 })).toBe(true);
  });
  it("lit « rejeté » et « n'a pas adopté »", () => {
    const rej = JSON.parse(readFileSync("test/fixtures/scrutin.json", "utf8"));
    rej.scrutin.sort = { code: "rejeté" };
    expect(analyserScrutin(extraireScrutin(rej)!, s, c, new Map()).adopte).toBe(false);
    rej.scrutin.sort = { libelle: "L'Assemblée nationale n'a pas adopté." };
    expect(analyserScrutin(extraireScrutin(rej)!, s, c, new Map()).adopte).toBe(false);
  });
});

describe("agenda", () => {
  const r = extraireReunion(JSON.parse(readFileSync("test/fixtures/reunion.json", "utf8")))!;
  it("lit la réunion", () => { expect(r.type).toBe("seance"); expect(r.objet).toContain("assurance vieillesse"); });
  it("rattache via les termes législatifs", () => expect(rattacher(r.objet, sujet, true).ok).toBe(true));
  it("regroupe les séances budgétaires par intitulé", async () => {
    const { embedBudget } = await import("../src/messages.js");
    const e = embedBudget([
      { debut: "2026-10-28T13:00:00Z", objet: "PLF 2027" },
      { debut: "2026-10-27T13:00:00Z", objet: "PLF 2027" },
      { debut: "2026-10-29T13:00:00Z", objet: "PLFSS 2027" },
    ]);
    expect(e.title).toContain("(3)");
    expect(e.description!.split("\n")).toHaveLength(2);
    expect(e.description!.indexOf("27/10")).toBeLessThan(e.description!.indexOf("28/10"));
  });
  it("lit les points de l'ordre du jour sans les points supprimés", () => {
    const pt = (objet: string, etat: string) => ({ "@xsi:type": "podjSeanceConfPres_type", uid: "PT1", cycleDeVie: { etat }, objet });
    const brut = { reunion: { uid: "RUANR5L17S2027IDS1", timeStampDebut: "2026-10-27T15:00:00.000+01:00",
      ODJ: { convocationODJ: null, pointsODJ: { pointODJ: [pt("Ancien point", "Supprimé"), pt("Suite de la discussion du projet de loi de finances pour 2027", "Confirmé")] } } } };
    expect(extraireReunion(brut)!.objet).toBe("Suite de la discussion du projet de loi de finances pour 2027");
  });
  it("repère les textes budgétaires", () => {
    expect(estBudgetaire("Projet de loi de finances pour 2027")).toBe(true);
    expect(estBudgetaire("Projet de loi de financement de la sécurité sociale")).toBe(true);
    expect(estBudgetaire("Projet de loi relatif à l'assurance vieillesse")).toBe(false);
  });
});

describe("score presse", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const art = (h: number, dom: string, titre = "Âge de départ : nouveau débat") =>
    ({ sujet_id: sujet.id, guid: `${h}-${dom}-${titre}`, titre, source_nom: dom, source_domaine: dom, lien: "", publie_le: new Date(now.getTime() - h * 3600_000).toISOString() });
  it("référence = médiane des mêmes fenêtres sur 14 jours", () => {
    const hist = Array.from({ length: 14 }, (_, d) => art(24 * (d + 1) + 1, "x.fr"));
    expect(reference(hist, now, 3, 14)).toBe(1);
  });
  it("niveau haute avec 3 médias nationaux et un ratio élevé", () => {
    const arts = [art(1, "lemonde.fr"), art(1, "lefigaro.fr"), art(2, "liberation.fr"), art(2, "lci.fr", "Retraites : le Sénat amende le texte sur les pensions")];
    const sc = scorerPresse(arts, now, cfg, false, new Date("2026-10-01"));
    expect(sc.niveau).toBe("haute"); expect(sc.histoires.length).toBe(2); expect(sc.calibration).toBe(false);
  });
  it("aucun niveau sans hausse", () => expect(scorerPresse([art(1, "blog.fr")], now, cfg, false, null).niveau).toBeNull());
  it("le seul bonus Wikipédia donne un niveau bas", () => expect(scorerPresse([], now, cfg, true, null).niveau).toBe("basse"));
});

describe("garde-fous", () => {
  const emb = [{ title: "t" }];
  it("met en attente pendant la plage silencieuse", async () => {
    const st = new MemoireStore();
    const r = await publier({ cle: "a1", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, new Date("2026-10-26T21:30:00Z"));
    expect(r).toBe("en_attente");
  });
  it("écarte un rappel pendant la plage silencieuse", async () => {
    const st = new MemoireStore();
    expect(await publier({ cle: "r1", sujet, type: "rappel", niveau: "haute", embeds: emb }, cfg, st, new Date("2026-10-26T21:30:00Z"))).toBe("ecartee");
  });
  it("envoie en journée puis applique le délai de 6 h, sauf montée de niveau", async () => {
    const st = new MemoireStore();
    const t = new Date("2026-10-26T10:00:00Z");
    expect(await publier({ cle: "b1", sujet, type: "presse", niveau: "moyenne", embeds: emb }, cfg, st, t)).toBe("envoyee");
    expect(await publier({ cle: "b2", sujet, type: "presse", niveau: "moyenne", embeds: emb }, cfg, st, t)).toBe("ignoree_delai");
    expect(await publier({ cle: "b3", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, t)).toBe("envoyee");
    expect(await publier({ cle: "b3", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, t)).toBe("ignoree_doublon");
  });
  it("les alertes basses partent au récapitulatif", async () => {
    const st = new MemoireStore();
    expect(await publier({ cle: "w1", sujet, type: "wiki", niveau: "basse", embeds: emb }, cfg, st, new Date("2026-10-26T10:00:00Z"))).toBe("en_attente");
  });
});
