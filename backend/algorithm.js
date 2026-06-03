const db = require('./database');

//  Configuration 

const JOURS_COURS = ['Lundi', 'Mercredi', 'Vendredi'];
const JOURS_TD    = ['Mardi', 'Jeudi', 'Samedi'];
const TOUS_JOURS  = [...JOURS_COURS, ...JOURS_TD];

const CRENEAUX = [
  { heure_debut: '07:30', heure_fin: '11:30', duree: 4 },
  { heure_debut: '12:30', heure_fin: '16:30', duree: 4 },
  { heure_debut: '07:30', heure_fin: '16:30', duree: 8 }, // journée entière
];

// ─Helpers 

function profDisponible(prof, jour) {
  if (!prof.jours_disponibles) return true;
  const jours = JSON.parse(prof.jours_disponibles);
  return jours.includes(jour);
}

function aConflit(planning, jour, creneau, classeId, profId, salle) {
  return planning.some(slot =>
    slot.jour === jour &&
    slot.heure_debut === creneau.heure_debut &&
    (
      slot.professeur_id === profId ||
      slot.classe_id     === classeId ||
      (salle && slot.salle === salle)
    )
  );
}

function creerNotification(utilisateurId, message, type = 'info') {
  db.prepare(`
    INSERT INTO notifications (utilisateur_id, message, type)
    VALUES (?, ?, ?)
  `).run(utilisateurId, message, type);
}

function notifierTousLesEtudiants(classeId, message, type = 'info') {
  const etudiants = db.prepare(`
    SELECT id FROM utilisateurs WHERE classe_id = ? AND role = 'etudiant'
  `).all(classeId);
  for (const e of etudiants) {
    creerNotification(e.id, message, type);
  }
}

// Convertir une date en jour de la semaine
function _jourDeLaDate(dateStr) {
  const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const date  = new Date(dateStr);
  return jours[date.getDay()];
}

// 1. Générer l'emploi du temps 

function genererEmploiDuTemps(semaine = 1) {
  console.log(`\n🗓️  Génération semaine ${semaine}...`);

  const matieres    = db.prepare('SELECT * FROM matieres').all();
  const professeurs = db.prepare('SELECT * FROM professeurs').all();
  const classes     = db.prepare('SELECT * FROM classes').all();

  if (!matieres.length || !professeurs.length || !classes.length) {
    console.error('Données manquantes (matieres, professeurs ou classes vides).');
    return [];
  }

  db.prepare('DELETE FROM emplois_du_temps WHERE semaine = ?').run(semaine);

  const planning      = [];
  const heuresPlacees = {};

  for (const classe of classes) {
    for (const matiere of matieres) {

      const key          = `${classe.id}-${matiere.id}`;
      heuresPlacees[key] = 0;
      const heuresCible  = matiere.heures_semaine;
      const dureeCours   = matiere.duree_cours;

      const prof = professeurs.find(p => p.matiere_id === matiere.id);
      if (!prof) {
        console.warn(` Pas de professeur trouvé pour la matière "${matiere.nom}"`);
        continue;
      }

      const creneauxPossibles = CRENEAUX.filter(c => c.duree === dureeCours);
      if (!creneauxPossibles.length) {
        console.warn(`  Aucun créneau de durée ${dureeCours}h pour "${matiere.nom}"`);
        continue;
      }

      let tentatives = 0;

      while (heuresPlacees[key] < heuresCible && tentatives < 50) {
        tentatives++;

        const joursDispos = [...TOUS_JOURS]
          .filter(j => profDisponible(prof, j))
          .sort(() => Math.random() - 0.5);

        let place = false;

        for (const jour of joursDispos) {
          for (const creneau of creneauxPossibles) {
            if (!aConflit(planning, jour, creneau, classe.id, prof.id, prof.salle)) {
              planning.push({
                classe_id:     classe.id,
                matiere_id:    matiere.id,
                professeur_id: prof.id,
                jour,
                heure_debut:   creneau.heure_debut,
                heure_fin:     creneau.heure_fin,
                semaine,
                statut:        'normal',
                salle:         prof.salle || null,
              });
              heuresPlacees[key] += creneau.duree;
              place = true;
              break;
            }
          }
          if (place) break;
        }

        if (!place) {
          console.warn(` Impossible de placer "${matiere.nom}" pour "${classe.nom}" (conflit persistant)`);
          break;
        }
      }
    }
  }

  // Sauvegarder en base
  const insert = db.prepare(`
    INSERT INTO emplois_du_temps
      (classe_id, matiere_id, professeur_id, jour, heure_debut, heure_fin, semaine, statut)
    VALUES
      (@classe_id, @matiere_id, @professeur_id, @jour, @heure_debut, @heure_fin, @semaine, @statut)
  `);

  db.transaction((slots) => {
    for (const slot of slots) insert.run(slot);
  })(planning);

  console.log(` ${planning.length} créneaux générés pour la semaine ${semaine}.`);
  return planning;
}

