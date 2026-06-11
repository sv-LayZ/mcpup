# MCP Reliability Monitor — Brief projet

> Monitoring de santé sémantique pour serveurs MCP. Un « Checkly pour MCP » qui attrape ce que les moniteurs d'uptime génériques ne voient pas : échecs silencieux, dérive de schéma, outils cassés.

**Statut :** concept à valider
**Noms de travail :** MCPWatch · ProbeMCP · MCP Sentinel
**Cible de marché :** développeurs / petites équipes self-hébergeant des serveurs MCP

---

## 1. Le problème

L'adoption de MCP explose, mais la fiabilité en production est catastrophique. Données d'avril 2026 sur 2 181 endpoints MCP distants : **52 % complètement morts, 9 % seulement en pleine santé**. Le reste répond lentement, sert des données périmées, ou — le pire — échoue silencieusement avec des `200 OK` contenant des erreurs de parsing.

Trois douleurs concrètes, non couvertes par l'outillage actuel :

1. **Échecs silencieux.** Un serveur MCP répond `200 OK` mais le payload est malformé ou contient une erreur. Un moniteur d'uptime classique (Pingdom, UptimeRobot) le voit « vert ». L'agent, lui, casse.
2. **Dérive de schéma (schema drift).** Un outil change le format de son `inputSchema`/`outputSchema` sans prévenir. Les agents qui en dépendent échouent en silence, parfois en prod chez le client.
3. **Sprawl & abandon.** Pas de registre central, des doublons construits par des équipes qui s'ignorent, des credentials upstream expirés, des cold starts serverless qui tuent les premières requêtes. Un lead plateforme gérant 200 ingénieurs a trouvé 14 serveurs MCP dont 4 doublons inconnus les uns des autres.

**Pourquoi maintenant :** MCP est trop récent (transport streamable HTTP + auth OAuth 2.1 stabilisés courant 2025) pour que ce créneau soit occupé. Les plateformes existantes bundlent le monitoring dans des offres hosting + auth + enterprise — personne ne sert proprement la longue traîne qui veut juste *« surveille mon endpoint, attrape les échecs silencieux, préviens-moi »*.

---

## 2. La proposition de valeur

> Un Pingdom générique fait du ping HTTP. Nous savons ce que « sain » veut dire **sémantiquement** pour un serveur MCP.

Le moat n'est pas le monitoring d'uptime (commodité), c'est la **validation sémantique** propre au protocole :

- Vérifier le handshake `initialize` complet, pas juste « le port répond ».
- Capturer et versionner le schéma de chaque outil via `tools/list`, et **differ** à chaque run pour détecter le drift.
- Appeler optionnellement un outil « safe » désigné avec des arguments synthétiques et **valider la forme de la réponse** (et non le code HTTP).
- Distinguer un vrai succès d'un `200 OK` qui contient une `JSON-RPC error`.

C'est exactement le delta qu'un moniteur générique ne peut pas faire sans connaître le protocole — et c'est l'avantage qui vient de la pratique agentique directe.

---

## 3. La cible (ICP)

**Cible primaire — l'auto-hébergeur.**
Dev solo ou petite équipe (2 à 15 ingénieurs) qui construit et self-héberge ses propres serveurs MCP pour exposer des outils internes à des agents (Claude Code/Desktop, Cursor, agents custom). Profil très technique, sensible à la douleur des échecs silencieux, achète sans passer par un comité.

**Cible secondaire — l'éditeur de MCP public.**
Boîte SaaS qui ship un serveur MCP comme feature produit (ses clients y connectent leurs agents). Elle a un besoin business de prouver l'uptime du MCP côté client → SLA, status page publique.

**Acheteur :** le dev qui *possède* le serveur MCP (le builder lui-même), ou le lead eng. Achat bottom-up, PLG, friction minimale. Pas de cycle de vente enterprise au MVP.

