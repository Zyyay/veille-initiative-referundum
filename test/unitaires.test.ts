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
const { scorerPresse, scorerNuit, debutNuit, reference, empreinte, memeHistoire, retirerDejaSignalees } = await import("../src/scoring.js");
const { publier } = await import("../src/alerts.js");
const { MemoireStore } = await import("../src/lib/store.js");
const { mentionDiscord, mentionsAutorisees, borner, couper, lots, taille } = await import("../src/lib/discord.js");
const { mediaExclu, poidsMedia } = await import("../src/lib/medias.js");
const { embedPresse, embedNuit, titreCourt, echapper } = await import("../src/messages.js");
const { recuperer, configurerReseau, decrireTelechargement } = await import("../src/lib/http.js");
const { collecterGoogleNews } = await import("../src/sources/gnews.js");

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

const NOW = new Date("2026-10-26T10:00:00Z");
let n = 0;
const art = (h: number, dom: string, titre = "Âge de départ : nouveau débat", now = NOW) =>
  ({ sujet_id: sujet.id, guid: `g${n++}`, titre, source_nom: dom, source_domaine: dom, lien: `https://news.google.com/rss/articles/${"x".repeat(300)}${n}`, publie_le: new Date(now.getTime() - h * 3600_000).toISOString() });
const ilYA = (jours: number, now = NOW) => new Date(now.getTime() - jours * 86400_000);
const NATIONAUX = ["lemonde.fr", "lefigaro.fr", "liberation.fr", "lci.fr", "francetvinfo.fr"];

describe("score presse (P1 : normale)", () => {
  const now = NOW;
  it("référence = médiane des mêmes fenêtres sur 14 jours quand tout l'historique existe", () => {
    const hist = Array.from({ length: 14 }, (_, d) => art(24 * (d + 1) + 1, "x.fr"));
    expect(reference(hist, now, 3, 14, ilYA(20))).toEqual({ valeur: 1, jours: 14 });
  });
  it("3 jours d'historique à 5 articles par fenêtre, fenêtre courante à 10 : ×2 et non ×10", () => {
    const hist = [1, 2, 3].flatMap((d) => Array.from({ length: 5 }, (_, i) => art(24 * d + 1, `media${i}.fr`)));
    const courants = Array.from({ length: 10 }, (_, i) => art(1, `media${i}.fr`));
    const sc = scorerPresse([...hist, ...courants], now, cfg, false, ilYA(3.5));
    expect(sc.joursReference).toBe(3);
    expect(sc.reference).toBe(5);
    expect(sc.ratio).toBe(2);
    expect(sc.calibration).toBe(true); // moins de 7 jours : « référence peu fiable »
  });
  it("les jours d'avant la mise en service ne comptent pas comme des zéros", () => {
    // 6 jours d'historique à 4 articles : l'ancien calcul donnait une médiane de 0 sur 14 jours, donc ×N.
    const hist = [1, 2, 3, 4, 5, 6].flatMap((d) => Array.from({ length: 4 }, (_, i) => art(24 * d + 1, `m${i}.fr`)));
    const sc = scorerPresse([...hist, ...Array.from({ length: 4 }, (_, i) => art(1, `m${i}.fr`))], now, cfg, false, ilYA(6.5));
    expect(sc.reference).toBe(4); expect(sc.ratio).toBe(1); expect(sc.calibration).toBe(true);
  });
  it("aucun jour d'historique : pas de normale, donc pas d'alerte sur le ratio", () => {
    const arts = NATIONAUX.map((d) => art(1, d)).concat(art(1, "lemonde.fr", "Retraites : le Sénat amende le texte sur les pensions"));
    const sc = scorerPresse(arts, now, cfg, false, null);
    expect(sc.reference).toBeNull(); expect(sc.ratio).toBeNull(); expect(sc.niveau).toBeNull();
  });
  it("aucun jour d'historique : plancher utilisé si reference_sans_historique est renseigné", () => {
    const c = { ...cfg, regles: { ...cfg.regles, presse: { ...cfg.regles.presse, reference_sans_historique: 2 } } };
    expect(scorerPresse(Array.from({ length: 6 }, (_, i) => art(1, `m${i}.fr`)), now, c, false, null).ratio).toBe(3);
  });
  it("niveau haute : 5 médias pondérés dont 2 nationaux et un ratio élevé", () => {
    const arts = [...NATIONAUX.map((d) => art(1, d)), art(2, "lci.fr", "Retraites : le Sénat amende le texte sur les pensions")];
    const sc = scorerPresse(arts, now, cfg, false, ilYA(25));
    expect(sc.niveau).toBe("haute"); expect(sc.histoires.length).toBe(2); expect(sc.calibration).toBe(false);
  });
  it("pas de haute sans 2 médias nationaux, même avec 5 médias pondérés", () => {
    const arts = [...Array.from({ length: 10 }, (_, i) => art(1, `regional${i}.fr`)), art(2, "regional0.fr", "Retraites : le Sénat amende le texte sur les pensions")];
    const sc = scorerPresse(arts, now, cfg, false, ilYA(25));
    expect(sc.medias).toBe(5); expect(sc.mediasNationaux).toBe(0); expect(sc.niveau).toBe("moyenne");
  });
  it("moyenne exige 2 médias pondérés", () => {
    const arts = [art(1, "blog.fr"), art(1, "blog.fr"), art(2, "blog.fr", "Retraites : le Sénat amende le texte sur les pensions")];
    expect(scorerPresse(arts, now, cfg, false, ilYA(25)).niveau).toBeNull();
  });
  it("aucun niveau sans hausse", () => expect(scorerPresse([art(1, "blog.fr")], now, cfg, false, null).niveau).toBeNull());
  it("le seul bonus Wikipédia donne un niveau bas", () => expect(scorerPresse([], now, cfg, true, null).niveau).toBe("basse"));
});