// 2. Absence préventive (prof déclare à l'avance qu'il sera absent) 

function signalerAbsencePreventive(professeurId, dateAbsence, heureDebut = null, heureFin = null, motif = '') {
  // Vérifier si déjà signalée
  const dejaSignalee = db.prepare(`
    SELECT id FROM absences
    WHERE professeur_id = ? AND date_absence = ? AND type = 'preventive'
  `).get(professeurId, dateAbsence);

  if (dejaSignalee) {
    console.log('ℹ Absence préventive déjà enregistrée pour ce jour.');
    return { dejaSignalee: true, absenceId: dejaSignalee.id };
  }

  const result = db.prepare(`
    INSERT INTO absences (professeur_id, date_absence, heure_debut, heure_fin, type, motif)
    VALUES (?, ?, ?, ?, 'preventive', ?)
  `).run(professeurId, dateAbsence, heureDebut, heureFin, motif);

  const absenceId = result.lastInsertRowid;
  const jourSemaine = _jourDeLaDate(dateAbsence);

  // Trouver les cours concernés ce jour-là
  const coursAnnules = db.prepare(`
    SELECT e.*, c.nom AS classe_nom, m.nom AS matiere_nom
    FROM emplois_du_temps e
    JOIN classes  c ON e.classe_id  = c.id
    JOIN matieres m ON e.matiere_id = m.id
    WHERE e.professeur_id = ?
      AND e.jour = ?
      AND e.statut = 'normal'
  `).all(professeurId, jourSemaine);

  for (const cours of coursAnnules) {
    // Marquer le cours comme annulé
    db.prepare(`UPDATE emplois_du_temps SET statut = 'annule' WHERE id = ?`).run(cours.id);

    // Chercher et planifier un rattrapage
    const rattrapage = _trouverCreneauRattrapage(cours, absenceId);

    // Notifier les étudiants de la classe
    notifierTousLesEtudiants(
      cours.classe_id,
      ` Le cours de "${cours.matiere_nom}" du ${dateAbsence} est annulé (absence préventive).` +
      (rattrapage ? ` Rattrapage prévu le ${rattrapage.jour} à ${rattrapage.heure_debut}.` : ' Aucun rattrapage disponible pour l\'instant.'),
      'absence'
    );
  }

  // Notifier le professeur lui-même
  creerNotification(
    professeurId,
    ` Votre absence préventive du ${dateAbsence} a été enregistrée. ${coursAnnules.length} cours annulé(s).`,
    'info'
  );

  console.log(` Absence préventive enregistrée — prof ${professeurId}, date ${dateAbsence}, ${coursAnnules.length} cours annulé(s).`);
  return { absenceId, coursAnnules: coursAnnules.length };
}

// 3. Absence constatée (admin/étudiant signale que le prof était absent) 

function signalerAbsenceConstatee(professeurId, dateAbsence, signalePar, heureDebut = null, heureFin = null) {
  // Vérifier si déjà signalée
  const dejaSignalee = db.prepare(`
    SELECT id FROM absences
    WHERE professeur_id = ? AND date_absence = ? AND type = 'constatee'
  `).get(professeurId, dateAbsence);

  if (dejaSignalee) {
    console.log('ℹ  Absence constatée déjà signalée pour ce jour.');
    return { dejaSignalee: true, absenceId: dejaSignalee.id };
  }

  const result = db.prepare(`
    INSERT INTO absences (professeur_id, date_absence, heure_debut, heure_fin, type, signale_par)
    VALUES (?, ?, ?, ?, 'constatee', ?)
  `).run(professeurId, dateAbsence, heureDebut, heureFin, signalePar);

  const absenceId = result.lastInsertRowid;
  const jourSemaine = _jourDeLaDate(dateAbsence);

  // Trouver les cours concernés
  const coursAnnules = db.prepare(`
    SELECT e.*, c.nom AS classe_nom, m.nom AS matiere_nom
    FROM emplois_du_temps e
    JOIN classes  c ON e.classe_id  = c.id
    JOIN matieres m ON e.matiere_id = m.id
    WHERE e.professeur_id = ?
      AND e.jour = ?
      AND e.statut = 'normal'
  `).all(professeurId, jourSemaine);

  for (const cours of coursAnnules) {
    db.prepare(`UPDATE emplois_du_temps SET statut = 'annule' WHERE id = ?`).run(cours.id);

    const rattrapage = _trouverCreneauRattrapage(cours, absenceId);

    notifierTousLesEtudiants(
      cours.classe_id,
      ` Absence constatée pour le cours de "${cours.matiere_nom}" du ${dateAbsence}.` +
      (rattrapage ? ` Rattrapage prévu le ${rattrapage.jour} à ${rattrapage.heure_debut}.` : ' Aucun rattrapage disponible pour l\'instant.'),
      'absence'
    );
  }

  // Notifier le professeur concerné
  creerNotification(
    professeurId,
    `Une absence vous a été signalée pour le ${dateAbsence}. ${coursAnnules.length} cours marqué(s) annulé(s).`,
    'alerte'
  );

  console.log(` Absence constatée enregistrée — prof ${professeurId}, date ${dateAbsence}, ${coursAnnules.length} cours annulé(s).`);
  return { absenceId, coursAnnules: coursAnnules.length };
}

