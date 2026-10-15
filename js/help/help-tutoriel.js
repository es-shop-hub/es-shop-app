/** Tutoriels alignés sur le tiroir (nav.js) et les pages réelles. */
export const HELP_TUTORIALS = [
  // —— Vente ——
  {
    id: "vente",
    section: "Vente",
    title: "Vente rapide",
    page: "index.html",
    role: "Enregistrer les ventes du jour : panier, client, cash ou crédit.",
    howTo:
      "Ajoutez des produits au panier, saisissez le nom du client, puis choisissez Vendre (cash) ou Crédit. En crédit, indiquez éventuellement le montant payé et confirmez.",
    todo:
      "Toujours renseigner le client, respecter le prix minimum, valider chaque vente le jour même.",
    body:
      "Cash : vente soldée. Crédit : crée une dette client (payment_status partial/paid). Chaque vente écrit sales, sale_items et un OUT dans stock_movements. Les lots périssables suivent le FIFO."
  },
  {
    id: "vendus",
    section: "Vente",
    title: "Vendus",
    page: "vendus.html",
    role: "Historique des ventes filtrable (période, vendeur, produit, statut).",
    howTo:
      "Choisissez une période (Aujourd'hui par défaut), appliquez les filtres, consultez les cartes et KPIs.",
    todo:
      "Contrôler les ventes du jour, les dettes ouvertes, et annuler une erreur seulement si elle a moins de 48 h (triple confirmation).",
    body:
      "Les vendeurs ne voient que leurs ventes. Annulation ≤ 48 h : stock rétabli via correction. Liens croisés vers Clients et Ranking."
  },
  {
    id: "clients",
    section: "Vente",
    title: "Clients",
    page: "clients.html",
    role: "Registre clients : apport, récurrents, top 5, récompenses et détail.",
    howTo:
      "Filtrez par période ou nom, consultez les KPIs, ouvrez une fiche client pour le détail et les récompenses.",
    todo:
      "Vérifier les clients récurrents, enregistrer les récompenses du mois, croiser avec Vendus et Stats.",
    body:
      "Les ventes se lient par le nom (clients.nameKey ↔ sales.clientName). Pas de clientId sur sales. Page liée à Vendus et Statistiques."
  },

  // —— Stock ——
  {
    id: "produits",
    section: "Stock",
    title: "Produits",
    page: "products.html",
    role: "Catalogue : prix, stock affiché, alertes, offline et expiration.",
    howTo:
      "Ajoutez un produit (prix achat, vente, minimum, stock). Modifiez ou désactivez depuis la liste. Liens vers Achats et Fournisseurs.",
    todo:
      "Tenir les prix à jour, activer l'expiration si périssable, contrôler le stock après achat/vente.",
    body:
      "stock_current est un cache — la vérité est stock_movements. price_min bloque les ventes trop basses. Liens croisés : Achats, Fournisseurs."
  },
  {
    id: "achats",
    section: "Stock",
    title: "Achats",
    page: "purchases.html",
    role: "Entrées stock fournisseur et mise à jour des coûts.",
    howTo:
      "Renseignez le fournisseur, le produit, la quantité, le prix d'achat (et l'expiration du lot si besoin), puis validez.",
    todo:
      "Saisir chaque réception, nommer le fournisseur, renseigner l'expiration des lots périssables.",
    body:
      "Crée purchases, purchase_items et un IN dans stock_movements. Une dépense de réinvestissement peut être générée. Liens : Fournisseurs, Produits."
  },
  {
    id: "fournisseurs",
    section: "Stock",
    title: "Fournisseurs",
    page: "suppliers.html",
    role: "Synthèse des achats par fournisseur : totaux, activité, accès rapide nouvel achat.",
    howTo:
      "Filtrez la période, consultez les cartes fournisseur et l'activité récente. Utilisez « Nouvel achat » pour ouvrir Achats.",
    todo:
      "Contrôler qui livre le plus, croiser avec Achats et Produits, suivre les dettes fournisseur via Dettes si besoin.",
    body:
      "Agrégation locale sur les commandes (purchases). Liens croisés : Achats, Produits."
  },
  {
    id: "demande-ajout",
    section: "Stock",
    title: "Demande client",
    page: "demandes/demand_add.html",
    role: "Noter un produit demandé absent du catalogue.",
    howTo:
      "Saisissez le libellé (et une note optionnelle), enregistrez. Les doublons incrémentent le compteur.",
    todo:
      "Enregistrer chaque demande réelle, puis créer le produit ou l'acheter quand c'est prioritaire.",
    body:
      "Collection product_demands (labelKey pour dédoublonner). Voir aussi Stats demandes."
  },
  {
    id: "demande-stats",
    section: "Stock",
    title: "Stats demandes",
    page: "demandes/demand_stats.html",
    role: "Voir quels produits absents sont le plus demandés.",
    howTo:
      "Consultez le classement des demandes, marquez fulfilled ou ignored selon le traitement.",
    todo:
      "Prioriser les demandes fréquentes pour le prochain achat ou la création produit.",
    body:
      "Complète Demande client. Utile pour décider quoi ajouter au catalogue."
  },

  // —— Finances ——
  {
    id: "finances",
    section: "Finances",
    title: "Hub finances",
    page: "finances.html",
    role: "Accès central Dépenses, Dettes et Pertes + alertes.",
    howTo:
      "Ouvrez le module voulu depuis les raccourcis du hub.",
    todo:
      "Passer par le hub avant le détail, traiter les alertes dettes rapidement.",
    body:
      "Tableau de bord financier léger. Les trois modules restent séparés (expenses, debts, losses)."
  },
  {
    id: "depenses",
    section: "Finances",
    title: "Dépenses",
    page: "expenses.html",
    role: "Charges, investissements et réinvestissements.",
    howTo:
      "Libellé, montant, catégorie, date → créer. Filtrez par période avec Appliquer.",
    todo:
      "Classer correctement (salaire, loyer, investment, reinvestment…) ; ne pas mélanger charge et stock.",
    body:
      "investment / reinvestment alimentent le suivi stats (exclus du bénéfice opérationnel). Liens : Finances, Dettes, Pertes."
  },
  {
    id: "dettes",
    section: "Finances",
    title: "Dettes",
    page: "debts.html",
    role: "Créances clients et dettes fournisseurs, échéances et paiements.",
    howTo:
      "Créez une dette (nom, montants, échéance). Utilisez Payer sur chaque ligne pour un encaissement.",
    todo:
      "Relancer les retards, saisir l'échéance, enregistrer chaque paiement partiel dès réception.",
    body:
      "Une dette liée à une vente (relatedSaleId) met à jour payment_status. Liens : Finances, Dépenses."
  },
  {
    id: "pertes",
    section: "Finances",
    title: "Pertes",
    page: "losses.html",
    role: "Pertes produit (casse, expiration) ou argent.",
    howTo:
      "Choisissez le type, le produit ou le montant, validez. Corrigez une erreur via le bouton dédié.",
    todo:
      "Sortir le stock expiré en perte produit (FIFO), documenter la raison.",
    body:
      "Perte produit → OUT reason loss. Les pertes argent n'affectent pas le stock. Liens : Finances, Dépenses."
  },

  // —— Pilotage ——
  {
    id: "navigation",
    section: "Pilotage",
    title: "Navigation",
    page: "pages.html",
    role: "Hub de toutes les pages StockFlow.",
    howTo:
      "Ouvrez Navigation depuis le tiroir. Cliquez une carte pour aller au module.",
    todo:
      "Utiliser ce hub pour former les nouveaux utilisateurs et vérifier l'accès aux modules.",
    body:
      "Liste : Vente, Produits, Vendus, Clients, Stats, Vendeurs, Ranking, Demandes, Achats, Fournisseurs, Finances (Dépenses/Dettes/Pertes), Lots, Paramètres, Vue rapide, Aide, Quotas."
  },
  {
    id: "stats",
    section: "Pilotage",
    title: "Statistiques",
    page: "stats.html",
    role: "KPIs Totaux (classique + batch), tendances, finance opérationnelle et santé financière (admin).",
    howTo:
      "Choisissez la période, consultez Vue d'ensemble, Tendances (tuiles de courbes), puis Détail classique/batch et le suivi opérationnel.",
    todo:
      "Comparer les périodes chaque semaine, agir sur stock/expiration, croiser avec Ranking et Clients.",
    body:
      "Réservé admin. Sources : sales, sale_items, expenses, losses, purchases, stock_movements et module batch. Le bénéfice opérationnel exclut invest./réinvest."
  },
  {
    id: "vendeurs",
    section: "Pilotage",
    title: "Vendeurs",
    page: "vendeurs.html",
    role: "Leaderboard vendeurs : parts CA / nombre de ventes, forts et faibles.",
    howTo:
      "Filtrez la période, lisez le classement et les blocs vendeurs forts / faibles.",
    todo:
      "Identifier qui sous-performe, former ou répartir les plages horaires.",
    body:
      "Agrégation sur sales (sellerId). Complète Stats et Ranking produits."
  },
  {
    id: "ranking",
    section: "Pilotage",
    title: "Ranking",
    page: "ranging.html",
    role: "Classement produits : volume, marge, CA et stock faible.",
    howTo:
      "Choisissez la période, parcourez les classements et les produits faibles.",
    todo:
      "Réapprovisionner les forts qui manquent, pousser ou retirer les faibles.",
    body:
      "Données sale_items + products. Liens croisés : Stats, Vendus, Clients."
  },
  {
    id: "loader",
    section: "Pilotage",
    title: "Vue rapide",
    page: "loader.html",
    role: "Aperçu synthétique ventes / stock / finances.",
    howTo:
      "Ouvrez Vue rapide depuis le tiroir (Pilotage).",
    todo:
      "Coup d'œil en début de journée avant d'entrer dans Stats ou Vendus.",
    body:
      "Dashboard léger. Ne remplace pas l'analyse Stats."
  },

  // —— Lots ——
  {
    id: "batch-gestion",
    section: "Lots",
    title: "Gestion lots",
    page: "batch/batch_management.html",
    role: "Module isolé : types de produits batch, lots et ventes fractionnées.",
    howTo:
      "Créez un type de produit batch, créez un lot (qté + coût), puis enregistrez des sorties (ventes) sur le lot.",
    todo:
      "Ne pas mélanger avec le catalogue classique (products). Suivre quantity_remaining et le statut du lot.",
    body:
      "Collections batch_products, product_batches, batch_movements — indépendantes de sales/stock_movements. Lien vers Stats lots."
  },
  {
    id: "batch-stats",
    section: "Lots",
    title: "Stats lots",
    page: "batch/batch_stats.html",
    role: "Marge, encaissements et stock restant du module lots.",
    howTo:
      "Consultez les totaux agrégés des batch_movements et le stock des lots actifs.",
    todo:
      "Contrôler la marge réelle des ventes fractionnées, croiser avec Stats (Totaux).",
    body:
      "Montants arrondis à 2 décimales. Complète Gestion lots ; les Totaux Stats additionnent classique + batch."
  },

  // —— Système ——
  {
    id: "parametres",
    section: "Système",
    title: "Paramètres",
    page: "settings.html",
    role: "Boutique, devise, expiration, offline et utilisateurs (admin / seller).",
    howTo:
      "Onglet Configuration : nom, devise, alertes, expiration. Onglet Utilisateurs : créer, rôle, activer/désactiver.",
    todo:
      "Limiter les accès seller, activer l'expiration si périssables, sauvegarder après chaque changement.",
    body:
      "enableExpiration / expirationAlertDays pilotent le FIFO. users.role = admin|seller. Maximum d'utilisateurs selon system/meta. Ne jamais partager les mots de passe admin."
  },
  {
    id: "billing",
    section: "Système",
    title: "Quotas & sécurité",
    page: "billing-info/billing.html",
    role: "Vue admin des quotas Firebase et rappel sécurité.",
    howTo:
      "Ouvrez Quotas & sécurité depuis le tiroir (admin).",
    todo:
      "Surveiller les limites projet, ne pas exposer de clés privées hors du client prévu.",
    body:
      "Page d'information opérationnelle. Les règles Firestore restent dans « firestore rulses.txt » (déploiement manuel Console)."
  },
  {
    id: "aide",
    section: "Système",
    title: "Aide",
    page: "help.html",
    role: "Tutoriels par page, pourquoi StockFlow, contact ES-Company.",
    howTo:
      "Ouvrez un accordéon (un seul à la fois), lisez Comment utiliser / À faire, puis le détail.",
    todo:
      "Former chaque nouvel utilisateur ici avant la première vente réelle.",
    body:
      "Les tutoriels suivent les sections du tiroir. Contact et WhatsApp en bas de page."
  }
];