describe("mention Discord (P2.1)", () => {
  it("un identifiant brut devient une mention d'utilisateur", () => {
    expect(mentionDiscord("1494752847747612804")).toBe("<@1494752847747612804>");
    expect(mentionsAutorisees(mentionDiscord(" 1494752847747612804 "))).toEqual({ users: ["1494752847747612804"] });
  });
  it("les autres formes sont conservées", () => {
    expect(mentionDiscord("<@&123>")).toBe("<@&123>");
    expect(mentionDiscord("@everyone")).toBe("@everyone");
    expect(mentionsAutorisees("<@&123>")).toEqual({ roles: ["123"] });
  });
});

describe("médias (P3.1)", () => {
  it("exclut les médias étrangers, garde l'Outre-mer et les nationaux", () => {
    for (const d of ["letemps.ch", "blick.ch", "lesoir.be", "tvanouvelles.ca", "lemauricien.com", "informat.ro", "webmanagercenter.com"])
      expect(mediaExclu(d, cfg.medias), d).toBe(true);
    for (const d of ["lemonde.fr", "la1ere.francetvinfo.fr", "clicanoo.re", "rci.fm", "tntv.pf", "lesnouvellescaledoniennes.nc", "ladepeche.fr", ""])
      expect(mediaExclu(d, cfg.medias), d).toBe(false);
  });
  it("les articles de médias étrangers ne comptent pas dans le score", () => {
    const sc = scorerPresse([art(1, "letemps.ch"), art(1, "lesoir.be"), art(1, "lemonde.fr")], NOW, cfg, false, ilYA(25));
    expect(sc.articlesFenetre).toBe(1); expect(sc.medias).toBe(1);
  });
  it("liste blanche : les médias hors liste comptent 0", () => {
    const m = { ...cfg.medias, liste_blanche_active: true };
    expect(poidsMedia("lemonde.fr", m)).toBe(1);
    expect(poidsMedia("ladepeche.fr", m)).toBe(0.5);
    expect(poidsMedia("blog-inconnu.fr", m)).toBe(0);
    expect(poidsMedia("blog-inconnu.fr", cfg.medias)).toBe(0.5);
  });
});