**Anti-cible (pour l'instant) :** l'enterprise qui veut SSO/SAML, audit immuable, RBAC par outil. C'est le terrain des plateformes établies (Composio, Prefect, MintMCP…) — on ne les attaque pas frontalement.

---

## 4. Le MVP

Objectif : la plus petite chose qui fait dire à un auto-hébergeur « je laisse ça tourner ». Périmètre volontairement étroit.

### Dans le scope

| Feature | Détail |
|---|---|
| Enregistrement d'endpoint | URL MCP distant (streamable HTTP), auth bearer token / OAuth 2.1 |
| Probe de santé périodique | `initialize` → `tools/list` → (optionnel) appel d'un outil safe |
| Détection de drift | Snapshot du schéma `tools/list`, diff vs baseline, alerte au changement |
| Détection d'échec silencieux | Parse du payload, détection des `JSON-RPC error` sous `200 OK` |
| Métriques | Uptime %, latence (p50/p95), timeline d'incidents |
| Alerting | Email + Slack + webhook générique |
| Dashboard | Liste des moniteurs, statut, historique, vue d'un endpoint |

### Hors scope (volontairement reporté)

- Hébergement de serveurs MCP (c'est le marché bondé — on n'y va pas).
- Gateway / agrégation multi-serveurs.
- Auth, RBAC, audit enterprise.
- Registre/catalogue d'org.
- Mobile, multi-région.

### Intervalle & limites MVP

- Intervalle de probe : 5 min (free) → 1 min / 30 s (payant).
- Pas de scale exotique au départ : viser quelques centaines de moniteurs, pas des millions.

---

## 5. Architecture (esquisse)

Stack orientée vélocité solo, alignée sur ton profil :

- **Dashboard / API :** Next.js + TypeScript (App Router). Tu connais, time-to-ship minimal.
- **Couche de probe (workers) :** TypeScript au MVP (Node) suffit. Si le volume/parallélisme l'exige plus tard, réécrire les probes en **Rust (Axum/Tokio)** ou Go — tu as déjà le Rust/Axum dans les mains.
- **Scheduling :** une queue + cron (BullMQ/Redis, ou un scheduler managé).
- **Stockage :**
  - Postgres pour la config (endpoints, users, baselines de schéma).
  - Séries temporelles (uptime/latence) : Postgres partitionné au début, migration vers Timescale/ClickHouse seulement si le volume le justifie.
- **Schéma drift :** stocker chaque snapshot `tools/list` (hash + JSON), diff structurel au run suivant.
- **Déploiement :** tu maîtrises AWS EC2 ; un PaaS (Fly/Render/Railway) ira plus vite pour un MVP solo.

**Bloc technique critique à dérisquer en premier :** un client MCP robuste côté probe (handshake, transport HTTP streamable, gestion auth/refresh, timeouts, parsing JSON-RPC strict). C'est le cœur de la valeur — à prototyper avant tout le reste.

---

## 6. Hypothèse de pricing

Modèle par moniteur + intervalle, façon Checkly / Better Stack :

- **Free :** 1–3 moniteurs, intervalle 5 min, 1 canal d'alerte, 7 j d'historique. Sert d'aimant + de preuve sociale.
- **Pro (~20–39 €/mois) :** 10–25 moniteurs, intervalle 1 min, drift history complet, tous les canaux d'alerte.
- **Team (~99 €/mois) :** moniteurs étendus, intervalle 30 s, status page publique, membres multiples.

Le drift history et la status page publique sont les déclencheurs naturels de passage au payant.

---

## 7. Go-to-market

Distribution = ton terrain (GitHub / HN / communautés dev). Stratégie en deux temps :

1. **Open-source un probe CLI** (pattern Deezify-CLI) : `mcpup <url>` qui fait un health-check sémantique one-shot en local. Gratuit, crée la crédibilité technique et l'adoption ; le SaaS hébergé monétise le *continu* (scheduling, historique, alerting, dashboard).
2. **Post de lancement à angle fort :** « 52 % des serveurs MCP en prod sont morts — voici comment le savoir avant vos agents ». À publier sur HN, r/mcp, le Discord MCP/Anthropic, dev.to.

Canaux : Hacker News, communautés MCP, dev.to, GitHub (le repo du CLI comme top of funnel).

---

## 8. Plan de validation — 30 jours

Avant d'écrire le SaaS complet, prouver que la douleur est payante.

- **Semaine 1 :** 10–20 entretiens avec des gens qui self-hébergent un MCP (les trouver via repos GitHub « mcp-server », Discord MCP). Question clé : *as-tu déjà été surpris par un MCP « vert » mais cassé ?*
- **Semaine 1–2 :** sortir le **CLI open-source** `mcpup`. Mesurer les stars / installs comme signal d'intérêt.
- **Semaine 2 :** landing page + waitlist, avec l'angle « échec silencieux + drift ».
- **Semaine 3–4 :** convertir les intéressés en pré-inscrits payants (ou LOI). Critère de go : un nombre cible de signups + ≥ 10 entretiens confirmant explicitement la douleur des échecs silencieux.

**Signal d'arrêt :** si les auto-hébergeurs disent « je redéploie et je vois bien si ça marche », la douleur n'est pas assez aiguë → pivoter.

---

## 9. Risques (à garder en tête)

| Risque | Nature | Mitigation |
|---|---|---|
| Pari mono-écosystème | Tu es adossé à la trajectoire de MCP | Concevoir la couche probe pour généraliser à d'autres protocoles agent-tool si MCP s'essouffle |
| Absorption plateforme | Cloudflare/Vercel/Anthropic peuvent l'ajouter nativement | Aller vite, posséder l'angle sémantique/drift que les génériques ne font pas |
| TAM petit aujourd'hui | Marché jeune | Early-mover ; croissance rapide attendue du parc MCP |
| Commoditisation du « monitoring » | Feature copiable | Profondeur sémantique (drift, validation de tool-call) = barrière, pas l'uptime |

---

## 10. Prochaines étapes

1. Prototyper le **client MCP de probe** (handshake + `tools/list` + parsing strict) — le bloc qui dérisque tout.
2. En extraire le **CLI `mcpup`** open-source.
3. Lancer le CLI + landing page, démarrer les 10–20 entretiens.
4. Décider go/no-go sur les critères de la section 8.