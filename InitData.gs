/**
 * ============================================================
 * LFT - Initialisation des donnees
 * A executer UNE SEULE FOIS apres le deploiement de Code.gs
 * ============================================================
 *
 * 1. Collez ce code dans le meme projet Apps Script que Code.gs
 * 2. Executez la fonction initializeSheets() d'abord (depuis Code.gs)
 * 3. Puis executez la fonction populateAllData() ci-dessous
 * 4. Vous pouvez ensuite supprimer ce fichier
 */

function populateAllData() {
  populateProjets();
  populateUsers();
  populateEmailsAutorises();
  Logger.log('=== Initialisation complete ! ===');
  Logger.log('Projets inseres : voir onglet Projets');
  Logger.log('Compte admin : admin@egd.mg / admin2025');
  Logger.log('Emails autorises : voir onglet Emails_Autorises');
}

function populateProjets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Projets');
  if (!sheet) {
    Logger.log('ERREUR : Onglet Projets introuvable. Executez initializeSheets() d\'abord.');
    return;
  }

  // Verifier si des donnees existent deja
  if (sheet.getLastRow() > 1) {
    Logger.log('ATTENTION : Des donnees existent deja. Suppression des anciennes donnees...');
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const projets = [
    // =============================================
    // PROJETS AEFE (6)
    // =============================================
    [
      'AEFE-001', 'Semaine des Lycees Francais du Monde (SLFM)', 'Projet AEFE', 'Reseau AEFE',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'EMC, Histoire-Geographie, Lettres, Langues, Arts, Technologie', 'Tous niveaux',
      'Semaine thematique annuelle du reseau AEFE. Grand direct, emission speciale IA, activites culturelles et citoyennes dans tout l\'etablissement.',
      'Promouvoir les valeurs de citoyennete et solidarite|Valoriser l\'appartenance au reseau AEFE|Encourager l\'engagement des eleves|Developper des competences transversales',
      'Planifie', 'Haute', '2025-11-01', '2025-11-30',
      'Reseau AEFE, etablissements partenaires', 'Materiel audiovisuel, salle equipee',
      'Web radio, reseaux sociaux, site AEFE', 'DEGUEURCE Franck', 'admin@egd.mg'
    ],
    [
      'AEFE-002', 'Intelligence Artificielle - Projet annuel transversal', 'Projet AEFE', 'Reseau AEFE',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Toutes disciplines', 'Tous niveaux',
      'Projet annuel et transversal sur l\'IA, articule avec la semaine de la presse. Sensibilisation, formations, et integration dans les pratiques pedagogiques.',
      'Sensibiliser aux enjeux de l\'IA|Developper l\'esprit critique face aux outils numeriques|Integrer le numerique dans les apprentissages',
      'En cours', 'Haute', '2025-09-01', '2026-06-30',
      'EMIT Fianarantsoa (Dr RAKOTONIRAINY Hasina)', 'Outils numeriques, intervenants',
      'Emissions radio, productions numeriques', 'DEGUEURCE Franck', 'admin@egd.mg'
    ],
    [
      'AEFE-003', 'Club Eloquence - Ambassadeurs en Herbe (AEH)', 'Projet AEFE', 'Reseau AEFE',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres, Langues, EMC, Philosophie, Theatre', 'College, Lycee (6eme a 2nde)',
      'Club d\'eloquence hebdomadaire (mercredi 13h30-14h30 au CCUBE) avec participation au concours AEH de l\'AEFE. Theme 2026 : l\'IA, une revolution au benefice de l\'humain?',
      'Developper l\'expression orale et la prise de parole en public|Renforcer les competences argumentatives|Promouvoir le plurilinguisme|Debattre de grands enjeux contemporains|Valoriser l\'ouverture culturelle et la citoyennete',
      'En cours', 'Haute', '2025-10-01', '2026-04-30',
      'AEFE, etablissements zone OI, intervenants theatre', 'Amphi 1, CCUBE, materiel video, micros',
      'Concours AEH, videos, ceremonies', 'CUDRAZ Anthony Marin, BAUMARD Michele, COMBES Nivo', 'admin@egd.mg'
    ],
    [
      'AEFE-004', 'Mai des Langues', 'Projet AEFE', 'Reseau AEFE',
      'Axe 3', 'Promouvoir le plurilinguisme',
      'Langues vivantes, Lettres', 'Tous niveaux',
      'Evenement annuel AEFE de promotion du plurilinguisme. Production d\'un journal plurilingue impliquant toutes les langues enseignees.',
      'Valoriser la diversite linguistique|Encourager la pratique des langues|Produire un journal plurilingue',
      'Planifie', 'Moyenne', '2026-05-01', '2026-05-31',
      'AEFE, IFM', '', 'Journal plurilingue', '', 'admin@egd.mg'
    ],
    [
      'AEFE-005', 'Echanges ADN-AEFE', 'Projet AEFE', 'Reseau AEFE',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Toutes disciplines', 'Lycee',
      'Programme d\'echanges scolaires entre etablissements du reseau AEFE. Sejours de 3 a 6 semaines dans un autre etablissement francais a l\'etranger.',
      'Developper l\'ouverture internationale|Renforcer les echanges interculturels',
      'Planifie', 'Moyenne', '2025-09-01', '2026-06-30',
      'Etablissements AEFE', '', '', '', 'admin@egd.mg'
    ],
    [
      'AEFE-006', 'Olympiades de la Chimie', 'Projet AEFE', 'Reseau AEFE',
      'Axe 1', 'Viser l\'excellence et participer a des concours',
      'Sciences physiques, Chimie', 'Terminale (13 eleves spe physique)',
      'Participation aux Olympiades nationales et internationales de chimie. 4 seances de TP de 3h + epreuve concours. Possible qualification pour la finale de Paris.',
      'Donner le gout des sciences|Entrainer aux manipulations en chimie|Preparer les eleves aux ECE|Encourager l\'excellence scientifique',
      'Planifie', 'Moyenne', '2025-12-10', '2026-03-04',
      'AEFE', 'Laboratoire, materiels et produits de chimie',
      'Classement AEFE, diplomes, eventuelle finale Paris', 'BAUMARD Vincent', 'admin@egd.mg'
    ],

    // =============================================
    // PROJETS ZONE OCEAN INDIEN (8)
    // =============================================
    [
      'ZOI-001', 'Jeux des Iles des Automatismes', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Mathematiques, Technologie', 'College, Lycee',
      'Concours de mathematiques et technologie de la zone Ocean Indien. Phases etablissement, regionale et finale zone.',
      'Renforcer les automatismes mathematiques|Developper la logique|Stimuler l\'emulation inter-etablissements',
      'En cours', 'Haute', '2025-09-01', '2026-04-30',
      'Etablissements zone OI', '', '', '', 'admin@egd.mg'
    ],
    [
      'ZOI-002', 'Rallye Maths Madagascar', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Mathematiques', 'College, Lycee',
      'Concours de mathematiques par equipes. Phases regionale et finale nationale.',
      'Travailler en equipe|Resoudre des problemes mathematiques|Developper la logique',
      'En cours', 'Haute', '2025-11-01', '2026-04-30',
      'Etablissements Madagascar', '', '', '', 'admin@egd.mg'
    ],
    [
      'ZOI-003', 'Projet X - Sciences et Environnement', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Sciences, SVT, Geographie', 'College, Lycee',
      'Projet scientifique et environnemental de la zone Ocean Indien.',
      'Sensibiliser a l\'environnement|Developper la demarche scientifique',
      'Planifie', 'Moyenne', '2025-10-01', '2026-06-30',
      'Etablissements zone OI', '', '', '', 'admin@egd.mg'
    ],
    [
      'ZOI-004', 'Villages Scientifiques', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Sciences, Technologie, SVT', 'Tous niveaux',
      'Evenement scientifique de fin d\'annee. Exposition et demonstrations des travaux scientifiques des eleves.',
      'Valoriser les travaux scientifiques|Communiquer sur ses recherches|Developper la culture scientifique',
      'Planifie', 'Moyenne', '2026-06-01', '2026-06-30',
      '', 'Materiel scientifique, stands', 'Exposition, demonstrations', '', 'admin@egd.mg'
    ],
    [
      'ZOI-005', 'TARA - Echo d\'Escales', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Sciences, Geographie, SVT', 'College, Lycee',
      'Projet fondation TARA Ocean. Sensibilisation aux enjeux oceaniques et climatiques.',
      'Sensibiliser aux enjeux environnementaux|Developper l\'esprit scientifique',
      'Planifie', 'Moyenne', '2025-10-01', '2026-06-30',
      'Fondation TARA', '', '', '', 'admin@egd.mg'
    ],
    [
      'ZOI-006', 'La Nuit du Code', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'NSI, Technologie, Mathematiques', 'Premiere, Terminale',
      'Concours de programmation : coder un jeu en 6 heures en Python (bibliotheque Pyxel). Concours mondial. 58 eleves l\'an dernier.',
      'Developper les competences en programmation|Stimuler la creativite|Travailler en equipe sous contrainte de temps',
      'Planifie', 'Moyenne', '2026-05-01', '2026-05-31',
      'Ecole 42', 'Ordinateurs, salle informatique', '',
      'DEVALETTE Jocelin, HUOT Laurent, BOSSER Jean-Luc', 'admin@egd.mg'
    ],
    [
      'ZOI-007', 'Echecs en ligne', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Mathematiques, Logique', 'Sixieme',
      'Challenge d\'echecs en ligne dans le cadre du Challenge ZOI.',
      'Developper la logique et la strategie|Stimuler la concentration',
      'Planifie', 'Moyenne', '', '',
      'Etablissements zone OI', '', '', 'PIAU Amandine', 'admin@egd.mg'
    ],
    [
      'ZOI-008', 'Relais solidaire', 'Projet Zone OI', 'Zone Ocean Indien',
      'Axe 2', 'Ameliorer la vie quotidienne des eleves',
      'EPS, EMC', 'Tous niveaux',
      'Challenge sportif et solidaire dans le cadre du Challenge ZOI.',
      'Promouvoir la solidarite|Encourager la pratique sportive|Renforcer la cohesion',
      'Planifie', 'Moyenne', '', '',
      'Etablissements zone OI', '', '', 'PIAU Amandine', 'admin@egd.mg'
    ],

    // =============================================
    // PROJETS LFT (21)
    // =============================================
    [
      'LFT-001', 'Parcours du Lecteur', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres, Documentation', 'College, Lycee',
      'Parcours de lecture structure sur le cursus scolaire. Developpement du gout de la lecture a travers des selections adaptees a chaque niveau.',
      'Developper le gout de la lecture|Enrichir la culture litteraire|Structurer un parcours lecteur',
      'En cours', 'Haute', '2025-09-01', '2026-06-30',
      '', 'CDI, livres', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-002', 'Cartographie des Controverses', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'HGGSP, EMC, Sciences, Philosophie', 'Lycee',
      'Projet interdisciplinaire de cartographie des controverses. Themes : IA, nucleaire, viande cultivee, glyphosate. Recherche documentaire, argumentation, restitution.',
      'Developper l\'esprit critique|Maitriser la recherche documentaire|Structurer l\'argumentation|Travailler en equipe',
      'En cours', 'Haute', '2025-09-01', '2026-03-31',
      '', 'Outils numeriques, salle informatique', 'Expositions, presentations', '', 'admin@egd.mg'
    ],
    [
      'LFT-003', 'Partenariats LFT', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Renforcer l\'attractivite du LFT',
      '', 'Tous niveaux',
      'Developpement des partenariats institutionnels et culturels du LFT avec les acteurs locaux et internationaux.',
      'Renforcer l\'ancrage local|Developper les partenariats culturels',
      'En cours', 'Moyenne', '2025-09-01', '2026-06-30',
      'IFM, institutions locales, Graines de Bitume', '', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-004', 'Nouvel An Malagasy', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Bien vivre ensemble et creer des evenements federateurs',
      'Langues, Arts, EMC, Musique, Malgache', 'Tous niveaux',
      'Celebration du Nouvel An Malagasy. Evenement federateur valorisant la culture malgache au sein de l\'etablissement.',
      'Valoriser la culture malgache|Creer un evenement federateur|Renforcer le sentiment d\'appartenance',
      'Planifie', 'Moyenne', '', '',
      '', '', 'Ceremonie, spectacles', '', 'admin@egd.mg'
    ],
    [
      'LFT-005', 'Passe ton Hack d\'Abord', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'NSI, Technologie, Mathematiques', 'Terminale',
      'Concours de cybersecurite en partenariat avec le ministere des armees. Les eleves resolvent des enigmes pendant 3 semaines. Classement : 32e en 2024, 91e en 2025 sur 1500 equipes.',
      'Sensibiliser a la cybersecurite|Developper les competences numeriques|Decouvrir la programmation et le code',
      'Planifie', 'Moyenne', '2026-01-01', '2026-02-28',
      'Ministere des armees (officier de reserve)', 'Ordinateurs portables, connexion internet',
      'Classement national', 'DEVALETTE Jocelin', 'admin@egd.mg'
    ],
    [
      'LFT-006', 'Voyages Scolaires', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Toutes disciplines', 'Tous niveaux',
      'Organisation des voyages et sorties scolaires : Toledo (Espagne), Londres, Antsirabe, Chine (Pekin/Chengdu), JIJ Le Caire.',
      'Decouvrir le patrimoine|Renforcer la cohesion|Donner du sens aux apprentissages|Favoriser l\'ouverture internationale',
      'Planifie', 'Moyenne', '2025-09-01', '2026-06-30',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-007', 'Webradio LFT', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Toutes disciplines, Documentation', 'Tous niveaux',
      'Mise en place et animation de la webradio du lycee. Production d\'emissions, interviews et podcasts par les eleves.',
      'Developper l\'expression orale|Maitriser les outils mediatiques|Produire des contenus audio',
      'En cours', 'Haute', '2025-09-01', '2026-06-30',
      '', 'Materiel audiovisuel, studio webradio', 'Emissions, podcasts', '', 'admin@egd.mg'
    ],
    [
      'LFT-008', 'Prix Litteraire Les Incorruptibles', 'Projet LFT', 'National',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres, Documentation', '6eme, 3eme',
      'Participation au prix litteraire jeunesse Les Incorruptibles. Lecture de selections, debats et vote.',
      'Developper le gout de la lecture|Argumenter et debattre',
      'En cours', 'Moyenne', '2025-11-01', '2026-06-30',
      'Les Incorruptibles', 'Livres', 'Vote, debats', '', 'admin@egd.mg'
    ],
    [
      'LFT-009', 'Residence Theatrale', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Lettres, Arts dramatiques', 'College, Lycee',
      'Residence theatrale du 17 novembre au 3 decembre. Ateliers, creation et representation finale.',
      'Developper l\'expression corporelle et orale|Decouvrir les arts de la scene',
      'Planifie', 'Moyenne', '2025-11-17', '2025-12-03',
      'Artiste(s) en residence', 'Salle de spectacle', 'Representation finale', '', 'admin@egd.mg'
    ],
    [
      'LFT-010', 'Seminaire de Rentree', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Toutes disciplines', 'Enseignants',
      'Seminaire de rentree pour l\'equipe pedagogique. Lancement de la dynamique de l\'annee et presentation des projets.',
      'Federer l\'equipe pedagogique|Lancer la dynamique de l\'annee',
      'Termine', 'Haute', '2025-09-01', '2025-09-05',
      '', 'Salle de conference', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-011', 'Challenge Photo', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Arts, Documentation', 'Tous niveaux',
      'Concours photo thematique ouvert a tous les eleves de l\'etablissement.',
      'Developper le regard artistique|Valoriser la creativite',
      'Planifie', 'Basse', '2025-11-01', '2025-11-30',
      '', '', 'Exposition', '', 'admin@egd.mg'
    ],
    [
      'LFT-012', 'La Grande Dictee', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres', 'Tous niveaux',
      'Grande dictee ouverte a tous les niveaux de l\'etablissement.',
      'Renforcer la maitrise de la langue francaise',
      'Planifie', 'Basse', '2025-11-01', '2025-11-30',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-013', 'Les Nuits de la Lecture', 'Projet LFT', 'National',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres, Documentation', 'Tous niveaux',
      'Evenement national de promotion de la lecture. Animations et lectures partagees au CDI.',
      'Promouvoir la lecture|Creer un moment convivial autour du livre',
      'Planifie', 'Moyenne', '2026-01-01', '2026-01-31',
      '', 'CDI', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-014', 'Le Printemps des Poetes', 'Projet LFT', 'National',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Lettres, Langues, Arts', 'Tous niveaux',
      'Evenement national de celebration de la poesie. Ateliers d\'ecriture, lectures, affichages.',
      'Decouvrir et pratiquer la poesie|Developper la sensibilite artistique',
      'Planifie', 'Basse', '2026-03-01', '2026-03-31',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-015', 'Concours d\'Essais', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Accompagner les eleves dans les apprentissages',
      'Lettres, Philosophie, HGGSP', 'Lycee',
      'Concours d\'ecriture argumentative ouvert aux lyceens.',
      'Developper les competences redactionnelles|Structurer la pensee argumentative',
      'Planifie', 'Moyenne', '2026-03-01', '2026-03-31',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'LFT-016', 'TARA GRS - Graines de Reporters Scientifiques', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'SVT, Geographie, Education aux medias, Documentation', '3eme (classe de 3eme 5)',
      'Production d\'une video de type Journal TV sur les petites iles vulnerables. Roles : journalistes, expert scientifique, association ecolo, Etat, entreprise. Lien avec la COP Climat.',
      'Developper l\'esprit scientifique et l\'argumentation|Comprendre les enjeux scientifiques et societaux|Rechercher, trier et organiser l\'information|Gerer un projet en equipe|S\'initier a la cartographie des risques',
      'En cours', 'Haute', '2026-02-01', '2026-03-31',
      'Fondation TARA, documentalistes', 'Internet, outils de mind mapping (Mindomo, Coggle, Miro), Genially, Canva, Padlet, salle informatique',
      'Video Journal TV, emissions radio',
      'THANASACK Alexandrine, RAZANAMALALA Kanto, LEBON Camille, RAKOTOMANGA Diana, BAUMARD Michele', 'admin@egd.mg'
    ],
    [
      'LFT-017', 'Ressourcerie scolaire - La deuxieme vie des objets', 'Projet LFT', 'Etablissement',
      'Axe 2', 'Developpement durable et EFE3D',
      'Technologie', 'Troisieme',
      'Mise en place d\'une ressourcerie scolaire : collecte, reparation, reemploi et redistribution d\'objets. Lie au programme de technologie cycle 4 (reparabilite, cycle de vie des produits).',
      'Sensibiliser au developpement durable|Developper des competences transversales|Favoriser l\'engagement citoyen|Valoriser la creativite dans une demarche ecoresponsable',
      'En cours', 'Moyenne', '2025-09-01', '2026-06-30',
      'Association environnementale locale, parents, agents techniques, ONG',
      'Local dedie, mobilier, outils de reparation, materiel informatique',
      'Exposition, articles, journees portes ouvertes', 'DEGUEURCE Franck', 'admin@egd.mg'
    ],
    [
      'LFT-018', 'Collecte et valorisation des dechets plastiques (EFE3D)', 'Projet LFT', 'Etablissement',
      'Axe 2', 'Developpement durable et EFE3D',
      'SVT, EMC, Sciences', 'Tous niveaux (eco-delegues)',
      'Partenariat avec ANDAO Company. Collecte mensuelle, tri, transformation des plastiques en mobilier scolaire durable. 2 bacs de collecte, inaugures le 18 dec 2025. Fresque du plastique, eco-randonnee.',
      'Ameliorer le tri des dechets|Valoriser les dechets plastiques en mobilier|Sensibiliser a la reduction du plastique|Inciter gourdes et contenants reutilisables',
      'En cours', 'Haute', '2025-10-01', '2026-06-30',
      'ANDAO Company (convention depuis mai 2025), service gestion, service technique',
      'Budget suivi par le service gestion, 2 bacs ANDAO',
      'Video prix actions eco-delegues AEFE, exposition',
      'BAUMARD Michele (doc.), MERLIN Melissa (CPE), AUBERTIN (maths)', 'admin@egd.mg'
    ],
    [
      'LFT-019', 'Atelier Photo EFE3D - Regards d\'eleves sur l\'environnement', 'Projet LFT', 'Etablissement',
      'Axe 2', 'Developpement durable et EFE3D',
      'Arts plastiques, Lettres, EMC, SVT', '3eme a Terminale (12 eleves stage photo)',
      'Stage photo conduit par un photographe professionnel. Initiation technique, problematique locale DD, prises de vue, exposition au lycee. ODD 4, 11, 12, 13, 15.',
      'Sensibiliser a la transition ecologique|Mettre en oeuvre des actions concretes DD|Valoriser la demarche EFE3D|Developper le regard artistique',
      'Planifie', 'Moyenne', '', '',
      'Photographe professionnel, intervenant DD',
      'Materiel photo (reflex, trepieds), tirages, encadrements, espaces exposition',
      'Exposition CDI et espace EFE3D', 'Referents EFE3D', 'admin@egd.mg'
    ],
    [
      'LFT-020', 'Partenariat Graines de Bitume', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Developper la cooperation educative',
      'Activites artistiques, culturelles, pedagogiques, sportives', 'Lyceens internes (tous niveaux)',
      'Lyceens tuteurs volontaires accompagnent les jeunes de Graines de Bitume a travers des activites. 1 mercredi apres-midi (2h30) par mois au LFT.',
      'Encourager les echanges interculturels et solidaires|Sensibiliser a l\'engagement citoyen|Developper de nouvelles competences|Promouvoir le partenariat',
      'En cours', 'Moyenne', '2025-12-03', '2026-05-13',
      'Graines de Bitume (Christine Magny, Julio RAFANOMEZANTSOA)',
      'Fournitures arts plastiques, materiel sportif, ingredients cuisine',
      'Evenements, restitutions',
      'MERLIN Melissa (CPE), TRUEL Marie-Helene', 'admin@egd.mg'
    ],
    [
      'LFT-021', 'Rencontre litteraire - Hella Feki', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Developper la cooperation educative',
      'Malgache, Francais, Documentation', '3eme (classes de malgache)',
      'Rencontre avec l\'autrice Hella Feki autour de son roman "Une reine sans royaume" (Lattes, 2025). Evocation de l\'histoire coloniale de Madagascar et de la reine Ranavalona III.',
      'Favoriser l\'ouverture culturelle et artistique|Promouvoir la culture malgache|Valoriser le reseau culturel francais a Madagascar|Enrichir les apprentissages par l\'interdisciplinarite',
      'Termine', 'Moyenne', '2025-10-17', '2025-10-17',
      'Institut Francais de Madagascar (IFM), autrice invitee',
      'Amphi 1, videoprojecteur, studio webradio, frais deplacement autrice',
      'Interview podcast, affichage, dedicace, mise a disposition au CCUBE',
      'BAUMARD Michele, RAVINALA Ambinimanantsoa', 'admin@egd.mg'
    ],

    // =============================================
    // PROJETS LFT - VOYAGES SCOLAIRES (5)
    // =============================================
    [
      'LFT-022', 'Voyage solidaire 1STMG - Antsirabe', 'Projet LFT', 'Etablissement',
      'Axe 2', 'Ameliorer la vie quotidienne des eleves',
      'Management, Economie et droit, Francais', 'Premiere STMG (1STMG1 et 1STMG2)',
      'Voyage pedagogique du 2 au 3 avril 2026 a Antsirabe. Visite d\'entreprises (COTONA, SOCOLAIT, VISY GASY), distribution de fournitures scolaires, visite de la ville.',
      'Apprehender l\'environnement economique et social|Mettre en relation programme scolaire et realite|Renforcer la cohesion entre eleves|Mettre en pratique les valeurs de solidarite',
      'Planifie', 'Moyenne', '2026-04-02', '2026-04-03',
      'COTONA, SOCOLAIT, VISY GASY, ecole locale',
      'Bus, paniers repas, bouteilles d\'eau, megaphone',
      'Restitution, temoignages',
      'TELLIER Christophe, RAZAFIARISON Aina, RATIARISON Harilandy, RAKOTOMALALA Miharivola', 'admin@egd.mg'
    ],
    [
      'LFT-023', 'Voyage linguistique - Toledo (Espagne)', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Promouvoir le plurilinguisme',
      'Espagnol, Histoire-Geographie', 'Lycee (principalement 2nde)',
      'Immersion linguistique et culturelle de 12-13 jours a Toledo. Cours d\'espagnol, visites (Catedral, Alcazar, Musee del Greco), excursion a Madrid, rencontre avec des lyceens espagnols.',
      'Renforcer les competences linguistiques en contexte authentique|Decouvrir la culture et l\'histoire de l\'Espagne|Favoriser la cooperation et la cohesion|Developper la curiosite culturelle|Donner du sens a l\'apprentissage',
      'Planifie', 'Haute', '2026-04-01', '2026-05-15',
      'Centre de langues, Air France',
      'Materiel photo/numerique, hebergement, bus, assurance',
      'Exposition, diaporamas, temoignages, carnets de voyage',
      'VOAHANGIARIMANANA Marie Lea, RAZAFIMANANTSOA Dadhy', 'admin@egd.mg'
    ],
    [
      'LFT-024', 'Voyage d\'etude - Londres', 'Projet LFT', 'Etablissement',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Anglais, AMC, BFI, Histoire-Geographie, Francais, SVT', '1BFI, 1AMC',
      'Voyage a Londres. Visites : British Museum, Imperial War Museum, The Globe (representation), Tower of London, Houses of Parliament. Sejour en familles d\'accueil.',
      'Trouver du sens dans les enseignements BFI et AMC|Decouvrir Londres comme ville monde|Comprendre la societe britannique multiculturelle',
      'Planifie', 'Haute', '2026-03-01', '2026-03-15',
      '', 'Livret de voyage, materiel pedagogique',
      'Reportages quotidiens (Facebook, Webradio, WhatsApp)',
      'GEORGE (Mr), WHITE (Mr)', 'admin@egd.mg'
    ],
    [
      'LFT-025', 'Voyage educatif - Chine (Pekin et Chengdu)', 'Projet LFT', 'Etablissement',
      'Axe 3', 'Promouvoir le plurilinguisme',
      'Mandarin, Culture chinoise', '2nde et 1ere (option mandarin, 10-15 eleves)',
      'Voyage de 10 jours (2-11 avril 2026). Circuit : Beijing (Cite interdite, Grande Muraille, Lycee francais de Pekin) → Chengdu (centre des pandas, marche de Jinli). Journal de voyage par chaque eleve.',
      'Enrichissement culturel et linguistique|Appliquer les connaissances en situation reelle|Developper communication, confiance, autonomie|Echange avec le Lycee Francais de Pekin|Innovation pedagogique hors classe',
      'Planifie', 'Haute', '2026-04-02', '2026-04-11',
      'Lycee Francais de Pekin, Air Mauritius, Air Asia, agence de voyage',
      'Billets avion AR, 7 nuitees, transports, repas, guide local (budget ~13M MGA/eleve)',
      'Film et magazine du voyage, exposition photos',
      'RASOANAIVO Sitraka Toavina, ANDRIAMANJATO Mamy', 'admin@egd.mg'
    ],
    [
      'LFT-026', 'Jeux Internationaux de la Jeunesse (JIJ) - Le Caire 2026', 'Projet LFT', 'Etablissement',
      'Axe 2', 'Ameliorer la vie quotidienne des eleves',
      'EPS', '2nde (6 eleves selectionnes, 3 garcons / 3 filles)',
      '14eme edition des JIJ au Caire du 18 au 24 mai 2026. Evenement AEFE/UNSS. Rencontres sportives (nautiques, collectives, plage), culturelles et festives. Visite des Pyramides de Gizeh.',
      'Promouvoir la pratique sportive|Valoriser l\'engagement et le depassement de soi|Developper l\'autonomie et la responsabilisation|Renforcer l\'appartenance au reseau AEFE|Favoriser les echanges interculturels',
      'Planifie', 'Haute', '2026-05-16', '2026-05-25',
      'AEFE, UNSS, partenaires financiers',
      'Installations sportives LFT, tenues de delegation, tenue danse traditionnelle malgache',
      'Evenement de restitution, reportages',
      'DANIEL Yann, RALAMBOMANANA Lova', 'admin@egd.mg'
    ],

    // =============================================
    // PROJETS INSTITUTIONNELS (7)
    // =============================================
    [
      'INST-001', 'EFE3D et Eco-delegues', 'Projet institutionnel', 'National / AEFE',
      'Axe 2', 'Developpement durable et EFE3D',
      'SVT, Geographie, EMC, Sciences', 'Tous niveaux',
      'Label EFE3D et animation des eco-delegues. Dispositif obligatoire : 1 eco-delegue par classe. Groupes ambassadeurs (communication) et action (projets concrets, 1h/mois).',
      'Eduquer au developpement durable|Former des eco-citoyens|Sensibiliser aux 4R : reduire, reparer, reutiliser, recycler',
      'En cours', 'Haute', '2025-09-01', '2026-06-30',
      '', '', '',
      'BAUMARD Michele, MERLIN Melissa, AUBERTIN', 'admin@egd.mg'
    ],
    [
      'INST-002', 'Ecole au Cinema', 'Projet institutionnel', 'National',
      'Axe 1', 'Formaliser et faire vivre les 4 parcours educatifs',
      'Arts, Lettres, Langues', 'Primaire, College',
      'Dispositif national articule avec l\'option CAV (Cinema Audiovisuel). Projection de films, analyses et travaux pedagogiques.',
      'Developper la culture cinematographique|Eduquer au regard et a l\'image',
      'Planifie', 'Moyenne', '2025-09-01', '2026-06-30',
      'Institutions culturelles', '', '', '', 'admin@egd.mg'
    ],
    [
      'INST-003', 'Semaine de la Presse et des Medias', 'Projet institutionnel', 'National / AEFE',
      'Axe 1', 'Innover en classe et dans les pratiques pedagogiques',
      'Documentation, EMC, Lettres', 'Tous niveaux',
      'Semaine de la presse du 30 mars au 10 avril. Theme 2026 : Intelligence Artificielle. Ateliers, debats, productions mediatiques.',
      'Eduquer aux medias et a l\'information|Developper l\'esprit critique|Comprendre les enjeux de l\'IA dans les medias',
      'Planifie', 'Haute', '2026-03-30', '2026-04-10',
      'CLEMI', 'Journaux, supports numeriques', '', '', 'admin@egd.mg'
    ],
    [
      'INST-004', 'Semaine de la Francophonie', 'Projet institutionnel', 'National / AEFE',
      'Axe 3', 'Promouvoir le plurilinguisme',
      'Lettres, Langues, Documentation', 'Tous niveaux',
      'Dis-moi dix mots, dictee francophone, rencontre avec des autrices invitees a l\'IFM. Celebration de la langue francaise et de la diversite francophone.',
      'Promouvoir la langue francaise|Valoriser la diversite francophone',
      'Planifie', 'Haute', '2026-02-01', '2026-03-31',
      'IFM, autrices invitees', '', 'Dictee, rencontres, expositions', '', 'admin@egd.mg'
    ],
    [
      'INST-005', 'Olympiades de Geosciences', 'Projet institutionnel', 'National',
      'Axe 1', 'Viser l\'excellence et participer a des concours',
      'SVT, Sciences de la Terre', 'Lycee',
      'Olympiades nationales de geosciences. Epreuve individuelle valorisant l\'excellence scientifique.',
      'Encourager l\'excellence scientifique|Developper la culture geologique',
      'Planifie', 'Moyenne', '2026-03-01', '2026-03-31',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'INST-006', 'Olympiades de Mathematiques', 'Projet institutionnel', 'National',
      'Axe 1', 'Viser l\'excellence et participer a des concours',
      'Mathematiques', 'Lycee',
      'Olympiades nationales de mathematiques. Epreuve individuelle stimulant la reflexion mathematique.',
      'Encourager l\'excellence mathematique|Developper le raisonnement logique',
      'Planifie', 'Moyenne', '2026-03-01', '2026-03-31',
      '', '', '', '', 'admin@egd.mg'
    ],
    [
      'INST-007', 'Journee de la Langue Espagnole', 'Projet institutionnel', 'National / AEFE',
      'Axe 3', 'Promouvoir le plurilinguisme',
      'Espagnol', 'Tous niveaux',
      'Journee de celebration de la langue espagnole. Activites culturelles, gastronomiques et artistiques.',
      'Promouvoir l\'apprentissage de l\'espagnol|Decouvrir les cultures hispanophones',
      'Planifie', 'Basse', '2026-04-01', '2026-04-30',
      '', '', '', '', 'admin@egd.mg'
    ]
  ];

  // Insert all projects
  if (projets.length > 0) {
    sheet.getRange(2, 1, projets.length, projets[0].length).setValues(projets);
  }

  Logger.log(projets.length + ' projets inseres avec succes !');
}

function populateUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Utilisateurs');
  if (!sheet) {
    Logger.log('ERREUR : Onglet Utilisateurs introuvable.');
    return;
  }

  // Le compte admin est deja cree par initializeSheets()
  // On peut ajouter des comptes enseignants de demonstration si necessaire
  Logger.log('Onglet Utilisateurs pret. Compte admin : admin@egd.mg / admin2025');
}

function populateEmailsAutorises() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Emails_Autorises');
  if (!sheet) {
    Logger.log('ERREUR : Onglet Emails_Autorises introuvable. Executez initializeSheets() d\'abord.');
    return;
  }

  if (sheet.getLastRow() > 1) {
    Logger.log('Onglet Emails_Autorises deja rempli. Ignoré.');
    return;
  }

  // Liste initiale des emails autorises a s'inscrire (@egd.mg)
  // L'administrateur peut en ajouter/supprimer via le panel Admin du site
  const emailsAutorises = [
    ['admin@egd.mg'],
    // Ajoutez ici les emails des enseignants autorises a creer un compte
    // Exemple :
    // ['prenom.nom@egd.mg'],
  ];

  if (emailsAutorises.length > 0) {
    sheet.getRange(2, 1, emailsAutorises.length, 1).setValues(emailsAutorises);
  }

  Logger.log(emailsAutorises.length + ' email(s) autorises inseres. Ajoutez d\'autres via le panel Admin du site.');
}