describe("histoires déjà signalées (P3.2)", () => {
  const T1 = "Le yacht Dreamer arraisonné avec deux tonnes de cocaïne";
  const T2 = "Deux tonnes de cocaïne : l'équipage du yacht Dreamer arraisonné en garde à vue";
  const alerte = () => {
    const sc = scorerPresse([...NATIONAUX.map((d) => art(1, d, T1)), art(1, "blog.fr", "Un autre sujet sans rapport aucun")], NOW, cfg, false, ilYA(25));
    return { sc, emp: sc.histoires.map((h) => empreinte(h, sujet, sc.niveau!, "presse:x", NOW, cfg)) };
  };
  const plusTard = new Date(NOW.getTime() + 20 * 3600_000);
  it("une même histoire reprise par d'autres articles ne redéclenche pas d'alerte", () => {
    const { emp } = alerte();
    const sc2 = scorerPresse(["lemonde.fr", "lefigaro.fr", "liberation.fr", "lci.fr", "francetvinfo.fr"].map((d) => art(1, d, T2, plusTard)), plusTard, cfg, false, ilYA(25));
    const { score, retirees } = retirerDejaSignalees(sc2, emp, sujet, cfg);
    expect(retirees).toHaveLength(1); expect(score.niveau).toBeNull();
  });
  it("articles en commun : même histoire", () => {
    const { sc, emp } = alerte();
    expect(memeHistoire(sc.histoires[0], emp[0], sujet, cfg)).toBe(true);
  });
  it("une autre histoire n'est pas écartée", () => {
    const { emp } = alerte();
    const h = scorerPresse([art(1, "lemonde.fr", "Marseille : un point de deal démantelé dans les quartiers nord"), art(1, "lefigaro.fr", "Marseille : un point de deal démantelé, cinq interpellations")], NOW, cfg, false, ilYA(25)).histoires[0];
    expect(emp.some((e) => memeHistoire(h, e, sujet, cfg))).toBe(false);
  });
  it("redéclenche si les médias de l'histoire ont doublé", () => {
    const emp = [{ ...alerte().emp[0], medias: 2 }];
    const sc2 = scorerPresse(NATIONAUX.map((d) => art(1, d, T2, plusTard)), plusTard, cfg, false, ilYA(25));
    expect(retirerDejaSignalees(sc2, emp, sujet, cfg).retirees).toHaveLength(0);
  });
  it("redéclenche si le niveau monte (orange puis rouge)", () => {
    const emp = alerte().emp.map((e) => ({ ...e, niveau: "moyenne" }));
    const sc2 = scorerPresse(NATIONAUX.map((d) => art(1, d, T2, plusTard)), plusTard, cfg, false, ilYA(25));
    expect(sc2.niveau).toBe("haute");
    expect(retirerDejaSignalees(sc2, emp, sujet, cfg).retirees).toHaveLength(0);
  });
  it("les empreintes sont stockées puis relues", async () => {
    const st = new MemoireStore();
    await st.enregistrerHistoires(alerte().emp);
    expect(await st.histoiresDepuis(sujet.id, ilYA(1))).toHaveLength(2);
    expect(await st.histoiresDepuis("autre", ilYA(1))).toHaveLength(0);
  });
});

