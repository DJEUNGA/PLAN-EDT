const db = require('./database');
const bcrypt = require('bcrypt');
const hash = bcrypt.hashSync('admin123', 10);
db.prepare('INSERT INTO utilisateurs (nom, email, mot_de_passe, role) VALUES (?, ?, ?, ?)').run('Administrateur', 'admin@planedt.com', hash, 'admin');
console.log('Admin créé avec succès !');
process.exit();