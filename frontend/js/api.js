// api.js — fonctions d'appel vers le backend Express

const API = 'http://localhost:3000';

async function apiGet(url) {
  const res = await fetch(`${API}${url}`, { headers: headersAuth() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

async function apiPost(url, body) {
  const res = await fetch(`${API}${url}`, {
    method:  'POST',
    headers: headersAuth(),
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

async function apiPut(url, body) {
  const res = await fetch(`${API}${url}`, {
    method:  'PUT',
    headers: headersAuth(),
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

async function apiDelete(url) {
  const res = await fetch(`${API}${url}`, {
    method:  'DELETE',
    headers: headersAuth(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

// ── Matières ────────────────────────────────────────────
const Matieres = {
  lister:     ()     => apiGet('/api/matieres'),
  ajouter:    (data) => apiPost('/api/matieres', data),
  modifier:   (id, data) => apiPut(`/api/matieres/${id}`, data),
  supprimer:  (id)   => apiDelete(`/api/matieres/${id}`),
};

// ── Professeurs ─────────────────────────────────────────
const Professeurs = {
  lister:     ()     => apiGet('/api/professeurs'),
  ajouter:    (data) => apiPost('/api/professeurs', data),
  modifier:   (id, data) => apiPut(`/api/professeurs/${id}`, data),
  supprimer:  (id)   => apiDelete(`/api/professeurs/${id}`),
};

// ── Classes ─────────────────────────────────────────────
const Classes = {
  lister:     ()     => apiGet('/api/classes'),
  ajouter:    (data) => apiPost('/api/classes', data),
  modifier:   (id, data) => apiPut(`/api/classes/${id}`, data),
  supprimer:  (id)   => apiDelete(`/api/classes/${id}`),
};

// ── Emplois du temps ────────────────────────────────────
const Emplois = {
  detail:     (classe_id, semaine) => apiGet(`/api/emplois/detail?classe_id=${classe_id}&semaine=${semaine}`),
  generer:    (semaine) => apiPost('/api/emplois/generer', { semaine }),
  supprimer:  (id)      => apiDelete(`/api/emplois/${id}`),
};

// ── Absences ────────────────────────────────────────────
const Absences = {
  lister:      (params = '') => apiGet(`/api/absences${params}`),
  preventive:  (data)  => apiPost('/api/absences/preventive', data),
  constatee:   (data)  => apiPost('/api/absences/constatee', data),
};

// ── Rattrapages ─────────────────────────────────────────
const Rattrapages = {
  planifies:   (classe_id) => apiGet(`/api/rattrapages/planifies?classe_id=${classe_id}`),
  majStatut:   (id, statut) => apiPut(`/api/rattrapages/${id}/statut`, { statut }),
};

// ── Notifications ───────────────────────────────────────
const Notifications = {
  lister:      ()   => apiGet('/api/notifications'),
  nonLues:     ()   => apiGet('/api/notifications/nonlues'),
  marquerLue:  (id) => apiPut(`/api/notifications/${id}/lue`, {}),
  toutesLues:  ()   => apiPut('/api/notifications/touteslues', {}),
};

// ── Utilisateurs ────────────────────────────────────────
const Utilisateurs = {
  lister:      ()         => apiGet('/api/utilisateurs'),
  toggleActif: (id, actif) => apiPut(`/api/utilisateurs/${id}/actif`, { actif }),
};