describe("orange puis rouge (P3.3)", () => {
  const emb = [{ title: "t" }];
  const t = new Date("2026-10-26T10:00:00Z");
  const h = (x: number) => new Date(t.getTime() + x * 3600_000);
  it("le rouge part sans mention moins de 2 h après un orange", async () => {
    const st = new MemoireStore();
    expect(await publier({ cle: "o", sujet, type: "presse", niveau: "moyenne", embeds: emb }, cfg, st, t)).toBe("envoyee");
    expect(await publier({ cle: "r", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, h(1))).toBe("envoyee");
    expect((await st.derniereAlerte(sujet.id, "presse"))!.mention).toBe(false);
  });
  it("le message orange est modifié quand son identifiant est connu", async () => {
    const st = new MemoireStore();
    await st.enregistrerAlerte({ cle: "o", sujet_id: sujet.id, type: "presse", niveau: "moyenne", mention: false, statut: "envoyee", cree_le: t.toISOString(), payload: { discord_message_id: "42" } });
    expect(await publier({ cle: "r", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, h(1))).toBe("modifiee");
    const r = (await st.derniereAlerte(sujet.id, "presse"))!;
    expect(r.mention).toBe(false); expect(r.payload.discord_message_id).toBe("42");
  });
  it("au-delà de 2 h, le rouge garde sa mention", async () => {
    const st = new MemoireStore();
    await publier({ cle: "o", sujet, type: "presse", niveau: "moyenne", embeds: emb }, cfg, st, t);
    await publier({ cle: "r", sujet, type: "presse", niveau: "haute", embeds: emb }, cfg, st, h(3));
    expect((await st.derniereAlerte(sujet.id, "presse"))!.mention).toBe(true);
  });
});

describe("affichage Discord (P4)", () => {
  const titreLong = "Retraites : le Sénat amende le texte sur les pensions et l'âge de départ après une longue nuit de débats houleux";
  const arts = [
    ...NATIONAUX.map((d, i) => art(2 + i * 0.1, d)),              // grosse histoire, plus ancienne
    art(0.5, "lexpress.fr", titreLong),                              // petite histoire, la plus récente
    ...Array.from({ length: 30 }, (_, i) => art(1, `m${i}.fr`, `${titreLong} ${i} [brut] *gras*`)),
  ];
  const sc = scorerPresse(arts, NOW, cfg, false, ilYA(25));
  const e = embedPresse(sujet, sc, cfg);
  const sources = e.fields!.find((f) => f.name === "Sources")!.value;
  it("« Ce qui se passe » et la première source viennent de la même histoire", () => {
    const h = sc.histoires[0];
    expect(e.description).toContain(h.titre);
    expect(sources.split("\n")[0]).toContain(h.articles[0].source_nom);
    expect(h.articles.map((a) => a.guid)).toContain(arts.find((a) => sources.split("\n")[0].includes(a.source_nom))!.guid);
  });
  it("un seul lien : celui de l'histoire principale, dans la description", () => {
    expect(sources).not.toContain("](");
    expect(e.description!.match(/\]\(/g)).toHaveLength(1);
    expect(e.description).toContain(sc.histoires[0].lien);
  });
  it("aucun champ ne dépasse les limites Discord", () => {
    const b = borner(e);
    for (const f of b.fields!) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(sources.length).toBeLessThanOrEqual(1024);
    expect(taille(b)).toBeLessThanOrEqual(6000);
  });
  it("les titres sont tronqués sur un mot et le Markdown neutralisé", () => {
    expect(titreCourt(titreLong, 40)).toBe("Retraites : le Sénat amende le texte…");
    expect(echapper("[brut] *gras*")).toBe("\\[brut\\] \\*gras\\*");
  });
  it("le compte des sources non affichées est exact", () => {
    const total = sc.histoires.reduce((t, h) => t + h.articles.length, 0);
    const affichees = sources.split("\n").filter((l) => l.startsWith("• ")).length;
    expect(affichees).toBeLessThanOrEqual(cfg.regles.presse.sources_max_affichees);
    expect(sources.split("\n").at(-1)).toBe(`… et ${total - affichees} autre(s)`);
  });
  it("la troncature ne coupe jamais un lien Markdown", () => {
    const lien = `[Le Monde](https://news.google.com/rss/articles/${"a".repeat(300)})`;
    const coupe = couper(`${"x".repeat(900)} ${lien}`, 1024);
    expect(coupe.length).toBeLessThanOrEqual(1024);
    expect(coupe).not.toContain("[Le Monde](");
    const lignes = couper(Array.from({ length: 10 }, () => lien).join("\n"), 1024);
    expect(lignes.split("\n").every((l) => l === lien || l === "…" || l.endsWith(")…"))).toBe(true);
    expect(couper("```\n" + "ligne\n".repeat(300) + "```", 1024).endsWith("```")).toBe(true);
  });
  it("les messages sont découpés à 6000 caractères et 10 embeds", () => {
    const gros = { title: "x", description: "y".repeat(4000) };
    expect(lots([gros, gros, gros]).length).toBe(3);
    expect(lots(Array.from({ length: 12 }, () => ({ title: "x" }))).map((l) => l.length)).toEqual([10, 2]);
  });
});

describe("réseau (P5)", () => {
  const vrai = globalThis.fetch;
  const reglages = cfg.regles.reseau;
  const rapide = { ...reglages, backoff_ms: 1, timeout_ms: 50, gnews_delai_ms: 60 };
  const fin = () => { globalThis.fetch = vrai; configurerReseau(reglages); };
  it("relance sur HTTP 503 avec 2 relances", async () => {
    configurerReseau(rapide);
    let appels = 0;
    globalThis.fetch = (async () => (++appels < 3 ? new Response("", { status: 503 }) : new Response("ok"))) as typeof fetch;
    try { const r = await recuperer("https://exemple.test/"); expect(r.texte()).toBe("ok"); expect(r.tentatives).toBe(3); }
    finally { fin(); }
  });
  it("relance quand le téléchargement est coupé en cours de route (« terminated »)", async () => {
    configurerReseau(rapide);
    let appels = 0;
    globalThis.fetch = (async () => ++appels === 1
      ? new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.error(new TypeError("terminated")); } }))
      : new Response("complet")) as typeof fetch;
    try { expect((await recuperer("https://exemple.test/")).texte()).toBe("complet"); expect(appels).toBe(2); }
    finally { fin(); }
  });
  it("abandonne après le délai, en indiquant le nombre de tentatives", async () => {
    configurerReseau(rapide);
    globalThis.fetch = ((_: unknown, init?: RequestInit) => new Promise((_r, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)))) as typeof fetch;
    try { await expect(recuperer("https://exemple.test/")).rejects.toThrow(/délai.*3 tentative/); }
    finally { fin(); }
  });
  it("espace les requêtes Google News", async () => {
    configurerReseau(rapide);
    const heures: number[] = [];
    globalThis.fetch = (async () => { heures.push(Date.now()); return new Response("<rss><channel></channel></rss>"); }) as typeof fetch;
    const c = { ...cfg, regles: { ...cfg.regles, reseau: rapide } };
    try { await collecterGoogleNews(c, () => {}); }
    finally { fin(); }
    expect(heures.length).toBe(2);
    expect(heures[1] - heures[0]).toBeGreaterThanOrEqual(55);
  });
  it("décrit taille et durée d'un téléchargement", () => {
    expect(decrireTelechargement({ contenu: Buffer.alloc(0), octets: 12_300_000, dureeMs: 8200, tentatives: 1 })).toBe("12,3 Mo en 8,2 s (1 tentative)");
    expect(decrireTelechargement({ contenu: null, octets: 0, dureeMs: 300, tentatives: 1 })).toContain("inchangé (304)");
  });
});

