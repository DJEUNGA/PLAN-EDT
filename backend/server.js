// server.js
// Stack : Node.js + Express + better-sqlite3 + JWT + bcrypt + node-cron
// Hébergement prévu : Railway

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const fs       = require('fs');
const cron     = require('node-cron');

const db = require('./database');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'changez_ce_secret_en_production';

// ─────────────────────────────────────────
// ✅ RÉSOLUTION ROBUSTE DU DOSSIER FRONTEND
// Fonctionne peu importe d'où le process est lancé (Railway, local, etc.)
// ─────────────────────────────────────────

function trouverDossierFrontend() {
  const candidats = [
    path.join(__dirname, 'frontend'),             // ✅ priorité : copié dans backend/ via Start Command
    path.join(__dirname, '..', 'frontend'),      // backend/server.js -> ../frontend
    path.join(process.cwd(), 'frontend'),         // depuis la racine du process
    path.join(process.cwd(), 'backend', '..', 'frontend'),
    path.join(process.cwd(), 'backend', 'frontend'),
    '/app/frontend',                              // chemin absolu typique sur Railway
    '/app/backend/frontend',
  ];

  console.log('🔍 Diagnostic chemins :');
  console.log('   __dirname   =', __dirname);
  console.log('   process.cwd =', process.cwd());

  for (const candidat of candidats) {
    const existe = fs.existsSync(path.join(candidat, 'index.html'));
    console.log(`   Test: ${candidat} -> ${existe ? '✅ TROUVÉ' : '❌ absent'}`);
    if (existe) return candidat;
  }

  console.error('⚠️ Aucun dossier frontend valide trouvé ! Utilisation du chemin par défaut.');
  return path.join(__dirname, '..', 'frontend');
}

const FRONTEND_DIR = trouverDossierFrontend();
console.log('📁 Dossier frontend utilisé :', FRONTEND_DIR);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin:         process.env.FRONTEND_URL || '*',
  methods:        ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.static(FRONTEND_DIR));

// ─────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────

function authentifier(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ erreur: 'Token manquant. Accès refusé.' });
  try {
    req.utilisateur = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ erreur: 'Token invalide ou expiré.' });
  }
}

function autoriser(...rolesPermis) {
  return (req, res, next) => {
    if (!rolesPermis.includes(req.utilisateur.role)) {
      return res.status(403).json({ erreur: `Accès refusé. Rôle requis : ${rolesPermis.join(' ou ')}.` });
    }
    next();
  };
}

// ─────────────────────────────────────────
// HELPER : Numéro de semaine
// ─────────────────────────────────────────

function getSemaineCourante() {
  const maintenant = new Date();
  const debutAnnee = new Date(maintenant.getFullYear(), 0, 1);
  return Math.ceil(((maintenant - debutAnnee) / 86400000 + debutAnnee.getDay() + 1) / 7);
}

// ─────────────────────────────────────────
// ROUTE PRINCIPALE
// ─────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ═════════════════════════════════════════
// 1. AUTHENTIFICATION
// ═════════════════════════════════════════