//  4. Trouver un créneau de rattrapage 

function _trouverCreneauRattrapage(cours, absenceId) {
  const creneauxPossibles = CRENEAUX.filter(c => c.duree === 4); // rattrapages = demi-journée

  for (const jour of TOUS_JOURS) {
    for (const creneau of creneauxPossibles) {

      // Vérifier pas de conflit dans emplois_du_temps
      const conflit = db.prepare(`
        SELECT id FROM emplois_du_temps
        WHERE (classe_id = ? OR professeur_id = ?)
          AND jour = ?
          AND heure_debut = ?
          AND statut != 'annule'
      `).get(cours.classe_id, cours.professeur_id, jour, creneau.heure_debut);

      // Vérifier pas de conflit dans rattrapages
      const conflitRattrapage = db.prepare(`
        SELECT id FROM rattrapages
        WHERE (classe_id = ? OR professeur_id = ?)
          AND jour = ?
          AND heure_debut = ?
          AND statut != 'annule'
      `).get(cours.classe_id, cours.professeur_id, jour, creneau.heure_debut);

      if (!conflit && !conflitRattrapage) {
        db.prepare(`
          INSERT INTO rattrapages
            (absence_id, emploi_du_temps_id, classe_id, matiere_id, professeur_id, jour, heure_debut, heure_fin, statut)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planifie')
        `).run(
          absenceId,
          cours.id,
          cours.classe_id,
          cours.matiere_id,
          cours.professeur_id,
          jour,
          creneau.heure_debut,
          creneau.heure_fin
        );

        console.log(`Rattrapage planifié : ${jour} ${creneau.heure_debut}-${creneau.heure_fin}`);
        return { jour, heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin };
      }
    }
  }

  console.warn(' Aucun créneau de rattrapage disponible.');
  return null;
}

// 5. Lire l'emploi du temps enrichi (avec noms matière, prof, classe) 

function getEmploiDuTemps(classeId, semaine = 1) {
  return db.prepare(`
    SELECT
      e.*,
      m.nom     AS matiere_nom,
      m.couleur AS matiere_couleur,
      p.nom     AS prof_nom,
      p.salle,
      c.nom     AS classe_nom
    FROM emplois_du_temps e
    JOIN matieres    m ON e.matiere_id    = m.id
    JOIN professeurs p ON e.professeur_id = p.id
    JOIN classes     c ON e.classe_id     = c.id
    WHERE e.classe_id = ? AND e.semaine = ?
    ORDER BY
      CASE e.jour
        WHEN 'Lundi'    THEN 1
        WHEN 'Mardi'    THEN 2
        WHEN 'Mercredi' THEN 3
        WHEN 'Jeudi'    THEN 4
        WHEN 'Vendredi' THEN 5
        WHEN 'Samedi'   THEN 6
      END,
      e.heure_debut
  `).all(classeId, semaine);
}

//  6. Lire les rattrapages planifiés 

function getRattrapages(classeId) {
  return db.prepare(`
    SELECT
      r.*,
      m.nom  AS matiere_nom,
      p.nom  AS prof_nom,
      p.salle
    FROM rattrapages r
    JOIN matieres    m ON r.matiere_id    = m.id
    JOIN professeurs p ON r.professeur_id = p.id
    WHERE r.classe_id = ? AND r.statut = 'planifie'
    ORDER BY r.jour, r.heure_debut
  `).all(classeId);
}

//  Exports 

module.exports = {
  genererEmploiDuTemps,
  signalerAbsencePreventive,
  signalerAbsenceConstatee,
  getEmploiDuTemps,
  getRattrapages,
};
