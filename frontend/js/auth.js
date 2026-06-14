// auth.js — gestion de la session JWT côté frontend

const TOKEN_KEY = 'edt_token';
const USER_KEY  = 'edt_user';

function sauvegarderSession(token, utilisateur) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(utilisateur));
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUtilisateur() {
  const data = localStorage.getItem(USER_KEY);
  return data ? JSON.parse(data) : null;
}

function deconnecter() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = 'index.html';
}

function verifierSession() {
  const token = getToken();
  const user  = getUtilisateur();
  if (!token || !user) {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

function headersAuth() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

// Afficher les infos utilisateur dans la sidebar
function afficherInfosUtilisateur() {
  const user = getUtilisateur();
  if (!user) return;

  const nameEl   = document.getElementById('user-name');
  const roleEl   = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl)   nameEl.textContent   = user.nom;
  if (roleEl)   roleEl.textContent   = user.role;
  if (avatarEl) avatarEl.textContent = user.nom.slice(0, 2).toUpperCase();
}
