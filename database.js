const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'emploidutemps.db'));

// Création des tables
db.exec(`
  CREATE TABLE IF NOT EXISTS matieres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    heures_semaine INTEGER NOT NULL,
    duree_cours INTEGER NOT NULL,
    couleur TEXT DEFAULT 'purple'
  );

  CREATE TABLE IF NOT EXISTS professeurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    matiere_id INTEGER,
    salle TEXT,
    jours_disponibles TEXT,
    FOREIGN KEY (matiere_id) REFERENCES matieres(id)
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    niveau TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS emplois_du_temps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classe_id INTEGER,
    matiere_id INTEGER,
    professeur_id INTEGER,
    jour TEXT NOT NULL,
    heure_debut TEXT NOT NULL,
    heure_fin TEXT NOT NULL,
    semaine INTEGER DEFAULT 1,
    FOREIGN KEY (classe_id) REFERENCES classes(id),
    FOREIGN KEY (matiere_id) REFERENCES matieres(id),
    FOREIGN KEY (professeur_id) REFERENCES professeurs(id)
  );
`);

console.log('Base de données prête !');

module.exports = db;