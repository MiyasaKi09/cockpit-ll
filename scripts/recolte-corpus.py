# ============================================================
# Récolte du corpus réglementaire de l'assistant — outil de dev.
#
# Produit public/corpus/*.json (packs) + index.json (catalogue)
# à partir de DEUX sources officielles, toutes deux issues des
# données DILA / Légifrance sous Licence Ouverte :
#
#   1. codes.droit.org — XML consolidés quotidiennement depuis
#      l'API Légifrance (uniquement le droit en VIGUEUR) ;
#   2. le dump open-data LEGI de la DILA
#      (echanges.dila.gouv.fr/OPENDATA/LEGI) pour les textes non
#      codifiés : arrêtés sécurité incendie ERP, accessibilité…
#
# ⛔ LIGNE ROUGE : jamais de DTU, normes NF, Eurocodes ou documents
#    CSTB — textes protégés (AFNOR/CSTB), hors Licence Ouverte.
#
# Usage :
#   python3 scripts/recolte-corpus.py --codes DOSSIER_XML \
#           [--dump DOSSIER_LEGI_EXTRAIT] [--sortie public/corpus]
#
# Chaque document émis porte sa source exacte et sa date de
# consolidation — l'assistant cite toujours les deux.
# ============================================================

import argparse
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

MAX_CARACTERES_DOC = 110_000  # marge sous la limite serverless (120k)

# ------------------------------------------------------------------
# 1) Extraction depuis les XML codes.droit.org
# ------------------------------------------------------------------

def charger_code(dossier, nom):
    chemin = os.path.join(dossier, f"{nom}.xml")
    racine = ET.parse(chemin).getroot()
    return racine, racine.get("lastup", "?")


def texte_article(article):
    """texte intégral d'un article (les commentaires XML sont ignorés par ET)"""
    morceaux = [t for t in article.itertext()]
    texte = "".join(morceaux)
    texte = html.unescape(texte)
    texte = re.sub(r"[ \t]+", " ", texte)
    texte = re.sub(r"\n{3,}", "\n\n", texte)
    return texte.strip()


def extraire(racine, inclure, exclure=None):
    """parcourt l'arbre ; rend [(chemin, [(num, texte), …]), …] pour les
    sections dont le chemin complet matche `inclure` (et pas `exclure`)."""
    resultats = []

    def marche(el, chemin, dans_zone):
        for t in el.findall("t"):
            titre = (t.get("title") or "").strip()
            nouveau = chemin + [titre]
            texte_chemin = " > ".join(nouveau)
            if exclure and re.search(exclure, texte_chemin, re.I):
                continue
            zone = dans_zone or bool(re.search(inclure, texte_chemin, re.I))
            articles = [
                (a.get("num") or "?", texte_article(a))
                for a in t.findall("article")
                if (a.get("etat") or "VIGUEUR").startswith("VIGUEUR")
            ]
            if zone and articles:
                resultats.append((nouveau, articles))
            marche(t, nouveau, zone)

    marche(racine, [], False)
    return resultats


def rendre(sections):
    """rend le texte lisible : titres de section puis « Article N : … »"""
    lignes = []
    for chemin, articles in sections:
        lignes.append("\n## " + " — ".join(chemin[-3:]))
        for num, texte in articles:
            lignes.append(f"\nArticle {num}\n{texte}")
    return "\n".join(lignes).strip()


def decouper(titre, texte):
    """coupe un texte trop long en parties (aux frontières de sections) ;
    chaque partie est titrée par sa première section pour rester repérable"""
    if len(texte) <= MAX_CARACTERES_DOC:
        return [(titre, texte)]
    blocs = texte.split("\n## ")
    parties, courant = [], ""
    for i, bloc in enumerate(blocs):
        morceau = bloc if i == 0 else "\n## " + bloc
        if courant and len(courant) + len(morceau) > MAX_CARACTERES_DOC:
            parties.append(courant)
            courant = morceau.lstrip("\n")
        else:
            courant += morceau
    if courant:
        parties.append(courant)
    n = len(parties)

    def etiquette(part):
        m = re.search(r"## ([^\n]+)", part)
        if not m:
            return ""
        e = re.sub(r"\s+", " ", m.group(1)).strip(" .")
        return f" · {e[:52]}" if e else ""

    return [(f"{titre} — {i + 1}/{n}{etiquette(p)}", p) for i, p in enumerate(parties)]