describe("presse de la nuit (P6)", () => {
  const matin = new Date("2026-10-27T07:05:00Z"); // 8 h 05 à Paris
  it("la nuit commence la veille à 21 h (Paris)", () => expect(debutNuit(matin, cfg).toISOString()).toBe("2026-10-26T20:00:00.000Z"));
  it("compare la nuit à la même plage horaire des nuits précédentes", () => {
    const nuitH = (d: number) => (matin.getTime() - new Date("2026-10-26T23:00:00Z").getTime()) / 3600_000 + 24 * d;
    const hist = [1, 2, 3].flatMap((d) => [art(nuitH(d), "lemonde.fr", undefined, matin), art(nuitH(d), "lefigaro.fr", undefined, matin)]);
    const nuit = [...NATIONAUX, "lexpress.fr"].map((d) => art(nuitH(0), d, undefined, matin));
    const veille = art(12, "lemonde.fr", undefined, matin); // 20 h 05 la veille : hors de la nuit
    const sc = scorerNuit([...hist, ...nuit, veille], matin, cfg, ilYA(3.9, matin));
    expect(sc.articlesFenetre).toBe(6);
    expect(sc.reference).toBe(2); expect(sc.ratio).toBe(3); expect(sc.joursReference).toBe(3);
    const e = embedNuit([{ sujet, sc }], debutNuit(matin, cfg), matin, cfg);
    expect(e.title).toContain("21:00"); expect(e.description).toContain("×3");
  });
  it("une nuit sans article est dite explicitement", () => {
    const sc = scorerNuit([], matin, cfg, ilYA(10, matin));
    expect(embedNuit([{ sujet, sc }], debutNuit(matin, cfg), matin, cfg).description).toContain("Aucun article");
  });
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