export const ES_COMPANY_ABOUT = {
  mission:
    "Moderniser la gestion des commerces locaux grâce à des outils simples, professionnels et adaptés aux réalités africaines.",
  history:
    "Tout a commencé dans une boutique physique : gestion sur papier, calculs longs, stock difficile à suivre. En échangeant avec d'autres commerçants, la même problématique revenait — organisation, pas seulement visibilité web. StockFlow est né pour répondre à ce besoin concret, puis ES-Company est devenue le véhicule pour aider d'autres entreprises à se moderniser.",
  approach:
    "Nous ne vendons pas seulement des logiciels : nous construisons un écosystème numérique qui combine technologie, stratégie business, design professionnel et accompagnement pratique."
};

export const STOCKFLOW_WHY = {
  pointA: [
    "Cahiers papier et calculs manuels",
    "Difficulté à connaître le vrai bénéfice",
    "Stock mal suivi et pertes invisibles",
    "Dettes mal contrôlées",
    "Décisions prises au hasard"
  ],
  pointB: [
    "Suivi clair des ventes",
    "Contrôle du stock",
    "Gestion des dépenses et des dettes",
    "Réduction des pertes",
    "Statistiques simples à comprendre",
    "Meilleure prise de décision",
    "Entreprise plus organisée"
  ],
  promise:
    "StockFlow aide les commerçants à passer d'une gestion approximative sur papier à une gestion organisée et contrôlée, afin de mieux suivre leur argent, réduire les pertes et prendre de meilleures décisions.",
  centralMessage:
    "Vous n'avez pas besoin de travailler plus. Vous avez besoin de mieux contrôler votre activité. StockFlow vous aide à savoir où va votre argent, à réduire les pertes et à prendre de meilleures décisions pour développer votre entreprise."
};

export const HELP_CONTACT = {
  email: "escompany98@gmail.com",
  phonePrimary: "+243843858955",
  phonePrimaryDisplay: "+243 843 858 955",
  phoneSecondary: "+243840344307",
  phoneSecondaryDisplay: "+243 840 344 307",
  website: "https://es-company98.github.io/Es-Company/",
  whatsappPrimary: "243843858955",
  whatsappMessage:
    "Bonjour ES-Company, j'utilise StockFlow et j'ai besoin d'aide ou de support."
};