# ------------------------------------------------------------------
# 2) Extraction depuis le dump LEGI de la DILA (textes non codifiés)
# ------------------------------------------------------------------

def lire_xml(chemin):
    try:
        return ET.parse(chemin).getroot()
    except ET.ParseError:
        return None


def texte_depuis_dump(dossier_texte):
    """reconstruit un texte consolidé depuis son dossier LEGITEXT… du dump :
    lit texte/struct pour l'ordre, texte/version pour le titre, article/ pour
    les contenus. Rend (titre_officiel, texte)."""
    # titre officiel
    titre_officiel = None
    dossier_version = os.path.join(dossier_texte, "texte", "version")
    if os.path.isdir(dossier_version):
        for f in os.listdir(dossier_version):
            r = lire_xml(os.path.join(dossier_version, f))
            if r is not None:
                el = r.find(".//TITREFULL")
                if el is not None and el.text:
                    titre_officiel = el.text.strip()
                break

    # index des articles par id
    articles = {}
    for base, _dirs, fichiers in os.walk(dossier_texte):
        if os.sep + "article" + os.sep not in base + os.sep:
            continue
        for f in fichiers:
            if not f.endswith(".xml"):
                continue
            r = lire_xml(os.path.join(base, f))
            if r is None:
                continue
            ident = r.findtext(".//META_COMMUN/ID", "")
            etat = r.findtext(".//ETAT", "VIGUEUR")
            num = r.findtext(".//NUM", "?")
            bloc = r.find(".//BLOC_TEXTUEL/CONTENU")
            if bloc is None:
                continue
            texte = "".join(bloc.itertext())
            texte = re.sub(r"[ \t]+", " ", texte)
            texte = re.sub(r"\n{3,}", "\n\n", texte).strip()
            articles[ident] = (num, etat, texte)

    # sections (section_ta) indexées par id : (titre TITRE_TA, corps STRUCTURE_TA)
    section_ta = {}
    for base, _dirs, fichiers in os.walk(dossier_texte):
        if os.sep + "section_ta" + os.sep not in base + os.sep:
            continue
        for f in fichiers:
            if not f.endswith(".xml"):
                continue
            r = lire_xml(os.path.join(base, f))
            if r is None:
                continue
            ident = r.findtext("ID", "") or r.findtext(".//ID", "")
            titre_ta = (r.findtext("TITRE_TA", "") or "").strip()
            corps = r.find(".//STRUCTURE_TA")
            if ident and corps is not None:
                section_ta[ident] = (titre_ta, corps)

    # structure ordonnée : seuls les liens à l'état VIGUEUR sont rendus
    # (la structure liste TOUTES les versions de chaque article)
    lignes = []
    vus = set()

    def marche_struct(struct_el, prof):
        for enfant in struct_el:
            if enfant.tag == "LIEN_ART":
                ident = enfant.get("id", "")
                if enfant.get("etat", "") != "VIGUEUR" or ident in vus:
                    continue
                if ident in articles:
                    num, etat, texte = articles[ident]
                    if etat.startswith("VIGUEUR"):
                        vus.add(ident)
                        lignes.append(f"\nArticle {num}\n{texte}" if num and num != "?" else f"\n{texte}")
            elif enfant.tag == "LIEN_SECTION_TA":
                if enfant.get("etat", "VIGUEUR") not in ("", "VIGUEUR"):
                    continue
                ident = enfant.get("id", "")
                entree = section_ta.get(ident)
                if entree is None:
                    continue
                titre_ta, corps = entree
                if titre_ta:
                    lignes.append("\n## " + titre_ta)
                marche_struct(corps, prof + 1)

    dossier_struct = os.path.join(dossier_texte, "texte", "struct")
    if os.path.isdir(dossier_struct):
        for f in os.listdir(dossier_struct):
            r = lire_xml(os.path.join(dossier_struct, f))
            if r is not None:
                corps = r.find(".//STRUCT")
                if corps is not None:
                    marche_struct(corps, 0)
            break

    if not lignes:  # texte plat sans structure : articles triés par numéro
        def cle(num):
            m = re.findall(r"\d+", num or "")
            return [int(x) for x in m] or [0]
        for num, etat, texte in sorted(articles.values(), key=lambda a: cle(a[0])):
            if etat.startswith("VIGUEUR"):
                lignes.append(f"\nArticle {num}\n{texte}")

    return titre_officiel, "\n".join(lignes).strip()


