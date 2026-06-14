const db = require('./database');

// ─── Configuration ─────────────────────────────────────────────────────────────

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Créneaux de 2h style ENSPD
const CRENEAUX = [
  { heure_debut: '07:30', heure_fin: '09:30', duree: 2 },
  { heure_debut: '09:30', heure_fin: '11:30', duree: 2 },
  { heure_debut: '12:30', heure_fin: '14:30', duree: 2 },
  { heure_debut: '14:30', heure_fin: '16:30', duree: 2 },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Vérifie si un prof est disponible un jour ET un créneau précis.
 * disponibilites format JSON :
 * {
 *   "Mardi":  ["07:30-09:30", "09:30-11:30"],
 *   "Jeudi":  ["12:30-14:30", "14:30-16:30"]
 * }
 * Si disponibilites est null ou vide → disponible partout.
 */
function profDisponible(prof, jour, creneau) {
  if (!prof.jours_disponibles) return true;
  try {
    const dispos = JSON.parse(prof.jours_disponibles);

    // Ancien format : tableau de jours ["Lundi", "Mardi", ...]
    if (Array.isArray(dispos)) {
      return dispos.includes(jour);
    }

    // Nouveau format : objet { "Mardi": ["07:30-09:30", ...] }
    if (!dispos[jour]) return false;
    if (!creneau) return true;

    const cleCreneau = `${creneau.heure_debut}-${creneau.heure_fin}`;
    return dispos[jour].includes(cleCreneau);

  } catch {
    return true;
  }
}

/**
 * Vérifie s'il y a un conflit dans le planning en cours de construction.
 * Même prof OU même classe OU même salle au même créneau → conflit.
 * Exception : même matière dans des salles différentes (TD parallèles) → pas conflit.
 */
function aConflit(planning, jour, creneau, classeId, profId, salle, matiereId) {
  return planning.some(slot => {
    if (slot.jour !== jour || slot.heure_debut !== creneau.heure_debut) return false;
    if (slot.classe_id === classeId) return true;
    if (slot.professeur_id === profId && slot.matiere_id !== matiereId) return true;
    if (salle && slot.salle === salle) return true;
    return false;
  });
}

function creerNotification(utilisateurId, message, type = 'info') {
  try {
    db.prepare(`INSERT INTO notifications (utilisateur_id, message, type) VALUES (?, ?, ?)`)
      .run(utilisateurId, message, type);
  } catch(e) {}
}

function notifierTousLesEtudiants(classeId, message, type = 'info') {
  try {
    const etudiants = db.prepare(
      `SELECT id FROM utilisateurs WHERE classe_id = ? AND role = 'etudiant'`
    ).all(classeId);
    for (const e of etudiants) creerNotification(e.id, message, type);
  } catch(e) {}
}

function _jourDeLaDate(dateStr) {
  const jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  return jours[new Date(dateStr).getDay()];
}

// ─── 1. Générer l'emploi du temps ──────────────────────────────────────────────

function genererEmploiDuTemps(semaine = 1) {
  console.log(`\n🗓️  Génération semaine ${semaine}...`);

  const matieres    = db.prepare('SELECT * FROM matieres').all();
  const professeurs = db.prepare('SELECT * FROM professeurs').all();
  const classes     = db.prepare('SELECT * FROM classes').all();

  if (!matieres.length || !professeurs.length || !classes.length) {
    throw new Error('Données insuffisantes (matières, professeurs ou classes manquantes).');
  }

  db.prepare('DELETE FROM emplois_du_temps WHERE semaine = ?').run(semaine);

  const planning = [];

  for (const classe of classes) {
    for (const matiere of matieres) {

      const heuresCible = matiere.heures_semaine;
      const dureeCours  = matiere.duree_cours;
      let heuresPlacees = 0;

      // Tous les profs de cette matière
      const profs = professeurs.filter(p => p.matiere_id === matiere.id);
      if (!profs.length) {
        console.warn(`⚠️  Pas de professeur pour "${matiere.nom}"`);
        continue;
      }

      const creneauxPossibles = CRENEAUX.filter(c => c.duree === dureeCours);
      if (!creneauxPossibles.length) {
        console.warn(`⚠️  Aucun créneau de durée ${dureeCours}h pour "${matiere.nom}"`);
        continue;
      }

      let profIndex = 0;

      // Parcourir tous les jours et créneaux
      for (const jour of JOURS) {
        if (heuresPlacees >= heuresCible) break;

        for (const creneau of creneauxPossibles) {
          if (heuresPlacees >= heuresCible) break;

          // Trouver un prof disponible ce jour ET ce créneau précis
          const profDispo = profs.find(p => profDisponible(p, jour, creneau));
          if (!profDispo) continue;

          if (!aConflit(planning, jour, creneau, classe.id, profDispo.id, profDispo.salle, matiere.id)) {
            planning.push({
              classe_id:     classe.id,
              matiere_id:    matiere.id,
              professeur_id: profDispo.id,
              jour,
              heure_debut:   creneau.heure_debut,
              heure_fin:     creneau.heure_fin,
              semaine,
              statut:        'normal',
              salle:         profDispo.salle || null,
            });
            heuresPlacees += creneau.duree;
            profIndex++;
            console.log(`✅ Placé : ${matiere.nom} - ${classe.nom} - ${jour} ${creneau.heure_debut} (${profDispo.nom})`);
          }
        }
      }

      if (heuresPlacees < heuresCible) {
        console.warn(`⚠️  ${heuresPlacees}h/${heuresCible}h placées pour "${matiere.nom}" - "${classe.nom}"`);
      }
    }
  }

  if (planning.length === 0) {
    throw new Error("Aucun créneau n'a pu être planifié. Vérifiez les disponibilités des professeurs.");
  }

  const insert = db.prepare(`
    INSERT INTO emplois_du_temps
      (classe_id, matiere_id, professeur_id, jour, heure_debut, heure_fin, semaine, statut, salle)
    VALUES
      (@classe_id, @matiere_id, @professeur_id, @jour, @heure_debut, @heure_fin, @semaine, @statut, @salle)
  `);

  db.transaction((slots) => {
    for (const slot of slots) insert.run(slot);
  })(planning);

  console.log(`✅ ${planning.length} créneaux générés pour la semaine ${semaine}.`);
  return planning;
}

// ─── 2. Absence préventive ─────────────────────────────────────────────────────

function signalerAbsencePreventive(professeurId, dateAbsence, heureDebut = null, heureFin = null, motif = '') {
  const dejaSignalee = db.prepare(`
    SELECT id FROM absences WHERE professeur_id = ? AND date_absence = ? AND type = 'preventive'
  `).get(professeurId, dateAbsence);
  if (dejaSignalee) return { dejaSignalee: true, absenceId: dejaSignalee.id };

  const result = db.prepare(`
    INSERT INTO absences (professeur_id, date_absence, heure_debut, heure_fin, type, motif)
    VALUES (?, ?, ?, ?, 'preventive', ?)
  `).run(professeurId, dateAbsence, heureDebut, heureFin, motif);

  const absenceId   = result.lastInsertRowid;
  const jourSemaine = _jourDeLaDate(dateAbsence);

  const coursAnnules = db.prepare(`
    SELECT e.*, c.nom AS classe_nom, m.nom AS matiere_nom
    FROM emplois_du_temps e
    JOIN classes  c ON e.classe_id  = c.id
    JOIN matieres m ON e.matiere_id = m.id
    WHERE e.professeur_id = ? AND e.jour = ? AND e.statut = 'normal'
  `).all(professeurId, jourSemaine);

  for (const cours of coursAnnules) {
    db.prepare(`UPDATE emplois_du_temps SET statut = 'annule' WHERE id = ?`).run(cours.id);
    const rattrapage = _trouverCreneauRattrapage(cours, absenceId);
    notifierTousLesEtudiants(
      cours.classe_id,
      `⚠️ Cours de "${cours.matiere_nom}" du ${dateAbsence} annulé.` +
      (rattrapage ? ` Rattrapage le ${rattrapage.jour} à ${rattrapage.heure_debut}.` : ''),
      'absence'
    );
  }

  creerNotification(professeurId,
    `📅 Absence du ${dateAbsence} enregistrée. ${coursAnnules.length} cours annulé(s).`, 'info');
  return { absenceId, coursAnnules: coursAnnules.length };
}

// ─── 3. Absence constatée ──────────────────────────────────────────────────────

function signalerAbsenceConstatee(professeurId, dateAbsence, signalePar, heureDebut = null, heureFin = null) {
  const dejaSignalee = db.prepare(`
    SELECT id FROM absences WHERE professeur_id = ? AND date_absence = ? AND type = 'constatee'
  `).get(professeurId, dateAbsence);
  if (dejaSignalee) return { dejaSignalee: true, absenceId: dejaSignalee.id };

  const result = db.prepare(`
    INSERT INTO absences (professeur_id, date_absence, heure_debut, heure_fin, type, signale_par)
    VALUES (?, ?, ?, ?, 'constatee', ?)
  `).run(professeurId, dateAbsence, heureDebut, heureFin, signalePar);

  const absenceId   = result.lastInsertRowid;
  const jourSemaine = _jourDeLaDate(dateAbsence);

  const coursAnnules = db.prepare(`
    SELECT e.*, c.nom AS classe_nom, m.nom AS matiere_nom
    FROM emplois_du_temps e
    JOIN classes  c ON e.classe_id  = c.id
    JOIN matieres m ON e.matiere_id = m.id
    WHERE e.professeur_id = ? AND e.jour = ? AND e.statut = 'normal'
  `).all(professeurId, jourSemaine);

  for (const cours of coursAnnules) {
    db.prepare(`UPDATE emplois_du_temps SET statut = 'annule' WHERE id = ?`).run(cours.id);
    const rattrapage = _trouverCreneauRattrapage(cours, absenceId);
    notifierTousLesEtudiants(
      cours.classe_id,
      `📌 Absence constatée pour "${cours.matiere_nom}" du ${dateAbsence}.` +
      (rattrapage ? ` Rattrapage le ${rattrapage.jour} à ${rattrapage.heure_debut}.` : ''),
      'absence'
    );
  }

  creerNotification(professeurId,
    `📌 Absence signalée pour le ${dateAbsence}.`, 'alerte');
  return { absenceId, coursAnnules: coursAnnules.length };
}

// ─── 4. Trouver un créneau de rattrapage ───────────────────────────────────────

function _trouverCreneauRattrapage(cours, absenceId) {
  for (const jour of JOURS) {
    for (const creneau of CRENEAUX) {
      const conflit = db.prepare(`
        SELECT id FROM emplois_du_temps
        WHERE (classe_id = ? OR professeur_id = ?)
          AND jour = ? AND heure_debut = ? AND statut != 'annule'
      `).get(cours.classe_id, cours.professeur_id, jour, creneau.heure_debut);

      const conflitRattrapage = db.prepare(`
        SELECT id FROM rattrapages
        WHERE (classe_id = ? OR professeur_id = ?)
          AND jour = ? AND heure_debut = ? AND statut != 'annule'
      `).get(cours.classe_id, cours.professeur_id, jour, creneau.heure_debut);

      if (!conflit && !conflitRattrapage) {
        db.prepare(`
          INSERT INTO rattrapages
            (absence_id, emploi_du_temps_id, classe_id, matiere_id, professeur_id, jour, heure_debut, heure_fin, statut)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planifie')
        `).run(absenceId, cours.id, cours.classe_id, cours.matiere_id,
               cours.professeur_id, jour, creneau.heure_debut, creneau.heure_fin);
        console.log(`✅ Rattrapage : ${jour} ${creneau.heure_debut}-${creneau.heure_fin}`);
        return { jour, heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin };
      }
    }
  }
  console.warn('⚠️  Aucun créneau de rattrapage disponible.');
  return null;
}

// ─── 5. Lire l'emploi du temps ─────────────────────────────────────────────────

function getEmploiDuTemps(classeId, semaine = 1) {
  return db.prepare(`
    SELECT e.*, m.nom AS matiere_nom, m.couleur AS matiere_couleur,
           p.nom AS prof_nom, p.salle, c.nom AS classe_nom,
           m.heures_semaine AS heures_total
    FROM emplois_du_temps e
    JOIN matieres    m ON e.matiere_id    = m.id
    JOIN professeurs p ON e.professeur_id = p.id
    JOIN classes     c ON e.classe_id     = c.id
    WHERE e.classe_id = ? AND e.semaine = ?
    ORDER BY
      CASE e.jour
        WHEN 'Lundi'    THEN 1 WHEN 'Mardi'    THEN 2
        WHEN 'Mercredi' THEN 3 WHEN 'Jeudi'    THEN 4
        WHEN 'Vendredi' THEN 5 WHEN 'Samedi'   THEN 6
      END, e.heure_debut
  `).all(classeId, semaine);
}

// ─── 6. Lire les rattrapages ───────────────────────────────────────────────────

function getRattrapages(classeId) {
  return db.prepare(`
    SELECT r.*, m.nom AS matiere_nom, p.nom AS prof_nom, p.salle
    FROM rattrapages r
    JOIN matieres    m ON r.matiere_id    = m.id
    JOIN professeurs p ON r.professeur_id = p.id
    WHERE r.classe_id = ? AND r.statut = 'planifie'
    ORDER BY r.jour, r.heure_debut
  `).all(classeId);
}

module.exports = {
  genererEmploiDuTemps,
  signalerAbsencePreventive,
  signalerAbsenceConstatee,
  getEmploiDuTemps,
  getRattrapages,
};
