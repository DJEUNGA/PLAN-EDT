const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'emploidutemps.db'));

// Active les clés étrangères
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Création des tables 

db.exec(`

  -- Matières
  CREATE TABLE IF NOT EXISTS matieres (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nom            TEXT    NOT NULL,
    heures_semaine INTEGER NOT NULL,
    duree_cours    INTEGER NOT NULL,  -- en heures (4 ou 8)
    couleur        TEXT    DEFAULT 'purple'
  );

  -- Professeurs
  CREATE TABLE IF NOT EXISTS professeurs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nom               TEXT    NOT NULL,
    matiere_id        INTEGER,
    salle             TEXT,
    jours_disponibles TEXT,           -- JSON ex: ["Lundi","Mercredi","Vendredi"]
    FOREIGN KEY (matiere_id) REFERENCES matieres(id)
  );

  -- Classes
  CREATE TABLE IF NOT EXISTS classes (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nom    TEXT NOT NULL,
    niveau TEXT NOT NULL
  );

  -- Emplois du temps générés
  CREATE TABLE IF NOT EXISTS emplois_du_temps (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    classe_id      INTEGER NOT NULL,
    matiere_id     INTEGER NOT NULL,
    professeur_id  INTEGER NOT NULL,
    jour           TEXT    NOT NULL,
    heure_debut    TEXT    NOT NULL,
    heure_fin      TEXT    NOT NULL,
    semaine        INTEGER DEFAULT 1,
    statut         TEXT    DEFAULT 'normal', -- normal | annule | rattrapage
    FOREIGN KEY (classe_id)     REFERENCES classes(id),
    FOREIGN KEY (matiere_id)    REFERENCES matieres(id),
    FOREIGN KEY (professeur_id) REFERENCES professeurs(id)
  );

  -- Utilisateurs (admin, professeurs, étudiants)
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nom        TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    mot_de_passe TEXT  NOT NULL,          -- hashé avec bcrypt
    role       TEXT    NOT NULL DEFAULT 'etudiant', -- admin | professeur | etudiant
    classe_id  INTEGER,                   -- pour les étudiants
    professeur_id INTEGER,                -- pour les professeurs
    actif      INTEGER DEFAULT 1,         -- 1 = actif, 0 = bloqué
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (classe_id)     REFERENCES classes(id),
    FOREIGN KEY (professeur_id) REFERENCES professeurs(id)
  );

  -- Absences (préventives ou constatées)
  CREATE TABLE IF NOT EXISTS absences (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    professeur_id  INTEGER NOT NULL,
    date_absence   TEXT    NOT NULL,       -- ex: '2024-03-18'
    heure_debut    TEXT,                   -- null = toute la journée
    heure_fin      TEXT,
    type           TEXT    DEFAULT 'preventive', -- preventive | constatee
    motif          TEXT,
    signale_par    INTEGER,                -- utilisateur_id qui a signalé
    created_at     TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (professeur_id) REFERENCES professeurs(id),
    FOREIGN KEY (signale_par)   REFERENCES utilisateurs(id)
  );

  -- Rattrapages générés automatiquement
  CREATE TABLE IF NOT EXISTS rattrapages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    absence_id          INTEGER NOT NULL,
    emploi_du_temps_id  INTEGER,           -- créneau original annulé
    classe_id           INTEGER NOT NULL,
    matiere_id          INTEGER NOT NULL,
    professeur_id       INTEGER NOT NULL,
    jour                TEXT    NOT NULL,
    heure_debut         TEXT    NOT NULL,
    heure_fin           TEXT    NOT NULL,
    statut              TEXT    DEFAULT 'planifie', -- planifie | effectue | annule
    created_at          TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (absence_id)          REFERENCES absences(id),
    FOREIGN KEY (emploi_du_temps_id)  REFERENCES emplois_du_temps(id),
    FOREIGN KEY (classe_id)           REFERENCES classes(id),
    FOREIGN KEY (matiere_id)          REFERENCES matieres(id),
    FOREIGN KEY (professeur_id)       REFERENCES professeurs(id)
  );

  -- Notifications (pour alerter profs et étudiants)
  CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL,
    message      TEXT    NOT NULL,
    type         TEXT    DEFAULT 'info',  -- info | absence | rattrapage | alerte
    lu           INTEGER DEFAULT 0,       -- 0 = non lu, 1 = lu
    created_at   TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id)
  );

`);

console.log('Base de données prête !');

module.exports = db;