# ------------------------------------------------------------------
# 3) Définition des packs
# ------------------------------------------------------------------

def docs_code(dossier, nom_code, legitext, cibles):
    """cibles = [(slug, titre_doc, inclure, exclure), …]"""
    racine, lastup = charger_code(dossier, nom_code)
    source = f"{nom_code} — Légifrance (données DILA, Licence Ouverte), version consolidée au {lastup}"
    url = f"https://www.legifrance.gouv.fr/codes/id/{legitext}/"
    docs = []
    for slug, titre_doc, inclure, exclure in cibles:
        sections = extraire(racine, inclure, exclure)
        texte = rendre(sections)
        if not texte:
            print(f"  ⚠ AUCUN article pour {slug} ({nom_code})", file=sys.stderr)
            continue
        parties = decouper(titre_doc, texte)
        for i, (t, part) in enumerate(parties):
            suffixe = "" if len(parties) == 1 else f"-{i + 1}"
            docs.append({
                "id": f"lf-{slug}{suffixe}",
                "titre": t,
                "type": "reglementaire",
                "source": source,
                "url": url,
                "texte": part,
            })
    return docs, lastup


def construire_packs_codes(dossier):
    packs = []

    # --- Marchés publics : exécution financière + MOE ---
    docs, v = docs_code(dossier, "Code de la commande publique", "LEGITEXT000037701019", [
        ("ccp-execution-l", "CCP (législatif) — Exécution du marché : paiement, avances, retenue de garantie, sous-traitance",
         r"Partie législative > DEUXIÈME PARTIE : MARCHÉS PUBLICS > Livre Ier .* > Titre IX",
         r"Livre III|CONCESSIONS"),
        ("ccp-execution-r", "CCP (réglementaire) — Exécution du marché : délais de paiement, avances, RG, sous-traitance",
         r"Partie réglementaire > DEUXIÈME PARTIE : MARCHÉS PUBLICS > Livre Ier .* > Titre IX",
         r"Livre III|CONCESSIONS"),
        ("ccp-moe", "CCP — Maîtrise d'ouvrage publique et maîtrise d'œuvre privée (livre IV)",
         r"DEUXIÈME PARTIE : MARCHÉS PUBLICS > Livre IV",
         r"Livre III|CONCESSIONS"),
    ])
    packs.append({
        "id": "marches-publics",
        "theme": "Marchés publics",
        "titre": "Marchés publics — exécution & maîtrise d'œuvre",
        "description": "Code de la commande publique : délais de paiement, avances et acomptes, retenue de garantie, sous-traitance, et le livre MOA/MOE (loi MOP codifiée, concours, rémunération).",
        "version": v,
        "docs": docs,
    })

    # --- Sécurité incendie (partie CCH) ---
    docs, v = docs_code(dossier, "Code de la construction et de l'habitation", "LEGITEXT000006074096", [
        ("cch-incendie-l", "CCH (législatif) — Sécurité incendie : objectifs, ERP neufs et existants",
         r"Partie législative > Livre Ier .* > Titre IV : Sécurité des personnes contre les risques d'incendie", None),
        ("cch-incendie-r", "CCH (réglementaire) — Sécurité incendie : classement ERP, contrôles, travaux",
         r"Partie réglementaire.* > Livre Ier .* > Titre IV : SÉCURITÉ DES PERSONNES CONTRE LES RISQUES D'INCENDIE", None),
    ])
    packs.append({
        "id": "incendie-cch",
        "theme": "Sécurité incendie",
        "titre": "Sécurité incendie — socle CCH (classement ERP)",
        "description": "Code de la construction et de l'habitation : objectifs de sécurité, classement des ERP en types et catégories, autorisations de travaux, commissions de sécurité, ERP existants.",
        "version": v,
        "docs": docs,
    })

    # --- Accessibilité (partie CCH) ---
    docs, v = docs_code(dossier, "Code de la construction et de l'habitation", "LEGITEXT000006074096", [
        ("cch-access-l", "CCH (législatif) — Accessibilité : règles générales, Ad'AP",
         r"Partie législative > Livre Ier .* > Titre VI : Accessibilité", None),
        ("cch-access-r", "CCH (réglementaire) — Accessibilité et qualité d'usage : ERP, logements, attestations",
         r"Partie réglementaire.* > Livre Ier .* > Titre VI : ACCESSIBILITÉ ET QUALITÉ D'USAGE", None),
    ])
    packs.append({
        "id": "accessibilite-cch",
        "theme": "Accessibilité PMR",
        "titre": "Accessibilité handicap — socle CCH",
        "description": "Code de la construction et de l'habitation : obligations d'accessibilité des ERP et des logements, dérogations, attestations, agendas d'accessibilité programmée.",
        "version": v,
        "docs": docs,
    })

    # --- Garanties & assurance construction ---
    docs_cc, v_cc = docs_code(dossier, "code-civil", "LEGITEXT000006070721", [
        ("cciv-louage", "Code civil — Contrat d'entreprise, réception, garanties des constructeurs (art. 1779, 1787 à 1799-1, 1792 s.)",
         r"Du louage d'ouvrage et d'industrie", None),
    ])
    docs_ass, v_ass = docs_code(dossier, "Code des assurances", "LEGITEXT000006073984", [
        ("cass-decennale", "Code des assurances — Obligation d'assurance travaux : décennale et dommages-ouvrage (L241 à L243)",
         r"Titre IV : L'assurance des travaux de construction", r"Partie réglementaire|Annexes"),
    ])
    packs.append({
        "id": "garanties-construction",
        "theme": "Garanties & assurances",
        "titre": "Garanties & assurances construction",
        "description": "Code civil (contrat d'entreprise, réception, garanties biennale et décennale des constructeurs) et Code des assurances (obligations décennale et dommages-ouvrage).",
        "version": max(v_cc, v_ass),
        "docs": docs_cc + docs_ass,
    })

    # --- Urbanisme : autorisations ---
    docs, v = docs_code(dossier, "Code de l'urbanisme", "LEGITEXT000006074075", [
        ("curb-champ", "Code de l'urbanisme — Champ d'application : PC, permis d'aménager, déclaration préalable (R*421)",
         r"Partie réglementaire.*Titre II : Dispositions communes.*Chapitre Ier : Champ d'application", None),
        ("curb-dossier", "Code de l'urbanisme — Instruction des demandes (R*423) et dossier de permis de construire (R*431)",
         r"Décrets en Conseil d'Etat > Livre IV.*(Chapitre III : Dépôt et instruction|Titre III : Dispositions propres aux constructions)", None),
    ])
    packs.append({
        "id": "urbanisme-autorisations",
        "theme": "Urbanisme",
        "titre": "Urbanisme — autorisations (PC / DP)",
        "description": "Code de l'urbanisme : champ d'application des permis et déclarations préalables, composition du dossier de PC, délais d'instruction, recours obligatoire à l'architecte.",
        "version": v,
        "docs": docs,
    })

    CCH = "LEGITEXT000006074096"

    # --- Acoustique (partie CCH) ---
    docs, v = docs_code(dossier, "Code de la construction et de l'habitation", CCH, [
        ("cch-acoustique", "CCH — Acoustique des bâtiments (isolement, bruits, attestation)",
         r"Livre Ier .* > Titre V : (Qualité sanitaire|QUALITÉ SANITAIRE) > Chapitre IV : (Acou|AC)", None),
    ])
    packs.append({
        "id": "acoustique-cch",
        "theme": "Acoustique",
        "titre": "Acoustique du bâtiment — socle CCH",
        "description": "Code de la construction et de l'habitation : exigences d'isolement acoustique, protection contre les bruits, attestation de prise en compte de la réglementation acoustique.",
        "version": v,
        "docs": docs,
    })

    # --- Ascenseurs (partie CCH) ---
    docs, v = docs_code(dossier, "Code de la construction et de l'habitation", CCH, [
        ("cch-ascenseurs", "CCH — Ascenseurs : sécurité, entretien, contrôle technique",
         r"Livre Ier .* > Titre III : (Règles générales de sécurité|RÈGLES GÉNÉRALES DE SÉCURITÉ) > Chapitre [IV]+ : .*scenseur", None),
    ])
    packs.append({
        "id": "ascenseurs-cch",
        "theme": "Ascenseurs",
        "titre": "Ascenseurs — socle CCH",
        "description": "Code de la construction et de l'habitation : obligations de sécurité des ascenseurs, entretien, contrôle technique quinquennal, travaux de mise en sécurité.",
        "version": v,
        "docs": docs,
    })

    # --- Thermique / RE2020 (partie CCH) ---
    docs, v = docs_code(dossier, "Code de la construction et de l'habitation", CCH, [
        ("cch-thermique-l", "CCH (législatif) — Performance énergétique et environnementale des bâtiments",
         r"Partie législative > Livre Ier .* > Titre VII : Performance énergétique", None),
        ("cch-thermique-r", "CCH (réglementaire) — RE2020 : exigences des constructions et rénovations",
         r"Partie réglementaire > Livre Ier .* > Titre VII : PERFORMANCE ÉNERGÉTIQUE", r"Livre III|Aides diverses"),
    ])
    packs.append({
        "id": "thermique-re2020",
        "theme": "Thermique / RE2020",
        "titre": "Thermique & RE2020 — socle CCH",
        "description": "Code de la construction et de l'habitation, titre « Performance énergétique et environnementale » : exigences RE2020 des constructions neuves, rénovation énergétique, DPE et audit énergétique. (Les valeurs de calcul détaillées sont fixées par arrêtés — pack « Arrêtés énergie » à part.)",
        "version": v,
        "docs": docs,
    })

    # --- Amiante & plomb : diagnostics avant travaux sur le bâti existant ---
    docs_trav, v_trav = docs_code(dossier, "Code du travail", "LEGITEXT000006072050", [
        ("trav-amiante", "Code du travail — Risque amiante : repérage avant travaux, obligations du donneur d'ordre",
         r"Section 3 : Risques d'exposition à l'amiante", None),
    ])
    docs_sante, v_sante = docs_code(dossier, "Code de la santé publique", "LEGITEXT000006072665", [
        ("sante-plomb-amiante", "Code de la santé publique — Plomb (CREP) et amiante (DTA) dans les immeubles bâtis",
         r"Livre III .* > Titre III .* > Chapitre IV : (Lutte contre la prése|LUTTE CONTRE LA PRÉSE)", None),
    ])
    packs.append({
        "id": "amiante-plomb",
        "theme": "Amiante & plomb",
        "titre": "Amiante & plomb — diagnostics du bâti existant",
        "description": "Code du travail (repérage amiante avant travaux, obligations du maître d'ouvrage) et Code de la santé publique (constat de risque d'exposition au plomb, dossier technique amiante) — incontournables en réhabilitation.",
        "version": max(v_trav, v_sante),
        "docs": docs_trav + docs_sante,
    })

    # --- ICPE : régime des installations classées (législatif) ---
    docs, v = docs_code(dossier, "Code de l'environnement", "LEGITEXT000006074220", [
        ("env-icpe-l", "Code de l'environnement — Installations classées (ICPE) : nomenclature, autorisation, enregistrement, déclaration",
         r"Partie législative > Livre V .* > Titre Ier : Installations classées", None),
    ])
    packs.append({
        "id": "icpe",
        "theme": "ICPE",
        "titre": "ICPE — régime des installations classées (législatif)",
        "description": "Code de l'environnement, régime des installations classées pour la protection de l'environnement : définition, nomenclature, autorisation / enregistrement / déclaration — utile quand un projet relève d'une installation classée.",
        "version": v,
        "docs": docs,
    })

    return packs