app.post('/api/auth/inscription', async (req, res) => {
  const { nom, email, mot_de_passe, role, classe_id, professeur_id } = req.body;
  if (!nom || !email || !mot_de_passe || !role)
    return res.status(400).json({ erreur: 'Tous les champs sont obligatoires.' });
  if (!['admin', 'professeur', 'etudiant'].includes(role))
    return res.status(400).json({ erreur: 'Rôle invalide.' });
  try {
    const existant = db.prepare('SELECT id FROM utilisateurs WHERE email = ?').get(email);
    if (existant) return res.status(409).json({ erreur: 'Cet email est déjà utilisé.' });
    const hash   = await bcrypt.hash(mot_de_passe, 10);
    const result = db.prepare(`
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, classe_id, professeur_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nom, email, hash, role, classe_id || null, professeur_id || null);
    res.status(201).json({ message: 'Compte créé avec succès.', utilisateur_id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/auth/connexion', async (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe)
    return res.status(400).json({ erreur: 'Email et mot de passe requis.' });
  try {
    const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get(email);
    if (!utilisateur || !utilisateur.actif)
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect, ou compte désactivé.' });
    const valide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!valide) return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    const token = jwt.sign(
      { id: utilisateur.id, nom: utilisateur.nom, email: utilisateur.email,
        role: utilisateur.role, classe_id: utilisateur.classe_id, professeur_id: utilisateur.professeur_id },
      JWT_SECRET, { expiresIn: '8h' }
    );
    res.json({ message: 'Connexion réussie.', token,
      utilisateur: { id: utilisateur.id, nom: utilisateur.nom, email: utilisateur.email,
        role: utilisateur.role, classe_id: utilisateur.classe_id, professeur_id: utilisateur.professeur_id }
    });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 2. MATIÈRES
// ═════════════════════════════════════════

app.get('/api/matieres', authentifier, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM matieres').all()); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/matieres', authentifier, autoriser('admin'), (req, res) => {
  const { nom, heures_semaine, duree_cours, couleur } = req.body;
  if (!nom || !heures_semaine || !duree_cours)
    return res.status(400).json({ erreur: 'nom, heures_semaine et duree_cours sont requis.' });
  if (![2, 4, 8].includes(Number(duree_cours)))
    return res.status(400).json({ erreur: 'duree_cours doit être 2, 4 ou 8 heures.' });
  try {
    const result = db.prepare(
      'INSERT INTO matieres (nom, heures_semaine, duree_cours, couleur) VALUES (?, ?, ?, ?)'
    ).run(nom, heures_semaine, duree_cours, couleur || 'purple');
    res.status(201).json({ message: 'Matière ajoutée.', id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/matieres/:id', authentifier, autoriser('admin'), (req, res) => {
  const { nom, heures_semaine, duree_cours, couleur } = req.body;
  try {
    db.prepare('UPDATE matieres SET nom = ?, heures_semaine = ?, duree_cours = ?, couleur = ? WHERE id = ?')
      .run(nom, heures_semaine, duree_cours, couleur, req.params.id);
    res.json({ message: 'Matière mise à jour.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.delete('/api/matieres/:id', authentifier, autoriser('admin'), (req, res) => {
  try { db.prepare('DELETE FROM matieres WHERE id = ?').run(req.params.id); res.json({ message: 'Matière supprimée.' }); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 3. PROFESSEURS
// ═════════════════════════════════════════

app.get('/api/professeurs', authentifier, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM professeurs').all()); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/professeurs', authentifier, autoriser('admin'), (req, res) => {
  const { nom, matiere_id, salle, jours_disponibles } = req.body;
  if (!nom) return res.status(400).json({ erreur: 'Le nom est requis.' });
  try {
    const result = db.prepare('INSERT INTO professeurs (nom, matiere_id, salle, jours_disponibles) VALUES (?, ?, ?, ?)')
      .run(nom, matiere_id || null, salle || null, jours_disponibles || null);
    res.status(201).json({ message: 'Professeur ajouté.', id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/professeurs/:id', authentifier, autoriser('admin'), (req, res) => {
  const { nom, matiere_id, salle, jours_disponibles } = req.body;
  try {
    db.prepare('UPDATE professeurs SET nom = ?, matiere_id = ?, salle = ?, jours_disponibles = ? WHERE id = ?')
      .run(nom, matiere_id, salle, jours_disponibles || null, req.params.id);
    res.json({ message: 'Professeur mis à jour.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.delete('/api/professeurs/:id', authentifier, autoriser('admin'), (req, res) => {
  try { db.prepare('DELETE FROM professeurs WHERE id = ?').run(req.params.id); res.json({ message: 'Professeur supprimé.' }); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 4. CLASSES
// ═════════════════════════════════════════

app.get('/api/classes', authentifier, (req, res) => {
  try { res.json(db.prepare('SELECT * FROM classes').all()); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/classes', authentifier, autoriser('admin'), (req, res) => {
  const { nom, niveau } = req.body;
  if (!nom || !niveau) return res.status(400).json({ erreur: 'nom et niveau sont requis.' });
  try {
    const result = db.prepare('INSERT INTO classes (nom, niveau) VALUES (?, ?)').run(nom, niveau);
    res.status(201).json({ message: 'Classe ajoutée.', id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/classes/:id', authentifier, autoriser('admin'), (req, res) => {
  const { nom, niveau } = req.body;
  try {
    db.prepare('UPDATE classes SET nom = ?, niveau = ? WHERE id = ?').run(nom, niveau, req.params.id);
    res.json({ message: 'Classe mise à jour.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.delete('/api/classes/:id', authentifier, autoriser('admin'), (req, res) => {
  try { db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id); res.json({ message: 'Classe supprimée.' }); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 5. EMPLOIS DU TEMPS
// ═════════════════════════════════════════

app.get('/api/emplois', authentifier, (req, res) => {
  const { classe_id, semaine } = req.query;
  try {
    let query = 'SELECT * FROM emplois_du_temps WHERE 1=1';
    const params = [];
    if (classe_id) { query += ' AND classe_id = ?'; params.push(classe_id); }
    if (semaine)   { query += ' AND semaine = ?';   params.push(semaine); }
    res.json(db.prepare(query).all(...params));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.get('/api/emplois/detail', authentifier, (req, res) => {
  const { classe_id, semaine } = req.query;
  if (!classe_id) return res.status(400).json({ erreur: 'classe_id est requis.' });
  try {
    const { getEmploiDuTemps } = require('./algorithm');
    return res.json(getEmploiDuTemps(Number(classe_id), Number(semaine) || 1));
  } catch (err) { return res.status(500).json({ erreur: err.message }); }
});

// POST génération manuelle
app.post('/api/emplois/generer', authentifier, autoriser('admin'), (req, res) => {
  const { semaine } = req.body;
  if (!semaine) return res.status(400).json({ erreur: 'semaine est requise.' });
  try {
    const { genererEmploiDuTemps } = require('./algorithm');
    const resultat = genererEmploiDuTemps(Number(semaine));
    return res.json({ message: `Emploi du temps généré : ${resultat.length} créneaux.`, total: resultat.length });
  } catch (err) {
    console.error('❌ Erreur génération:', err.message);
    return res.status(500).json({ erreur: err.message });
  }
});

app.delete('/api/emplois/:id', authentifier, autoriser('admin'), (req, res) => {
  try { db.prepare('DELETE FROM emplois_du_temps WHERE id = ?').run(req.params.id); res.json({ message: 'Créneau supprimé.' }); }
  catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 6. ABSENCES
// ═════════════════════════════════════════

app.get('/api/absences', authentifier, (req, res) => {
  const { professeur_id, type } = req.query;
  try {
    let query = 'SELECT * FROM absences WHERE 1=1';
    const params = [];
    if (professeur_id) { query += ' AND professeur_id = ?'; params.push(professeur_id); }
    if (type)          { query += ' AND type = ?';          params.push(type); }
    res.json(db.prepare(query).all(...params));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/absences/preventive', authentifier, autoriser('admin', 'professeur'), (req, res) => {
  const { professeur_id, date_absence, heure_debut, heure_fin, motif } = req.body;
  if (!professeur_id || !date_absence)
    return res.status(400).json({ erreur: 'professeur_id et date_absence sont requis.' });
  if (req.utilisateur.role === 'professeur' && req.utilisateur.professeur_id !== professeur_id)
    return res.status(403).json({ erreur: 'Vous ne pouvez déclarer que vos propres absences.' });
  try {
    const { signalerAbsencePreventive } = require('./algorithm');
    const resultat = signalerAbsencePreventive(professeur_id, date_absence, heure_debut, heure_fin, motif);
    res.status(201).json({ message: 'Absence préventive enregistrée.', ...resultat });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.post('/api/absences/constatee', authentifier, autoriser('admin', 'etudiant'), (req, res) => {
  const { professeur_id, date_absence, heure_debut, heure_fin } = req.body;
  if (!professeur_id || !date_absence)
    return res.status(400).json({ erreur: 'professeur_id et date_absence sont requis.' });
  try {
    const { signalerAbsenceConstatee } = require('./algorithm');
    const resultat = signalerAbsenceConstatee(professeur_id, date_absence, req.utilisateur.id, heure_debut, heure_fin);
    res.status(201).json({ message: 'Absence constatée enregistrée.', ...resultat });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 7. RATTRAPAGES
// ═════════════════════════════════════════

app.get('/api/rattrapages', authentifier, (req, res) => {
  const { classe_id, statut } = req.query;
  try {
    let query = 'SELECT * FROM rattrapages WHERE 1=1';
    const params = [];
    if (classe_id) { query += ' AND classe_id = ?'; params.push(classe_id); }
    if (statut)    { query += ' AND statut = ?';    params.push(statut); }
    res.json(db.prepare(query).all(...params));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.get('/api/rattrapages/planifies', authentifier, (req, res) => {
  const { classe_id } = req.query;
  if (!classe_id) return res.status(400).json({ erreur: 'classe_id est requis.' });
  try {
    const { getRattrapages } = require('./algorithm');
    res.json(getRattrapages(Number(classe_id)));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/rattrapages/:id/statut', authentifier, autoriser('admin'), (req, res) => {
  const { statut } = req.body;
  if (!['effectue', 'annule'].includes(statut))
    return res.status(400).json({ erreur: "statut doit être 'effectue' ou 'annule'." });
  try {
    db.prepare('UPDATE rattrapages SET statut = ? WHERE id = ?').run(statut, req.params.id);
    res.json({ message: `Rattrapage marqué comme ${statut}.` });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 8. NOTIFICATIONS
// ═════════════════════════════════════════

app.get('/api/notifications', authentifier, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM notifications WHERE utilisateur_id = ? ORDER BY created_at DESC').all(req.utilisateur.id));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.get('/api/notifications/nonlues', authentifier, (req, res) => {
  try {
    res.json(db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE utilisateur_id = ? AND lu = 0').get(req.utilisateur.id));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/notifications/:id/lue', authentifier, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET lu = 1 WHERE id = ? AND utilisateur_id = ?').run(req.params.id, req.utilisateur.id);
    res.json({ message: 'Notification marquée comme lue.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/notifications/touteslues', authentifier, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET lu = 1 WHERE utilisateur_id = ?').run(req.utilisateur.id);
    res.json({ message: 'Toutes les notifications marquées comme lues.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 9. PROFIL
// ═════════════════════════════════════════

app.get('/api/profil', authentifier, (req, res) => {
  try {
    res.json(db.prepare('SELECT id, nom, email, role, classe_id, professeur_id, actif, created_at FROM utilisateurs WHERE id = ?').get(req.utilisateur.id));
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/profil/mot-de-passe', authentifier, async (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
  if (!ancien_mot_de_passe || !nouveau_mot_de_passe)
    return res.status(400).json({ erreur: 'Les deux mots de passe sont requis.' });
  try {
    const utilisateur = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
    const valide = await bcrypt.compare(ancien_mot_de_passe, utilisateur.mot_de_passe);
    if (!valide) return res.status(401).json({ erreur: 'Ancien mot de passe incorrect.' });
    const nouveauHash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(nouveauHash, req.utilisateur.id);
    res.json({ message: 'Mot de passe mis à jour avec succès.' });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ═════════════════════════════════════════
// 10. UTILISATEURS (admin)
// ═════════════════════════════════════════

app.get('/api/utilisateurs', authentifier, autoriser('admin'), (req, res) => {
  try {
    res.json(db.prepare('SELECT id, nom, email, role, classe_id, professeur_id, actif, created_at FROM utilisateurs').all());
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ✅ Création d'un utilisateur par l'admin
app.post('/api/utilisateurs', authentifier, autoriser('admin'), async (req, res) => {
  const { nom, email, mot_de_passe, role, classe_id, professeur_id } = req.body;

  if (!nom || !email || !mot_de_passe || !role)
    return res.status(400).json({ erreur: 'Tous les champs sont obligatoires.' });
  if (!['admin', 'professeur', 'etudiant'].includes(role))
    return res.status(400).json({ erreur: 'Rôle invalide.' });
  if (role === 'etudiant' && !classe_id)
    return res.status(400).json({ erreur: 'Une classe est requise pour un étudiant.' });
  if (role === 'professeur' && !professeur_id)
    return res.status(400).json({ erreur: 'Un profil professeur est requis.' });

  try {
    const existant = db.prepare('SELECT id FROM utilisateurs WHERE email = ?').get(email);
    if (existant) return res.status(409).json({ erreur: 'Cet email est déjà utilisé.' });

    const hash   = await bcrypt.hash(mot_de_passe, 10);
    const result = db.prepare(`
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, classe_id, professeur_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nom, email, hash, role, classe_id || null, professeur_id || null);

    res.status(201).json({ message: 'Utilisateur créé avec succès.', id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

app.put('/api/utilisateurs/:id/actif', authentifier, autoriser('admin'), (req, res) => {
  const { actif } = req.body;
  if (![0, 1].includes(Number(actif))) return res.status(400).json({ erreur: 'actif doit être 0 ou 1.' });
  try {
    db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?').run(actif, req.params.id);
    res.json({ message: `Compte ${actif ? 'activé' : 'désactivé'}.` });
  } catch (err) { res.status(500).json({ erreur: err.message }); }
});

// ─────────────────────────────────────────
// 404
// ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ erreur: `Route introuvable : ${req.method} ${req.path}` });
});

// ═════════════════════════════════════════
// ⏰ GÉNÉRATION AUTOMATIQUE — Chaque Dimanche à 23h00
// ═════════════════════════════════════════
cron.schedule('0 23 * * 0', () => {
  console.log('\n⏰ Génération automatique de l\'emploi du temps (tâche planifiée)...');
  try {
    const { genererEmploiDuTemps } = require('./algorithm');
    const semaine = getSemaineCourante() + 1; // semaine suivante
    genererEmploiDuTemps(semaine);
    console.log(`✅ EDT semaine ${semaine} généré automatiquement !`);
  } catch(e) {
    console.error('❌ Erreur génération automatique:', e.message);
  }
}, {
  timezone: 'Africa/Douala' // Fuseau horaire Cameroun
});

// ─────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`📌 Environnement : ${process.env.NODE_ENV || 'développement'}`);
  console.log(`⏰ Génération automatique : chaque Dimanche à 23h00 (heure de Douala)`);
});

module.exports = app;