# ------------------------------------------------------------------
# Textes non codifiés depuis le dump DILA (arrêtés, loi de 1977…)
# Chaque texte est repéré par une regex sur son TITREFULL ; en cas de
# textes homonymes (arrêtés modificatifs), on garde le plus riche en
# articles : c'est la version consolidée du texte de base.
# ------------------------------------------------------------------

TNC = [
    {
        "pack": "incendie-erp-arretes",
        "theme": "Sécurité incendie",
        "titre_pack": "Sécurité incendie ERP — règlement complet (volumineux)",
        "description": "Règlement de sécurité contre l'incendie dans les ERP, consolidé (arrêté du 25 juin 1980) : dispositions générales (GN, CO, AM, DF, MS…), 5e catégorie (PE) et établissements spéciaux (chapiteaux, gares, parcs de stationnement…). ~1,2 M de caractères : cochez la partie utile à la question.",
        "textes": [
            (r"^Arrêté du 25 juin 1980\b.*sécurité", "arrete-1980", "Règlement sécurité incendie ERP (arr. 25 juin 1980)"),
        ],
    },
    {
        "pack": "accessibilite-arretes",
        "theme": "Accessibilité PMR",
        "titre_pack": "Accessibilité handicap — arrêtés d'application",
        "description": "Arrêté du 20 avril 2017 (ERP neufs et installations ouvertes au public) et arrêté du 8 décembre 2014 (ERP situés dans un cadre bâti existant).",
        "textes": [
            (r"^Arrêté du 20 avril 2017\b.*accessibilité", "arrete-2017", "Arrêté du 20 avril 2017 — Accessibilité des ERP neufs"),
            (r"^Arrêté du 8 décembre 2014\b.*(accessibilité|cadre bâti existant)", "arrete-2014", "Arrêté du 8 décembre 2014 — Accessibilité des ERP existants"),
        ],
    },
    {
        "pack": "profession-architecte",
        "theme": "Profession",
        "titre_pack": "Profession — loi de 1977 & déontologie",
        "description": "Loi n°77-2 du 3 janvier 1977 sur l'architecture (recours obligatoire, seuils) et code de déontologie des architectes (décret n°80-217).",
        "textes": [
            # le code de déontologie est ajouté par main() depuis sa version code consolidé
            (r"^Loi n° ?77-2 du 3 janvier 1977", "loi-1977", "Loi n°77-2 du 3 janvier 1977 sur l'architecture"),
        ],
    },
    {
        "pack": "gaz-arretes",
        "theme": "Gaz / plomberie",
        "titre_pack": "Sécurité gaz — arrêté du 2 août 1977",
        "description": "Arrêté du 2 août 1977 : règles techniques et de sécurité applicables aux installations de gaz combustible et d'hydrocarbures liquéfiés situées à l'intérieur des bâtiments et de leurs dépendances.",
        "textes": [
            (r"^Arrêté du 2 août 1977\b.*(gaz|hydrocarbures)", "arrete-gaz-1977", "Arrêté du 2 août 1977 — Sécurité des installations de gaz dans les bâtiments"),
        ],
    },
    {
        "pack": "energie-re2020-arrete",
        "theme": "Thermique / RE2020",
        "titre_pack": "RE2020 — arrêté « exigences » du 4 août 2021",
        "description": "Arrêté du 4 août 2021 relatif aux exigences de performance énergétique et environnementale des constructions de bâtiments (RE2020) : indicateurs, seuils, méthode de calcul.",
        "textes": [
            (r"^Arrêté du 4 août 2021\b.*(performance énergétique|exigences)", "arrete-re2020-2021", "Arrêté du 4 août 2021 — Exigences RE2020 des constructions neuves"),
        ],
    },
]


def indexer_tnc(dossier_dump):
    """[(TITREFULL, dossier_JORFTEXT)] pour tous les textes en vigueur du dump"""
    index = []
    for base, dirs, fichiers in os.walk(dossier_dump):
        if os.path.basename(base) != "version" or os.sep + "texte" + os.sep not in base:
            continue
        for f in fichiers:
            if not f.endswith(".xml"):
                continue
            try:
                with open(os.path.join(base, f), encoding="utf-8") as fh:
                    contenu = fh.read(20000)
            except OSError:
                continue
            m = re.search(r"<TITREFULL>(.*?)</TITREFULL>", contenu, re.S)
            if m:
                titre = html.unescape(m.group(1)).strip()
                dossier_texte = os.path.dirname(os.path.dirname(base))  # …/JORFTEXT…/
                index.append((titre, dossier_texte))
    return index


def compter_articles(dossier_texte):
    n = 0
    for base, _d, fichiers in os.walk(dossier_texte):
        if os.sep + "article" + os.sep in base + os.sep:
            n += sum(1 for f in fichiers if f.endswith(".xml"))
    return n


def construire_packs_tnc(dossier_dump, version_dump, cache_index=None):
    if cache_index and os.path.exists(cache_index):
        with open(cache_index, encoding="utf-8") as f:
            index = [tuple(e) for e in json.load(f)]
        print(f"  index chargé depuis le cache ({len(index)} textes)")
    else:
        print("indexation des textes non codifiés…")
        index = indexer_tnc(dossier_dump)
        print(f"  {len(index)} textes en vigueur indexés")
        if cache_index:
            with open(cache_index, "w", encoding="utf-8") as f:
                json.dump([list(e) for e in index], f)
    packs = []
    for entree in TNC:
        docs = []
        for motif, slug, titre in entree["textes"]:
            candidats = [(t, d) for t, d in index if re.search(motif, t, re.I)]
            if not candidats:
                print(f"  ⚠ aucun texte ne matche « {motif} » ({titre})", file=sys.stderr)
                continue
            # le texte de base consolidé est celui qui porte le plus d'articles
            candidats.sort(key=lambda c: compter_articles(c[1]), reverse=True)
            titre_trouve, dossier = candidats[0]
            print(f"  · {titre} ← « {titre_trouve[:90]} » ({len(candidats)} candidat(s))")
            titre_officiel, texte = texte_depuis_dump(dossier)
            titre_officiel = titre_officiel or titre_trouve
            if not texte:
                print(f"  ⚠ texte vide pour « {titre_trouve[:60]} » ({titre})", file=sys.stderr)
                continue
            source = f"{titre_officiel} — Légifrance (dump open-data DILA, Licence Ouverte), version consolidée au {version_dump}"
            # lien de recherche Légifrance (le LEGITEXT est le nom du fichier version)
            legitext = ""
            dossier_version = os.path.join(dossier, "texte", "version")
            if os.path.isdir(dossier_version):
                noms = [f[:-4] for f in os.listdir(dossier_version) if f.endswith(".xml")]
                if noms:
                    legitext = noms[0]
            url = f"https://www.legifrance.gouv.fr/loda/id/{legitext}/" if legitext else "https://www.legifrance.gouv.fr/"
            parties = decouper(titre, texte)
            for i, (t, part) in enumerate(parties):
                suffixe = "" if len(parties) == 1 else f"-{i + 1}"
                docs.append({
                    "id": f"lf-{slug}{suffixe}",
                    "titre": t,
                    "type": "reglementaire",
                    "source": source,
                    "url": url,
                    "texte": part,
                })
        if docs:
            packs.append({
                "id": entree["pack"],
                "theme": entree.get("theme", ""),
                "titre": entree["titre_pack"],
                "description": entree["description"],
                "version": version_dump,
                "docs": docs,
            })
    return packs


# ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", required=True, help="dossier des XML codes.droit.org")
    ap.add_argument("--dump", help="dossier d'extraction (partielle) du dump LEGI DILA")
    ap.add_argument("--version-dump", default="?", help="date de consolidation du dump (AAAA-MM-JJ)")
    ap.add_argument("--index-cache", help="fichier JSON où (re)lire l'index des titres TNC")
    ap.add_argument("--sortie", default="public/corpus")
    args = ap.parse_args()

    packs = construire_packs_codes(args.codes)
    if args.dump:
        packs_tnc = construire_packs_tnc(args.dump, args.version_dump, args.index_cache)
        # le code de déontologie est un code consolidé (pas un TNC) : il rejoint le pack profession
        docs_deonto, _v = docs_code(args.codes, "Code de déontologie des architectes", "LEGITEXT000006074232", [
            ("deonto", "Code de déontologie des architectes (décret n°80-217)", r".", None),
        ])
        for p in packs_tnc:
            if p["id"] == "profession-architecte":
                p["docs"] += docs_deonto
        packs += packs_tnc

    os.makedirs(args.sortie, exist_ok=True)
    index = []
    for pack in packs:
        fichier = f"{pack['id']}.json"
        with open(os.path.join(args.sortie, fichier), "w", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False)
        taille = sum(len(d["texte"]) for d in pack["docs"])
        index.append({
            "fichier": fichier,
            "id": pack["id"],
            "theme": pack.get("theme", ""),
            "titre": pack["titre"],
            "description": pack["description"],
            "version": pack["version"],
            "nbDocs": len(pack["docs"]),
            "taille": taille,
            "docIds": [d["id"] for d in pack["docs"]],
        })
        print(f"✓ {pack['id']}: {len(pack['docs'])} doc(s), {taille // 1000} k caractères")
    with open(os.path.join(args.sortie, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"→ {len(packs)} packs écrits dans {args.sortie}")


if __name__ == "__main__":
    main()
