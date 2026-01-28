import { initAuth, getCurrentUser, signOut, signIn, signUp, validateInviteCode, ROLES, PERMISSIONS, supabase } from './auth.js'
import { tachoReader, formatTachoDataForDisplay } from './tacho-reader.js'
import { db } from './db.js'
// import './style.css'
// import './flatpickr-theme.css'

// ---- Storage upload helpers (documents bucket) ----
function sanitizeFileName(name) {
  return (name || 'file').toString().replace(/[^\w.\-]+/g, '_');
}

async function uploadToDocumentsBucket(file, path) {
  if (!supabase) throw new Error('Supabase client not initialized');
  const bucket = 'documents';
  console.log('📤 Uploading to bucket:', bucket, 'at path:', path);

  const { data: uploadData, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || undefined });

  if (error) {
    console.error('❌ Upload Error:', error);
    throw error;
  }

  console.log('✅ Upload success:', uploadData);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error('Cannot get public URL');

  console.log('🔗 Generated Public URL:', data.publicUrl);
  return data.publicUrl;
}

async function uploadDocumentForEntity(file, entityType, entityId) {
  const orgId = currentState.currentUserProfile?.org_id;
  if (!orgId) throw new Error('Org not loaded');
  const safe = sanitizeFileName(file.name);
  const path = `${orgId}/${entityType}/${entityId}/${Date.now()}_${safe}`;
  return uploadToDocumentsBucket(file, path);
}

// Safety Reveal: Make sure the app is visible even if some JS fails later
const revealApp = () => {
  const appTarget = document.getElementById('app');
  if (appTarget && appTarget.style.opacity !== '1') {
    requestAnimationFrame(() => {
      appTarget.style.transition = 'opacity 0.6s ease-in-out';
      appTarget.style.opacity = '1';
    });
  }
};

// DEBUG: Confirm execution
// console.log("⚠️ MAIN.JS IS RUNNING");

// --- Event Delegation for Payroll Clicks (Moved to Top for Safety) ---
console.log("🚀 INITIALIZING GLOBAL CLICK LISTENER");
document.addEventListener('click', (e) => {
  // console.log("🖱️ RAW CLICK TARGET:", e.target); // CATCH-ALL LOG
  // Updated to target the container card
  const target = e.target.closest('.payroll-driver-card');
  if (target) {
    console.log("⚡ GLOBAL CLICK ON DRIVER CARD DETECTED:", target);
    if (target.dataset.driverId && !e.target.closest('button')) { // Ignore clicks on buttons inside the card
      e.preventDefault();
      e.stopPropagation();
      console.log("   -> ID:", target.dataset.driverId);
      if (window.app && typeof window.app.openPayrollDetail === 'function') {
        window.app.openPayrollDetail(target.dataset.driverId);
      } else {
        console.error("❌ window.app.openPayrollDetail is missing!");
      }
    } else {
      console.error("❌ window.app.openPayrollDetail is missing!");
    }
  } else {
    // console.warn("   -> Card click ignored (button or missing ID)");
  }
});

// --- Helper for Driver App Context ---
// Needed because driver docs view might be accessed from top level without setting currentDocEntity
if (!window.app) window.app = {};
window.app.setDocContext = (type, id) => {
  currentState.currentDocEntity = { type, id };
  // Also ensure folder is synced if we are in 'driverDocs' mode which relies on 'currentDocFolder'
  if (!currentState.currentDocFolder) currentState.currentDocFolder = { type, id };
};

// --- Constants & State ---
let currentState = {
  currentUser: null,
  userRole: ROLES.DRIVER, // Default until login
  currentView: 'login',   // Start at login
  selectedVehicle: null,
  isModalOpen: false,
  vehicles: [],
  drivers: [],
  tasks: [],
  alerts: [],
  attendance: {}, // Structure: { '2025-12-19': { 1: 'present', 2: 'absent' } }
  bonuses: {}, // Structure: { '2025-12-19': { 1: [{id, label, amount}] } }
  maintenanceLogs: {}, // Structure: { 1: [{id, date, type, mileage, notes}] },
  activeDriverId: null, // For Driver Experience mode
  currentPayrollDate: new Date().toISOString().split('T')[0],
  payrollSearch: '',
  fleetSearch: '',
  docSearch: '',
  currentMissionDate: new Date().toISOString().split('T')[0],
  showDrivers: false,
  currentDocFolder: null, // { type: 'vehicle'|'driver'|'custom', id: 123 }
  customFolders: [], // [{ id, name, documents: [] }]
  activities: [], // [{ id, type, title, subject, date }]
  signupOwnerMode: false,
  currentUserProfile: null,
  loginMode: 'admin', // 'admin' or 'driver'
  currentOrg: null,
  currentDocSubFolder: null
};

// --- View Definitions ---
const views = {
  login: () => {
    return `
    <div class="auth-background"></div>
    <div class="auth-view animate-fade-in" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px;">
      <div class="glass-effect" style="width: 100%; max-width: 420px; padding: 40px; border-radius: 28px; text-align: center;">
        
        <div class="auth-header">
          <div class="auth-logo-bg" style="background: var(--primary-color);">
            <i data-lucide="truck" style="width: 32px; height: 32px; color: white;"></i>
          </div>
          <h1>Connexion 4ESSIEUX</h1>
          <p style="opacity: 0.6; margin-top: 8px;">Accédez à votre espace sécurisé.</p>
        </div>
        
        <form id="login-form" style="text-align: left;">
          <div class="form-group" style="margin-bottom: 20px;">
            <label>Email</label>
            <div class="glass-input-wrapper">
              <i data-lucide="mail" class="input-icon"></i>
              <input type="email" id="login-email" class="glass-input" placeholder="votre@email.com" required>
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 24px;">
            <label>Mot de passe</label>
            <div class="glass-input-wrapper" style="position: relative;">
              <i data-lucide="lock" class="input-icon"></i>
              <input type="password" id="login-password" class="glass-input" placeholder="••••••••" required style="padding-right: 45px;">
              <button type="button" id="toggle-password" style="position: absolute; right: 15px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; justify-content: center; z-index: 10;">
                <i data-lucide="eye" style="width: 18px; height: 18px;"></i>
              </button>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
            <input type="checkbox" id="remember-me" style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary-color);">
            <label for="remember-me" style="font-size: 0.9rem; cursor: pointer; opacity: 0.8; user-select: none;">Se souvenir de moi</label>
          </div>

          <button type="submit" class="btn-primary w-full" style="justify-content: center; height: 54px; font-weight: 700; font-size: 1rem; border-radius: 14px; background: var(--primary-color); box-shadow: 0 4px 15px var(--primary-glow);">
             Se connecter <i data-lucide="arrow-right" style="margin-left:8px; width:18px;"></i>
          </button>
        </form>
        
        <div class="auth-footer">
          <p style="font-size: 0.9rem; opacity: 0.8;">
            Pas encore de compte ?<br>
            <a href="#" onclick="window.handleNavigation('signup')" class="auth-link">Créer une Cellule Entreprise</a>
          </p>
        </div>
      </div>
    </div>
  `;
  },
  signup: () => {
    const isOwnerMode = currentState.signupOwnerMode || false;
    return `
    <div class="auth-background"></div>
    <div class="auth-view animate-fade-in" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px;">
      <div class="glass-effect" style="width: 100%; max-width: 440px; padding: 40px; border-radius: 28px; text-align: center;">
        <div class="auth-header">
          <h1>${isOwnerMode ? 'Profil Entreprise' : 'Inscription'}</h1>
          <p style="opacity: 0.6; margin-top: 8px;">${isOwnerMode ? 'Créez votre cellule de gestion' : 'Rejoignez le réseau 4ESSIEUX'}</p>
        </div>
        
        <form id="signup-form" style="text-align: left;">
          ${isOwnerMode ? `
            <div class="form-group" style="margin-bottom: 20px;">
              <label>Nom de l'entreprise (Cellule)</label>
              <div class="glass-input-wrapper">
                <i data-lucide="building-2" class="input-icon"></i>
                <input type="text" id="signup-org-name" class="glass-input" placeholder="Ex: TRANSPORTS DURAND" required>
              </div>
            </div>
          ` : `
            <div class="form-group" style="margin-bottom: 20px;">
              <label>Code Invitation (Requis)</label>
              <div class="glass-input-wrapper">
                <i data-lucide="key" class="input-icon"></i>
                <input type="text" id="signup-invite" class="glass-input" placeholder="4X-XXXXX" required style="letter-spacing: 2px; text-transform: uppercase; font-weight: 700;">
              </div>
              <div id="invite-status" style="font-size: 0.75rem; margin-top: 4px; display: flex; align-items: center; gap: 4px;"></div>
            </div>
          `}

          <div id="signup-core-fields" class="${isOwnerMode ? '' : 'opacity-50 pointer-events-none'}" style="transition: opacity 0.3s;">
            <div class="form-group" style="margin-bottom: 15px;">
              <label>Nom complet</label>
              <div class="glass-input-wrapper">
                <i data-lucide="user" class="input-icon"></i>
                <input type="text" id="signup-name" class="glass-input" placeholder="Jean Dupont" required ${isOwnerMode ? '' : 'disabled'}>
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 15px;">
              <label>Email</label>
              <div class="glass-input-wrapper">
                <i data-lucide="mail" class="input-icon"></i>
                <input type="email" id="signup-email" class="glass-input" placeholder="votre@email.com" required ${isOwnerMode ? '' : 'disabled'}>
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 20px;">
              <label>Mot de passe</label>
              <div class="glass-input-wrapper">
                <i data-lucide="lock" class="input-icon"></i>
                <input type="password" id="signup-password" class="glass-input" placeholder="••••••••" required ${isOwnerMode ? '' : 'disabled'}>
              </div>
            </div>
            <input type="hidden" id="signup-role-hidden" value="${isOwnerMode ? 'admin' : ''}">
            <div class="form-group" style="margin-bottom: 24px;">
              <label>Rôle assigné</label>
              <div id="signup-role-badge" style="padding: 10px; background: rgba(255,255,255,0.05); border-radius: 12px; font-weight: 600; text-transform: uppercase; font-size: 0.8rem; text-align: center; border: 1px solid var(--glass-border);">
                ${isOwnerMode ? 'ADMINISTRATEUR (PATRON)' : 'En attente du code...'}
              </div>
            </div>
            <button type="submit" class="btn-primary w-full" style="justify-content: center; height: 54px; font-weight: 700; font-size: 1rem; border-radius: 14px;">
              Créer mon compte <i data-lucide="user-plus" style="margin-left:8px; width:18px;"></i>
            </button>
          </div>
        </form>
        
        <div class="auth-footer">
          <p style="font-size: 0.85rem; opacity: 0.8;">
            ${isOwnerMode
        ? `Rejoindre une entreprise existante ? <a href="#" onclick="window.app.toggleSignupMode(false)" class="auth-link">Utiliser un code</a>`
        : `Vous êtes le Patron ? <a href="#" onclick="window.app.toggleSignupMode(true)" class="auth-link">Créer un profil Entreprise</a>`
      }
          </p>
          <p style="font-size: 0.9rem; margin-top: 15px; opacity: 0.6;">
            Déjà inscrit ? <a href="#" onclick="window.handleNavigation('login')" class="auth-link">Se connecter</a>
          </p>
        </div>
      </div>
    </div>
  `;
  },
  dashboard: () => {
    const alertsHtml = currentState.alerts.map(alert => `
      <div class="alert-item ${alert.type}" onclick="window.app.viewAlert('${alert.id}')">
        <div class="alert-icon">
          <i data-lucide="${alert.type === 'critical' ? 'alert-octagon' : alert.type === 'warning' ? 'alert-triangle' : 'info'}"></i>
        </div>
        <div class="alert-content">
          <div class="alert-title">${alert.title}</div>
          <div class="alert-desc">${alert.subject} • ${new Date(alert.date).toLocaleDateString('fr-FR')}</div>
        </div>
        <i data-lucide="chevron-right" class="text-muted"></i>
      </div>
    `).join('');

    const activeDrivers = currentState.drivers.length;
    const stoppedVehicles = currentState.vehicles.filter(v => v.status === 'maintenance').length;

    // Recent activities rendering: ONLY SHOW LAST 8 on dashboard
    const activitiesList = (currentState.activities || []).slice(0, 8);
    const activitiesHtml = activitiesList.length > 0 ? activitiesList.map(act => `
      <div class="activity-item" style="display: flex; gap: 12px; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); align-items: flex-start;">
        <div class="activity-icon" style="flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; margin-top: 2px;">
          <i data-lucide="${act.type === 'success' ? 'plus-circle' : act.type === 'error' ? 'trash-2' : act.type === 'warning' ? 'edit-3' : 'bell'}" style="width: 16px; color: ${act.type === 'success' ? 'var(--success-color)' : act.type === 'error' ? 'var(--alert-color)' : act.type === 'warning' ? 'var(--warning-color)' : 'var(--primary-color)'}"></i>
        </div>
        <div class="activity-content" style="flex: 1;">
          <div style="font-size: 0.85rem; font-weight: 600;">${act.title}</div>
          <div style="font-size: 0.75rem; opacity: 0.6; margin-bottom: 2px;">${act.subject}</div>
          <div style="font-size: 0.65rem; opacity: 0.4;">
            <i data-lucide="user" style="width: 10px; display: inline-block; vertical-align: middle;"></i> ${act.user || 'Système'}
          </div>
        </div>
        <div style="font-size: 0.7rem; opacity: 0.4;">${new Date(act.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `).join('') : '<p class="text-muted text-center" style="padding: 20px; font-size: 0.9rem;">Aucune activité récente.</p>';

    return `
      <div class="dashboard-view">
        <div class="welcome-section">
          <h1>Tableau de Bord</h1>
          <p>Bienvenue sur 4ESSIEUX, <span onclick="window.app.toggleRoleModal()" style="cursor:pointer; color:var(--primary-color); font-weight:600;">${currentState.userRole.label}</span></p>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <span class="label">Chauffeurs actifs</span>
            <span class="value">${activeDrivers}</span>
          </div>
          <div class="stat-card ${stoppedVehicles > 0 ? 'warning' : ''}">
            <span class="label">Véhicules arrêtés</span>
            <span class="value">${stoppedVehicles}</span>
          </div>
          <div class="stat-card ${currentState.alerts.filter(a => a.type === 'critical').length > 0 ? 'alert' : ''}">
            <span class="label">Alertes Critiques</span>
            <span class="value">${currentState.alerts.filter(a => a.type === 'critical').length}</span>
          </div>
          <div class="stat-card">
            <span class="label">Missions</span>
            <span class="value">${currentState.tasks.length}</span>
          </div>
        </div>

        <div class="alerts-section">
          <div class="section-header">
            <h2><i data-lucide="bell"></i> Alertes & Priorités</h2>
            <button class="btn-ghost text-xs">Tout voir</button>
          </div>
          <div class="alerts-list">
            ${alertsHtml || '<p class="text-muted text-center" style="padding: 20px; font-size: 0.85rem;">Aucune alerte en cours.</p>'}
          </div>
        </div>

        <div class="activity-section">
          <div class="section-header">
            <h2><i data-lucide="activity"></i> Activité Récente</h2>
            <button class="btn-ghost" onclick="window.app.openHistoryModal()" style="font-size: 0.75rem; color: var(--primary-color);">Consulter le journal</button>
          </div>
          <div class="activity-list" style="margin-bottom: 10px;">
            ${activitiesHtml}
          </div>
        </div>
      </div>
    `;
  },
  documents: () => {
    const query = (currentState.docSearch || '').trim().toUpperCase();

    // --- MODE 1: DETAIL VIEW (INSIDE A FOLDER) ---
    if (currentState.currentDocFolder) {
      const { type, id } = currentState.currentDocFolder;
      let entity;
      if (type === 'vehicle') entity = currentState.vehicles.find(v => v.id == id);
      else if (type === 'driver') entity = currentState.drivers.find(d => d.id == id);
      else if (type === 'custom') entity = currentState.customFolders.find(f => f.id == id);

      if (!entity) {
        currentState.currentDocFolder = null;
        setTimeout(() => render(), 0);
        return '';
      }

      const docs = (entity.documents || []).filter(d =>
        !query || d.name.toUpperCase().includes(query) || (d.folder && d.folder.toUpperCase().includes(query))
      );

      // Initialize categories with defaults
      const categories = {};
      if (type === 'driver') {
        categories['DOCUMENTS CHAUFFEUR'] = [];
        categories['ADMINISTRATIF'] = [];
      } else if (type === 'vehicle') {
        categories['DOCUMENTS VÉHICULE'] = [];
        categories['ADMINISTRATIF'] = [];
        categories['MAINTENANCE MÉCANIQUE'] = [];
      } else {
        categories['DIVERS'] = [];
      }

      docs.forEach(d => {
        const folderName = (d.folder || 'DIVERS').toUpperCase();
        if (!categories[folderName]) categories[folderName] = [];
        categories[folderName].push(d);
      });

      const renderDocCard = (doc) => {
        const canDelete = currentState.userRole.id === 'admin';
        return `
        <div class="glass-effect hover-lift" style="padding: 15px; border-radius: 12px; border: 1px solid var(--glass-border); min-height: 120px; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
             <div style="background: rgba(255,255,255,0.05); padding: 8px; border-radius: 8px; color: ${doc.expiry && new Date(doc.expiry) < new Date() ? '#ef4444' : 'var(--primary-color)'}">
               <i data-lucide="${doc.type?.includes('image') ? 'image' : 'file-text'}" style="width: 20px; height: 20px;"></i>
             </div>
             <div style="display: flex; gap: 4px;">
               <button class="btn-ghost" style="padding: 6px; color: var(--primary-color);" onclick="event.stopPropagation(); window.app.openPreviewDoc('${doc.id}')" title="Voir">
                 <i data-lucide="eye" style="width: 16px;"></i>
               </button>
               <button class="btn-ghost" style="padding: 6px; color: var(--text-muted);" onclick="event.stopPropagation(); window.app.openEditDoc('${doc.id}')" title="Modifier">
                 <i data-lucide="edit-2" style="width: 16px;"></i>
               </button>
               ${canDelete ? `
               <button class="btn-ghost" style="padding: 6px; color: #ef4444;" onclick="event.stopPropagation(); window.app.deleteDoc('${doc.id}')" title="Supprimer">
                 <i data-lucide="trash-2" style="width: 16px;"></i>
               </button>
               ` : ''}
             </div>
          </div>
          <div style="cursor: pointer;" onclick="window.app.openPreviewDoc('${doc.id}')">
            <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${doc.name}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${doc.date ? new Date(doc.date).toLocaleDateString('fr-FR') : 'Date inconnue'}</div>
          </div>
        </div>
      `;
      };

      return `
        <div class="documents-view animate-fade-in">
           <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px;">
              <div style="display: flex; align-items: center; gap: 15px;">
                <button class="btn-back" onclick="window.app.closeFolder()">
                  <i data-lucide="arrow-left"></i> Retour
                </button>
               <div>
               <h1 style="font-size: 1.5rem; margin: 0;">${type === 'vehicle' ? entity.plate : entity.name}</h1>
                 <span style="font-size: 0.85rem; color: var(--text-muted);">${type === 'vehicle' ? 'Dossier Véhicule' : (type === 'driver' ? 'Dossier Chauffeur' : 'Dossier Spécial')}</span>
               </div>
             </div>
              <button class="btn-primary hover-lift" onclick="window.app.openDocs('${type}', '${id}', 'ADMINISTRATIF')">
                <i data-lucide="plus"></i> Ajouter
              </button>
            </div>

            <div class="glass-input-wrapper" style="margin-bottom: 30px;">
              <i data-lucide="search" class="input-icon"></i>
              <input type="text" placeholder="Rechercher un document..." class="glass-input" value="${currentState.docSearch || ''}" oninput="window.app.handleDocSearch(this.value)">
            </div>

            <div style="display: flex; flex-direction: column; gap: 30px;">
               ${Object.entries(categories).map(([catName, catDocs]) => `
                 <div class="doc-category">
                   <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                     <div style="display: flex; align-items: center; gap: 10px; color: var(--primary-color); font-weight: 600; font-size: 0.85rem; letter-spacing: 1px;">
                       <i data-lucide="folder-open" style="width: 16px;"></i> ${catName}
                     </div>
                       <div style="display: flex; gap: 8px;">
                         <button class="btn-ghost glass-effect hover-lift" style="font-size: 0.7rem; padding: 6px 12px; border-radius: 10px; color: var(--primary-light); background: rgba(59, 130, 246, 0.08); border: 1px solid var(--glass-border);" onclick="window.app.openDocs('${type}', '${id}', '${catName}')">
                            <i data-lucide="plus" style="width: 14px;"></i> Ajouter
                         </button>
                         ${currentState.userRole.id === 'admin' ? `
                         <button class="btn-ghost glass-effect hover-lift" style="font-size: 0.7rem; padding: 6px 12px; border-radius: 10px; color: var(--text-secondary); background: rgba(255, 255, 255, 0.03); border: 1px solid var(--glass-border);" onclick="window.app.renameFolder('${catName}', '${type}', '${id}')">
                            <i data-lucide="edit-3" style="width: 14px;"></i> Renommer
                         </button>
                         <button class="btn-ghost glass-effect hover-lift" style="font-size: 0.7rem; padding: 6px 12px; border-radius: 10px; color: #ef4444; background: rgba(239, 68, 68, 0.05); border: 1px solid var(--glass-border);" onclick="window.app.deleteFolder('${catName}', '${type}', '${id}')">
                            <i data-lucide="trash-2" style="width: 14px;"></i> Supprimer
                         </button>
                         ` : ''}
                       </div>
                   </div>
                   <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 15px;">
                      ${catDocs.length ? catDocs.map(renderDocCard).join('') : '<div style="font-size:0.8rem; opacity:0.3; padding: 10px;">Aucun document trouvé</div>'}
                   </div>
                 </div>
               `).join('')}
            </div>
        </div>
      `;
    }

    // --- MODE 2: ROOT VIEW (ARCHIVES GRID) ---
    const allDocs = [
      ...currentState.vehicles.flatMap(v => v.documents || []),
      ...currentState.drivers.flatMap(d => d.documents || []),
      ...currentState.customFolders.flatMap(f => f.documents || [])
    ];

    const now = new Date();
    const sixtyDaysFromNow = new Date(now.setDate(now.getDate() + 60));
    const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7));

    const expiringCount = allDocs.filter(d => d.expiry && new Date(d.expiry) < sixtyDaysFromNow).length;
    const recentCount = allDocs.filter(d => d.date && new Date(d.date) > sevenDaysAgo).length;

    const renderFolderCard = (entity, type) => {
      const docsCount = (entity.documents || []).length;
      let color = '#3b82f6';
      let icon = 'folder';

      if (type === 'vehicle') { color = '#10b981'; icon = 'truck'; }
      else if (type === 'driver') { color = '#f59e0b'; icon = 'user'; }

      const label = type === 'vehicle' ? entity.plate : entity.name;

      return `
        <div class="glass-effect folder-card hover-lift" 
             onclick="window.app.openFolder('${type}', '${entity.id}')"
             style="position: relative; cursor: pointer; padding: 20px; border-radius: 20px; border: 1px solid var(--glass-border); text-align: center;">
           
           ${type === 'custom' && currentState.userRole.id === 'admin' ? `
             <button class="btn-ghost" 
                     onclick="event.stopPropagation(); window.app.deleteCustomFolder('${entity.id}')" 
                     style="position: absolute; top: 10px; right: 10px; padding: 6px; color: #ef4444; background: rgba(239, 68, 68, 0.05); border-radius: 8px;">
               <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
             </button>
           ` : ''}

           <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(255,255,255,0.03); color: ${color}; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
             <i data-lucide="${icon}" style="width: 24px; height: 24px;"></i>
           </div>
           <div style="font-weight: 700; font-size: 1rem; margin-bottom: 4px; color: white;">${label}</div>
           <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 12px;">${type === 'vehicle' ? entity.brand : (type === 'driver' ? 'Chauffeur' : 'Dossier Spécial')}</div>
           <div style="font-size: 0.7rem; opacity: 0.5; background: rgba(255,255,255,0.05); display: inline-block; padding: 4px 10px; border-radius: 20px;">
             ${docsCount} document${docsCount > 1 ? 's' : ''}
           </div>
        </div>
      `;
    };

    const filteredDrivers = currentState.drivers.filter(d => !query || d.name.toUpperCase().includes(query));
    const filteredVehicles = currentState.vehicles.filter(v => !query || v.plate.toUpperCase().includes(query) || v.brand.toUpperCase().includes(query));

    return `
      <div class="documents-view animate-fade-in">
        <div class="section-header" style="margin-bottom: 30px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <i data-lucide="archive" style="color: var(--primary-color);"></i>
            <h1 style="margin: 0;">Archives</h1>
          </div>
          ${currentState.userRole.id === 'admin' ? `
          <button class="btn-primary hover-lift" onclick="window.app.addCustomFolder()">
            <i data-lucide="folder-plus"></i> Nouveau Dossier
          </button>
          ` : ''}
        </div>

        <div class="glass-effect" style="margin-bottom: 30px; padding: 20px; border-radius: 20px; border: 1px solid var(--glass-border); display: flex; text-align: center;">
           <div style="flex: 1; border-right: 1px solid var(--glass-border);">
             <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 5px;">Total Archives</div>
             <div style="font-size: 1.4rem; font-weight: 700; color: white;">${allDocs.length}</div>
           </div>
           <div style="flex: 1; border-right: 1px solid var(--glass-border);">
             <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 5px;">À Renouveler</div>
             <div style="font-size: 1.4rem; font-weight: 700; color: ${expiringCount > 0 ? 'var(--error-color)' : 'white'};">${expiringCount}</div>
           </div>
           <div style="flex: 1;">
             <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; opacity: 0.6; margin-bottom: 5px;">Nouveautés</div>
             <div style="font-size: 1.4rem; font-weight: 700; color: var(--success-color);">${recentCount}</div>
           </div>
        </div>

        <div class="glass-input-wrapper" style="margin-bottom: 40px;">
             <i data-lucide="search" class="input-icon"></i>
             <input type="text" placeholder="Rechercher un dossier..." class="glass-input" value="${currentState.docSearch || ''}" oninput="window.app.handleDocSearch(this.value)">
        </div>

        <div style="display: flex; flex-direction: column; gap: 40px;">
          ${filteredDrivers.length ? `
            <div>
              <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 15px; letter-spacing: 1px;">Chauffeurs (${filteredDrivers.length})</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px;">
                ${filteredDrivers.map(d => renderFolderCard(d, 'driver')).join('')}
              </div>
            </div>
          ` : ''}

          ${filteredVehicles.length ? `
            <div>
              <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 15px; letter-spacing: 1px;">Véhicules (${filteredVehicles.length})</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px;">
                ${filteredVehicles.map(v => renderFolderCard(v, 'vehicle')).join('')}
              </div>
            </div>
          ` : ''}

          ${currentState.customFolders.length ? `
            <div>
              <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 15px; letter-spacing: 1px;">Dossiers Spéciaux (${currentState.customFolders.length})</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 15px;">
                ${currentState.customFolders.filter(f => !query || f.name.toUpperCase().includes(query)).map(f => renderFolderCard(f, 'custom')).join('')}
              </div>
            </div>
          ` : ''}
          
          ${!filteredDrivers.length && !filteredVehicles.length && !currentState.customFolders.length ? `
            <div style="text-align: center; padding: 40px; opacity: 0.4;">Aucun résultat pour "${currentState.docSearch}"</div>
          ` : ''}
        </div>
      </div>
    `;
  },
  drivers: () => {
    const driversHtml = currentState.drivers.map(d => `
      <div class="alert-item info" onclick="window.app.viewDriver('${d.id}')">
        <div class="avatar" style="width: 40px; height: 40px;">${d.name.split(' ').map(n => n[0]).join('')}</div>
        <div class="alert-content">
          <div class="alert-title">${d.name}</div>
          <div class="alert-desc">
            <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
              ${d.email ? `<a href="mailto:${d.email}" style="font-size: 0.75rem; color: var(--primary-color); display: flex; align-items: center; gap: 6px; cursor: pointer; text-decoration: none;" onclick="event.stopPropagation()"><i data-lucide="mail" style="width: 12px;"></i> ${d.email}</a>` : ''}
              ${d.phone ? `<div style="font-size: 0.75rem; color: var(--success-color); display: flex; align-items: center; gap: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.app.openContactModal('${d.id}')"><i data-lucide="phone" style="width: 12px;"></i> ${d.phone}</div>` : ''}
            </div>
            <div style="margin-top: 6px;">Permis: ${d.license || 'N/A'} • Médical: ${d.medicalExpiry || 'N/A'}</div>
          </div>
        </div>
        <i data-lucide="info"></i>
      </div>
    `).join('');
    return `
      <div class="drivers-view">
        <div class="section-header">
          <h1>Chauffeurs</h1>
          <button class="btn-primary" onclick="window.app.openAddDriver()"><i data-lucide="user-plus"></i> Nouveau</button>
        </div>
        <div class="drivers-list" style="margin-top: 20px;">
          ${driversHtml}
        </div>
      </div>
    `;
  },
  fleet: () => {
    const isMechanic = currentState.userRole.id === 'mechanic';
    const isAdmin = currentState.userRole.id === 'admin';
    // Mechanics forced to see vehicles only
    const isVehicles = isMechanic ? true : !currentState.showDrivers;
    const query = currentState.fleetSearch.toLowerCase();
    const itemsHtml = isVehicles
      ? currentState.vehicles
        .filter(v => v.plate.toLowerCase().includes(query) || v.brand.toLowerCase().includes(query) || v.model.toLowerCase().includes(query))
        .map(v => {
          const associatedDriver = currentState.drivers.find(d => d.vehicleId === v.id);
          return `
            <div class="alert-item ${v.status === 'maintenance' ? 'warning' : 'info'}">
              <div class="alert-icon" onclick="window.app.viewVehicle('${v.id}')"><i data-lucide="truck"></i></div>
              <div class="alert-content" onclick="window.app.viewVehicle('${v.id}')">
                <div class="alert-title">${v.plate}</div>
                <div class="alert-desc">${v.brand} ${v.model} • <span style="color: var(--primary-color);">${associatedDriver ? associatedDriver.name : 'Aucun chauffeur'}</span></div>
              </div>
              <div class="actions" style="display: flex; align-items: center; gap: 8px;">
                <div class="status-badge ${v.status === 'active' ? 'success' : 'warning'}">${v.status === 'active' ? 'En route' : 'Garage'}</div>
                <button class="btn-ghost" style="padding: 4px;" onclick="window.app.openDocsFolder('vehicle', '${v.id}')" title="Entretien">
                  <i data-lucide="wrench" style="width: 18px; height: 18px;"></i>
                </button>
                <button class="btn-ghost" style="padding: 4px;" onclick="window.app.openDocsFolder('vehicle', '${v.id}')">
                   <i data-lucide="file-text" style="width: 18px; height: 18px;"></i>
                </button>
                <button class="btn-ghost" style="padding: 4px;" onclick="event.stopPropagation(); window.app.openEditVehicle('${v.id}')">
                  <i data-lucide="edit-3" style="width: 18px; height: 18px;"></i>
                </button>
                ${isAdmin ? `
                <button class="btn-ghost" style="padding: 4px; color: #ef4444;" onclick="event.stopPropagation(); window.app.deleteVehicle('${v.id}')">
                  <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                </button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')
      : currentState.drivers
        .filter(d => d.name.toLowerCase().includes(query))
        .map(d => {
          const associatedVehicle = currentState.vehicles.find(v => v.id === d.vehicleId);
          const hasInvite = (currentState.teamInvitations || []).some(i => i.target_name === d.name);
          const isMember = (currentState.teamMembers || []).some(m => m.full_name === d.name);
          const hasAccess = hasInvite || isMember;

          return `
            <div class="alert-item info">
              <div class="alert-icon" onclick="window.app.viewDriver('${d.id}')">
                <i data-lucide="user"></i>
                ${hasAccess ? '<div style="position:absolute; bottom:-2px; right:-2px; background:var(--success-color); border:2px solid #111; width:12px; height:12px; border-radius:50%;" title="Accès App activé"></div>' : ''}
              </div>
              <div class="alert-content" onclick="window.app.viewDriver('${d.id}')">
                <div class="alert-title" style="font-weight: 700; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
                  ${d.name}
                  ${hasAccess ? `<i data-lucide="smartphone" style="width:14px; opacity:0.5; color:var(--success-color);" title="${isMember ? 'Compte actif' : 'Invitation envoyée'}"></i>` : ''}
                </div>
                <div class="alert-desc">
                   <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                     ${d.email ? `<a href="mailto:${d.email}" style="font-size: 0.75rem; color: var(--primary-color); display: flex; align-items: center; gap: 6px; cursor: pointer; text-decoration: none;" onclick="event.stopPropagation()"><i data-lucide="mail" style="width: 12px;"></i> ${d.email}</a>` : ''}
                     ${d.phone ? `<div style="font-size: 0.75rem; color: var(--success-color); display: flex; align-items: center; gap: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.app.openContactModal('${d.id}')"><i data-lucide="phone" style="width: 12px;"></i> ${d.phone}</div>` : ''}
                   </div>
                   <div style="margin-top: 6px;">
                     Véhicule: <span style="font-weight: 600;">${associatedVehicle ? associatedVehicle.plate : 'Aucun'}</span> • Permis: <span style="font-weight: 600;">${d.license || 'N/A'}</span>
                   </div>
                </div>
              </div>
              <div class="actions" style="display: flex; align-items: center; gap: 8px;">
                <button class="btn-ghost" style="padding: 4px;" onclick="window.app.openDocsFolder('driver', '${d.id}')">
                  <i data-lucide="file-text" style="width: 18px; height: 18px;"></i>
                </button>
                <button class="btn-ghost" style="padding: 4px;" onclick="window.app.openEditDriver('${d.id}')">
                  <i data-lucide="edit-3" style="width: 18px; height: 18px;"></i>
                </button>
                ${isAdmin ? `
                <button class="btn-ghost" style="padding: 4px; color: #ef4444;" onclick="event.stopPropagation(); window.app.deleteDriver('${d.id}')">
                  <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                </button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');

    return `
      <div class="fleet-view">
        <div class="section-header">
          <h1>${isVehicles ? 'Véhicules' : 'Chauffeurs'}</h1>
          <button class="btn-primary" onclick="${isVehicles ? 'window.app.openAddVehicle()' : 'window.app.openAddDriver()'}" style="${isMechanic && !isVehicles ? 'display:none' : ''}"><i data-lucide="plus"></i> Nouveau</button>
        </div>
        
        <div class="tabs-container glass-effect" style="display: flex; border-radius: 12px; padding: 4px; margin-bottom: 20px; gap: 4px; ${isMechanic ? 'display: none;' : ''}">
          <button class="tab-btn ${isVehicles ? 'active' : ''}" 
                  onclick="window.app.setFleetTab(false)" 
                  style="flex:1; border:none; background: ${isVehicles ? 'var(--primary-color)' : 'transparent'}; color: white; padding: 8px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">
            Véhicules
          </button>
          <button class="tab-btn ${!isVehicles ? 'active' : ''}" 
                  onclick="window.app.setFleetTab(true)" 
                  style="flex:1; border:none; background: ${!isVehicles ? 'var(--primary-color)' : 'transparent'}; color: white; padding: 8px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">
            Chauffeurs
          </button>
        </div>

        <div class="search-bar" style="margin-bottom: 25px;">
          <div class="glass-input-wrapper">
             <i data-lucide="search" class="input-icon"></i>
             <input type="text" 
                    placeholder="Rechercher..." 
                    class="glass-input" 
                    value="${currentState.fleetSearch}"
                    oninput="window.app.handleFleetSearch(this.value)">
          </div>
        </div>
        <div class="fleet-list">
          ${itemsHtml}
        </div>
      </div>
    `;
  },
  shiftPayrollDate: (days) => {
    const d = new Date(currentState.currentPayrollDate);
    d.setDate(d.getDate() + days);
    currentState.currentPayrollDate = d.toISOString().split('T')[0];
    render();
  },

  shiftMissionDate: (days) => {
    const d = new Date(currentState.currentMissionDate);
    d.setDate(d.getDate() + days);
    currentState.currentMissionDate = d.toISOString().split('T')[0];
    render();
  },
  updateMissionDate: (date) => {
    currentState.currentMissionDate = date;
    render();
  },
  payroll: () => {
    const date = currentState.currentPayrollDate;
    const dailyAttendance = currentState.attendance[date] || {};
    const [year, month] = date.split('-');
    const isMonthlyView = currentState.payrollViewMode === 'monthly';

    let contentHtml = '';

    if (isMonthlyView) {
      const daysInMonth = new Date(year, month, 0).getDate();
      const filteredDrivers = currentState.drivers.filter(d =>
        d.name.toLowerCase().includes(currentState.payrollSearch.toLowerCase())
      );
      contentHtml = filteredDrivers.map(d => {
        let presenceCount = 0;
        let absenceCount = 0;
        let vacationCount = 0;
        let sickCount = 0;
        let bonusTotal = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const dStr = `${year}-${month}-${day.toString().padStart(2, '0')}`;
          const status = currentState.attendance[dStr]?.[d.id];
          if (status === 'present') presenceCount++;
          else if (status === 'absent') absenceCount++;
          else if (status === 'vacation') vacationCount++;
          else if (status === 'sick') sickCount++;

          const dayBonuses = currentState.bonuses[dStr]?.[d.id] || [];
          bonusTotal += dayBonuses.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
        }

        return `
          <div class="glass-effect payroll-driver-card" onclick="window.app.openPayrollDetail('${d.id}')" data-driver-id="${d.id}" style="padding: 15px; border-radius: 16px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: transform 0.2s;">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
              <div class="avatar" style="width: 40px; height: 40px; background: rgba(255,255,255,0.05); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-weight: bold; border-radius: 50%;">${d.name.split(' ').map(n => n[0]).join('')}</div>
              <div>
                <div style="font-weight: 600;">${d.name}</div>
                <div style="font-size: 0.75rem; opacity: 0.6;">Récapitulatif ${new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long' })}</div>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 15px;">
              <div style="display: flex; gap: 12px; text-align: center;">
                <div>
                  <div style="font-size: 0.65rem; opacity: 0.6;">Trav.</div>
                  <div style="color: #10b981; font-weight: 700;">${presenceCount}j</div>
                </div>
                <div>
                  <div style="font-size: 0.65rem; opacity: 0.6;">Congés</div>
                  <div style="color: #6366f1; font-weight: 700;">${vacationCount}j</div>
                </div>
                <div>
                  <div style="font-size: 0.65rem; opacity: 0.6;">Primes</div>
                  <div style="color: var(--primary-color); font-weight: 700;">${bonusTotal.toFixed(2)}€</div>
                </div>
              </div>
              <button class="btn-ghost" onclick="event.stopPropagation(); window.app.downloadMonthlyReport(${d.id})" style="padding: 8px; border-radius: 10px; background: rgba(255,255,255,0.05); color: var(--primary-color);" title="Télécharger le rapport">
                <i data-lucide="download" style="width: 20px;"></i>
              </button>
            </div>
          </div >
  `;
      }).join('');
    } else {
      const filteredDrivers = currentState.drivers.filter(d =>
        d.name.toLowerCase().includes(currentState.payrollSearch.toLowerCase())
      );
      contentHtml = filteredDrivers.map(d => {
        const status = dailyAttendance[d.id] || 'unset';
        const dayBonuses = currentState.bonuses[date]?.[d.id] || [];
        const bonusAmount = dayBonuses.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

        const statusLabel = {
          'present': 'Travaille',
          'absent': 'Absent',
          'vacation': 'Congés Payés',
          'sick': 'Arrêt Maladie',
          'unset': 'Non pointé'
        }[status];

        const statusColor = {
          'present': '#10b981',
          'absent': '#ef4444',
          'vacation': '#6366f1',
          'sick': '#f59e0b',
          'unset': 'transparent'
        }[status];

        return `
          <div class="glass-effect payroll-driver-card" onclick="window.app.openPayrollDetail('${d.id}')" data-driver-id="${d.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 15px; border-radius: 16px; margin-bottom: 12px; border-left: 4px solid ${statusColor}; cursor: pointer; transition: transform 0.2s;">
            <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
              <div class="avatar" style="width: 40px; height: 40px; background: rgba(255,255,255,0.05); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-weight: bold; border-radius: 50%;">${d.name.split(' ').map(n => n[0]).join('')}</div>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.95rem;">${d.name}</div>
                <div style="display: flex; gap: 8px; align-items: center; margin-top: 2px;">
                  <span style="font-size: 0.7rem; color: ${statusColor === 'transparent' ? 'rgba(255,255,255,0.6)' : statusColor}; font-weight: 500;">${statusLabel}</span>
                  ${bonusAmount > 0 ? `<span style="font-size: 0.7rem; color: var(--primary-color); background: rgba(66, 193, 166, 0.1); padding: 1px 6px; border-radius: 4px;">+${bonusAmount.toFixed(2)}€</span>` : ''}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn-primary" onclick="event.stopPropagation(); window.app.openBonusModal('${d.id}')" style="padding: 6px 12px; border-radius: 8px; font-size: 0.75rem; height: 32px; background: rgba(66, 193, 166, 0.15); border: 1px solid rgba(66, 193, 166, 0.3); color: var(--primary-color);">
                <i data-lucide="plus-circle" style="width: 14px; margin-right: 4px; vertical-align: middle;"></i> Primes
              </button>
              <button class="btn-ghost" onclick="event.stopPropagation(); window.app.setAttendance('${d.id}', 'present')" style="padding: 6px; border-radius: 8px; background: ${status === 'present' ? 'rgba(16, 185, 129, 0.15)' : 'transparent'}; color: ${status === 'present' ? '#10b981' : 'rgba(255,255,255,0.4)'};">
                <i data-lucide="check-circle" style="width: 18px;"></i>
              </button>
              <button class="btn-ghost" onclick="event.stopPropagation(); window.app.setAttendance('${d.id}', 'vacation')" style="padding: 6px; border-radius: 8px; background: ${status === 'vacation' ? 'rgba(99, 102, 241, 0.15)' : 'transparent'}; color: ${status === 'vacation' ? '#6366f1' : 'rgba(255,255,255,0.4)'};" title="Congés">
                <i data-lucide="palmtree" style="width: 18px;"></i>
              </button>
              <button class="btn-ghost" onclick="event.stopPropagation(); window.app.setAttendance('${d.id}', 'sick')" style="padding: 6px; border-radius: 8px; background: ${status === 'sick' ? 'rgba(245, 158, 11, 0.15)' : 'transparent'}; color: ${status === 'sick' ? '#f59e0b' : 'rgba(255,255,255,0.4)'};" title="Maladie">
                <i data-lucide="thermometer" style="width: 18px;"></i>
              </button>
              <button class="btn-ghost" onclick="event.stopPropagation(); window.app.setAttendance('${d.id}', 'absent')" style="padding: 6px; border-radius: 8px; background: ${status === 'absent' ? 'rgba(239, 68, 68, 0.15)' : 'transparent'}; color: ${status === 'absent' ? '#ef4444' : 'rgba(255,255,255,0.4)'};">
                <i data-lucide="x-circle" style="width: 18px;"></i>
              </button>
            </div>
          </div >
  `;
      }).join('');
    }

    return `
      <div class="payroll-view">
        <div class="section-header">
          <h1>Présences</h1>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="date-picker-wrapper glass-effect" style="padding: 2px 8px; border-radius: 12px; display: flex; align-items: center; gap: 5px;">
              <button class="btn-ghost" style="padding: 4px;" onclick="window.app.shiftPayrollDate(-1)">
                <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
              </button>
              
              <input type="date" value="${date}" data-default-date="${date}" onchange="window.app.updatePayrollDate(this.value)" 
                 class="payroll-date-input" 
                 style="background: transparent; border: none; color: white; outline: none; font-size: 0.9rem; width: 130px; text-align: center;">

              <button class="btn-ghost" style="padding: 4px;" onclick="window.app.shiftPayrollDate(1)">
                <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
              </button>
            </div>
            <button class="btn-ghost" onclick="window.app.togglePayrollView()" style="background: var(--glass-bg); padding: 8px; border-radius: 10px; border: 1px solid var(--glass-border);">
              <i data-lucide="${isMonthlyView ? 'list' : 'calendar'}"></i>
            </button>
          </div>
        </div>

        <div class="search-bar" style="margin: 15px 0;">
          <div class="glass-input-wrapper">
             <i data-lucide="search" class="input-icon"></i>
             <input type="text" 
                    placeholder="Chercher un chauffeur..." 
                    class="glass-input" 
                    value="${currentState.payrollSearch}"
                    oninput="window.app.handlePayrollSearch(this.value)">
          </div>
        </div>

        ${!isMonthlyView ? `
          <div class="attendance-summary" style="display: flex; gap: 10px; margin: 20px 0;">
            <div class="stat-mini glass-effect" style="flex: 1; padding: 12px; border-radius: 16px; text-align: center;">
              <div style="font-size: 0.75rem; opacity: 0.6; margin-bottom: 4px;">Présents</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: #10b981;">${Object.values(dailyAttendance).filter(s => s === 'present').length}</div>
            </div>
            <div class="stat-mini glass-effect" style="flex: 1; padding: 12px; border-radius: 16px; text-align: center;">
              <div style="font-size: 0.75rem; opacity: 0.6; margin-bottom: 4px;">Absents</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: #ef4444;">${Object.values(dailyAttendance).filter(s => s === 'absent').length}</div>
            </div>
          </div>
        ` : ''
      }

<div class="payroll-list" style="margin-top: 20px;">
  ${contentHtml || '<p class="text-muted text-center" style="margin-top: 40px;">Aucune donnée disponible</p>'}
</div>
      </div >
  `;
  },
  tasks: () => {
    const tasksHtml = currentState.tasks.map(task => {
      const vehicle = currentState.vehicles.find(v => v.id == task.vehicleId);
      const driver = currentState.drivers.find(d => d.id == task.driverId);
      const dateStr = task.date ? new Date(task.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : 'ASAP';

      return `
      <div class="alert-item ${task.urgent ? 'critical' : ''} ${task.status === 'completed' ? 'opacity-50' : ''}">
           <div class="alert-icon" onclick="window.app.toggleTask(${task.id})">
             <i data-lucide="${task.status === 'completed' ? 'check-circle-2' : 'circle'}" style="color: ${task.status === 'completed' ? '#10b981' : 'var(--primary-color)'}"></i>
           </div>
           <div class="alert-content" onclick="window.app.openMissionDetail(${task.id})" style="flex: 1; cursor: pointer;">
             <div class="alert-title" style="display: flex; justify-content: space-between; align-items: center;">
               ${task.title}
               <span style="font-size: 0.7rem; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${dateStr}</span>
             </div>
             <div class="alert-desc" style="font-size: 0.75rem; display: flex; gap: 8px; margin-top: 4px;">
               ${vehicle ? `<span><i data-lucide="truck" style="width: 12px; height: 12px; vertical-align: middle;"></i> ${vehicle.plate}</span>` : ''}
               ${driver ? `<span><i data-lucide="user" style="width: 12px; height: 12px; vertical-align: middle;"></i> ${driver.name}</span>` : ''}
             </div>
              <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
                ${(task.files || []).length ? `
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                      <div style="width: ${(task.files.filter(f => f.completed).length / task.files.length) * 100}%; height: 100%; background: var(--primary-color);"></div>
                    </div>
                    <span style="font-size: 0.6rem; opacity: 0.6;">${task.files.filter(f => f.completed).length}/${task.files.length}</span>
                  </div>
                ` : ''}
                <div style="display: flex; gap: 12px; opacity: 0.8;">
                  ${(task.files || []).filter(f => f.from === 'admin').length ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;" title="Docs Admin"><i data-lucide="file-text" style="width: 10px; color: var(--primary-color);"></i> ${(task.files || []).filter(f => f.from === 'admin').length}</span>` : ''}
                  ${(task.files || []).filter(f => f.from === 'driver').length ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;" title="Preuves Chauffeur"><i data-lucide="camera" style="width: 10px; color: var(--success-color);"></i> ${(task.files || []).filter(f => f.from === 'driver').length}</span>` : ''}
                  ${task.report ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;" title="Rapport Chauffeur"><i data-lucide="clipboard-list" style="width: 10px; opacity: 0.6;"></i></span>` : ''}
                </div>
              </div>
           </div>
           <button class="btn-ghost" onclick="window.app.deleteTask('${task.id}')" style="color: #ef4444; padding: 4px;">
             <i data-lucide="trash-2" style="width: 18px;"></i>
           </button>
        </div>
  `;
    }).join('');
    return `
      <div class="tasks-view">
        <div class="section-header">
          <h1>Tâches & Missions</h1>
          <button class="btn-primary" onclick="window.app.openAddTask()"><i data-lucide="plus"></i> Nouveau</button>
        </div>
        
        <div class="tasks-summary" style="display: flex; gap: 10px; margin-bottom: 20px;">
          <div class="stat-mini glass-effect" style="flex: 1; padding: 10px; border-radius: 12px; text-align: center;">
            <div style="font-size: 0.8rem; opacity: 0.7;">À faire</div>
            <div style="font-size: 1.2rem; font-weight: 700;">${currentState.tasks.filter(t => t.status !== 'completed').length}</div>
          </div>
          <div class="stat-mini glass-effect" style="flex: 1; padding: 10px; border-radius: 12px; text-align: center;">
            <div style="font-size: 0.8rem; opacity: 0.7;">Urgents</div>
            <div style="font-size: 1.2rem; font-weight: 700; color: #ef4444;">${currentState.tasks.filter(t => t.urgent && t.status !== 'completed').length}</div>
          </div>
        </div>

        <div class="tasks-list">
          ${tasksHtml || '<p class="text-muted text-center" style="margin-top: 40px;">Aucune tâche pour le moment</p>'}
        </div>
      </div>
  `;
  },
  scan: () => `
    <div class="scan-overlay">
       <div class="camera-view glass-effect">
          <div class="scan-frame"></div>
          <div class="scan-instructions">Alignez le document dans le cadre</div>
       </div>
        <div class="scan-controls">
           <button class="btn-circle large"><i data-lucide="camera"></i></button>
           <button class="btn-back" id="close-scan" style="margin-top: 20px;">
             <i data-lucide="arrow-left"></i> Retour
           </button>
        </div>
    </div>
  `,
  tacho: () => {
    const parsedFiles = currentState.tachoFiles || [];
    const filesHtml = parsedFiles.map((file, index) => {
      const driverName = file.analyzed?.conducteur ? `${file.analyzed.conducteur.prenom} ${file.analyzed.conducteur.nom} ` : null;
      return `
      <div class="alert-item info" onclick="window.app.viewTachoFile(${index})">
        <div class="alert-icon">
          <i data-lucide="${file.fileType === 'Driver Card' ? 'credit-card' : 'truck'}"></i>
        </div>
        <div class="alert-content">
          <div class="alert-title">${driverName || file.fileName}</div>
          <div class="alert-desc">${file.fileType} • ${new Date(file.parsedAt).toLocaleDateString('fr-FR')} ${driverName ? `• ${file.fileName}` : ''}</div>
        </div>
        <i data-lucide="chevron-right" class="text-muted"></i>
      </div>
      `;
    }).join('');

    return `
      <div class="tacho-view">
        <div class="section-header">
          <h1>Chronotachygraphe</h1>
          <button class="btn-primary" onclick="window.app.openTachoUpload()">
            <i data-lucide="upload"></i> Importer
          </button>
        </div>
        <div class="glass-effect" style="padding: 20px; border-radius: 16px; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="width: 48px; height: 48px; background: var(--primary-color); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
              <i data-lucide="file-scan" style="width: 24px; height: 24px; color: white;"></i>
            </div>
            <div>
              <h3 style="font-size: 1rem; margin-bottom: 4px;">Analyse des fichiers .DDD</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">Importez des fichiers de carte conducteur ou de VU pour analyse automatique</p>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 15px;">
            <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
              <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 4px;">Fichiers analysés</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: var(--primary-color);">${parsedFiles.length}</div>
            </div>
            <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
              <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 4px;">Cartes conducteur</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: #10b981;">${parsedFiles.filter(f => f.fileType === 'Driver Card').length}</div>
            </div>
            <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
              <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 4px;">Données VU</div>
              <div style="font-size: 1.3rem; font-weight: 700; color: #f59e0b;">${parsedFiles.filter(f => f.fileType === 'Vehicle Unit').length}</div>
            </div>
          </div>
        </div>
        <div class="tacho-files-list">
          ${filesHtml || '<p class="text-muted text-center" style="margin-top: 40px;">Aucun fichier importé.</p>'}
        </div>
      </div>
    `;
  },
  driverSelection: () => {
    const driversHtml = currentState.drivers.map(d => `
      <div class="glass-effect" onclick="window.app.selectDriver('${d.id}')" style="padding: 20px; border-radius: 16px; text-align: center; cursor: pointer; transition: transform 0.2s;">
        <div class="avatar" style="width: 60px; height: 60px; margin: 0 auto 12px; font-size: 1.5rem;">${d.name.split(' ').map(n => n[0]).join('')}</div>
        <div style="font-weight: 700; font-size: 1.1rem;">${d.name}</div>
        <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 4px;">Cliquez pour vous connecter</div>
      </div>
    `).join('');
    return `
      <div class="driver-selection-view animate-fade-in">
        <div style="margin-bottom: 20px;">
           <button class="btn-back" onclick="window.handleNavigation('login')">
             <i data-lucide="arrow-left"></i> Connexion
           </button>
        </div>
        <div class="welcome-section" style="text-align: center; margin-bottom: 30px;">
          <h1>Qui êtes-vous ?</h1>
          <p>Sélectionnez votre profil </p>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px;">
          ${driversHtml}
        </div>
      </div>
    `;
  },
  driverDashboard: () => {
    const driver = currentState.drivers.find(d => d.id == currentState.activeDriverId);
    const vehicle = currentState.vehicles.find(v => v.id == driver?.vehicleId);
    const myTasks = currentState.tasks.filter(t => t.driverId == currentState.activeDriverId && t.status !== 'completed');
    const myInfractionsCount = (currentState.tachoFiles || [])
      .filter(f => f.analyzed?.conducteur?.nom && driver?.name.toLowerCase().includes(f.analyzed.conducteur.nom.toLowerCase()))
      .reduce((sum, f) => sum + (f.analyzed?.infractions?.length || 0), 0);

    return `
      <div class="driver-dashboard animate-fade-in">
        <div class="welcome-section">
          <h1>Mon Espace</h1>
          <p>Salut ${driver?.name.split(' ')[0] || 'Chauffeur'} !</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
           <div class="stat-card" style="background: linear-gradient(135deg, var(--primary-color), var(--primary-dark)); color: white; border: none;">
             <span class="label" style="color: rgba(255,255,255,0.8);">Missions</span>
             <span class="value">${myTasks.length}</span>
           </div>
           <div class="stat-card ${myInfractionsCount > 0 ? 'alert' : ''}">
             <span class="label">Alertes Tacho</span>
             <span class="value">${myInfractionsCount}</span>
           </div>
        </div>
        ${vehicle ? `
          <div class="glass-effect" style="padding: 20px; border-radius: 20px; display: flex; align-items: center; gap: 15px;">
            <div style="color: var(--primary-color);"><i data-lucide="truck"></i></div>
            <div>
              <div style="font-size: 0.8rem; opacity: 0.6;">Mon Véhicule</div>
              <div style="font-weight: 700;">${vehicle.plate}</div>
            </div>
          </div>
        ` : ''}
        <button class="btn-primary w-full" style="margin-top: 20px; height: 60px; justify-content: center;" onclick="window.app.openFieldUpload()">
          <i data-lucide="camera"></i> Photo Terrain
        </button>
      </div>
    `;
  },
  driverMissions: () => {
    const date = currentState.currentMissionDate;
    const myTasks = currentState.tasks.filter(t =>
      t.driverId == currentState.activeDriverId &&
      t.date === date
    );

    const tasksHtml = myTasks.map(task => `
      <div class="alert-item ${task.urgent ? 'critical' : ''} ${task.status === 'completed' ? 'opacity-50' : ''}" onclick="window.app.openMissionDetail('${task.id}')" style="cursor: pointer;">
        <div class="alert-icon">
          <i data-lucide="${task.status === 'completed' ? 'check-circle-2' : 'map-pin'}" style="color: ${task.status === 'completed' ? '#10b981' : 'var(--primary-color)'}"></i>
        </div>
        <div class="alert-content">
          <div class="alert-title">${task.title}</div>
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
             ${(task.files || []).length ? `
               <div style="display: flex; align-items: center; gap: 8px;">
                 <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                   <div style="width: ${(task.files.filter(f => f.completed).length / task.files.length) * 100}%; height: 100%; background: var(--primary-color);"></div>
                 </div>
                 <span style="font-size: 0.6rem; opacity: 0.6;">${task.files.filter(f => f.completed).length}/${task.files.length}</span>
               </div>
             ` : ''}
             <div style="display: flex; gap: 12px; opacity: 0.8;">
                ${(task.files || []).filter(f => f.from === 'admin').length ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;"><i data-lucide="file-text" style="width: 10px; color: var(--primary-color);"></i> ${(task.files || []).filter(f => f.from === 'admin').length}</span>` : ''}
                ${(task.files || []).filter(f => f.from === 'driver').length ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;"><i data-lucide="camera" style="width: 10px; color: var(--success-color);"></i> ${(task.files || []).filter(f => f.from === 'driver').length}</span>` : ''}
                ${task.report ? `<span style="font-size: 0.65rem; display: flex; align-items: center; gap: 4px;"><i data-lucide="clipboard-list" style="width: 10px; opacity: 0.6;"></i></span>` : ''}
             </div>
          </div>
        </div>
        <i data-lucide="chevron-right" class="text-muted"></i>
      </div>
    `).join('');

    return `
      <div class="tasks-view animate-fade-in">
        <div class="section-header" style="margin-bottom: 25px;">
          <h1>Mon Boulot</h1>
          <div class="date-picker-wrapper glass-effect" style="padding: 2px 8px; border-radius: 12px; display: flex; align-items: center; gap: 5px;">
            <button class="btn-ghost" style="padding: 4px;" onclick="window.app.shiftMissionDate(-1)">
              <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
            </button>
            <input type="date" value="${date}" onchange="window.app.updateMissionDate(this.value)"
              class="payroll-date-input"
              style="background: transparent; border: none; color: white; outline: none; font-size: 0.85rem; width: 120px; text-align: center;">
            <button class="btn-ghost" style="padding: 4px;" onclick="window.app.shiftMissionDate(1)">
              <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
            </button>
          </div>
        </div>
        ${tasksHtml || `<div class="text-center" style="padding: 60px 20px; opacity: 0.4;">
          <i data-lucide="calendar-check" style="width: 48px; height: 48px; margin-bottom: 15px;"></i>
          <p>Aucune mission pour cette date.</p>
        </div>`}
      </div>
    `;
  },
  driverTacho: () => {
    const driver = currentState.drivers.find(d => d.id == currentState.activeDriverId);
    const myFiles = (currentState.tachoFiles || []).filter(f =>
      f.analyzed?.conducteur?.nom && driver?.name.toLowerCase().includes(f.analyzed.conducteur.nom.toLowerCase())
    );

    const infractionsHtml = myFiles.flatMap(f => f.analyzed.infractions).map(inf => `
      <div class="alert-item critical">
        <div class="alert-icon"><i data-lucide="alert-octagon"></i></div>
        <div class="alert-content">
          <div class="alert-title">${inf.type.replace(/_/g, ' ')}</div>
          <div class="alert-desc">${new Date(inf.date).toLocaleDateString('fr-FR')} • ${inf.description}</div>
        </div>
      </div>
    `).join('');

    return `
      <div class="tacho-view animate-fade-in">
        <div class="section-header">
          <h1>Mes Infractions</h1>
        </div>
        ${myFiles.length > 0 ? `
          <div class="glass-effect" style="padding: 15px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-around; text-align: center;">
            <div>
              <div style="font-size: 0.7rem; opacity: 0.6;">Fichiers</div>
              <div style="font-size: 1.2rem; font-weight: 700;">${myFiles.length}</div>
            </div>
            <div>
              <div style="font-size: 0.7rem; opacity: 0.6;">Infractions</div>
              <div style="font-size: 1.2rem; font-weight: 700; color: #ef4444;">${myFiles.reduce((sum, f) => sum + f.analyzed.infractions.length, 0)}</div>
            </div>
          </div>
          <div class="infractions-list">
            ${infractionsHtml || '<p class="text-center text-muted">Aucune infraction détectée.</p>'}
          </div>
        ` : `<p class="text-muted text-center" style="margin-top: 40px;">Aucune donnée tachygraphe pour votre profil.</p>`}
      </div>
    `;
  },
  driverDocs: () => {
    const driver = currentState.drivers.find(d => d.id == currentState.activeDriverId);
    const vehicleId = driver?.vehicleId;
    const vehicle = currentState.vehicles.find(v => v.id == vehicleId);

    // MODE : DOSSIER OUVERT
    if (currentState.currentDocFolder) {
      const { type, id } = currentState.currentDocFolder;
      const entity = type === 'vehicle' ? currentState.vehicles.find(v => v.id == id) : currentState.drivers.find(d => d.id == id);

      // -- SOUS-DOSSIERS PAR DÉFAUT --
      const defaultSubFolders = type === 'vehicle'
        ? ['DOCUMENTS VÉHICULE', 'ADMINISTRATIF', 'MAINTENANCE MÉCANIQUE']
        : ['DOCUMENTS CHAUFFEUR', 'ADMINISTRATIF'];


      // SI AUCUN SOUS-DOSSIER N'EST SÉLECTIONNÉ : AFFICHER LA GRILLE DES SOUS-DOSSIERS
      if (!currentState.currentDocSubFolder) {
        return `
          <div class="docs-view animate-fade-in">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
              <button class="btn-back" onclick="window.app.closeFolder()" style="padding: 10px; border-radius: 12px; width: auto; height: auto;">
                <i data-lucide="arrow-left" style="width: 18px;"></i>
              </button>
              <div>
                <h1 style="font-size: 1.2rem; margin: 0;">${type === 'vehicle' ? 'Mon Véhicule' : 'Mes Documents'}</h1>
                <span style="font-size: 0.75rem; opacity: 0.5;">${type === 'vehicle' ? (entity?.plate || 'Camion') : (entity?.name || 'Chauffeur')}</span>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
              ${defaultSubFolders.map(folderName => {
          const docCount = (entity?.documents || []).filter(d => (d.folder || '').toUpperCase() === folderName).length;
          return `
                  <div class="glass-effect folder-card hover-lift" onclick="window.app.openSubFolder('${folderName}')"
                       style="padding: 20px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--glass-border); cursor: pointer;">
                    <div style="display: flex; align-items: center; gap: 15px;">
                      <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.05); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--primary-color);">
                        <i data-lucide="folder" style="width: 20px;"></i>
                      </div>
                      <div style="text-align: left;">
                        <div style="font-weight: 600; font-size: 0.95rem;">${folderName}</div>
                        <div style="font-size: 0.75rem; opacity: 0.5;">${docCount} document${docCount > 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <i data-lucide="chevron-right" style="width: 18px; opacity: 0.4;"></i>
                  </div>
                `;
        }).join('')}
            </div>
          </div>
        `;
      }

      // SI UN SOUS-DOSSIER EST SÉLECTIONNÉ : AFFICHER LES DOCUMENTS DU SOUS-DOSSIER
      const docs = (entity?.documents || []).filter(d => (d.folder || '').toUpperCase() === currentState.currentDocSubFolder);

      return `
        <div class="docs-view animate-fade-in">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px;">
            <button class="btn-back" onclick="window.app.closeSubFolder()" style="padding: 10px; border-radius: 12px; width: auto; height: auto;">
              <i data-lucide="arrow-left" style="width: 18px;"></i>
            </button>
            <div>
              <h1 style="font-size: 1.2rem; margin: 0;">${currentState.currentDocSubFolder}</h1>
              <span style="font-size: 0.75rem; opacity: 0.5;">${type === 'vehicle' ? (entity?.plate || 'Camion') : (entity?.name || 'Chauffeur')}</span>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${docs.map(doc => {
        const isExpired = doc.expiry && new Date(doc.expiry) < new Date();
        return `
                <div class="glass-effect animate-scale-in" style="padding: 15px; border-radius: 16px; border-left: 4px solid ${isExpired ? '#ef4444' : 'var(--primary-color)'};">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 12px; align-items: center;">
                      <div style="width: 36px; height: 36px; background: rgba(255,255,255,0.05); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: var(--primary-color);">
                        <i data-lucide="file-text" style="width: 18px;"></i>
                      </div>
                      <div style="text-align: left;">
                        <div style="font-weight: 600; font-size: 0.9rem;">${doc.name}</div>
                        <div style="font-size: 0.75rem; opacity: 0.6;">${doc.expiry ? `Exp: ${new Date(doc.expiry).toLocaleDateString('fr-FR')}` : 'Permanent'}</div>
                      </div>
                    </div>
                    <button class="btn-ghost" onclick="event.stopPropagation(); window.app.setDocContext('${type}', '${id}'); window.app.openPreviewDoc('${doc.id}')" style="color: var(--primary-color); padding: 5px;">
                      <i data-lucide="eye" style="width: 20px;"></i>
                    </button>
                  </div>
                </div>
              `;
      }).join('') || '<div class="text-center text-muted" style="padding: 40px; opacity: 0.5;">Ce dossier est vide</div>'}
          </div>
        </div>
      `;
    }

    // MODE : ARCHIVES (RACINE)
    const driverDocsCount = (driver?.documents || []).length;
    const vehicleDocsCount = (vehicle?.documents || []).length;

    return `
      <div class="docs-view animate-fade-in">
        <div class="section-header" style="margin-bottom: 25px;">
          <h1>Archives</h1>
          <button class="btn-primary" onclick="window.app.openFieldUpload()" title="Scanner / Photo">
            <i data-lucide="camera"></i>
          </button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr; gap: 15px;">
          <!-- Dossier Chauffeur -->
          <div class="glass-effect folder-card hover-lift" onclick="window.app.openFolder('driver', '${currentState.activeDriverId}')"
               style="padding: 25px; border-radius: 20px; text-align: center; border: 1px solid var(--glass-border); cursor: pointer;">
             <div style="width: 50px; height: 50px; background: rgba(59, 130, 246, 0.1); color: var(--primary-color); border-radius: 15px; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
               <i data-lucide="user" style="width: 24px;"></i>
             </div>
             <div style="font-weight: 700; margin-bottom: 5px;">Mes Documents</div>
             <div style="font-size: 0.75rem; opacity: 0.5;">${driverDocsCount} document${driverDocsCount > 1 ? 's' : ''}</div>
          </div>

          <!-- Dossier Véhicule -->
          <div class="glass-effect folder-card hover-lift" onclick="${vehicleId ? `window.app.openFolder('vehicle', '${vehicleId}')` : 'showToast(\'Aucun véhicule assigné\', \'info\')'}"
               style="padding: 25px; border-radius: 20px; text-align: center; border: 1px solid var(--glass-border); cursor: pointer; ${!vehicleId ? 'opacity: 0.5;' : ''}">
             <div style="width: 50px; height: 50px; background: rgba(16, 185, 129, 0.1); color: var(--success-color); border-radius: 15px; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px;">
               <i data-lucide="truck" style="width: 24px;"></i>
             </div>
             <div style="font-weight: 700; margin-bottom: 5px;">Mon Véhicule</div>
             <div style="font-size: 0.75rem; opacity: 0.5;">${vehicle ? (vehicle.plate + ' • ' + vehicleDocsCount + ' docs') : 'Non assigné'}</div>
          </div>
        </div>
      </div>
    `;
  },
  team: () => {
    const invites = currentState.teamInvitations || [];
    const members = currentState.teamMembers || [];

    const invitesHtml = invites.map(inv => `
      <div class="glass-effect" style="padding: 15px; border-radius: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 700; color: var(--primary-color); letter-spacing: 1px;">${inv.code}</div>
          <div style="font-size: 0.8rem; opacity: 0.7;">${inv.target_name} • ${ROLES[inv.role.toUpperCase()]?.label}</div>
        </div>
        <button class="btn-ghost" onclick="window.app.copyInviteCode('${inv.code}')" title="Copier le code">
          <i data-lucide="copy" style="width: 18px;"></i>
        </button>
      </div>
    `).join('');

    const membersHtml = members.map(m => `
      <div class="alert-item info" style="align-items: center;">
        <div class="avatar" style="width: 36px; height: 36px; font-size: 0.8rem;">${(m.full_name || 'U').split(' ').map(n => n[0]).join('')}</div>
        <div class="alert-content">
          <div class="alert-title" style="font-weight: 700;">${m.full_name}</div>
          <div class="alert-desc" style="color: var(--primary-color); opacity: 1; font-weight: 500;">${m.email}</div>
          <div style="font-size: 0.75rem; opacity: 0.6;">Rôle : ${ROLES[m.role.toUpperCase()]?.label || m.role}</div>
        </div>
        <button class="btn-ghost" onclick="window.app.resetUserPassword('${m.email}')" title="Réinitialiser le mot de passe" style="color: var(--warning-color);">
        <i data-lucide="key-round" style="width: 18px;"></i>
      </button>
      ${(m.id && !m.isMe) ? `
      <button class="btn-ghost" onclick="window.app.deleteTeamMember('${m.id}', '${m.full_name}')" title="Retirer de l'équipe" style="color: var(--alert-color);">
        <i data-lucide="trash-2" style="width: 18px;"></i>
      </button>
      ` : ''}
    </div>
  `).join('');

    return `
      <div class="team-view animate-fade-in">
        <div class="section-header">
          <h1>Gestion d'Équipe</h1>
          <button class="btn-primary" onclick="window.app.showInviteForm()">
            <i data-lucide="user-plus"></i> Inviter
          </button>
        </div>

        <div id="invite-form-container" class="glass-effect hidden" style="padding: 20px; border-radius: 16px; margin-bottom: 25px;">
          <h3 style="margin-bottom: 15px; font-size: 1rem;">Générer un code d'accès</h3>
          <div class="form-group">
            <label>Nom de la personne</label>
            <input type="text" id="inv-name" class="glass-input" placeholder="ex: Marc Morel">
          </div>
          <div class="form-group">
            <label>Rôle assigné</label>
            <select id="inv-role" class="glass-input">
              <option value="driver">Chauffeur</option>
              <option value="mechanic">Mécanicien</option>
              <option value="collaborator">Collaborateur</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="btn-primary" onclick="window.app.generateNewInvitation()" style="flex: 1; justify-content: center;">Générer le code</button>
            <button class="btn-ghost" onclick="window.app.showInviteForm(false)">Annuler</button>
          </div>
        </div>

        <div class="tabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--glass-border); padding-bottom: 10px;">
          <button class="btn-ghost ${currentState.teamTab === 'invites' ? 'active' : ''}" onclick="window.app.setTeamTab('invites')">Invitations en cours</button>
          <button class="btn-ghost ${currentState.teamTab === 'members' ? 'active' : ''}" onclick="window.app.setTeamTab('members')">Membres actifs</button>
        </div>

        <div class="tab-content">
          ${currentState.teamTab === 'invites' ?
        (invitesHtml || '<p class="text-muted text-center" style="padding: 20px;">Aucun code en attente.</p>') :
        (membersHtml || '<p class="text-muted text-center" style="padding: 20px;">Chargement des membres...</p>')
      }
        </div>
      </div>
    `;
  }
};

// --- Supabase Integration ---

// --- Supabase Integration ---

// Normalize payloads before sending to Supabase (snake_case, RLS org_id, bigint ids, etc.)
function normalizePayload(table, data, action = 'INSERT') {
  const out = { ...(data || {}) };

  // drivers: snake_case vehicle_id
  if (table === 'drivers' && out.vehicleId !== undefined && out.vehicle_id === undefined) {
    out.vehicle_id = out.vehicleId;
    delete out.vehicleId;
  }

  // drivers: normalize email (avoid UNIQUE conflicts with empty string)
  if (table === 'drivers' && out.email !== undefined) {
    const raw = (out.email ?? '').toString().trim();
    out.email = raw ? raw.toLowerCase() : null;
  }

  // custom_folders: BIGINT id -> never send string ids like "custom-..."
  if (table === 'custom_folders' && action === 'INSERT' && typeof out.id === 'string') {
    delete out.id;
  }

  // attendance: ensure driver_id is a number
  if (table === 'attendance' && out.driver_id !== undefined) {
    const n = Number(out.driver_id);
    out.driver_id = Number.isFinite(n) ? n : out.driver_id;
  }

  return out;
}

async function syncToSupabase(table, data, action = 'INSERT') {
  if (!supabase) return { error: 'Supabase not initialized' };

  // Show a short "saving" indicator, but ALWAYS clear it (success or error)
  const savingToast = (action === 'INSERT' || action === 'UPDATE')
    ? showToast('Enregistrement sur le serveur...', 'info')
    : null;

  const needsOrg = new Set([
    'vehicles', 'drivers', 'tasks', 'invitations', 'maintenance_logs', 'bonuses', 'custom_folders', 'tacho_files', 'attendance'
  ]);

  try {
    let payload = normalizePayload(table, data, action);

    // Ensure we have org_id for RLS-protected inserts
    if (action === 'INSERT' && needsOrg.has(table)) {
      if (!currentState.currentUserProfile?.org_id) {
        console.warn('⚠️ Tentative d\'enregistrement sans profil chargé. Tentative de rechargement...');
        try {
          if (window.app && typeof window.app.loadAllData === 'function') {
            await window.app.loadAllData();
          }
        } catch (e) {
          console.error('Failed to reload data:', e);
        }
      }

      const orgId = currentState.currentUserProfile?.org_id;
      if (!orgId) {
        throw new Error('Votre entreprise (Cellule) n\'est pas chargée');
      }

      if (!payload.org_id) payload.org_id = orgId;
    }

    let result;

    if (action === 'INSERT') {
      if (table === 'attendance') {
        // Upsert to avoid duplicate key errors on (driver_id, date)
        result = await supabase.from(table).upsert(payload, { onConflict: 'driver_id,date' });
      } else {
        result = await supabase.from(table).insert(payload);
      }
    } else if (action === 'UPDATE') {
      if (table === 'attendance') {
        result = await supabase.from(table).upsert(payload, { onConflict: 'driver_id,date' });
      } else {
        const id = data?.id ?? payload.id;
        let updates = data?.updates ? normalizePayload(table, data.updates, 'UPDATE') : payload;

        // Fix: Explicitly include org_id in updates to satisfy RLS 'WITH CHECK' policies
        if (!updates.org_id && currentState.currentUserProfile?.org_id) {
          updates = { ...updates, org_id: currentState.currentUserProfile.org_id };
        }

        console.log(`📡 [Sync] UPDATE ${table} ID:${id}`, updates); // DEBUG

        result = await supabase.from(table).update(updates).eq('id', id);

        console.log(`✅ [Sync] Result:`, result); // DEBUG
        if (result.error) console.error('❌ [Sync] ERROR:', result.error);
      }
    } else if (action === 'DELETE') {
      if (table === 'attendance') {
        result = await supabase.from(table).delete().match({ driver_id: data.driver_id, date: data.date });
      } else {
        result = await supabase.from(table).delete().eq('id', data.id);
      }
    }

    if (result && result.error) throw result.error;
    console.log(`✅ ${table} synced to Supabase`);
    // Fix: loadingToast might not be defined or global. Check window.loadingToast or safely ignore.
    if (window.loadingToast) (window.loadingToast.removeToast ? window.loadingToast.removeToast() : window.loadingToast.remove());
    return result;
  } catch (error) {
    if (window.loadingToast) (window.loadingToast.removeToast ? window.loadingToast.removeToast() : window.loadingToast.remove());
    console.warn(`⚠️ Supabase sync failed(${error.message}), queuing offline...`);

    if (navigator.onLine) {
      showToast(`Erreur de sauvegarde(Serveur): ${error.message || 'Inconnue'} `, 'error');
    } else {
      showToast("Mode hors-ligne: Sauvegarde locale", "warning");
    }

    // Queue normalized payload (important for RLS + snake_case + bigint)
    let queuedData = data;

    if (action === 'INSERT') {
      queuedData = normalizePayload(table, data, 'INSERT');
      if (needsOrg.has(table) && !queuedData.org_id && currentState.currentUserProfile?.org_id) {
        queuedData.org_id = currentState.currentUserProfile.org_id;
      }
    } else if (action === 'UPDATE') {
      queuedData = { ...data };
      if (queuedData?.updates) queuedData.updates = normalizePayload(table, queuedData.updates, 'UPDATE');
    } else if (action === 'DELETE') {
      // keep minimal keys
      queuedData = table === 'attendance'
        ? { driver_id: data.driver_id, date: data.date }
        : { id: data.id };
    }

    await db.addToQueue(action, table, queuedData);

    // Register for background sync if available
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-data');
      } catch (e) { console.warn('Background Sync registration failed:', e); }
    }
    return { error };
  } finally {
    try { if (savingToast) savingToast.remove(); } catch (e) { }
  }
}

async function processOfflineQueue() {
  if (!supabase) return;
  const queue = await db.getQueue();
  if (!queue || queue.length === 0) return;

  console.log(`🔄 Processing ${queue.length} queued offline actions...`);
  for (const item of queue) {
    try {
      const table = item.table;
      const action = item.action;
      const data = item.data || {};
      const payload = normalizePayload(table, data, action);

      let result;

      if (action === 'INSERT') {
        if (table === 'attendance') {
          result = await supabase.from(table).upsert(payload, { onConflict: 'driver_id,date' });
        } else {
          result = await supabase.from(table).insert(payload);
        }
      } else if (action === 'UPDATE') {
        if (table === 'attendance') {
          result = await supabase.from(table).upsert(payload, { onConflict: 'driver_id,date' });
        } else {
          const id = data.id ?? payload.id;
          const updates = data.updates ? normalizePayload(table, data.updates, 'UPDATE') : payload;
          result = await supabase.from(table).update(updates).eq('id', id);
        }
      } else if (action === 'DELETE') {
        if (table === 'attendance') {
          result = await supabase.from(table).delete().match({ driver_id: data.driver_id, date: data.date });
        } else {
          result = await supabase.from(table).delete().eq('id', data.id);
        }
      }

      if (result && result.error) throw result.error;
      await db.clearQueueItem(item.id);
      console.log(`✅ Offline item ${item.id} synced successfully`);
    } catch (e) {
      console.error(`❌ Still failing to sync item ${item.id}: `, e.message);
      break; // Stop and wait for next connectivity change
    }
  }
}


// --- App Logic ---
console.log('📱 4ESSIEUX V3.0.2 Initializing App Object...');
const app = {
  syncToSupabase,
  toggleSignupMode: (isOwner) => {
    currentState.signupOwnerMode = isOwner;
    render();
  },
  setLoginMode: (mode) => {
    currentState.loginMode = mode;
    render();
  },
  loadAllData: async () => {
    console.log("🔄 LOAD ALL DATA STARTED...");
    currentState.alerts = []; // Reset alerts to prevent legacy ghosts
    if (!supabase || !currentState.currentUser) {
      console.error("❌ Abort Load: Supabase or CurrentUser missing", { sb: !!supabase, user: !!currentState.currentUser });
      return;
    }
    console.log('Fetching records for current Cellule...');

    try {
      // 1. Fetch Profile First
      const { data: profile, error: errProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentState.currentUser.id)
        .single();

      if (errProfile || !profile) {
        console.error('Profile fetch error:', errProfile);
        throw new Error('Profil introuvable pour cet utilisateur.');
      }

      currentState.currentUserProfile = profile;
      let orgId = profile.org_id;

      // 2. Fetch Organization separately if we have an org_id
      if (orgId) {
        const { data: orgData, error: errOrg } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', orgId)
          .single();

        if (orgData) {
          currentState.currentOrg = orgData;
        } else {
          console.warn('Organization not found despite having org_id:', errOrg);
        }
      }

      // Override role logic: Prioritize Admin (already set by authCallback) to avoid downgrade
      if (currentState.userRole.id === 'admin') {
        if (profile.role !== 'admin') {
          console.warn(`⚠️ Role Mismatch: Auth=Admin vs DB=${profile.role}. Updating DB...`);
          supabase.from('profiles').update({ role: 'admin' }).eq('id', currentState.currentUser.id)
            .then(res => { if (res.error) console.error("Failed to update role in DB", res.error); });
        }
      } else {
        currentState.userRole = ROLES[profile.role.toUpperCase()] || ROLES.DRIVER;
      }

      // AUTO-REPAIR: If Organization is missing, create one on the fly
      if (!orgId) {
        console.warn('⚠️ Compte orphelin détecté. Création automatique d\'une organisation de secours...');
        toast.warning('Réparation de votre compte en cours...');

        try {
          // 1. Create Org
          const { data: newOrg, error: errOrg } = await supabase
            .from('organizations')
            .insert({
              name: 'Mon Entreprise (Récup)',
              owner_id: currentState.currentUser.id
            })
            .select()
            .single();

          if (errOrg) throw errOrg;

          // 2. Link Profile
          const { error: errLink } = await supabase
            .from('profiles')
            .update({ org_id: newOrg.id, role: 'admin' })
            .eq('id', currentState.currentUser.id);

          if (errLink) throw errLink;

          // 3. Update Local State
          orgId = newOrg.id;
          currentState.currentUserProfile.org_id = newOrg.id;
          currentState.currentOrg = newOrg;
          showToast('Compte réparé avec succès !', 'success');

        } catch (repairErr) {
          console.error('Auto-repair failed:', repairErr);
          throw new Error('Votre compte est bloqué (Sans Cellule) et la réparation a échoué. Veuillez contacter le support ou recréer un compte.');
        }
      }

      // 2. Fetch all data filtered by Org
      const [
        { data: v, error: ev },
        { data: d, error: ed },
        { data: t, error: et },
        { data: cf, error: ecf },
        { data: allInvs, error: ei },
        { data: att, error: eatt },
        { data: bns, error: ebns },
        { data: maint, error: emaint },
        { data: tacho, error: etacho },
        { data: allProfiles, error: eprof }
      ] = await Promise.all([
        supabase.from('vehicles').select('*').eq('org_id', orgId),
        supabase.from('drivers').select('*').eq('org_id', orgId),
        supabase.from('tasks').select('*').eq('org_id', orgId),
        supabase.from('custom_folders').select('*').eq('org_id', orgId),
        supabase.from('invitations').select('*').eq('org_id', orgId),
        supabase.from('attendance').select('*').eq('org_id', orgId),
        supabase.from('bonuses').select('*').eq('org_id', orgId),
        supabase.from('maintenance_logs').select('*').eq('org_id', orgId),
        supabase.from('tacho_files').select('*').eq('org_id', orgId),
        supabase.from('profiles').select('*').eq('org_id', orgId)
      ]);

      if (ev || ed || et || ecf || ei || eatt || ebns || emaint || etacho) {
        console.error('Data fetch error:', { ev, ed, et, ecf, ei, eatt, ebns, emaint, etacho });
        showToast('Certaines données n\'ont pas pu être récupérées.', 'warning');
      }

      // Intelligent Merge based on IDs (for array-based lists: vehicles, drivers, tasks)
      const mergeData = (serverItems, localItems) => {
        if (!serverItems) return localItems;
        const localItemsArray = Array.isArray(localItems) ? localItems : [];

        // 1. Start with server items, merging local unsynced edits if any
        const merged = serverItems.map(serverItem => {
          // Loose equality '==' handles string vs number ID mismatch for finding
          const localItem = localItemsArray.find(li => li.id == serverItem.id);
          if (localItem) {
            // Preserve local edits, but prioritize Server for critical fields like documents/urls
            const mergedItem = { ...serverItem, ...localItem };
            // Force server version of documents to ensure valid URLs (not blob:)
            if (serverItem.documents && Array.isArray(serverItem.documents)) {
              mergedItem.documents = serverItem.documents;
            }
            // Ensure ID type matches server (number usually)
            mergedItem.id = serverItem.id;
            return mergedItem;
          }
          return serverItem;
        });

        // 2. Add local items not yet on server
        // Normalize to String for robust Set check
        const serverIds = new Set(serverItems.map(i => String(i.id)));

        localItemsArray.forEach(localItem => {
          if (!serverIds.has(String(localItem.id))) {
            merged.push(localItem);
          }
        });

        return merged;
      };

      if (v) currentState.vehicles = mergeData(v, currentState.vehicles);
      if (d) currentState.drivers = mergeData(d, currentState.drivers);

      if (t) currentState.tasks = mergeData(t, currentState.tasks);
      if (cf) currentState.customFolders = mergeData(cf, currentState.customFolders);

      // Tacho Files Mapping
      if (tacho) {
        currentState.tachoFiles = tacho.map(tf => ({
          id: tf.id,
          fileName: tf.file_name,
          fileType: tf.processed_data?.type || 'Unknown',
          parsedAt: tf.created_at,
          analyzed: tf.processed_data,
          data: tf.processed_data // In case we need raw access
        }));
      }

      // --- SELF-CORRECTION: Force Driver Role if user is physically linked to a driver ---
      if (currentState.currentUser) {
        const linkedDriver = currentState.drivers.find(d =>
          d.auth_id === currentState.currentUser.id ||
          (d.email && d.email.toLowerCase() === currentState.currentUser.email.toLowerCase())
        );

        if (linkedDriver) {
          console.log("🚗 User identified as Driver in database. Enforcing Driver View.");
          currentState.userRole = ROLES.DRIVER;
          currentState.activeDriverId = linkedDriver.id;

          // Redirect if currently on Admin Dashboard
          if (currentState.currentView === 'dashboard' || currentState.currentView === 'fleet') {
            currentState.currentView = 'driverDashboard';
          }
        }
      }

      // --- TRANSFORM MAP-BASED STATES ---

      // Attendance: Array -> Object { date: { driver_id: status } }
      const attendanceMap = {};
      if (att) {
        att.forEach(r => {
          if (!attendanceMap[r.date]) attendanceMap[r.date] = {};
          attendanceMap[r.date][r.driver_id] = r.status;
        });
      }
      currentState.attendance = attendanceMap;

      // Bonuses: Array -> Object { date: { driver_id: [bonus...] } }
      const bonusesMap = {};
      if (bns) {
        bns.forEach(b => {
          if (!bonusesMap[b.date]) bonusesMap[b.date] = {};
          if (!bonusesMap[b.date][b.driver_id]) bonusesMap[b.date][b.driver_id] = [];
          bonusesMap[b.date][b.driver_id].push(b);
        });
      }
      currentState.bonuses = bonusesMap;

      // Maintenance: Array -> Object { vehicle_id: [log...] }
      const maintMap = {};
      if (maint) {
        maint.forEach(l => {
          if (!maintMap[l.vehicle_id]) maintMap[l.vehicle_id] = [];
          maintMap[l.vehicle_id].push(l);
        });
        // Sort desc by date
        Object.values(maintMap).forEach(list => list.sort((a, b) => new Date(b.date) - new Date(a.date)));
      }
      currentState.maintenanceLogs = maintMap;


      if (allInvs) {
        currentState.teamInvitations = allInvs.filter(i => !i.is_used);
      }

      // Populate teamMembers from PROFILES (Source of Truth)
      if (allProfiles) {
        currentState.teamMembers = allProfiles.map(p => {
          // Try to enrich with driver info if available
          const driver = (currentState.drivers || []).find(d => d.auth_id === p.id);
          // Try to enrich with invitation info (if they used one)
          const invite = (allInvs || []).find(i => i.used_by_auth_id === p.id);

          return {
            id: p.id, // Auth ID
            full_name: p.full_name || (driver ? driver.name : 'Utilisateur'),
            email: driver ? driver.email : (invite ? 'Compte lié' : 'Email masqué'), // Profiles don't have email by default
            role: p.role,
            isMe: (currentState.currentUser && currentState.currentUser.id === p.id)
          };
        });
      }

      // Relink active driver profile
      if (currentState.currentUser && currentState.userRole.id === 'driver') {
        const email = currentState.currentUser.email;
        const driver = currentState.drivers.find(dr => dr.email === email);
        if (driver) {
          currentState.activeDriverId = driver.id;
        }
      }


      window.app.refreshAlerts(); // <--- Refresh alerts after data load
      render();
    } catch (err) {
      console.warn('Error loading data from Supabase:', err);
    }
  },
  viewVehicle: (id) => {
    window.app.openDocsFolder('vehicle', id);
  },
  viewDriver: (id) => {
    window.app.openDocsFolder('driver', id);
  },
  openContactModal: (id) => {
    const d = currentState.drivers.find(d => d.id == id);
    if (!d) return;

    document.getElementById('contact-name').textContent = d.name;
    document.getElementById('contact-avatar').textContent = d.name.split(' ').map(n => n[0]).join('');

    const callLink = document.getElementById('contact-call-link');
    const emailLink = document.getElementById('contact-email-link');
    const phoneDisplay = document.getElementById('contact-phone-display');
    const emailDisplay = document.getElementById('contact-email-display');
    const phoneBox = document.getElementById('contact-phone-box');
    const emailBox = document.getElementById('contact-email-box');

    if (d.phone) {
      phoneDisplay.textContent = d.phone;
      callLink.href = `tel:${d.phone} `;
      phoneBox.style.display = 'flex';
    } else {
      phoneBox.style.display = 'none';
    }

    if (d.email) {
      emailDisplay.textContent = d.email;
      emailLink.href = `mailto:${d.email} `;
      emailBox.style.display = 'flex';
    } else {
      emailBox.style.display = 'none';
    }

    document.getElementById('contact-modal').classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },
  copyToClipboard: (text, message) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message || 'Copié dans le presse-papier', 'success');
    }).catch(err => {
      console.error('Failed to copy:', err);
      showToast('Erreur lors de la copie', 'error');
    });
  },
  addActivity: (type, title, subject) => {
    // Determine author
    let author = 'Système';
    if (currentState.currentUserProfile && currentState.currentUserProfile.full_name) {
      author = currentState.currentUserProfile.full_name;
    } else if (currentState.currentUser && currentState.currentUser.email) {
      author = currentState.currentUser.email;
    }

    const activity = {
      id: Date.now(),
      type: type || 'info', // info, success, warning, error
      title,
      subject,
      user: author,
      date: new Date().toISOString()
    };
    if (!currentState.activities) currentState.activities = [];
    currentState.activities.unshift(activity);

    // Keep the last 100 actions in memory
    if (currentState.activities.length > 100) currentState.activities.pop();

    // Save state
    db.saveState(currentState);
  },
  openHistoryModal: () => {
    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-full-list');

    if (!modal || !list) return;

    const acts = currentState.activities || [];

    if (acts.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="padding:40px;">Aucun historique enregistré.</p>';
    } else {
      // Grouping by date logic
      let lastDate = '';
      list.innerHTML = acts.map(act => {
        const d = new Date(act.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
        let header = '';
        if (d !== lastDate) {
          header = `<div style="padding: 15px 5px 5px 5px; font-size: 0.75rem; font-weight: 700; opacity: 0.5; text-transform: uppercase; letter-spacing: 1px;">${d}</div>`;
          lastDate = d;
        }

        return `
          ${header}
<div class="activity-item" style="display: flex; gap: 12px; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: start;">
  <div style="flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; margin-top: 2px;">
    <i data-lucide="${act.type === 'success' ? 'plus-circle' : act.type === 'error' ? 'trash-2' : act.type === 'warning' ? 'edit-3' : 'bell'}" style="width: 14px; color: ${act.type === 'success' ? 'var(--success-color)' : act.type === 'error' ? 'var(--alert-color)' : act.type === 'warning' ? 'var(--warning-color)' : 'var(--primary-color)'}"></i>
  </div>
  <div style="flex: 1;">
    <div style="font-size: 0.85rem; font-weight: 600;">${act.title}</div>
    <div style="font-size: 0.75rem; opacity: 0.6; margin-bottom: 4px;">${act.subject}</div>
    <div style="font-size: 0.7rem; opacity: 0.4; display: flex; align-items: center; gap: 4px;">
       <i data-lucide="user" style="width: 12px;"></i> ${act.user || 'Système'}
    </div>
  </div>
  <div style="font-size: 0.7rem; opacity: 0.4;">${new Date(act.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
</div>
`;
      }).join('');
    }

    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },
  viewAlert: (id) => {
    const a = currentState.alerts.find(a => String(a.id).trim() === String(id).trim());
    if (!a) return;

    // If it's a document alert, navigate to the docs and open edit if possible
    if (String(a.id).includes('doc')) {
      // Handle various formats: "v-doc-123", "v - doc - 123", "d-doc-123"
      const parts = String(a.id).split('-');
      const docId = parts[parts.length - 1].trim();

      if (String(a.id).startsWith('v')) {
        const vehicle = currentState.vehicles.find(v => v.plate === a.subject);
        if (vehicle) {
          handleNavigation('documents');
          setTimeout(() => {
            app.openFolder('vehicle', vehicle.id);
            if (docId) setTimeout(() => app.openEditDoc(docId), 100);
          }, 0);
          return;
        }
      } else {
        const driver = currentState.drivers.find(d => d.name === a.subject);
        if (driver) {
          handleNavigation('documents');
          setTimeout(() => {
            app.openFolder('driver', driver.id);
            if (docId) setTimeout(() => app.openEditDoc(docId), 100);
          }, 100);
          return;
        }
      }
    }

    alert(`Alerte: ${a.title} \nSujet: ${a.subject} `);
  },
  setFleetTab: (showDrivers) => {
    currentState.showDrivers = showDrivers;
    render();
  },
  handleDocSearch: (query) => {
    currentState.docSearch = query;
    render();

    // Maintain focus - reusing the same technique as fleetSearch
    setTimeout(() => {
      const input = document.querySelector('.documents-view input[type="text"]');
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }, 0);
  },
  openAddVehicle: () => {
    const modal = document.getElementById('add-vehicle-modal');
    if (modal) {
      const dSelect = document.getElementById('v-driver-select');
      if (dSelect) {
        dSelect.innerHTML = '<option value="">Aucun</option>' +
          currentState.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
      }
      modal.classList.remove('hidden');
      modal.offsetHeight;
    }
  },
  openAddDriver: () => {
    const modal = document.getElementById('add-driver-modal');
    if (modal) {
      const vSelect = document.getElementById('d-vehicle-select');
      if (vSelect) {
        vSelect.innerHTML = '<option value="">Aucun</option>' +
          currentState.vehicles.map(v => `<option value="${v.id}">${v.plate}</option>`).join('');
      }

      // Reset tags and fields
      document.querySelectorAll('#add-d-license-selector .license-tag').forEach(tag => tag.classList.remove('active'));
      document.getElementById('d-license').value = '';
      document.getElementById('d-email').value = '';
      document.getElementById('d-phone').value = '';

      modal.classList.remove('hidden');
      modal.offsetHeight;
    }
  },
  openEditDriver: (id) => {
    const d = currentState.drivers.find(d => d.id == id);
    if (!d) return;

    document.getElementById('edit-d-id').value = d.id;
    document.getElementById('edit-d-name').value = d.name;
    document.getElementById('edit-d-email').value = d.email || '';
    document.getElementById('edit-d-phone').value = d.phone || '';
    document.getElementById('edit-d-license').value = d.license || '';

    const vSelect = document.getElementById('edit-d-vehicle-select');
    if (vSelect) {
      vSelect.innerHTML = '<option value="">Aucun</option>' +
        currentState.vehicles.map(v => `<option value="${v.id}" ${d.vehicleId === v.id ? 'selected' : ''}>${v.plate}</option>`).join('');
    }

    const modal = document.getElementById('edit-driver-modal');
    if (modal) {
      // Setup tags from current license
      const licenses = d.license ? d.license.split(',').map(s => s.trim()) : [];
      document.querySelectorAll('#edit-d-license-selector .license-tag').forEach(tag => {
        if (licenses.includes(tag.dataset.val)) {
          tag.classList.add('active');
        } else {
          tag.classList.remove('active');
        }
      });
      document.getElementById('edit-d-license').value = d.license || '';

      modal.classList.remove('hidden');
      modal.offsetHeight;

      // Access Info Logic
      const accessInfo = document.getElementById('driver-access-info');
      const genBtn = document.getElementById('btn-gen-access');

      if (accessInfo && genBtn) {
        // Check if driver has a linked member or invitation
        const inv = (currentState.teamInvitations || []).find(i => i.target_name === d.name);

        if (inv) {
          accessInfo.innerHTML = `<i data-lucide="key" style="width:14px;"></i> Code actif: <span style="color:var(--success-color); margin-left:5px; font-weight:700;">${inv.code}</span>`;
          genBtn.innerHTML = '<i data-lucide="copy" style="width:16px;"></i> Copier le code';
          genBtn.onclick = () => window.app.copyInviteCode(inv.code);
        } else {
          accessInfo.innerHTML = `<i data-lucide="info" style="width:14px;"></i> Aucun accès configuré`;
          genBtn.innerHTML = '<i data-lucide="key-round" style="width:16px;"></i> Générer un code d\'invitation';
          genBtn.onclick = () => window.app.generateAccessForDriver(d.id);
        }
      }
      lucide.createIcons();
    }
  },
  generateAccessForDriver: async (id) => {
    const d = currentState.drivers.find(d => d.id == id);
    if (!d) return;

    // Generate random code 4X-XXXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '4X-';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
      const { error } = await supabase
        .from('invitations')
        .insert({ code, role: 'driver', target_name: d.name });

      if (error) throw error;

      showToast(`Accès généré: ${code} `, 'success');
      window.app.addActivity('success', 'Accès App Généré', `Code ${code} pour ${d.name} `);

      // Refresh invitations in state and update modal
      const { data: invs } = await supabase.from('invitations').select('*').eq('is_used', false);
      currentState.teamInvitations = invs || [];
      window.app.openEditDriver(id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  },
  openEditVehicle: (id) => {
    const v = currentState.vehicles.find(v => v.id == id);
    if (!v) return;

    document.getElementById('edit-v-id').value = v.id;
    document.getElementById('edit-v-plate').value = v.plate;
    document.getElementById('edit-v-brand').value = v.brand;
    document.getElementById('edit-v-model').value = v.model;
    document.getElementById('edit-v-mileage').value = v.mileage;
    document.getElementById('edit-v-status').value = v.status;

    const dSelect = document.getElementById('edit-v-driver-select');
    if (dSelect) {
      const associatedDriver = currentState.drivers.find(d => d.vehicleId === v.id);
      dSelect.innerHTML = '<option value="">Aucun</option>' +
        currentState.drivers.map(d => `<option value="${d.id}" ${associatedDriver?.id === d.id ? 'selected' : ''}>${d.name}</option>`).join('');
    }

    const modal = document.getElementById('edit-vehicle-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.offsetHeight;
      console.log('Modal edit-vehicle-modal displayed', v);
    }
  },
  openDocsFolder: (type, id, folderName = null) => {
    handleNavigation('documents');
    setTimeout(() => {
      window.app.openFolder(type, id);
      if (folderName) {
        currentState.docSearch = folderName; // Shortcut to 'filter' to the right folder
        render();
      } else {
        currentState.docSearch = ''; // Clear search if no specific folder targeted
        render();
      }
    }, 20);
  },
  openDocs: (type, id, defaultFolder = null) => {
    currentState.currentDocEntity = { type, id };
    let entity;
    if (type === 'vehicle') entity = currentState.vehicles.find(v => v.id == id);
    else if (type === 'driver') entity = currentState.drivers.find(d => d.id == id);
    else if (type === 'custom') entity = currentState.customFolders.find(f => f.id == id);

    if (!entity) return;

    // Folder Logic: Populate dropdown with existing folders
    const folderSelect = document.getElementById('doc-folder-select');
    if (folderSelect) {
      const existingFolders = new Set();

      // Default folders based on type
      const defaults = type === 'vehicle'
        ? ['DOCUMENTS VÉHICULE', 'ADMINISTRATIF', 'MÉCANIQUE / ENTRETIEN']
        : ['DOCUMENTS CHAUFFEUR', 'ADMINISTRATIF'];

      defaults.forEach(f => existingFolders.add(f));

      if (entity.documents) {
        entity.documents.forEach(d => {
          if (d.folder) existingFolders.add(d.folder.trim().toUpperCase());
        });
      }

      folderSelect.innerHTML = '<option value="" disabled selected>-- Choisir un dossier --</option>' +
        Array.from(existingFolders).map(f =>
          `< option value = "${f}" > ${f}</option > `
        ).join('') + '<option value="Autre">Nouveau dossier...</option>';

      if (defaultFolder) {
        folderSelect.value = defaultFolder.trim().toUpperCase();
      } else if (currentState.userRole.id === 'driver') {
        // Default to Administratif for drivers
        folderSelect.value = 'ADMINISTRATIF';
      }
    }

    // Dynamic Select Options
    const typeSelect = document.getElementById('doc-type-select');
    if (typeSelect) {
      typeSelect.innerHTML = '<option value="" disabled selected>Choisir un type...</option>';

      const vehicleOpts = [
        { v: 'Immatriculation', l: 'Immatriculation (Carte Grise)' },
        { v: 'Assurance', l: 'Assurance (Carte Verte)' },
        { v: 'Contrôle / visite', l: 'Contrôle / visite (Mines)' },
        { v: 'Taxes / vignettes', l: 'Taxes / vignettes' },
        { v: 'Entretien', l: 'Entretien' },
        { v: 'Autre', l: 'Autre...' }
      ];

      const driverOpts = [
        { v: 'Permis', l: 'Permis de conduire' },
        { v: 'Visite', l: 'Visite médicale' },
        { v: 'FIMO', l: 'Carte qualification (CQC/FCO)' },
        { v: 'Chrono', l: 'Carte conducteur' },
        { v: 'Autre', l: 'Autre...' }
      ];

      const opts = type === 'vehicle' ? vehicleOpts : driverOpts;

      opts.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.v;
        option.textContent = opt.l;
        typeSelect.appendChild(option);
      });

      // Reset custom input
      const customInput = document.getElementById('doc-custom-name');
      if (customInput) {
        customInput.classList.add('hidden');
        customInput.value = '';
      }
    }

    // If admin is viewing, clear "new" status for notifications
    if (currentState.userRole.id === 'admin' && entity.documents) {
      entity.documents.forEach(d => { if (d.status === 'new') d.status = 'reviewed'; });
      updateDynamicAlerts();
    }

    document.getElementById('doc-modal-title').textContent = `Documents: ${entity.plate || entity.name} `;

    const modal = document.getElementById('document-modal');
    modal.classList.remove('hidden');
    modal.offsetHeight;
  },
  toggleDocCustomInput: (val) => {
    const customInput = document.getElementById('doc-custom-name');
    if (val === 'Autre') {
      customInput.classList.remove('hidden');
      customInput.required = true;
    } else {
      customInput.classList.add('hidden');
      customInput.required = false;
    }
  },
  toggleExpiryInput: (checked) => {
    const input = document.getElementById('doc-expiry-input');
    if (checked) {
      input.disabled = false;
      input.style.opacity = '1';
    } else {
      input.disabled = true;
      input.style.opacity = '0.5';
      input.value = '';
    }
  },
  toggleEditExpiryInput: (checked) => {
    const input = document.getElementById('edit-doc-expiry');
    if (checked) {
      input.disabled = false;
      input.style.opacity = '1';
    } else {
      input.disabled = true;
      input.style.opacity = '0.5';
      input.value = '';
    }
  },
  openFolder: (type, id) => {
    console.log('Opening folder:', type, id);
    currentState.currentDocFolder = { type, id };
    currentState.currentDocSubFolder = null; // Reset sub-folder level
    currentState.currentDocEntity = { type, id };
    render();
  },
  openSubFolder: (name) => {
    currentState.currentDocSubFolder = name;
    render();
  },
  closeSubFolder: () => {
    currentState.currentDocSubFolder = null;
    render();
  },
  closeFolder: () => {
    currentState.currentDocFolder = null;
    render();
  },
  logoutDriver: () => {
    currentState.activeDriverId = null;
    currentState.currentView = 'driverSelection';
    render();
  },
  toggleDocFolderInput: (val) => {
    const input = document.getElementById('doc-new-folder');
    if (val === 'Autre') {
      input.classList.remove('hidden');
      input.value = '';
    } else {
      input.classList.add('hidden');
    }
  },
  toggleEditDocFolder: (val) => {
    const input = document.getElementById('edit-doc-new-folder');
    if (!input) return;
    if (val === 'Autre') {
      input.classList.remove('hidden');
      input.value = '';
    } else {
      input.classList.add('hidden');
    }
  },
  deleteTeamMember: async (authId, name) => {
    if (!confirm(`Êtes-vous sûr de vouloir retirer ${name} de l'équipe ?\nCette action est irréversible.`)) return;

    try {
      // 1. Unlink from Drivers (if applicable) - Keep driver record but remove auth link
      const { error: errDriver } = await supabase
        .from('drivers')
        .update({ auth_id: null })
        .eq('auth_id', authId);

      if (errDriver) console.warn('Driver unlink warning', errDriver);

      // 2. Remove from Profiles (Set org_id to NULL) - Effectively kicks them
      const { error: errProfile } = await supabase
        .from('profiles')
        .update({ org_id: null }) // They become orphans
        .eq('id', authId);

      if (errProfile) throw errProfile;

      showToast(`${name} a été retiré de l'équipe.`, 'success');
      window.app.addActivity('warning', 'Membre retiré', `${name} a été retiré de l'équipe.`);

      // Reload
      await app.loadAllData();
    } catch (e) {
      console.error('Delete member error:', e);
      showToast('Erreur lors de la suppression: ' + e.message, 'error');
    }
  },
  saveNewDocument: async () => {
    const typeSelect = document.getElementById('doc-type-select');
    const customInput = document.getElementById('doc-custom-name');
    const folderSelect = document.getElementById('doc-folder-select');
    const newFolderInput = document.getElementById('doc-new-folder');
    const expiryInput = document.getElementById('doc-expiry-input');
    const hasExpiry = document.getElementById('doc-has-expiry').checked;
    const fileInput = document.getElementById('doc-upload-input');
    const camInput = document.getElementById('doc-camera-input');

    const type = typeSelect.value;
    if (!type) { showToast('Veuillez sélectionner un type', 'warning'); return; }

    const name = type === 'Autre' ? customInput.value : type;
    if (type === 'Autre' && !name) { showToast('Précisez le nom du document', 'warning'); return; }

    // Folder Logic
    let folder = folderSelect ? folderSelect.value : 'ADMINISTRATIF';
    if (folder === 'Autre') {
      const rawName = newFolderInput.value.trim();
      if (!rawName) { showToast('Précisez le nom du dossier', 'warning'); return; }
      folder = rawName.toUpperCase();
    }

    if (hasExpiry && !expiryInput.value) { showToast('Date d\'expiration requise', 'warning'); return; }

    // Read file from file picker OR camera
    const picked = (fileInput && fileInput.files && fileInput.files.length > 0)
      ? fileInput.files[0]
      : ((camInput && camInput.files && camInput.files.length > 0) ? camInput.files[0] : null);

    if (!picked) {
      showToast('Veuillez choisir un fichier ou prendre une photo', 'warning');
      return;
    }

    const sendingToast = showToast('Envoi en cours...', 'info', { persistent: true });
    let fileUrl = null;

    try {
      fileUrl = await uploadDocumentForEntity(picked, currentState.currentDocEntity?.type || 'docs', currentState.currentDocEntity?.id || 'unknown');
    } catch (err) {
      console.error('❌ Upload Failed inside saveNewDocument:', err);
      showToast(`Erreur Upload: ${err.message || err}`, 'error');
      try { sendingToast.removeToast && sendingToast.removeToast(); } catch (e) { }
      return;
    } finally {
      try { sendingToast.removeToast && sendingToast.removeToast(); } catch (e) { }
    }

    const file = picked;
    const newDoc = {
      id: 'doc-' + Date.now(),
      name: name,
      type: type,
      folder: folder, // Now standardized to UPPERCASE if it's a new one or from select
      expiry: hasExpiry ? expiryInput.value : null,
      fileName: file.name,
      url: fileUrl,
      date: new Date().toISOString(),
      status: 'valid'
    };

    const { currentDocEntity } = currentState;
    let entity;
    if (currentDocEntity.type === 'vehicle') entity = currentState.vehicles.find(v => v.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'driver') entity = currentState.drivers.find(d => d.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'custom') entity = currentState.customFolders.find(f => f.id == currentDocEntity.id);

    if (entity) {
      if (!entity.documents) entity.documents = [];
      entity.documents.push(newDoc);

      const tableName = currentDocEntity.type === 'vehicle' ? 'vehicles' : (currentDocEntity.type === 'driver' ? 'drivers' : 'custom_folders');

      // Guard: Check for Blob URLs
      const badDoc = entity.documents.find(d => d.url && String(d.url).startsWith('blob:'));
      if (badDoc) {
        throw new Error(`CRITICAL: Blob URL detected in ${badDoc.name}(saveNewDocument).Aborting.`);
      }

      // Fix: Await the sync to ensure it's saved before notifying.
      try {
        console.log('💾 [Save] Syncing to Supabase:', tableName, entity.id, entity.documents);
        const { error } = await window.app.syncToSupabase(tableName, { id: entity.id, documents: entity.documents }, 'UPDATE');

        if (error) throw error;

        // Auto-Verify
        try {
          // Use imported 'supabase' client, NOT window.supabase
          const { data: verifyData } = await supabase
            .from(tableName)
            .select('documents')
            .eq('id', entity.id)
            .single();
          const stuck = verifyData?.documents?.find(d => d.id === newDoc.id);
          if (!stuck) throw new Error('Vérification DB échouée (Donnée perdue/RLS)');
        } catch (verifyErr) {
          console.error('Verify Failed:', verifyErr);
          throw verifyErr;
        }

        showToast('Document enregistré et sécurisé', 'success');
        window.app.addActivity('success', 'Nouveau document', `${newDoc.name} ajouté à ${entity.plate || entity.name} `);
      } catch (err) {
        console.error('❌ [Save] Failed:', err);
        showToast(`Erreur Sauvegarde: ${err.message || err}`, 'error');
      }

      // Close Modals
      const docModal = document.getElementById('document-modal');
      const editModal = document.getElementById('edit-doc-modal');
      if (docModal) docModal.classList.add('hidden');
      if (editModal) editModal.classList.add('hidden');

      // Refresh main UI to show the new folder/document
      render();

      // Reset form
      typeSelect.value = '';
      customInput.value = '';
      customInput.classList.add('hidden');
      if (folderSelect.value === 'Autre') {
        // If it was a new folder, we need to add it to the select and select it
        const newOption = document.createElement('option');
        newOption.value = folder;
        newOption.textContent = folder;
        folderSelect.insertBefore(newOption, folderSelect.querySelector('option[value="Autre"]'));
        folderSelect.value = folder;
        newFolderInput.classList.add('hidden');
        newFolderInput.value = '';
      }
      expiryInput.value = '';
      fileInput.value = '';
    } else {
      showToast('Erreur: Contexte introuvable', 'error');
    }
  },

  deleteDoc: async (docId) => {
    if (!await showConfirm('Supprimer ce document ?')) return;

    const { currentDocEntity } = currentState;
    if (!currentDocEntity) {
      showToast('Erreur: Contexte introuvable', 'error');
      return;
    }

    let entity;
    if (currentDocEntity.type === 'vehicle') entity = currentState.vehicles.find(v => v.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'driver') entity = currentState.drivers.find(d => d.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'custom') entity = currentState.customFolders.find(f => f.id == currentDocEntity.id);

    if (entity && entity.documents) {
      const initialCount = entity.documents.length;
      entity.documents = entity.documents.filter(d => d.id != docId);

      if (entity.documents.length === initialCount) {
        console.warn('Document with ID not found during deletion:', docId);
        // Try fallback if ID has 'doc-' prefix or not
        const altId = String(docId).startsWith('doc-') ? docId.replace('doc-', '') : 'doc-' + docId;
        entity.documents = entity.documents.filter(d => d.id != altId);
      }

      if (entity.documents.length < initialCount) {
        // Always re-render the full UI
        render();

        const tableName = currentDocEntity.type === 'vehicle' ? 'vehicles' : (currentDocEntity.type === 'driver' ? 'drivers' : 'custom_folders');
        window.app.syncToSupabase(tableName, { id: entity.id, documents: entity.documents }, 'UPDATE');
        showToast('Document supprimé', 'info');
        window.app.addActivity('error', 'Suppression document', `Un document a été retiré de ${entity.plate || entity.name} `);
      } else {
        showToast('Impossible de trouver le document à supprimer', 'error');
      }
    }
  },
  viewDoc: (docId) => {
    // Legacy alias to new preview
    window.app.openPreviewDoc(docId);
  },
  renameFolder: async (oldName, type, id) => {
    const newName = prompt('Nouveau nom du dossier :', oldName);
    if (!newName || newName === oldName) return;

    let entity;
    if (type === 'vehicle') entity = currentState.vehicles.find(v => v.id == id);
    else if (type === 'driver') entity = currentState.drivers.find(d => d.id == id);
    else if (type === 'custom') entity = currentState.customFolders.find(f => f.id == id);

    if (entity && entity.documents) {
      const standardizedNewName = newName.trim().toUpperCase();
      if (type === 'custom') {
        entity.name = standardizedNewName;
      }
      entity.documents.forEach(d => {
        if (d.folder === oldName || (!d.folder && oldName.includes('DOCUMENTS'))) {
          d.folder = standardizedNewName;
        }
      });

      const tableName = type === 'vehicle' ? 'vehicles' : (type === 'driver' ? 'drivers' : 'custom_folders');
      window.app.syncToSupabase(tableName, { id: entity.id, documents: entity.documents, name: entity.name }, 'UPDATE');
      showToast('Dossier renommé', 'success');
      window.app.addActivity('warning', 'Dossier renommé', `${oldName} -> ${newName}(${entity.plate || entity.name})`);
      render();
    }
  },
  deleteFolder: async (folderName, type, id) => {
    if (!await showConfirm(`Supprimer le dossier "${folderName}" et TOUS ses documents ? `)) return;

    const entity = type === 'vehicle'
      ? currentState.vehicles.find(v => v.id == id)
      : currentState.drivers.find(d => d.id == id);

    if (entity && entity.documents) {
      const initialCount = entity.documents.length;
      entity.documents = entity.documents.filter(d => d.folder !== folderName);
      const deletedCount = initialCount - entity.documents.length;

      const tableName = type === 'vehicle' ? 'vehicles' : (type === 'driver' ? 'drivers' : 'custom_folders');
      window.app.syncToSupabase(tableName, { id: entity.id, documents: entity.documents }, 'UPDATE');

      showToast(`${deletedCount} document(s) supprimé(s)`, 'success');
      window.app.addActivity('error', 'Dossier supprimé', `Le dossier ${folderName} a été supprimé(${entity.plate || entity.name})`);
      render();
    }
  },
  deleteCustomFolder: async (id) => {
    if (!await showConfirm('Supprimer ce dossier spécial et TOUS ses documents ?')) return;
    currentState.customFolders = currentState.customFolders.filter(f => f.id != id);
    window.app.syncToSupabase('custom_folders', { id }, 'DELETE');
    showToast('Dossier spécial supprimé', 'info');
    window.app.addActivity('error', 'Dossier spécial supprimé', 'Un dossier personnalisé a été retiré');
    render();
  },
  addCustomFolder: async () => {
    const name = prompt('Nom du nouveau dossier :');
    if (!name) return;

    const newFolder = {
      id: 'custom-' + Date.now(),
      name: name.toUpperCase(),
      documents: []
    };

    currentState.customFolders.push(newFolder);
    window.app.syncToSupabase('custom_folders', newFolder, 'INSERT');
    showToast('Dossier spécial créé', 'success');
    window.app.addActivity('success', 'Dossier spécial créé', name.toUpperCase());
    render();
  },
  openEditDoc: (docId) => {
    console.log('Opening edit for doc:', docId, currentState.currentDocEntity);
    const { currentDocEntity } = currentState;
    if (!currentDocEntity) return;

    let entity;
    if (currentDocEntity.type === 'vehicle') entity = currentState.vehicles.find(v => v.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'driver') entity = currentState.drivers.find(d => d.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'custom') entity = currentState.customFolders.find(f => f.id == currentDocEntity.id);

    if (!entity) return;
    const doc = entity.documents.find(d => d.id == docId);
    if (!doc) return;

    document.getElementById('edit-doc-id').value = doc.id;
    document.getElementById('edit-doc-name').value = doc.name;

    const expiryInput = document.getElementById('edit-doc-expiry');
    const hasExpiryToggle = document.getElementById('edit-doc-has-expiry');

    if (doc.expiry) {
      expiryInput.value = doc.expiry;
      if (hasExpiryToggle) hasExpiryToggle.checked = true;
      expiryInput.disabled = false;
      expiryInput.style.opacity = '1';
    } else {
      expiryInput.value = '';
      if (hasExpiryToggle) hasExpiryToggle.checked = false;
      expiryInput.disabled = true;
      expiryInput.style.opacity = '0.5';
    }

    document.getElementById('edit-doc-file-name').textContent = `Fichier actuel: ${doc.fileName || 'Nouveau'} `;
    document.getElementById('edit-doc-modal').classList.remove('hidden');
  },
  saveEditDoc: async (e) => {
    e.preventDefault();
    const rawEmail = (document.getElementById('d-email').value || '').trim().toLowerCase();
    if (rawEmail) {
      const already = currentState.drivers.some(d => (d.email || '').toString().toLowerCase() === rawEmail);
      if (already) {
        showToast('Un chauffeur avec cet email existe déjà dans cette cellule.', 'warning');
        return;
      }
    }


    const docId = document.getElementById('edit-doc-id').value;
    const name = document.getElementById('edit-doc-name').value;
    const hasExpiryToggle = document.getElementById('edit-doc-has-expiry');
    const hasExpiry = hasExpiryToggle ? hasExpiryToggle.checked : !!document.getElementById('edit-doc-expiry').value;
    const expiry = document.getElementById('edit-doc-expiry').value;
    const fileInput = document.getElementById('edit-doc-file');
    const camFileInput = document.getElementById('edit-doc-camera-file');

    if (hasExpiry && !expiry) { showToast('Date d\'expiration requise', 'warning'); return; }

    const { currentDocEntity } = currentState;
    let entity;
    if (currentDocEntity.type === 'vehicle') entity = currentState.vehicles.find(v => v.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'driver') entity = currentState.drivers.find(d => d.id == currentDocEntity.id);
    else if (currentDocEntity.type === 'custom') entity = currentState.customFolders.find(f => f.id == currentDocEntity.id);

    if (!entity) return;
    const doc = entity.documents.find(d => d.id == docId);
    if (!doc) return;

    // Update fields
    doc.name = name;
    doc.expiry = hasExpiry ? expiry : null;

    // Update file if new one selected

    const pickedFile = (fileInput && fileInput.files && fileInput.files.length > 0)
      ? fileInput.files[0]
      : ((camFileInput && camFileInput.files && camFileInput.files.length > 0) ? camFileInput.files[0] : null);

    if (pickedFile) {
      const upToast = showToast('Upload en cours...', 'info', { persistent: true });
      try {
        const newUrl = await uploadDocumentForEntity(pickedFile, currentState.currentDocEntity?.type || 'docs', currentState.currentDocEntity?.id || 'unknown');
        doc.fileName = pickedFile.name;
        doc.url = newUrl;
      } catch (err) {
        console.error(err);
        showToast('Upload impossible (bucket documents).', 'error');
      } finally {
        try { upToast.removeToast && upToast.removeToast(); } catch (e) { }
      }
    }


    render();

    const tableName = currentDocEntity.type === 'vehicle' ? 'vehicles' : (currentDocEntity.type === 'driver' ? 'drivers' : 'custom_folders');
    window.app.syncToSupabase(tableName, { id: entity.id, documents: entity.documents }, 'UPDATE');

    document.getElementById('edit-doc-modal').classList.add('hidden');
    showToast('Document modifié', 'success');
    window.app.addActivity('warning', 'Document modifié', `${doc.name}(${entity.plate || entity.name})`);
  },
  openPreviewDoc: (docId) => {
    // 1. Locate Document
    // FALLBACK: Use currentDocFolder if currentDocEntity is missing (Admin View usually sets currentDocFolder)
    const context = currentState.currentDocEntity || currentState.currentDocFolder;

    if (!context) {
      console.error('❌ Missing Document Context (currentDocEntity or currentDocFolder)');
      showToast('Contexte documents manquant.', 'error');
      return;
    }

    let entity;
    if (context.type === 'vehicle') entity = currentState.vehicles.find(v => v.id == context.id);
    else if (context.type === 'driver') entity = currentState.drivers.find(d => d.id == context.id);
    else if (context.type === 'custom') entity = currentState.customFolders.find(f => f.id == context.id);

    if (!entity) {
      console.error('❌ Entity not found for', currentDocEntity);
      return;
    }

    const doc = entity.documents ? entity.documents.find(d => d.id == docId) : null;

    if (!doc || !doc.url) {
      showToast('Document introuvable ou illisible.', 'error');
      return;
    }

    // 2. Prepare Modal
    const modal = document.getElementById('preview-doc-modal');
    if (!modal) {
      console.error('❌ Modal #preview-doc-modal NOT FOUND in DOM');
      showToast('Erreur interne: Modale de prévisualisation manquante', 'error');
      return;
    }

    const title = document.getElementById('preview-doc-title');
    const frame = document.getElementById('preview-frame');
    const img = document.getElementById('preview-image');
    const fallback = document.getElementById('preview-fallback');
    const dlBtn = document.getElementById('preview-download-btn');
    const loader = document.getElementById('preview-loader');

    if (title) title.textContent = doc.name || doc.fileName || 'Aperçu Document';

    // Reset Views
    if (frame) frame.style.display = 'none';
    if (img) img.style.display = 'none';
    if (fallback) fallback.style.display = 'none';
    if (loader) loader.style.display = 'flex'; // Show loader initially
    if (frame) frame.src = '';
    if (img) img.src = '';

    // CRITICAL FIX: Move to body to ensure z-indexing works and it's not trapped in #app
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.style.zIndex = '20000'; // Ensure it is on top
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.display = 'flex'; // Force flex

    // Force Reflow/Repaint
    void modal.offsetHeight;

    // 3. Detect content type and render
    const isImage = (doc.type && doc.type.toLowerCase().includes('image')) ||
      (doc.fileName && /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.fileName)) ||
      (doc.url && /\.(jpg|jpeg|png|gif|webp)/i.test(doc.url));

    const isPdf = (doc.type && doc.type.toLowerCase().includes('pdf')) ||
      (doc.fileName && /\.pdf$/i.test(doc.fileName)) ||
      (doc.url && /\.pdf/i.test(doc.url));

    // Helper to handle load event
    const handleLoad = () => {
      if (loader) loader.style.display = 'none';
    };

    if (isImage && img) {
      img.src = doc.url;
      img.onload = handleLoad;
      img.onerror = () => { handleLoad(); if (fallback) fallback.style.display = 'block'; };
      img.style.display = 'block';
    } else if (isPdf && frame) {
      // PDF might invoke platform viewer, but try iframe first
      frame.src = doc.url;
      frame.onload = handleLoad;
      frame.onerror = () => { handleLoad(); if (fallback) fallback.style.display = 'block'; };
      frame.style.display = 'block';

      // Fallback timer for iframe, as some browsers don't fire error on X-Frame-Allow issues
      setTimeout(() => {
        if (loader && loader.style.display !== 'none') handleLoad();
      }, 5000);
    } else {
      // Unknown type -> Fallback
      handleLoad();
      if (fallback) fallback.style.display = 'block';
    }

    // Setup Download Action
    if (dlBtn) {
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = doc.url;
        a.download = doc.fileName || doc.name || 'document';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    }
  },
  openAddTask: () => {
    const modal = document.getElementById('add-task-modal');
    if (modal) {
      // Populate selects
      const vSelect = document.getElementById('t-vehicle');
      const dSelect = document.getElementById('t-driver');

      if (vSelect) {
        vSelect.innerHTML = '<option value="">Non assigné</option>' +
          currentState.vehicles.map(v => `< option value = "${v.id}" > ${v.plate}(${v.brand})</option > `).join('');
      }
      if (dSelect) {
        dSelect.innerHTML = '<option value="">Non assigné</option>' +
          currentState.drivers.map(d => `< option value = "${d.id}" > ${d.name}</option > `).join('');
      }

      modal.classList.remove('hidden');
      modal.offsetHeight;
      lucide.createIcons();
    }
  },
  toggleTask: (id) => {
    const task = currentState.tasks.find(t => t.id == id);
    if (task) {
      task.status = task.status === 'completed' ? 'pending' : 'completed';
      render();
      console.log(`Tâche ${id} basculée: `, task.status);
    }
  },
  deleteTask: async (id) => {
    if (await showConfirm("Supprimer cette tâche ?")) {
      currentState.tasks = currentState.tasks.filter(t => t.id != id);
      const task = currentState.tasks.find(t => t.id == id); // Oops, it's already gone
      render();
      syncToSupabase('tasks', { id }, 'DELETE');
      window.app.addActivity('error', 'Mission supprimée', 'Une mission a été retirée');
    }
  },

  // --- Unified Mission Folder Logic (Simple V1) ---
  openMissionDetail: (id) => {
    const task = currentState.tasks.find(t => t.id == id);
    if (!task) return;

    currentState.currentTaskId = id;
    if (!task.files) task.files = [];
    if (!task.stops) task.stops = [];

    const modal = document.getElementById('mission-detail-modal');
    document.getElementById('m-detail-title').textContent = task.title;
    document.getElementById('m-detail-date').textContent = task.date ? new Date(task.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Dès que possible';

    const notesBox = document.getElementById('m-notes-box');
    if (task.notes) {
      notesBox.style.display = 'block';
      document.getElementById('m-detail-notes').textContent = task.notes;
    } else {
      notesBox.style.display = 'none';
    }

    const reportInput = document.getElementById('m-driver-report');
    if (reportInput) reportInput.value = task.report || '';

    const completeBtn = document.getElementById('m-detail-complete-btn');
    completeBtn.innerHTML = task.status === 'completed' ? '<i data-lucide="refresh-cw"></i> Réouvrir la mission' : '<i data-lucide="check-circle"></i> Clôturer la mission';
    completeBtn.style.background = task.status === 'completed' ? 'var(--primary-color)' : 'var(--success-color)';
    completeBtn.onclick = () => {
      task.report = document.getElementById('m-driver-report')?.value;
      window.app.toggleTask(id);
      window.app.openMissionDetail(id);
    };

    modal.classList.remove('hidden');
    lucide.createIcons();
    window.app.renderMissionFolder();
  },

  renderMissionFolder: () => {
    const task = currentState.tasks.find(t => t.id == currentState.currentTaskId);
    if (!task) return;

    // Update global progress in modal if roadmap progress el exists
    const progressEl = document.getElementById('m-roadmap-progress');
    if (progressEl) {
      const done = (task.files || []).filter(f => f.completed).length;
      const total = (task.files || []).length;
      progressEl.textContent = `${done} / ${total}`;
    }

    const renderFileList = (containerId, type) => {
      const container = document.getElementById(containerId);
      const files = (task.files || []).filter(f => f.from === type);

      container.innerHTML = files.length ? files.map((file) => {
        // Validation Logic: 
        // Admin docs (type==='admin') can only be checked by Driver
        // Driver docs (type==='driver') can only be checked by Admin
        const canCheck = (type === 'admin' && currentState.userRole.id === 'driver') ||
          (type === 'driver' && currentState.userRole.id === 'admin');

        return `
    < div class= "glass-effect" style = "display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid ${file.completed ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)'}; transition: all 0.2s; ${file.completed ? 'opacity: 0.6;' : ''}" >
            < !--Checkbox proof-- >
            <div ${canCheck ? `onclick="window.app.toggleMissionFile('${file.id}')"` : ''} 
                 style="width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; 
                        background: ${file.completed ? (type === 'admin' ? 'var(--primary-color)' : 'var(--success-color)') : 'rgba(255,255,255,0.05)'}; 
                        border: 2px solid ${file.completed ? (type === 'admin' ? 'var(--primary-color)' : 'var(--success-color)') : 'var(--glass-border)'}; 
                        border-radius: 6px; color: white; flex-shrink: 0; ${canCheck ? 'cursor: pointer;' : 'cursor: not-allowed; opacity: 0.5;'}"
                 title="${canCheck ? 'Valider ce document' : 'En attente de validation par l\'autre partie'}">
              ${file.completed ? '<i data-lucide="check" style="width: 14px;"></i>' : ''}
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer; overflow: hidden;" onclick="window.app.downloadFile('${file.url}', '${file.name}')">
               <i data-lucide="file-text" style="width: 16px; opacity: 0.5;"></i>
               <div style="font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
               <i data-lucide="download" style="width: 12px; opacity: 0.4; margin-left: auto;"></i>
            </div>

            ${currentState.userRole.id === 'admin' || (type === 'driver' && currentState.userRole.id === 'driver') ? `
              <button class="btn-ghost" onclick="window.app.deleteMissionFile('${file.id}')" style="color: #ef4444; padding: 5px;">
                <i data-lucide="trash-2" style="width: 14px;"></i>
              </button>
            ` : ''
          }
          </div >
  `;
      }).join('') : `< p style = "font-size: 0.75rem; opacity: 0.4; text-align: center; padding: 10px;" > ${type === 'admin' ? 'Aucun document transmis.' : 'En attente de preuve (BL...)'}</p > `;
    };

    renderFileList('m-admin-files-list', 'admin');
    renderFileList('m-driver-files-list', 'driver');

    lucide.createIcons();
    db.saveState(currentState);
  },

  uploadMissionFiles: async (input, from) => {
    const files = Array.from(input.files);
    if (files.length === 0) return;
    const task = currentState.tasks.find(t => t.id == currentState.currentTaskId);
    if (task) {
      if (!task.files) task.files = [];

      const orgId = currentState.currentUserProfile?.org_id;
      if (!orgId) { showToast('Entreprise non chargée', 'warning'); return; }

      const upToast = showToast('Upload des fichiers...', 'info', { persistent: true });
      try {
        for (const file of files) {
          const safe = sanitizeFileName(file.name);
          const path = `${orgId}/tasks/${task.id}/${from}/${Date.now()}_${safe}`;
          const url = await uploadToDocumentsBucket(file, path);
          const newFile = {
            id: 'file-' + Date.now() + Math.random().toString(36).substr(2, 9),
            name: file.name,
            url,
            from: from,
            date: new Date().toISOString()
          };
          task.files.push(newFile);
        }
      } catch (err) {
        console.error(err);
        showToast('Upload impossible (bucket documents).', 'error');
      } finally {
        try { upToast.removeToast && upToast.removeToast(); } catch (e) { }
      }

      window.app.renderMissionFolder();
      syncToSupabase('tasks', task, 'UPDATE');
      showToast(`${files.length} document(s) ajouté(s).`, 'success');
      window.app.addActivity('success', 'Fichiers mission', `${files.length} fichiers ajoutés à "${task.title}"`);
      input.value = '';
    }
  },

  toggleMissionFile: (fileId) => {
    const task = currentState.tasks.find(t => t.id == currentState.currentTaskId);
    if (task) {
      const file = task.files.find(f => f.id === fileId);
      if (file) {
        file.completed = !file.completed;
        window.app.renderMissionFolder();
        syncToSupabase('tasks', task, 'UPDATE');
      }
    }
  },

  downloadFile: (url, name) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  deleteMissionFile: (fileId) => {
    const task = currentState.tasks.find(t => t.id == currentState.currentTaskId);
    if (task) {
      task.files = task.files.filter(f => f.id != fileId);
      window.app.renderMissionFolder();
      syncToSupabase('tasks', task, 'UPDATE');
      window.app.addActivity('error', 'Fichier mission supprimé', `Un document a été retiré de "${task.title}"`);
    }
  },

  toggleStop: (index) => {
    const task = currentState.tasks.find(t => t.id == currentState.currentTaskId);
    if (task && task.stops[index]) {
      task.stops[index].completed = !task.stops[index].completed;
      window.app.renderMissionFolder();
      syncToSupabase('tasks', task, 'UPDATE');
    }
  },
  toggleRoleModal: () => {
    console.log('🔄 Toggling Role Modal...');
    const modal = document.getElementById('role-modal');
    if (modal) {
      modal.classList.toggle('hidden');
      if (!modal.classList.contains('hidden')) {
        lucide.createIcons(); // Ensure icons inside modal are rendered
      }
    } else {
      console.error('❌ Role modal element not found!');
    }
  },
  deleteVehicle: async (id) => {
    // alert('DEBUG: deleteVehicle appelé pour ID: ' + id);
    console.log('🗑️ Attempting deleteVehicle id:', id);
    let confirmed = false;
    try {
      confirmed = await showConfirm('Voulez-vous vraiment supprimer ce véhicule ?');
    } catch (err) {
      console.warn('Fallback native confirm:', err);
      confirmed = window.confirm('Voulez-vous vraiment supprimer ce véhicule ?');
    }
    if (!confirmed) return;

    const vehicleIndex = currentState.vehicles.findIndex(v => v.id == id);
    if (vehicleIndex !== -1) {
      const v = currentState.vehicles[vehicleIndex];
      const detail = `${v.plate} (${v.brand})`;
      currentState.vehicles.splice(vehicleIndex, 1);
      render(); // Update UI immediately
      syncToSupabase('vehicles', { id }, 'DELETE');
      window.app.addActivity('error', 'Véhicule supprimé', detail);
      showToast('Véhicule supprimé du parc', 'info');
    } else {
      console.warn('Vehicle ID not found in local state:', id);
      showToast('Erreur: Véhicule introuvable', 'error');
    }
    // } catch (e) {
    //   console.error('Delete Vehicle Error:', e);
    //   showToast('Erreur lors de la suppression', 'error');
    // }
  },
  deleteDriver: async (id) => {
    // alert('DEBUG: deleteDriver appelé pour ID: ' + id);
    console.log('🗑️ Attempting deleteDriver id:', id);
    let confirmed = false;
    try {
      confirmed = await showConfirm('Voulez-vous vraiment supprimer ce chauffeur ?');
    } catch (err) {
      console.warn('Fallback native confirm:', err);
      confirmed = window.confirm('Voulez-vous vraiment supprimer ce chauffeur ?');
    }
    if (!confirmed) return;

    const driverIndex = currentState.drivers.findIndex(d => d.id == id);
    if (driverIndex !== -1) {
      const d = currentState.drivers[driverIndex];
      currentState.drivers.splice(driverIndex, 1);
      render();
      syncToSupabase('drivers', { id }, 'DELETE');
      window.app.addActivity('error', 'Chauffeur supprimé', d.name);
      showToast('Chauffeur supprimé', 'info');
    } else {
      console.warn('Driver ID not found in local state:', id);
      showToast('Erreur: Chauffeur introuvable', 'error');
    }
  },
  setAttendance: async (driverId, status) => {
    const date = currentState.currentPayrollDate; // YYYY-MM-DD
    const dId = Number(driverId);

    if (!currentState.attendance[date]) currentState.attendance[date] = {};

    let action;
    if (currentState.attendance[date][dId] === status) {
      delete currentState.attendance[date][dId];
      action = 'DELETE';
    } else {
      currentState.attendance[date][dId] = status;
      action = 'INSERT'; // INSERT uses UPSERT for attendance
    }

    render();

    // If profile/org not loaded yet, force reload then retry once
    if (!currentState.currentUserProfile?.org_id && typeof window.app.loadAllData === 'function') {
      showToast("Chargement de votre entreprise…", "info");
      try { await window.app.loadAllData(); } catch (e) { }
    }

    await syncToSupabase('attendance', { driver_id: dId, date, status }, action);
  },
  updatePayrollDate: (date) => {
    currentState.currentPayrollDate = date;
    render();
  },
  handlePayrollSearch: (val) => {
    currentState.payrollSearch = val;
    render();
    setTimeout(() => {
      const input = document.querySelector('.payroll-view .glass-input');
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }, 0);
  },
  handleFleetSearch: (val) => {
    currentState.fleetSearch = val;
    render();
    setTimeout(() => {
      const input = document.querySelector('.fleet-view .glass-input');
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }, 0);
  },
  shiftPayrollDate: (days) => {
    // Use Noon to avoid timezone shift issues
    const current = new Date(currentState.currentPayrollDate + 'T12:00:00');
    current.setDate(current.getDate() + days);

    // Safety check just in case
    if (isNaN(current.getTime())) return;

    const newDate = current.toISOString().split('T')[0];
    window.app.updatePayrollDate(newDate);
  },
  togglePayrollView: () => {
    currentState.payrollViewMode = currentState.payrollViewMode === 'monthly' ? 'daily' : 'monthly';
    render();
  },
  openBonusModal: (driverId) => {
    currentState.currentBonusDriver = driverId;
    const driver = currentState.drivers.find(d => d.id == driverId);
    if (driver) {
      const modalTitle = document.getElementById('bonus-modal-title');
      if (modalTitle) modalTitle.textContent = `Primes: ${driver.name} `;
      window.app.renderDayBonuses(driverId);
      const modal = document.getElementById('bonus-modal');
      if (modal) modal.classList.remove('hidden');
    }
  },
  addBonus: (label, amount) => {
    const driverId = currentState.currentBonusDriver;
    // CRITICAL: Ensure date is YYYY-MM-DD string, not a Date object or weird format
    const date = currentState.currentPayrollDate;

    // Ensure array exists
    if (!currentState.bonuses[date]) currentState.bonuses[date] = {};
    if (!currentState.bonuses[date][driverId]) currentState.bonuses[date][driverId] = [];

    const newBonus = {
      id: Date.now(),
      label,
      amount
    };

    currentState.bonuses[date][driverId].push(newBonus);

    // Refresh ONLY the day list if we are in the bonus modal
    window.app.renderDayBonuses(driverId);

    // Also refresh the main payroll grid to show the new total immediately
    render();

    // EXCLUDE the temporary local ID (Date.now()) from the payload
    // Let Supabase/Postgres generate the real BIGINT id, otherwise it might conflict or default to 0
    const { id: tempId, ...bonusPayload } = newBonus;
    syncToSupabase('bonuses', { driver_id: driverId, date, ...bonusPayload }, 'INSERT');
  },
  deleteBonus: (bonusId) => {
    // We need to find WHICH driver and date this bonus belongs to if not strictly tracking currentBonusDriver
    // But assuming currentBonusDriver and currentPayrollDate are set correctly when modal opened:
    const driverId = currentState.currentBonusDriver;
    const date = currentState.currentPayrollDate;

    if (currentState.bonuses[date]?.[driverId]) {
      currentState.bonuses[date][driverId] = currentState.bonuses[date][driverId].filter(b => b.id != bonusId);
      syncToSupabase('bonuses', { id: bonusId }, 'DELETE');
    }

    window.app.renderDayBonuses(driverId);
    render();
  },

  renderDayBonuses: (driverId) => {
    const list = document.getElementById('current-day-bonuses');
    if (!list) return;

    const date = currentState.currentPayrollDate;
    const bonuses = currentState.bonuses[date]?.[driverId] || [];

    if (bonuses.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="font-size: 0.8rem; padding: 10px;">Aucune prime pour ce jour.</p>';
    } else {
      list.innerHTML = bonuses.map(b => `
  < div class="glass-effect" style = "display: flex; justify-content: space-between; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 8px; font-size: 0.9rem;" >
          <div style="display: flex; gap: 8px; align-items: center;">
             <span style="width: 6px; height: 6px; background: var(--primary-color); border-radius: 50%;"></span>
             <span>${b.label}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: 700; color: var(--primary-color);">${b.amount.toFixed(2)}€</span>
            <button class="btn-ghost" onclick="window.app.deleteBonus('${b.id}')" style="color: #ef4444; padding: 4px; opacity: 0.7;">
              <i data-lucide="trash-2" style="width: 14px;"></i>
            </button>
          </div>
        </div >
  `).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },
  downloadMonthlyReport: (driverId, yearOpt = null, monthOpt = null) => {
    const dId = driverId;
    if (!dId) {
      showToast("❌ Chauffeur invalide (ID manquant).", "error");
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast("❌ PDF indisponible (jsPDF non chargé).", "error");
      return;
    }
    const { jsPDF } = window.jspdf;

    const driver = currentState.drivers.find(d => d.id == dId);
    if (!driver) {
      showToast("❌ Chauffeur introuvable pour le PDF.", "error");
      return;
    }
    const [curY, curM] = currentState.currentPayrollDate.split('-');
    const year = yearOpt ?? curY;
    const month = monthOpt ?? curM;
    const monthLabel = new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(66, 193, 166); // Brand color
    doc.text("4ESSIEUX - Récapitulatif Mensuel", 14, 20);

    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Chauffeur: ${driver.name} `, 14, 30);
    doc.text(`Période: ${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)} `, 14, 37);

    // Data Preparation
    const daysInMonth = new Date(year, month, 0).getDate();
    const tableData = [];
    let totals = { present: 0, vacation: 0, sick: 0, absent: 0, bonuses: 0 };
    let weekendStats = { saturday: 0, sunday: 0 };

    const statusMap = {
      'present': 'Travaille',
      'absent': 'Absent',
      'vacation': 'Congés Payés',
      'sick': 'Arrêt Maladie',
      'unset': '-'
    };

    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `${year}-${month}-${day.toString().padStart(2, '0')}`;
      const status = currentState.attendance[dStr]?.[dId] || "unset";
      const dayBonuses = currentState.bonuses[dStr]?.[dId] || [];
      const bonusText = dayBonuses.map(b => b.label).join(", ");
      const bonusAmount = dayBonuses.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

      const dateObj = new Date(dStr);
      const dayOfWeek = dateObj.getDay(); // 0 = Sunday, 6 = Saturday

      if (status !== 'unset') {
        totals[status]++;
        if (status === 'present') {
          if (dayOfWeek === 6) weekendStats.saturday++;
          if (dayOfWeek === 0) weekendStats.sunday++;
        }
      }
      totals.bonuses += bonusAmount;

      tableData.push([
        dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        statusMap[status],
        bonusText || "-",
        bonusAmount > 0 ? `${bonusAmount.toFixed(2)}€` : "-"
      ]);
    }

    // Table
    doc.autoTable({
      startY: 45,
      head: [['Date', 'Statut', 'Primes Detail', 'Montant']],
      body: tableData,
      headStyles: { fillColor: [66, 193, 166] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { top: 45 }
    });

    // Totals Summary
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("Résumé de l'activité", 14, finalY);

    doc.setFontSize(10);
    let currentY = finalY + 8;

    // Left Column
    doc.text(`Jours ouvrés travaillés: ${totals.present - weekendStats.saturday - weekendStats.sunday} j`, 14, currentY); currentY += 6;
    doc.text(`Samsedi travaillés: ${weekendStats.saturday} j`, 14, currentY); currentY += 6;
    doc.text(`Dimanche travaillés: ${weekendStats.sunday} j`, 14, currentY); currentY += 6;
    doc.text(`Congés Payés: ${totals.vacation} j`, 14, currentY); currentY += 6;
    doc.text(`Arrêt Maladie: ${totals.sick} j`, 14, currentY); currentY += 6;
    doc.text(`Absences: ${totals.absent} j`, 14, currentY);

    // Right Column (Bonuses)
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL DES PRIMES: ${totals.bonuses.toFixed(2)}€`, 130, finalY + 8);

    // Export
    doc.save(`Rapport_${driver.name.replace(/\s+/g, '_')}_${month}_${year}.pdf`);
  },

  // --- Payroll Detail (mois courant + mois précédent) ---
  openPayrollDetail: (driverId) => {
    try {
      // alert(`DEBUG: Ouverture Paie pour ID ${ driverId } \nSi ce message s'affiche, le clic fonctionne !`);

      const dId = driverId;
      if (!dId) throw new Error("ID Chauffeur manquant");

      currentState.payrollDetail = currentState.payrollDetail || {};
      currentState.payrollDetail.driverId = dId;

      // Ensure currentPayrollDate exists
      if (!currentState.currentPayrollDate) {
        console.warn("currentPayrollDate missing, defaulting to today");
        currentState.currentPayrollDate = new Date().toISOString().slice(0, 10);
      }

      currentState.payrollDetail.yearMonth = currentState.currentPayrollDate.slice(0, 7); // YYYY-MM

      window.app.renderPayrollDetailModal();
    } catch (e) {
      console.error("ERREUR CRITIQUE OPEN_PAYROLL:", e);
      showToast(`Erreur ouverture paie: ${e.message}`, "error");
    }
  },
  openPayrollDetailHistory: (driverId, yearMonth) => {
    currentState.payrollDetail = currentState.payrollDetail || {};
    currentState.payrollDetail.driverId = driverId;
    currentState.payrollDetail.yearMonth = yearMonth;
    window.app.renderPayrollDetailModal();
  },
  closePayrollDetail: () => {
    const modal = document.getElementById('payroll-detail-modal');
    if (modal) modal.classList.add('hidden');
  },
  shiftPayrollDetailMonth: (delta) => {
    if (!currentState.payrollDetail?.yearMonth) return;
    const [y, m] = currentState.payrollDetail.yearMonth.split('-').map(Number);
    const dt = new Date(y, (m - 1) + delta, 1);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, '0');
    currentState.payrollDetail.yearMonth = `${ny}-${nm}`;
    window.app.renderPayrollDetailModal();
  },
  downloadPayrollDetailReport: () => {
    const dId = currentState.payrollDetail?.driverId;
    const ym = currentState.payrollDetail?.yearMonth;
    if (!dId || !ym) return;
    const [y, m] = ym.split('-');
    window.app.downloadMonthlyReport(dId, y, m);
  },
  renderPayrollDetailModal: () => {
    try {
      const modal = document.getElementById('payroll-detail-modal');
      const dId = currentState.payrollDetail?.driverId;
      const ym = currentState.payrollDetail?.yearMonth;

      if (!modal) {
        showToast("⚠️ Modal paie introuvable (index.html non patché).", "error");
        return;
      }

      if (!dId || !ym) {
        console.error("❌ DriverID or YearMonth missing in state");
        return;
      }

      const driver = currentState.drivers.find(d => d.id == dId);
      if (!driver) {
        console.error(`❌ Driver not found for ID: ${dId}. Current drivers:`, currentState.drivers.map(d => d.id));
        showToast(`Chauffeur introuvable (ID: ${dId})`, "error");
        return;
      }

      // Force remove hidden class IMMEDIATELY to see if it pops up even if content fails later
      modal.classList.remove('hidden');
      modal.style.display = 'flex'; // Force display flex as fallback
      console.log('   -> Removed hidden class');

      const [year, month] = ym.split('-');
      const monthLabel = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

      const titleEl = document.getElementById('payroll-detail-title');
      const subEl = document.getElementById('payroll-detail-subtitle');
      const bodyEl = document.getElementById('payroll-detail-body');

      if (titleEl) titleEl.textContent = driver ? driver.name : `Chauffeur #${dId}`;
      if (subEl) subEl.textContent = `Détail du mois : ${monthLabel}`;

      const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

      let totals = { present: 0, absent: 0, vacation: 0, sick: 0, bonuses: 0 };
      const rows = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
        const status = currentState.attendance[dStr]?.[dId] || 'unset';
        const dayBonuses = currentState.bonuses[dStr]?.[dId] || [];
        const bonusAmount = dayBonuses.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

        if (status === 'present') totals.present++;
        else if (status === 'absent') totals.absent++;
        else if (status === 'vacation') totals.vacation++;
        else if (status === 'sick') totals.sick++;

        totals.bonuses += bonusAmount;

        const statusLabel = ({
          present: 'Présent',
          absent: 'Absent',
          vacation: 'Congés',
          sick: 'Maladie',
          unset: 'Non pointé'
        })[status] || 'Non pointé';

        rows.push(`
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); font-variant-numeric: tabular-nums;">${day.toString().padStart(2, '0')}/${month}/${year}</td>
          <td style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.08);">${statusLabel}</td>
          <td style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: right;">${bonusAmount ? bonusAmount.toFixed(2) + '€' : '—'}</td>
        </tr>
      `);
      }

      // --- History Logic (Last 6 Months) ---
      let historyHtml = '<div class="history-section" style="margin-bottom: 20px;">';
      historyHtml += '<h4 style="margin: 0 0 10px 0; font-size: 0.9rem; opacity: 0.8;">Historique Récents</h4>';
      historyHtml += '<div style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px;">';

      // Generate last 6 months including current displayed one
      // Base reference is today to avoid showing future months if displayed date is strangely in future
      const today = new Date();

      for (let i = 0; i < 6; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
        const fullLabel = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

        // Highlight if it matches the currently viewed detailed month
        const isActive = (y == year && m == month);
        const bgStyle = isActive ? 'background: rgba(66, 193, 166, 0.2); border-color: var(--primary-color);' : 'background: rgba(255,255,255,0.05);';

        historyHtml += `
            <div class="glass-effect" style="flex: 0 0 auto; padding: 8px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; ${bgStyle}"
                 onclick="${isActive ? '' : `window.app.openPayrollDetailHistory('${dId}', '${y}-${m}')`}">
                
                <span style="font-size: 0.8rem; font-weight: 600; text-transform: capitalize;">${label}</span>
                
                <button class="btn-ghost" 
                        onclick="event.stopPropagation(); window.app.downloadMonthlyReport('${dId}', '${y}', '${m}')" 
                        title="Télécharger ${fullLabel}"
                        style="padding: 4px; border-radius: 50%; background: rgba(255,255,255,0.1);">
                    <i data-lucide="download" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `;
      }
      historyHtml += '</div></div>';

      const summary = `
      ${historyHtml}
      <div class="glass-effect" style="padding: 14px; border-radius: 16px; margin-bottom: 14px; display:flex; flex-wrap:wrap; gap:12px; justify-content: space-between;">
        <div><div style="opacity:.65;font-size:.75rem;">Travail</div><div style="font-weight:800;">${totals.present} j</div></div>
        <div><div style="opacity:.65;font-size:.75rem;">Absence</div><div style="font-weight:800;">${totals.absent} j</div></div>
        <div><div style="opacity:.65;font-size:.75rem;">Congés</div><div style="font-weight:800;">${totals.vacation} j</div></div>
        <div><div style="opacity:.65;font-size:.75rem;">Maladie</div><div style="font-weight:800;">${totals.sick} j</div></div>
        <div><div style="opacity:.65;font-size:.75rem;">Primes</div><div style="font-weight:900; color: var(--primary-color);">${totals.bonuses.toFixed(2)}€</div></div>
      </div>
    `;

      bodyEl.innerHTML = `
      ${summary}
      <div class="glass-effect" style="border-radius: 16px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
          <thead>
            <tr style="background: rgba(255,255,255,0.06);">
              <th style="text-align:left; padding: 10px;">Jour</th>
              <th style="text-align:left; padding: 10px;">Statut</th>
              <th style="text-align:right; padding: 10px;">Primes</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;

      // Move to body to ensure it's not trapped in overflow/stacking context
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
        console.log('   -> Moved modal to document.body');
      }

      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      modal.style.zIndex = '10002'; // Restore normal z-index

      lucide.createIcons();
    } catch (e) {
      console.error("ERREUR CRITIQUE RENDER_PAYROLL:", e);
      showToast(`Erreur d'affichage paie: ${e.message}`, "error");
    }
  },
  openMaintenanceModal: (vehicleId) => {
    currentState.currentMaintVehicle = vehicleId;
    const vehicle = currentState.vehicles.find(v => v.id === vehicleId);
    document.getElementById('maint-modal-title').textContent = `Entretien: ${vehicle.plate}`;
    document.getElementById('m-mileage').value = vehicle.mileage;
    window.app.renderMaintenanceLogs(vehicleId);
    document.getElementById('maintenance-modal').classList.remove('hidden');
  },
  addMaintenanceLog: (vehicleId, logData) => {
    if (!currentState.maintenanceLogs[vehicleId]) currentState.maintenanceLogs[vehicleId] = [];

    const newLog = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      vehicle_id: vehicleId,
      ...logData
    };

    currentState.maintenanceLogs[vehicleId].unshift(newLog); // Newest first

    // Update vehicle mileage
    const vehicle = currentState.vehicles.find(v => v.id === vehicleId);
    if (vehicle && logData.mileage > vehicle.mileage) {
      vehicle.mileage = logData.mileage;
      // Sync vehicle update as well
      syncToSupabase('vehicles', { id: vehicle.id, mileage: vehicle.mileage }, 'UPDATE');
    }

    window.app.renderMaintenanceLogs(vehicleId);
    render(); // Update fleet view mileage

    syncToSupabase('maintenance_logs', newLog, 'INSERT');
  },
  deleteMaintLog: (logId) => {
    const vehicleId = currentState.currentMaintVehicle;
    if (currentState.maintenanceLogs[vehicleId]) {
      currentState.maintenanceLogs[vehicleId] = currentState.maintenanceLogs[vehicleId].filter(l => l.id != logId);
      syncToSupabase('maintenance_logs', { id: logId }, 'DELETE');
    }
    window.app.renderMaintenanceLogs(vehicleId);
  },

  // Helper for Maintenance Logs
  renderMaintenanceLogs: (vehicleId) => {
    const list = document.getElementById('maintenance-history');
    if (!list) return;

    const logs = currentState.maintenanceLogs[vehicleId] || [];
    if (logs.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="font-size: 0.85rem;">Aucun historique.</p>';
      return;
    }

    list.innerHTML = logs.map(log => `
      <div class="glass-effect" style="margin-bottom: 10px; padding: 10px; border-radius: 10px; border-left: 3px solid var(--primary-color);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div style="font-weight: 600; font-size: 0.9rem; text-transform: capitalize;">${log.type}</div>
            <div style="font-size: 0.8rem; opacity: 0.7;">${new Date(log.date).toLocaleDateString('fr-FR')} • ${log.mileage} km</div>
            ${log.notes ? `<div style="font-size: 0.8rem; margin-top: 4px; color: var(--text-secondary);">${log.notes}</div>` : ''}
          </div>
          <button class="btn-ghost" onclick="window.app.deleteMaintLog('${log.id}')" style="color: #ef4444; padding: 4px;">
            <i data-lucide="trash-2" style="width: 16px;"></i>
          </button>
        </div>
      </div>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // Tachograph functions
  openTachoUpload: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ddd,.tgd,.c1b,.v1b';
    input.multiple = true;

    input.onchange = async (e) => {
      const files = Array.from(e.target.files);

      if (files.length === 0) return;

      // Show loading state
      const loadingToast = showToast('Analyse en cours...', 'info');

      try {
        for (const file of files) {
          if (!tachoReader.isValidTachoFile(file)) {
            showToast(`${file.name} n'est pas un fichier tachygraphe valide`, 'warning');
            continue;
          }

          const isCard = tachoReader.detectFileType(file.name) === 'card';
          const result = await tachoReader.parseFile(file, isCard);

          if (result.success) {
            if (!currentState.tachoFiles) currentState.tachoFiles = [];
            currentState.tachoFiles.unshift(result);

            // --- PERSISTENCE LOGIC START ---
            try {
              const { conducteur } = result.analyzed;
              // Try to find driver by card number (exact) or name (fuzzy)
              let driver = null;
              if (conducteur) {
                // 1. Try generic match if we had card_number on drivers, but we don't.
                // 2. Try Name match
                const cleanName = (conducteur.nom || '').toLowerCase();
                const cleanFirst = (conducteur.prenom || '').toLowerCase();
                driver = currentState.drivers.find(d =>
                  (d.name || '').toLowerCase().includes(cleanName)
                );
              }

              // Only save if we found a driver OR if the SQL table allows nulls (which it doesn't yet, so this might fail if no driver found)
              // We construct the object. If driver is null, we might need a dummy ID or the SQL fix. 
              // For now, let's assume we proceed.

              const newTachoRecord = {
                org_id: currentState.currentUserProfile?.org_id,
                driver_id: driver ? driver.id : null, // This will throw DB error if NULL and constraint exists.
                file_name: file.name,
                // file_url: ..., // We skip uploading the binary for now to save bandwidth/complexity unless requested
                processed_data: result.analyzed
              };

              if (newTachoRecord.driver_id) {
                const { data: savedTacho, error: distErr } = await supabase
                  .from('tacho_files')
                  .insert(newTachoRecord)
                  .select()
                  .single();

                if (distErr) {
                  console.error('Failed to save tacho to DB:', distErr);
                  if (distErr.code === '23502') { // Not null violation
                    showToast('Sauvegarde échouée: Chauffeur non reconnu.', 'warning');
                  }
                } else {
                  // Update local ID to match DB
                  result.id = savedTacho.id;
                  showToast(`Sauvegardé pour ${driver.name}`, 'success');
                }
              } else {
                showToast('Fichier analysé (non sauvegardé: chauffeur inconnu)', 'warning');
                console.warn('Tacho persistence skipped: No matching driver found');
              }

            } catch (persistErr) {
              console.error('Tacho persistence error:', persistErr);
            }
            // --- PERSISTENCE LOGIC END ---

            showToast(`${file.name} analysé avec succès`, 'success');
          } else {
            showToast(`Erreur lors de l'analyse de ${file.name}`, 'error');
          }
        }

        render();
      } catch (error) {
        if (loadingToast) (loadingToast.removeToast ? loadingToast.removeToast() : loadingToast.remove());
        console.error('Error uploading tacho files:', error);
        showToast('Erreur lors de l\'importation', 'error');
      }
    };

    input.click();
  },

  viewTachoFile: (index) => {
    const file = currentState.tachoFiles?.[index];
    if (!file) return;

    const analyzed = file.analyzed;
    const formatted = formatTachoDataForDisplay(file);

    // Initialiser les dates de filtre (par défaut tout ou 28 derniers jours)
    let filterStart = "";
    let filterEnd = "";
    let currentTab = 'summary';

    if (analyzed && analyzed.activites.length > 0) {
      filterEnd = analyzed.activites[0].date;
      filterStart = analyzed.activites[Math.min(analyzed.activites.length - 1, 27)].date;
    }

    // Create a modal to display the data
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2000';

    const renderModalContent = () => {
      let contentHtml = '';

      if (formatted.fallback || !analyzed) {
        contentHtml = `
          <div class="alert-item warning" style="margin-bottom: 15px;">
            <div class="alert-icon"><i data-lucide="alert-triangle"></i></div>
            <div class="alert-content">
              <div class="alert-title">Mode dégradé</div>
              <div class="alert-desc">${formatted.message || 'Analyse complète non disponible'}</div>
            </div>
          </div>
          <div class="glass-effect" style="padding: 15px; border-radius: 12px;">
            <h4 style="margin-bottom: 10px;">Données brutes (JSON)</h4>
            <pre style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 0.75rem; max-height: 400px;">${JSON.stringify(file.data, null, 2)}</pre>
          </div>
        `;
      } else {
        const { conducteur } = analyzed;

        // Filtrer les données
        const filteredActivities = analyzed.activites.filter(a => {
          if (filterStart && a.date < filterStart) return false;
          if (filterEnd && a.date > filterEnd) return false;
          return true;
        });

        const filteredInfractions = analyzed.infractions.filter(i => {
          if (filterStart && i.date < filterStart) return false;
          if (filterEnd && i.date > filterEnd) return false;
          return true;
        });

        // Calculer les stats filtrées
        const stats = {
          totalJours: filteredActivities.length,
          totalConduiteMinutes: filteredActivities.reduce((sum, d) => sum + d.totalDriving, 0),
          totalTravailMinutes: filteredActivities.reduce((sum, d) => sum + d.totalWork, 0),
          totalReposMinutes: filteredActivities.reduce((sum, d) => sum + d.totalRest, 0),
          totalAvailableMinutes: filteredActivities.reduce((sum, d) => sum + (d.totalAvailable || 0), 0),
          totalInfractions: filteredInfractions.length
        };

        contentHtml = `
          <div class="tacho-report">
            <!-- En-tête Conducteur -->
            <div class="glass-effect" style="padding: 20px; border-radius: 16px; margin-bottom: 20px; border-left: 4px solid var(--primary-color);">
              <div style="display: flex; align-items: center; gap: 20px;">
                <div class="avatar" style="width: 64px; height: 64px; font-size: 1.5rem;">${(conducteur?.prenom?.[0] || '') + (conducteur?.nom?.[0] || 'U')}</div>
                <div style="flex: 1;">
                  <h2 style="margin: 0; font-size: 1.25rem;">${conducteur?.prenom || ''} ${conducteur?.nom || 'Conducteur Inconnu'}</h2>
                  <p style="margin: 5px 0 0; font-size: 0.9rem; opacity: 0.7;">Carte n° ${conducteur?.numeroCarte || 'N/A'}</p>
                  <div style="display: flex; gap: 15px; margin-top: 10px; font-size: 0.8rem;">
                    <span><i data-lucide="calendar" style="width:12px; height:12px; vertical-align: middle;"></i> Exp: ${conducteur?.dateExpiration || 'N/A'}</span>
                    <span><i data-lucide="map-pin" style="width:12px; height:12px; vertical-align: middle;"></i> Pays: ${conducteur?.paysEmission || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sélecteur de dates -->
            <div class="glass-effect" style="margin-bottom: 20px; padding: 12px; border-radius: 12px; display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="date" id="tacho-filter-start" class="glass-input" value="${filterStart}" style="font-size: 0.8rem; padding: 4px 8px; height: 32px; width: 135px;">
                <span style="opacity: 0.5;">au</span>
                <input type="date" id="tacho-filter-end" class="glass-input" value="${filterEnd}" style="font-size: 0.8rem; padding: 4px 8px; height: 32px; width: 135px;">
              </div>
              <div style="display: flex; gap: 5px;">
                <button class="btn-ghost" data-range="7" style="font-size: 0.7rem; padding: 4px 8px; height: 28px; background: rgba(255,255,255,0.05);">7j</button>
                <button class="btn-ghost" data-range="28" style="font-size: 0.7rem; padding: 4px 8px; height: 28px; background: rgba(255,255,255,0.05);">28j</button>
                <button class="btn-ghost" data-range="all" style="font-size: 0.7rem; padding: 4px 8px; height: 28px; background: rgba(255,255,255,0.05);">Tout</button>
              </div>
            </div>

            <!-- Statistiques Rapides -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px;">
              <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
                <div style="font-size: 0.65rem; opacity: 0.6; margin-bottom: 5px;">Conduite</div>
                <div style="font-size: 1rem; font-weight: 700; color: var(--primary-color);">${Math.floor(stats.totalConduiteMinutes / 60)}h${String(stats.totalConduiteMinutes % 60).padStart(2, '0')}</div>
              </div>
              <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
                <div style="font-size: 0.65rem; opacity: 0.6; margin-bottom: 5px;">Service (Travail)</div>
                <div style="font-size: 1rem; font-weight: 700; color: #f59e0b;">${Math.floor((stats.totalConduiteMinutes + stats.totalTravailMinutes) / 60)}h${String((stats.totalConduiteMinutes + stats.totalTravailMinutes) % 60).padStart(2, '0')}</div>
              </div>
              <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
                <div style="font-size: 0.65rem; opacity: 0.6; margin-bottom: 5px;">Infractions</div>
                <div style="font-size: 1rem; font-weight: 700; color: ${stats.totalInfractions > 0 ? '#ef4444' : '#10b981'};">${stats.totalInfractions}</div>
              </div>
              <div class="stat-mini glass-effect" style="padding: 12px; border-radius: 12px; text-align: center;">
                <div style="font-size: 0.65rem; opacity: 0.6; margin-bottom: 5px;">Repos Total</div>
                <div style="font-size: 1rem; font-weight: 700; color: #10b981;">${Math.floor(stats.totalReposMinutes / 60)}h${String(stats.totalReposMinutes % 60).padStart(2, '0')}</div>
              </div>
            </div>

            <!-- Onglets -->
            <div class="tabs-container glass-effect" style="display: flex; border-radius: 12px; padding: 4px; margin-bottom: 15px;">
              <button class="tab-btn ${currentTab === 'summary' ? 'active' : ''}" data-tab="summary" style="flex:1; border:none; background: ${currentTab === 'summary' ? 'var(--primary-color)' : 'transparent'}; color: white; padding: 8px; border-radius: 8px; cursor: pointer;">Résumé</button>
              <button class="tab-btn ${currentTab === 'activities' ? 'active' : ''}" data-tab="activities" style="flex:1; border:none; background: ${currentTab === 'activities' ? 'var(--primary-color)' : 'transparent'}; color: white; padding: 8px; border-radius: 8px; cursor: pointer;">Activités</button>
              <button class="tab-btn ${currentTab === 'infractions' ? 'active' : ''}" data-tab="infractions" style="flex:1; border:none; background: ${currentTab === 'infractions' ? 'var(--primary-color)' : 'transparent'}; color: white; padding: 8px; border-radius: 8px; cursor: pointer;">Infractions</button>
            </div>

            <div id="tacho-tab-content">
              ${currentTab === 'summary' ? `
                <div class="glass-effect" style="padding: 15px; border-radius: 12px;">
                  <h4 style="margin-top:0; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="bar-chart-3" style="color: var(--primary-color);"></i> Répartition du temps
                  </h4>
                  <div style="display: flex; height: 30px; border-radius: 6px; overflow: hidden; margin-bottom: 15px;">
                    <div style="width: ${(stats.totalConduiteMinutes / (stats.totalConduiteMinutes + stats.totalTravailMinutes + stats.totalReposMinutes + stats.totalAvailableMinutes || 1) * 100)}%; background: var(--primary-color);" title="Conduite"></div>
                    <div style="width: ${(stats.totalTravailMinutes / (stats.totalConduiteMinutes + stats.totalTravailMinutes + stats.totalReposMinutes + stats.totalAvailableMinutes || 1) * 100)}%; background: #f59e0b;" title="Travail"></div>
                    <div style="width: ${(stats.totalAvailableMinutes / (stats.totalConduiteMinutes + stats.totalTravailMinutes + stats.totalReposMinutes + stats.totalAvailableMinutes || 1) * 100)}%; background: #3b82f6;" title="Dispo"></div>
                    <div style="width: ${(stats.totalReposMinutes / (stats.totalConduiteMinutes + stats.totalTravailMinutes + stats.totalReposMinutes + stats.totalAvailableMinutes || 1) * 100)}%; background: #10b981;" title="Repos"></div>
                  </div>
                  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.8rem;">
                    <div style="display: flex; align-items: center; gap: 5px;"><span style="width:10px; height:10px; background: var(--primary-color); border-radius:2px;"></span> Conduite: ${Math.floor(stats.totalConduiteMinutes / 60)}h${String(stats.totalConduiteMinutes % 60).padStart(2, '0')}</div>
                    <div style="display: flex; align-items: center; gap: 5px;"><span style="width:10px; height:10px; background: #f59e0b; border-radius:2px;"></span> Travail: ${Math.floor(stats.totalTravailMinutes / 60)}h${String(stats.totalTravailMinutes % 60).padStart(2, '0')}</div>
                    <div style="display: flex; align-items: center; gap: 5px;"><span style="width:10px; height:10px; background: #3b82f6; border-radius:2px;"></span> Dispo: ${Math.floor((stats.totalAvailableMinutes || 0) / 60)}h${String((stats.totalAvailableMinutes || 0) % 60).padStart(2, '0')}</div>
                    <div style="display: flex; align-items: center; gap: 5px;"><span style="width:10px; height:10px; background: #10b981; border-radius:2px;"></span> Repos: ${Math.floor(stats.totalReposMinutes / 60)}h${String(stats.totalReposMinutes % 60).padStart(2, '0')}</div>
                  </div>
                </div>
              ` : currentTab === 'activities' ? `
                <div style="display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto;">
                  ${filteredActivities.map(day => `
                    <div class="glass-effect" style="padding: 12px; border-radius: 12px;">
                      <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.85rem;">
                        <span style="font-weight: 600;">${new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                        <span style="color: var(--primary-color); font-weight: 700;">${Math.floor(day.totalDriving / 60)}h${String(day.totalDriving % 60).padStart(2, '0')} cond.</span>
                      </div>
                      <div style="display: flex; height: 12px; border-radius: 4px; overflow: hidden; background: rgba(255,255,255,0.05);">
                        ${day.activities.map(act => `
                          <div style="width: ${(act.duree / 1440 * 100)}%; background: ${act.type === 'CONDUITE' ? 'var(--primary-color)' :
            act.type === 'TRAVAIL' ? '#f59e0b' :
              act.type === 'DISPONIBILITE' ? '#3b82f6' : '#10b981'
          };" title="${act.type}: ${act.duree}min"></div>
                        `).join('')}
                      </div>
                    </div>
                  `).join('')}
                  ${filteredActivities.length === 0 ? '<p style="text-align:center; opacity: 0.5; padding: 20px;">Aucune activité sur cette période</p>' : ''}
                </div>
              ` : `
                <div style="max-height: 400px; overflow-y: auto;">
                  ${filteredInfractions.length > 0 ? filteredInfractions.map(inf => {
            const isLabor = inf.type.includes('AMPLITUDE') || inf.type.includes('TRAVAIL') || inf.type.includes('SERVICE');
            const alertClass = inf.gravite === 'CRITIQUE' ? 'critical' : (inf.gravite === 'INFO' ? 'info' : 'warning');
            return `
                    <div class="alert-item ${alertClass}" style="margin-bottom: 10px;">
                      <div class="alert-icon"><i data-lucide="${inf.gravite === 'CRITIQUE' ? 'octagon-alert' : (inf.gravite === 'INFO' ? 'info' : 'triangle-alert')}"></i></div>
                      <div class="alert-content">
                        <div class="alert-title" style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="display: flex; align-items: center; gap: 6px;">
                            ${inf.type.replace(/_/g, ' ')}
                            <span style="font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); text-transform: uppercase;">
                              ${isLabor ? 'Code du Travail' : 'RSE'}
                            </span>
                          </span>
                          <span style="font-size: 0.7rem; opacity: 0.7;">${new Date(inf.date).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <div class="alert-desc">${inf.description}</div>
                      </div>
                    </div>
                  `}).join('') : `
                    <div style="text-align: center; padding: 40px; opacity: 0.5;">
                      <i data-lucide="check-circle-2" style="width: 48px; height: 48px; margin-bottom: 10px; color: var(--success-color);"></i>
                      <p>Aucune infraction sur cette période</p>
                    </div>
                  `}
                </div>
              `}
            </div>
          </div>
        `;
      }

      modal.innerHTML = `
        <div class="modal-content glass-effect" style="max-width: 700px; max-height: 95vh; overflow-y: auto; padding: 25px;">
          <div class="modal-header" style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="background: var(--primary-color); padding: 8px; border-radius: 10px;">
                <i data-lucide="file-text" style="color: white; width: 20px; height: 20px;"></i>
              </div>
              <h3>Analyse Tachygraphe</h3>
            </div>
            <button class="btn-ghost" onclick="this.closest('.modal-overlay').remove()">
              <i data-lucide="x"></i>
            </button>
          </div>
          
          <div id="tacho-modal-body">
            ${contentHtml}
          </div>
          
          <div style="margin-top: 25px; display: flex; gap: 12px; border-top: 1px solid var(--glass-border); padding-top: 20px; flex-wrap: wrap;">
            <button class="btn-ghost" onclick="window.app.deleteTachoFile(${index}); this.closest('.modal-overlay').remove();" style="color: #ef4444;">
              <i data-lucide="trash-2"></i> Supprimer
            </button>
            <button class="btn-primary" id="btn-archive-tacho" style="background: var(--primary-color); color: white;">
              <i data-lucide="archive"></i> Archiver
            </button>
            <button class="btn-primary" onclick="window.app.exportTachoPDF(${index}, '${filterStart}', '${filterEnd}')" style="background: #e11d48; color: white;">
              <i data-lucide="file-pie-chart"></i> PDF
            </button>
          </div>
        </div>
      `;

      // Ré-attacher les événements
      setTimeout(() => {
        const startInput = modal.querySelector('#tacho-filter-start');
        const endInput = modal.querySelector('#tacho-filter-end');
        if (startInput) startInput.onchange = (e) => { filterStart = e.target.value; renderModalContent(); };
        if (endInput) endInput.onchange = (e) => { filterEnd = e.target.value; renderModalContent(); };

        modal.querySelectorAll('.tab-btn').forEach(btn => {
          btn.onclick = () => { currentTab = btn.dataset.tab; renderModalContent(); };
        });

        modal.querySelectorAll('[data-range]').forEach(btn => {
          btn.onclick = () => {
            const range = btn.dataset.range;
            if (analyzed.activites.length > 0) {
              filterEnd = analyzed.activites[0].date;
              if (range === 'all') {
                filterStart = analyzed.activites[analyzed.activites.length - 1].date;
              } else {
                const days = parseInt(range);
                filterStart = analyzed.activites[Math.min(analyzed.activites.length - 1, days - 1)].date;
              }
              renderModalContent();
            }
          };
        });

        modal.querySelector('#btn-archive-tacho').onclick = () => {
          window.app.archiveTachoPDFToDriver(index, filterStart, filterEnd);
        };

        lucide.createIcons();
      }, 0);
    };

    renderModalContent();
    document.body.appendChild(modal);
    setTimeout(() => {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }, 10);
  },

  deleteTachoFile: async (index) => {
    const file = currentState.tachoFiles[index];
    if (await showConfirm('Êtes-vous sûr de vouloir supprimer ce fichier ?')) {

      // Persist deletion to Supabase
      if (file && file.id && !String(file.id).startsWith('temp-')) {
        try {
          const { error } = await supabase
            .from('tacho_files')
            .delete()
            .eq('id', file.id);

          if (error) {
            console.error('Supabase delete error:', error);
            showToast('Erreur lors de la suppression en base de données', 'error');
            return;
          }
        } catch (e) {
          console.error('Delete exception:', e);
          showToast('Erreur technique lors de la suppression', 'error');
          return;
        }
      }

      currentState.tachoFiles.splice(index, 1);
      // Remove from 'driver' documents if linked

      render();
      showToast('Fichier supprimé', 'success');
    }
  },

  exportTachoData: (index) => {
    const file = currentState.tachoFiles?.[index];
    if (!file) return;

    const dataStr = JSON.stringify(file.data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${file.fileName.replace(/\.[^/.]+$/, '')}_parsed.json`;
    link.click();

    URL.revokeObjectURL(url);
    showToast('Export réussi', 'success');
  },

  // Helper interne pour générer l'objet jsPDF du rapport
  _generateTachoReportPDF: (file, filterStart = "", filterEnd = "") => {
    const { conducteur, activites, infractions } = file.analyzed;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const filteredActivities = activites.filter(a => {
      if (filterStart && a.date < filterStart) return false;
      if (filterEnd && a.date > filterEnd) return false;
      return true;
    });

    const filteredInfractions = infractions.filter(i => {
      if (filterStart && i.date < filterStart) return false;
      if (filterEnd && i.date > filterEnd) return false;
      return true;
    });

    const stats = {
      totalConduite: filteredActivities.reduce((sum, d) => sum + d.totalDriving, 0),
      totalTravail: filteredActivities.reduce((sum, d) => sum + d.totalWork, 0),
      totalRepos: filteredActivities.reduce((sum, d) => sum + d.totalRest, 0),
      totalInfractions: filteredInfractions.length
    };

    // Style Header
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('4ESSIEUX - Rapport Tachygraphe', 15, 25);
    doc.setFontSize(10);
    doc.text(`Généré le: ${new Date().toLocaleString('fr-FR')}`, 15, 33);

    // Infos Conducteur
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.text('INFORMATIONS CONDUCTEUR', 15, 55);
    doc.setFontSize(10);
    doc.text(`Nom: ${conducteur.nom || 'N/A'}`, 15, 65);
    doc.text(`Prénom: ${conducteur.prenom || 'N/A'}`, 15, 70);
    doc.text(`N° Carte: ${conducteur.numeroCarte || 'N/A'}`, 15, 75);
    doc.text(`Période: ${filterStart || 'Début'} au ${filterEnd || 'Fin'}`, 15, 80);

    // Résumé Stats
    doc.autoTable({
      startY: 90,
      head: [['Statistiques', 'Valeur']],
      body: [
        ['Total Conduite', `${Math.floor(stats.totalConduite / 60)}h${String(stats.totalConduite % 60).padStart(2, '0')}`],
        ['Total Travail', `${Math.floor(stats.totalTravail / 60)}h${String(stats.totalTravail % 60).padStart(2, '0')}`],
        ['Temps de Service (Total)', `${Math.floor((stats.totalConduite + stats.totalTravail) / 60)}h${String((stats.totalConduite + stats.totalTravail) % 60).padStart(2, '0')}`],
        ['Total Repos', `${Math.floor(stats.totalRepos / 60)}h${String(stats.totalRepos % 60).padStart(2, '0')}`],
        ['Nombre d\'infractions', stats.totalInfractions.toString()]
      ],
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] }
    });

    if (filteredInfractions.length > 0) {
      doc.setFontSize(14);
      doc.text('INFRACTIONS DÉTECTÉES', 15, doc.lastAutoTable.finalY + 15);
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Date', 'Type', 'Source', 'Description']],
        body: filteredInfractions.map(inf => [
          new Date(inf.date).toLocaleDateString('fr-FR'),
          inf.type.replace(/_/g, ' '),
          inf.type.includes('AMPLITUDE') || inf.type.includes('TRAVAIL') || inf.type.includes('SERVICE') ? 'Code du Travail' : 'RSE',
          inf.description
        ]),
        headStyles: { fillColor: [239, 68, 68] }
      });
    }

    doc.addPage();
    doc.setFontSize(14);
    doc.text('DÉTAIL DES ACTIVITÉS JOURNALIÈRES', 15, 20);
    const fmt = (min) => {
      if (isNaN(min) || min === null) return '0h00';
      return `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
    };

    doc.autoTable({
      startY: 25,
      head: [['Date', 'Conduite', 'Travail', 'Service', 'Repos']],
      body: filteredActivities.map(day => [
        new Date(day.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
        fmt(day.totalDriving),
        fmt(day.totalWork),
        fmt(day.totalDriving + day.totalWork),
        fmt(day.totalRest)
      ]),
      headStyles: { fillColor: [59, 130, 246] }
    });

    return doc;
  },

  exportTachoPDF: (index, filterStart = "", filterEnd = "") => {
    const file = currentState.tachoFiles?.[index];
    if (!file || !file.analyzed) return;
    const doc = app._generateTachoReportPDF(file, filterStart, filterEnd);
    const fileName = `Rapport_Tacho_${file.analyzed.conducteur.nom || 'Conducteur'}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    showToast('PDF généré avec succès', 'success');
  },

  archiveTachoPDFToDriver: (index, filterStart = "", filterEnd = "") => {
    const file = currentState.tachoFiles?.[index];
    if (!file || !file.analyzed) return;

    const { conducteur } = file.analyzed;

    // Réutilisation de la modale de sélection de chauffeur
    const modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-content glass-effect" style="max-width: 450px;">
        <div class="modal-header">
          <h3>Archiver Rapport PDF</h3>
          <button class="btn-ghost" onclick="this.closest('.modal-overlay').remove()"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <p style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 15px;">
            Choisissez le chauffeur dans le dossier duquel vous souhaitez enregistrer ce rapport PDF.
          </p>
          <div class="form-group">
            <label>Dossier cible :</label>
            <select id="tacho-archive-driver" class="glass-input">
              <optgroup label="Suggéré">
                <option value="auto">Détection auto (${conducteur.prenom || ''} ${conducteur.nom || 'Inconnu'})</option>
              </optgroup>
              <optgroup label="Tous les chauffeurs">
                ${currentState.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
              </optgroup>
            </select>
          </div>
          <div style="margin-top: 20px; display: flex; gap: 10px;">
            <button class="btn-primary" id="confirm-archive" style="flex: 1;">Enregistrer le rapport</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }, 10);

    modal.querySelector('#confirm-archive').onclick = async () => {
      const selectedId = modal.querySelector('#tacho-archive-driver').value;
      let driver;

      if (selectedId === 'auto') {
        driver = currentState.drivers.find(d =>
          (conducteur.nom && d.name.toLowerCase().includes(conducteur.nom.toLowerCase()))
        );
      } else {
        driver = currentState.drivers.find(d => d.id == selectedId);
      }

      if (!driver) {
        showToast('Veuillez sélectionner un chauffeur valide', 'error');
        return;
      }

      const doc = app._generateTachoReportPDF(file, filterStart, filterEnd);
      const pdfBlob = doc.output('blob');

      // 1. Sauvegarder dans tacho_files (Persistence)
      try {
        // Check if already persisted
        if (!file.id || String(file.id).startsWith('temp-')) {
          const newTachoRecord = {
            org_id: currentState.currentUserProfile?.org_id,
            driver_id: driver.id,
            file_name: file.fileName,
            processed_data: file.analyzed
          };

          const { data: savedTacho, error: distErr } = await supabase
            .from('tacho_files')
            .insert(newTachoRecord)
            .select()
            .single();

          if (!distErr && savedTacho) {
            file.id = savedTacho.id; // Update local ID
            console.log('Tacho data persisted during archive for:', driver.name);
          } else {
            console.error('Failed to persist tacho data during archive:', distErr);
          }
        }
      } catch (err) {
        console.warn('Persistence logic error:', err);
      }

      // 2. Upload to Supabase Storage for persistence
      let publicUrl = null;
      try {
        const timestamp = Date.now();
        const safeName = `Rapport_Tacho_${timestamp}.pdf`;
        const path = `${currentState.currentUserProfile.org_id}/drivers/${driver.id}/${timestamp}_${safeName}`;

        publicUrl = await uploadToDocumentsBucket(pdfBlob, path);
      } catch (uploadErr) {
        console.error('Failed to upload PDF report:', uploadErr);
        showToast('Erreur lors de la sauvegarde du fichier PDF', 'error');
        // Fallback to blob URL if upload fails (will be lost on reload)
        publicUrl = URL.createObjectURL(pdfBlob);
      }

      // 3. Création du document PDF dans le profil chauffeur
      if (!driver.documents) driver.documents = [];

      const newDoc = {
        id: Date.now(),
        name: `Rapport_Tacho_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.pdf`,
        expiry: null,
        date: new Date().toISOString(),
        url: publicUrl, // Persistent URL from storage
        type: 'application/pdf',
        folder: 'RAPPORT CHRONOTACHYGRAPHE'
      };

      driver.documents.unshift(newDoc);

      // Sync driver doc to supabase
      window.app.syncToSupabase('drivers', { id: driver.id, documents: driver.documents }, 'UPDATE');

      modal.remove();
      showToast(`Rapport archivé dans le dossier de ${driver.name}`, 'success');

      // Si on est sur la vue flotte, on rafraîchit pour voir le badge mis à jour si nécessaire
      if (currentState.currentView === 'fleet') render();
    };
  },

  transcribeTachoToPayroll: (index) => {
    const file = currentState.tachoFiles?.[index];
    if (!file || !file.analyzed) return;

    const { conducteur, activites } = file.analyzed;

    // Créer une modale de sélection de chauffeur
    const modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-content glass-effect" style="max-width: 450px;">
        <div class="modal-header">
          <h3>Retranscription vers Présences</h3>
          <button class="btn-ghost" onclick="this.closest('.modal-overlay').remove()"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body" style="padding: 20px;">
          <p style="font-size: 0.85rem; opacity: 0.7; margin-bottom: 15px;">
            Sélectionnez le chauffeur à qui affecter les activités détectées pour le fichier <b>${file.fileName}</b>.
          </p>
          <div class="form-group">
            <label>Choisir un chauffeur :</label>
            <select id="tacho-reassign-driver" class="glass-input">
              <optgroup label="Suggéré (Carte Tacho)">
                <option value="auto">Détection auto (${conducteur.prenom || ''} ${conducteur.nom || 'Inconnu'})</option>
              </optgroup>
              <optgroup label="Tous les chauffeurs">
                ${currentState.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
              </optgroup>
            </select>
          </div>
          <div style="margin-top: 20px; display: flex; gap: 10px;">
            <button class="btn-primary" id="confirm-reassign" style="flex: 1;">Valider la retranscription</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }, 10);

    modal.querySelector('#confirm-reassign').onclick = () => {
      const selectedId = modal.querySelector('#tacho-reassign-driver').value;
      let driver;

      if (selectedId === 'auto') {
        driver = currentState.drivers.find(d =>
          (conducteur.nom && d.name.toLowerCase().includes(conducteur.nom.toLowerCase())) ||
          (conducteur.numeroPermis && d.license?.includes(conducteur.numeroPermis))
        );
      } else {
        driver = currentState.drivers.find(d => d.id === selectedId);
      }

      if (!driver) {
        showToast('Chauffeur introuvable dans la base de données', 'error');
        return;
      }

      modal.remove();
      this.app.executeTranscription(driver, activites);
    };
  },

  executeTranscription: (driver, activites) => {
    let updatedCount = 0;
    activites.forEach(day => {
      // Un jour est considéré comme travaillé s'il y a de la conduite ou du travail > 0
      if (day.totalDriving > 0 || day.totalWork > 0) {
        if (!currentState.attendance[day.date]) currentState.attendance[day.date] = {};

        // On ne remplace que si c'est vide ou 'unset'
        if (!currentState.attendance[day.date][driver.id] || currentState.attendance[day.date][driver.id] === 'unset') {
          currentState.attendance[day.date][driver.id] = 'present';
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      showToast(`${updatedCount} jours retranscrits pour ${driver.name}`, 'success');
      if (currentSection === 'attendance') render();
    } else {
      showToast('Aucune nouvelle donnée à retranscrire', 'info');
    }
  },
  loadTeamData: async () => {
    if (!supabase) return;

    // Load Unused Invitations
    const { data: invs } = await supabase
      .from('invitations')
      .select('*')
      .eq('is_used', false);

    // Load Members (From users table or by querying auth)
    // Note: In a real app we'd have a public 'profiles' table linked to auth
    const { data: members } = await supabase
      .from('drivers') // We use the drivers table as our base for now
      .select('*');

    // Also try to get from invitations where is_used is true to get other roles
    const { data: others } = await supabase
      .from('invitations')
      .select('target_name, role, used_by_auth_id')
      .eq('is_used', true);

    const processedMembers = [
      ...members.map(m => ({ full_name: m.name, email: m.email, role: 'driver' })),
      ...(others || []).map(o => ({ full_name: o.target_name, email: 'Compte lié', role: o.role }))
    ];

    currentState.teamInvitations = invs || [];
    currentState.teamMembers = processedMembers;
    currentState.teamTab = currentState.teamTab || 'invites';
    render();
  },

  showInviteForm: (show = true) => {
    const form = document.getElementById('invite-form-container');
    if (form) {
      if (show) form.classList.remove('hidden');
      else form.classList.add('hidden');
    }
  },

  setTeamTab: (tab) => {
    currentState.teamTab = tab;
    render();
  },

  generateNewInvitation: async () => {
    const name = document.getElementById('inv-name').value;
    const role = document.getElementById('inv-role').value;
    if (!name) return showToast('Nom requis', 'error');

    // Generate random code 4X-XXXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '4X-';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
      const orgId = currentState.currentUserProfile?.org_id;
      if (!orgId) throw new Error("Impossible de récupérer l'ID de votre entreprise.");

      const { error } = await supabase
        .from('invitations')
        .insert({ code, role, target_name: name, org_id: orgId });

      if (error) throw error;

      showToast(`Code ${code} généré pour ${name}`, 'success');
      app.showInviteForm(false);
      app.loadTeamData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  copyInviteCode: (code) => {
    navigator.clipboard.writeText(code);
    showToast('Code copié dans le presse-papier', 'success');
  },

  setDocContext: (type, id) => {
    currentState.currentDocEntity = { type, id };
  },


  refreshAlerts: () => {
    // 1. Clear existing generated alerts (keep any that might be manual if we had that concept, but for now full rebuild)
    currentState.alerts = [];

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    const checkDoc = (doc, ownerName, type) => {
      if (!doc.expiry) return;
      const expiry = new Date(doc.expiry);
      if (isNaN(expiry.getTime())) return;

      const isExpired = expiry < now;
      const isExpiringSoon = expiry < thirtyDaysFromNow;

      if (isExpired) {

        currentState.alerts.push({
          id: `${type === 'folder' ? 'c' : type.charAt(0)}-doc-${doc.id}`,
          type: 'critical',
          title: 'Document Expiré',
          subject: `${ownerName} • ${doc.name}`,
          date: new Date().toISOString()
        });
      } else if (isExpiringSoon) {
        currentState.alerts.push({
          id: `${type === 'folder' ? 'c' : type.charAt(0)}-doc-${doc.id}`,
          type: 'warning',
          title: 'Expiration Proche',
          subject: `${ownerName} • ${doc.name}`,
          date: new Date().toISOString()
        });
      }
    };

    // 2. Scan Drivers
    currentState.drivers.forEach(d => {
      if (d.documents) d.documents.forEach(doc => checkDoc(doc, d.name, 'driver'));
      // Check License
      if (d.licenseexpiry) { // Note: field might be license_expiry or we check text, but standard docs are in d.documents
        // If license expiry is a separate field on driver object, check it here if needed.
        // Current model puts everything in documents array usually.
      }
    });

    // 3. Scan Vehicles
    currentState.vehicles.forEach(v => {
      if (v.documents) v.documents.forEach(doc => checkDoc(doc, v.plate, 'vehicle'));
    });

    // 4. Scan Custom Folders
    currentState.customFolders.forEach(f => {
      if (f.documents) f.documents.forEach(doc => checkDoc(doc, f.name, 'folder'));
    });

    // 5. Scan Maintenance (example: if we had next maintenance date)
    // ...

    // Sort alerts by urgency (critical first)
    currentState.alerts.sort((a, b) => {
      if (a.type === b.type) return 0;
      if (a.type === 'critical') return -1;
      return 1;
    });
  },

  viewDoc: (docId) => {
    // 1. Find the document context
    let doc, entity;

    // Check drivers
    if (!doc) {
      const dOwner = currentState.drivers.find(d => d.documents?.some(d => d.id == docId));
      if (dOwner) { entity = dOwner; doc = dOwner.documents.find(d => d.id == docId); currentState.currentDocEntity = { type: 'driver', id: dOwner.id }; }
    }
    // Check vehicles
    if (!doc) {
      const vOwner = currentState.vehicles.find(v => v.documents?.some(d => d.id == docId));
      if (vOwner) { entity = vOwner; doc = vOwner.documents.find(d => d.id == docId); currentState.currentDocEntity = { type: 'vehicle', id: vOwner.id }; }
    }
    // Check custom folders
    if (!doc) {
      const fOwner = currentState.customFolders.find(f => f.documents?.some(d => d.id == docId));
      if (fOwner) { entity = fOwner; doc = fOwner.documents.find(d => d.id == docId); currentState.currentDocEntity = { type: 'folder', id: fOwner.id }; }
    }

    if (!doc) {
      showToast('Document introuvable', 'error');
      return;
    }

    // 2. Populate the Modal
    const modal = document.getElementById('edit-doc-modal');
    if (!modal) {
      console.error("Edit modal not found");
      return;
    }

    // Fill fields
    const nameInput = document.getElementById('edit-doc-name');
    if (nameInput) nameInput.value = doc.name || '';

    const expiryInput = document.getElementById('edit-doc-expiry');
    const expiryToggle = document.getElementById('edit-doc-expiry-toggle');
    const expiryContainer = document.getElementById('edit-doc-expiry-container');

    if (doc.expiry) {
      if (expiryToggle) expiryToggle.checked = true;
      if (expiryContainer) expiryContainer.classList.remove('hidden');
      try {
        if (expiryInput) expiryInput.value = new Date(doc.expiry).toISOString().split('T')[0];
      } catch (e) { if (expiryInput) expiryInput.value = ''; }
    } else {
      if (expiryToggle) expiryToggle.checked = false;
      if (expiryContainer) expiryContainer.classList.add('hidden');
      if (expiryInput) expiryInput.value = '';
    }

    // Store ID for save
    modal.dataset.docId = doc.id;
    if (entity) modal.dataset.entityId = entity.id;

    // Populate Folders
    let folders = [];
    let currentType = entity ? (entity.plate ? 'vehicle' : (entity.license ? 'driver' : 'folder')) : 'driver';
    // Better check based on currentState.currentDocEntity or the search result
    if (currentState.currentDocEntity) currentType = currentState.currentDocEntity.type;

    if (currentType === 'driver') folders = ['DOCUMENTS CHAUFFEUR', 'ADMINISTRATIF'];
    else if (currentType === 'vehicle') folders = ['DOCUMENTS VÉHICULE', 'ADMINISTRATIF'];
    else folders = ['DIVERS'];

    // Add current folder custom definition if needed? No, standardizing.

    const folderSelect = document.getElementById('edit-doc-folder');
    if (folderSelect) {
      folderSelect.innerHTML = folders.map(f => `<option value="${f}">${f}</option>`).join('');
      // Set current selection
      if (doc.folder) folderSelect.value = doc.folder.toUpperCase();
      // Fallback for old docs?
      if (!folderSelect.value && doc.folder) {
        // If current folder is not in default list, add it?
        const opt = document.createElement('option');
        opt.value = doc.folder;
        opt.textContent = doc.folder;
        opt.selected = true;
        folderSelect.appendChild(opt);
      }
    }

    // Show Filename if exists
    const fileLabel = document.getElementById('edit-doc-current-file');
    if (fileLabel) fileLabel.textContent = doc.name;

    // 3. Show Modal
    modal.classList.remove('hidden');

    // 4. Setup Toggle Listener (redundant but ensures it works)
    if (expiryToggle && expiryContainer) {
      expiryToggle.onchange = (e) => {
        if (e.target.checked) expiryContainer.classList.remove('hidden');
        else expiryContainer.classList.add('hidden');
      };
    }
  },

  saveEditDoc: async (e) => {
    e.preventDefault();
    const modal = document.getElementById('edit-doc-modal');
    const mode = modal.dataset.mode || 'edit';
    const name = document.getElementById('edit-doc-name').value;
    const folder = document.getElementById('edit-doc-folder').value;
    const hasExpiry = document.getElementById('edit-doc-has-expiry')?.checked;
    const expiry = hasExpiry ? document.getElementById('edit-doc-expiry').value : null;

    if (!name) { showToast('Nom requis', 'error'); return; }
    if (hasExpiry && !expiry) { showToast('Date requise', 'error'); return; }

    const entityType = modal.dataset.entityType || currentState.currentDocEntity?.type;
    const entityId = parseInt(modal.dataset.entityId || currentState.currentDocEntity?.id);
    let entity;

    // Resolve Entity
    if (entityType === 'driver') entity = currentState.drivers.find(d => d.id === entityId);
    else if (entityType === 'vehicle') entity = currentState.vehicles.find(v => v.id === entityId);
    else if (entityType === 'folder') entity = currentState.customFolders.find(f => f.id === entityId); // ID string?

    if (!entity) { showToast('Entité introuvable', 'error'); return; }
    if (!entity.documents) entity.documents = [];

    if (mode === 'new') {
      const file = window.pendingUploadFile;
      if (!file) { showToast('Aucun fichier', 'error'); return; }

      const upToast = showToast('Upload en cours...', 'info', { persistent: true });
      let publicUrl = null;
      try {
        // Upload to Supabase
        publicUrl = await uploadDocumentForEntity(file, entityType || 'docs', entityId || 'unknown');
      } catch (err) {
        console.error('Upload Error (New Doc):', err);
        showToast('Erreur upload fichier', 'error');
        try { upToast.removeToast && upToast.removeToast(); } catch (e) { }
        return;
      } finally {
        try { upToast.removeToast && upToast.removeToast(); } catch (e) { }
      }

      const newDoc = {
        id: Date.now(),
        name: name,
        folder: folder,
        expiry: expiry,
        date: new Date().toISOString(),
        type: file.type || 'application/pdf',
        url: publicUrl, // Persistent URL
        fileName: file.name
      };

      entity.documents.unshift(newDoc);
      window.pendingUploadFile = null;
      // Wait for sync to confirm success
      // showToast('Document ajouté et sauvegardé', 'success');

    } else {
      // EDIT MODE
      const docId = parseInt(modal.dataset.docId);
      const docIndex = entity.documents.findIndex(d => d.id === docId);
      if (docIndex === -1) return;

      const doc = entity.documents[docIndex];
      doc.name = name;
      if (folder) doc.folder = folder;
      doc.expiry = expiry;

      // Handle file replacement
      const replacementInput = document.getElementById('edit-doc-file');
      const replacementFile = replacementInput?.files[0];

      if (replacementFile) {
        const upToast = showToast('Remplacement du fichier...', 'info', { persistent: true });
        try {
          const newUrl = await uploadDocumentForEntity(replacementFile, entityType || 'docs', entityId || 'unknown');
          doc.url = newUrl; // Persistent URL
          doc.fileName = replacementFile.name;
          doc.date = new Date().toISOString();
        } catch (err) {
          console.error('Upload Error (Edit Doc):', err);
          showToast('Erreur upload nouveau fichier', 'error');
        } finally {
          try { upToast.removeToast && upToast.removeToast(); } catch (e) { }
        }
      }

      showToast('Document modifié', 'success');
    }

    modal.classList.add('hidden');
    render();

    // Sync
    const table = entityType === 'driver' ? 'drivers' : (entityType === 'vehicle' ? 'vehicles' : 'custom_folders');

    // Fix: Await sync and handle errors
    try {
      // Guard against Blob URLs
      const docsToCheck = entity.documents || [];
      const badDoc = docsToCheck.find(d => d.url && String(d.url).startsWith('blob:'));
      if (badDoc) {
        throw new Error(`CRITICAL: Blob URL detected in ${badDoc.name}. Save aborted to prevent data loss.`);
      }

      // Intentional console log
      console.log(`💾 [saveEditDoc] Syncing ${table} ID:${entity.id}`);
      await window.app.syncToSupabase(table, { id: entity.id, documents: entity.documents }, 'UPDATE');

      showToast('Document enregistré et sécurisé', 'success');
    } catch (err) {
      console.error('❌ [saveEditDoc] Sync Failed:', err);
      showToast('Erreur sauvegarde (Sync)', 'error');
    }
  },

  toggleDocFolderInput: (val) => {
    const input = document.getElementById('doc-new-folder');
    if (input) {
      if (val === 'Autre') input.classList.remove('hidden');
      else input.classList.add('hidden');
    }
  },

  toggleDocCustomInput: (val) => {
    const input = document.getElementById('doc-custom-name');
    if (input) {
      if (val === 'Autre') input.classList.remove('hidden');
      else input.classList.add('hidden');
    }
  },

  openDocs: (type, id, folder) => {
    // 1. Set Context
    currentState.currentDocEntity = { type, id };
    const entity = type === 'vehicle' ? currentState.vehicles.find(v => v.id == id)
      : (type === 'driver' ? currentState.drivers.find(d => d.id == id)
        : (type === 'custom' ? currentState.customFolders.find(f => f.id == id) : null));

    if (!entity) return;

    // 2. Populate Folders
    let folders = [];
    if (type === 'driver') folders = ['DOCUMENTS CHAUFFEUR', 'ADMINISTRATIF'];
    else if (type === 'vehicle') folders = ['DOCUMENTS VÉHICULE', 'ADMINISTRATIF', 'MAINTENANCE MÉCANIQUE'];
    else folders = ['DIVERS'];

    const folderSelect = document.getElementById('doc-folder-select');
    if (folderSelect) {
      folderSelect.innerHTML = folders.map(f => `<option value="${f}">${f}</option>`).join('');
      folderSelect.innerHTML += `<option value="Autre">Nouveau dossier...</option>`;
    }

    // Select the current folder if passed
    if (folder && folderSelect) {
      folderSelect.value = folder;
      // If passed folder is valid but not in list (e.g. old custom folder), add it
      if (folderSelect.value !== folder) {
        const opt = document.createElement('option');
        opt.value = folder;
        opt.textContent = folder;
        opt.selected = true;
        folderSelect.insertBefore(opt, folderSelect.lastElementChild);
      }
    }

    // 3. Update Title
    const title = document.getElementById('doc-modal-title');
    if (title) title.textContent = `Documents: ${entity.plate || entity.name}`;

    // 4. Reset other fields
    if (document.getElementById('doc-type-select')) document.getElementById('doc-type-select').value = "";
    if (document.getElementById('doc-expiry-input')) document.getElementById('doc-expiry-input').value = "";
    // Reset file input
    const fileInput = document.getElementById('doc-upload-input');
    if (fileInput) fileInput.value = "";

    // 5. Open Modal
    const modal = document.getElementById('document-modal');
    if (modal) modal.classList.remove('hidden');
  },



  handleLogout: async () => {
    if (await showConfirm('Voulez-vous vous déconnecter ?')) {
      // Close modal if open
      const modal = document.getElementById('role-modal');
      if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }

      try {
        console.log('🚪 Logging out...');
        await signOut();
        showToast('Déconnexion réussie', 'success');
        // The auth state listener will handle the view change
      } catch (err) {
        console.error('❌ Logout error:', err);
        showToast('Erreur lors de la déconnexion', 'error');
      }
    }
  },

  openContactModal: (driverId) => {
    const driver = currentState.drivers.find(d => d.id == driverId);
    if (!driver) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
      <div class="modal-content glass-effect animate-scale-in" style="width: 90%; max-width: 380px; text-align: center; border-radius: 24px; padding: 30px; position: relative;">
        <button class="btn-ghost" onclick="this.closest('.modal-overlay').remove()" style="position: absolute; top: 15px; right: 15px; border-radius: 50%; padding: 8px;">
          <i data-lucide="x" style="width: 20px; height: 20px;"></i>
        </button>
        
        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05)); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; border: 1px solid var(--glass-border); box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
           <span style="font-size: 2rem; font-weight: 700; color: white;">${driver.name.split(' ').map(n => n[0]).join('')}</span>
        </div>

        <h3 style="margin: 0; font-size: 1.4rem; margin-bottom: 5px;">${driver.name}</h3>
        <p style="opacity: 0.6; font-size: 0.9rem; margin-bottom: 30px;">Options de contact rapide</p>

        <div style="display: flex; flex-direction: column; gap: 15px;">
          ${driver.phone ? `
            <a href="tel:${driver.phone}" class="btn-primary hover-lift" style="display: flex; align-items: center; justify-content: center; gap: 12px; height: 56px; border-radius: 16px; font-size: 1.1rem; text-decoration: none; background: #10b981; border: none; color: white;">
              <i data-lucide="phone" style="width: 24px;"></i> Appeler
            </a>
            <a href="sms:${driver.phone}" class="btn-primary hover-lift" style="display: flex; align-items: center; justify-content: center; gap: 12px; height: 56px; border-radius: 16px; font-size: 1.1rem; text-decoration: none; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: white;">
              <i data-lucide="message-square" style="width: 24px;"></i> Envoyer un SMS
            </a>
          ` : '<div style="opacity: 0.5;">Aucun numéro de téléphone</div>'}
          
          ${driver.email ? `
            <a href="mailto:${driver.email}" class="btn-primary hover-lift" style="display: flex; align-items: center; justify-content: center; gap: 12px; height: 56px; border-radius: 16px; font-size: 1.1rem; text-decoration: none; background: var(--primary-color); border: none; color: white;">
              <i data-lucide="mail" style="width: 24px;"></i> Envoyer un Email
            </a>
          ` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => {
      modal.classList.remove('hidden');
      lucide.createIcons();
    }, 10);
  },

  addCustomFolder: async () => {
    const name = prompt("Nom du nouveau dossier :");
    if (name) {
      const newFolder = {
        id: Date.now(),
        name: name.toUpperCase(),
        documents: [],
        org_id: currentState.currentUserProfile?.org_id || (currentState.currentUser?.user_metadata?.org_id)
      };
      if (!newFolder.org_id) {
        console.warn("⚠️ Org ID missing for new folder");
      }
      currentState.customFolders.push(newFolder);
      window.app.syncToSupabase('custom_folders', newFolder, 'INSERT');
      window.app.addActivity('success', 'Nouveau dossier', `Dossier "${name}" créé`);
      render();
      showToast(`Dossier "${name}" créé`, 'success');
    }
  },

  resetUserPassword: async (email) => {
    if (!supabase) return;
    if (await showConfirm(`Réinitialiser le mot de passe pour ${email} ?`)) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        showToast(`Lien de réinitialisation envoyé à ${email}`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  },
};

// Expose early to window
window.app = app;
window.toggleRoleModal = () => app.toggleRoleModal();
console.log('✅ App Manager Ready (v3.0.2)');

app.selectDriver = (id) => {
  currentState.activeDriverId = id;
  currentState.currentView = 'driverDashboard';
  showToast(`Connecté en tant que ${currentState.drivers.find(d => d.id == id).name}`, 'success');
  render();
};

app.openFieldUpload = () => {
  if (!currentState.activeDriverId) {
    showToast("Erreur: Profil non identifié.", "error");
    return;
  }

  // Refresh current entity context
  currentState.currentDocEntity = { type: 'driver', id: currentState.activeDriverId };

  const modal = document.getElementById('driver-doc-type-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.offsetHeight;
  } else {
    console.error("Modal driver-doc-type-modal not found");
  }
};

app.selectDocType = (typeLabel) => {
  const expiry = document.getElementById('driver-doc-expiry').value;
  if (!expiry) {
    showToast("La date d'expiration est obligatoire", "error");
    return;
  }

  const modal = document.getElementById('driver-doc-type-modal');
  modal.classList.add('hidden');

  const fileInput = document.getElementById('doc-upload-input');
  const camInput = document.getElementById('doc-camera-input');
  document.getElementById('doc-name-input').value = typeLabel;
  document.getElementById('doc-expiry-input').value = expiry;
  currentState.currentDocEntity = { type: 'driver', id: currentState.activeDriverId };
  fileInput.click();
};

app.triggerUpload = () => {
  const name = document.getElementById('doc-name-input').value;
  const expiry = document.getElementById('doc-expiry-input').value;

  if (!name || !expiry) {
    showToast("Le nom et la date d'expiration sont obligatoires", "error");
    return;
  }

  document.getElementById('doc-upload-input').click();
};

function initCustomBonusForm() {
  const form = document.getElementById('custom-bonus-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = document.getElementById('cb-label').value;
    const amount = parseFloat(document.getElementById('cb-amount').value);

    if (label && !isNaN(amount)) {
      window.app.addBonus(label, amount);
      form.reset();
    }
  });
}

// --- Core Functions ---
function initMaintenanceForm() {
  const form = document.getElementById('add-maintenance-form');
  const closeBtn = document.getElementById('close-maintenance-modal');
  const modal = document.getElementById('maintenance-modal');

  // Redundant but safe listener from init
  closeBtn?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('m-type').value;
    const mileage = parseInt(document.getElementById('m-mileage').value);
    const notes = document.getElementById('m-notes').value;

    if (type && !isNaN(mileage)) {
      if (window.app && window.app.addMaintenanceLog) {
        window.app.addMaintenanceLog(currentState.currentMaintVehicle, {
          type, mileage, notes
        });
        form.reset();
      }
    }
  });
}

function initVehicleForm() {
  const form = document.getElementById('add-vehicle-form');
  const closeBtn = document.getElementById('close-vehicle-modal');
  const modal = document.getElementById('add-vehicle-modal');

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const vehicleId = Date.now();
    const driverId = parseInt(document.getElementById('v-driver-select').value);

    const newVehicle = {
      id: vehicleId,
      plate: document.getElementById('v-plate').value,
      brand: document.getElementById('v-brand').value,
      model: document.getElementById('v-model').value,
      mileage: parseInt(document.getElementById('v-mileage').value),
      status: 'active',
      documents: []
    };

    currentState.vehicles.unshift(newVehicle);

    if (driverId) {
      // Unlink driver from previous vehicle if any
      currentState.drivers.forEach(d => {
        if (d.vehicleId === vehicleId) delete d.vehicleId; // Remove any driver previously linked to this vehicle ID (shouldn't happen on new vehicle but safe)
      });
      // Ensure exclusivity: unlink other drivers from this new vehicle (redundant but safe)
      currentState.drivers.forEach(d => {
        if (d.id !== driverId && d.vehicleId === vehicleId) delete d.vehicleId;
      });
      // Link the driver
      const driver = currentState.drivers.find(d => d.id === driverId);
      if (driver) driver.vehicleId = vehicleId;
    }

    modal.classList.add('hidden');
    form.reset();
    render();
    syncToSupabase('vehicles', newVehicle);
    window.app.addActivity('success', 'Nouveau véhicule', `${newVehicle.plate} (${newVehicle.brand})`);
  });
}

function initDriverForm() {
  const form = document.getElementById('add-driver-form');
  const closeBtn = document.getElementById('close-driver-modal');
  const modal = document.getElementById('add-driver-modal');

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const driverId = Date.now();
    const vehicleId = parseInt(document.getElementById('d-vehicle-select').value);

    const newDriver = {
      id: driverId,
      name: document.getElementById('d-name').value,
      email: (document.getElementById('d-email').value || '').trim() || null,
      phone: document.getElementById('d-phone').value,
      license: document.getElementById('d-license').value,
      vehicleId: vehicleId || null,
      documents: []
    };

    currentState.drivers.unshift(newDriver);

    if (vehicleId) {
      // Ensure exclusivity: remove other drivers from this vehicle
      currentState.drivers.forEach(d => {
        if (d.id !== driverId && d.vehicleId === vehicleId) delete d.vehicleId;
      });
    }

    modal.classList.add('hidden');
    form.reset();
    render();
    const dbDriver = { ...newDriver, vehicle_id: newDriver.vehicleId };
    delete dbDriver.vehicleId;
    delete dbDriver.documents; // Documents are JSONB or separate, checking schema usually handled as JSONB default [] if passed

    syncToSupabase('drivers', dbDriver);
    window.app.addActivity('success', 'Nouveau chauffeur', newDriver.name);
  });
}

function initEditVehicleForm() {
  const form = document.getElementById('edit-vehicle-form');
  const closeBtn = document.getElementById('close-edit-vehicle-modal');
  const modal = document.getElementById('edit-vehicle-modal');

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-v-id').value);
    const driverId = parseInt(document.getElementById('edit-v-driver-select').value);
    const vehicleIndex = currentState.vehicles.findIndex(v => v.id === id);

    if (vehicleIndex !== -1) {
      const updatedVehicle = {
        ...currentState.vehicles[vehicleIndex],
        plate: document.getElementById('edit-v-plate').value,
        brand: document.getElementById('edit-v-brand').value,
        model: document.getElementById('edit-v-model').value,
        mileage: parseInt(document.getElementById('edit-v-mileage').value),
        status: document.getElementById('edit-v-status').value
      };

      currentState.vehicles[vehicleIndex] = updatedVehicle;

      // Update Links
      // 1. Unlink everyone from this vehicle
      currentState.drivers.forEach(d => {
        if (d.vehicleId === id) delete d.vehicleId;
      });
      // 2. Link the selected driver to this vehicle
      if (driverId) {
        // First, unlink the selected driver from any other vehicle they might be assigned to
        currentState.drivers.forEach(d => {
          if (d.id === driverId && d.vehicleId !== id) delete d.vehicleId;
        });
        // Then, assign the selected driver to this vehicle
        const driver = currentState.drivers.find(d => d.id === driverId);
        if (driver) driver.vehicleId = id;
      }

      modal.classList.add('hidden');
      render();
      syncToSupabase('vehicles', updatedVehicle, 'UPDATE');
      window.app.addActivity('warning', 'Véhicule modifié', `${updatedVehicle.plate}`);
    }
  });
}

function initEditDriverForm() {
  const form = document.getElementById('edit-driver-form');
  const closeBtn = document.getElementById('close-edit-driver-modal');
  const modal = document.getElementById('edit-driver-modal');

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-d-id').value);
    const vehicleId = parseInt(document.getElementById('edit-d-vehicle-select').value);
    const driverIndex = currentState.drivers.findIndex(d => d.id === id);

    if (driverIndex !== -1) {
      const updatedDriver = {
        ...currentState.drivers[driverIndex],
        name: document.getElementById('edit-d-name').value,
        email: document.getElementById('edit-d-email').value,
        phone: document.getElementById('edit-d-phone').value,
        license: document.getElementById('edit-d-license').value,
        vehicleId: vehicleId || null
      };

      currentState.drivers[driverIndex] = updatedDriver;

      // Ensure exclusivity if a vehicle is assigned
      if (vehicleId) {
        currentState.drivers.forEach(d => {
          if (d.id !== id && d.vehicleId === vehicleId) delete d.vehicleId;
        });
      }

      modal.classList.add('hidden');
      render();
      const dbDriver = { ...updatedDriver, vehicle_id: updatedDriver.vehicleId };
      delete dbDriver.vehicleId;
      syncToSupabase('drivers', dbDriver, 'UPDATE');
      const driverBefore = currentState.drivers[driverIndex];
      window.app.addActivity('warning', 'Chauffeur modifié', updatedDriver.name);

      if (driverBefore.phone !== updatedDriver.phone) {
        window.app.addActivity('info', 'Changement de téléphone', `${updatedDriver.name}: ${updatedDriver.phone || 'Effacé'}`);
      }
      if (driverBefore.email !== updatedDriver.email) {
        window.app.addActivity('info', 'Changement d\'email', `${updatedDriver.name}: ${updatedDriver.email || 'Effacé'}`);
      }
    }
  });
}



function initLicenseSelectors() {
  const setupSelector = (selectorId, inputId) => {
    const selector = document.getElementById(selectorId);
    const input = document.getElementById(inputId);
    if (!selector || !input) return;

    selector.querySelectorAll('.license-tag').forEach(tag => {
      tag.onclick = () => {
        tag.classList.toggle('active');
        const activeTags = Array.from(selector.querySelectorAll('.license-tag.active'))
          .map(t => t.dataset.val);
        input.value = activeTags.join(', ');
      };
    });
  };

  setupSelector('add-d-license-selector', 'd-license');
  setupSelector('edit-d-license-selector', 'edit-d-license');
}

function initDocHandlers() {
  const fileInput = document.getElementById('doc-upload-input');
  // Removed unneeded ghost elements (modal, closeDocModal)

  fileInput?.addEventListener('change', (e) => {
    // FIX: If the GENERIC "Add Document" modal is open, do NOT trigger this flow.
    // The generic modal handles the file input itself via saveNewDocument.
    const genericModal = document.getElementById('document-modal');
    if (genericModal && !genericModal.classList.contains('hidden')) {
      console.log('Open generic modal detected, skipping shortcut flow.');
      return;
    }

    const file = e.target.files[0];
    if (!file) return;

    // 1. Determine Context & Folders
    const entity = currentState.currentDocEntity || { type: 'driver', id: currentState.activeDriverId };
    let folders = [];

    if (entity.type === 'driver') {
      folders = ['DOCUMENTS CHAUFFEUR', 'ADMINISTRATIF'];
    } else if (entity.type === 'vehicle') {
      folders = ['DOCUMENTS VÉHICULE', 'ADMINISTRATIF'];
    } else if (entity.type === 'folder') {
      // Should upload directly to this folder? Or allow choice? 
      // For now, let's treat it generic or add 'DIVERS'
      folders = ['DIVERS'];
    }

    // Add any existing custom folders for this entity?? 
    // Usually custom folders are root items, not subfolders. 
    // The requirement is specific: "Default Folders... to show up".

    // 2. Populate Modal
    const modal = document.getElementById('edit-doc-modal');
    const modalTitle = modal.querySelector('h3'); // Get title element
    if (modalTitle) modalTitle.textContent = 'Nouveau Document'; // Fix title

    const folderSelect = document.getElementById('edit-doc-folder');
    const nameInput = document.getElementById('edit-doc-name');
    const expiryInput = document.getElementById('edit-doc-expiry');
    const expiryToggle = document.getElementById('edit-doc-expiry-toggle');
    const expiryContainer = document.getElementById('edit-doc-expiry-container');
    const nameElem = document.getElementById('doc-name-input');
    const docName = nameElem ? nameElem.value : '';

    if (folderSelect) {
      // Ensure 'Autre' option exists for custom folder creation
      const options = folders.map(f => `<option value="${f}">${f}</option>`);
      options.push(`<option value="Autre">Autre (Nouveau dossier)</option>`);
      folderSelect.innerHTML = options.join('');

      // Reset new folder input visibility if it exists (it might not be in edit modal HTML yet?)
      // We need to inject or handle the "New Folder" input in the Edit Modal if we reuse it.
      // Checking HTML... edit-doc-modal (lines 652-703) does NOT have a new folder input!
      // We must add it dynamically or fail gracefully?
      // Actually, let's just add the 'Autre' option and rely on a listener to show a prompt or input.
    }

    if (nameInput) nameInput.value = docName || file.name;

    // Reset Expiry
    if (expiryToggle) expiryToggle.checked = false;
    if (expiryContainer) expiryContainer.classList.add('hidden');
    if (expiryInput) expiryInput.value = '';

    // Set Mode: NEW
    modal.dataset.mode = 'new';
    modal.dataset.entityType = entity.type;
    modal.dataset.entityId = entity.id;

    // Show Modal
    modal.classList.remove('hidden');

    // Pre-attach the file
    modal.dataset.pendingFile = true;
    window.pendingUploadFile = file; // Global var usage is easiest here given the architecture
  });
}

function initTaskForm() {
  const form = document.getElementById('add-task-form');
  const closeBtn = document.getElementById('close-task-modal');
  const modal = document.getElementById('add-task-modal');

  closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();

    const initialFiles = Array.from(document.getElementById('t-initial-file')?.files || []);
    const stopsText = document.getElementById('t-stops').value;
    const stopsList = stopsText.split('\n').filter(s => s.trim() !== '').map(s => ({ name: s.trim(), completed: false }));

    const newTask = {
      id: Date.now(),
      title: document.getElementById('t-title').value,
      type: document.getElementById('t-type').value,
      date: document.getElementById('t-date').value,
      vehicleId: document.getElementById('t-vehicle').value,
      driverId: document.getElementById('t-driver').value,
      urgent: document.getElementById('t-urgent').checked,
      stops: stopsList,
      status: 'pending',
      files: [],
      report: ''
    };

    // Handle initial files attachment if any
    initialFiles.forEach(file => {
      newTask.files.push({
        id: 'file-' + Date.now() + Math.random().toString(36).substr(2, 9),
        name: file.name,
        url: URL.createObjectURL(file),
        from: 'admin',
        date: new Date().toISOString()
      });
    });

    currentState.tasks.unshift(newTask);
    modal.classList.add('hidden');
    form.reset();
    render();
    const dbTask = {
      ...newTask,
      vehicle_id: newTask.vehicleId,
      driver_id: newTask.driverId
    };
    delete dbTask.vehicleId;
    delete dbTask.driverId;

    syncToSupabase('tasks', dbTask, 'INSERT');
    showToast('Mission envoyée avec succès', 'success');
    window.app.addActivity('success', 'Nouvelle mission', newTask.title);
  });
}

// Handler for clicking on an alert in the dashboard
app.viewAlert = (alertId) => {
  console.log("Navigating to alert:", alertId);
  // alertId formats: 'v - doc - ID', 'd - doc - ID', 'c - doc - ID', 'new-doc-ID'

  // Clean up the ID string (remove spaces)
  const cleanId = alertId.replace(/\s+/g, '');

  let docId, type, parentId;

  if (cleanId.includes('v-doc-')) {
    docId = cleanId.replace('v-doc-', '');
    // Find vehicle owning this doc
    const vehicle = currentState.vehicles.find(v => v.documents?.some(d => d.id === docId));
    if (vehicle) {
      type = 'vehicle';
      parentId = vehicle.id;
    }
  } else if (cleanId.includes('d-doc-')) {
    docId = cleanId.replace('d-doc-', '');
    const driver = currentState.drivers.find(d => d.documents?.some(d => d.id === docId));
    if (driver) {
      type = 'driver';
      parentId = driver.id;
    }
  } else if (cleanId.includes('c-doc-')) {
    docId = cleanId.replace('c-doc-', '');
    const folder = currentState.customFolders.find(f => f.documents?.some(d => d.id === docId));
    if (folder) {
      type = 'custom';
      parentId = folder.id;
    }
  } else if (cleanId.includes('new-doc-')) {
    docId = cleanId.replace('new-doc-', '');
    // Search everywhere
    const dOwner = currentState.drivers.find(d => d.documents?.some(d => d.id === docId));
    if (dOwner) { type = 'driver'; parentId = dOwner.id; }
    else {
      const vOwner = currentState.vehicles.find(v => v.documents?.some(d => d.id === docId));
      if (vOwner) { type = 'vehicle'; parentId = vOwner.id; }
    }
  }
  // LEGACY FALLBACK: Handle malformed IDs (e.g. 'alert-doc-doc-...') from older sessions
  else if (docId = (cleanId.match(/(\d+)$/) || [])[0]) {
    console.warn("Handling legacy alert ID:", cleanId);
    // Brute-force find the document owner
    const dOwner = currentState.drivers.find(d => d.documents?.some(d => d.id === docId));
    if (dOwner) { type = 'driver'; parentId = dOwner.id; }
    else {
      const vOwner = currentState.vehicles.find(v => v.documents?.some(d => d.id === docId));
      if (vOwner) { type = 'vehicle'; parentId = vOwner.id; }
      else {
        const fOwner = currentState.customFolders.find(f => f.documents?.some(d => d.id === docId));
        if (fOwner) { type = 'custom'; parentId = fOwner.id; }
      }
    }
  }

  if (type && parentId && docId) {
    // 1. Switch to Documents view
    currentState.currentView = 'documents';

    // 2. Open the correct folder context
    currentState.currentDocFolder = { type, id: parentId };

    // 3. Reset subfolder to show all (or could try to find specfic subfolder)
    // For now, let's just open the root of that entity's docs. 
    // Ideally we find the doc's folder and set currentState.currentDocSubFolder
    // Let's find the doc to get its folder
    let entity;
    if (type === 'vehicle') entity = currentState.vehicles.find(v => v.id == parentId);
    else if (type === 'driver') entity = currentState.drivers.find(d => d.id == parentId);
    else if (type === 'custom') entity = currentState.customFolders.find(f => f.id == parentId);

    const doc = entity?.documents?.find(d => d.id === docId);
    if (doc && doc.folder) {
      currentState.currentDocSubFolder = doc.folder.toUpperCase();
    } else {
      currentState.currentDocSubFolder = null;
    }

    // 4. Update UI
    render();

    // 5. Open the document modal immediately
    setTimeout(() => {
      window.app.viewDoc(docId);
    }, 100);

  } else {
    showToast("Document introuvable ou source inconnue.", "error");
  }
};

function updateDynamicAlerts() {
  const newAlerts = [];
  const today = new Date();
  const warningDays = 60;

  // Scan Vehicles
  currentState.vehicles.forEach(v => {
    if (v.documents) {
      v.documents.forEach(doc => {
        if (doc.expiry) {
          const expDate = new Date(doc.expiry);
          const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

          if (diffDays <= warningDays) {
            newAlerts.push({
              id: `v-doc-${doc.id}`,
              type: diffDays < 0 ? 'critical' : 'warning',
              title: diffDays < 0 ? `PERIMÉ: ${doc.name}` : `Alerte Expiration: ${doc.name}`,
              subject: v.plate,
              date: doc.expiry
            });
          }
        }
      });
    }
  });

  // Scan Drivers (Skip for Mechanics)
  if (currentState.userRole.id !== 'mechanic') {
    currentState.drivers.forEach(d => {
      if (d.documents) {
        d.documents.forEach(doc => {
          if (doc.expiry) {
            const expDate = new Date(doc.expiry);
            const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

            if (diffDays <= warningDays) {
              newAlerts.push({
                id: `d-doc-${doc.id}`,
                type: diffDays < 0 ? 'critical' : 'warning',
                title: diffDays < 0 ? `PERIMÉ: ${doc.name}` : `Alerte Expiration: ${doc.name}`,
                subject: d.name,
                date: doc.expiry
              });
            }
          }

          // Notification for new uploads by drivers
          if (doc.status === 'new') {
            newAlerts.push({
              id: `new-doc-${doc.id}`,
              type: 'info',
              title: `Nouveau Document: ${doc.name}`,
              subject: d.name,
              date: doc.date
            });
          }
        });
      }
    });

    // Scan Custom Folders (Skip for Mechanics)
    currentState.customFolders.forEach(f => {
      if (f.documents) {
        f.documents.forEach(doc => {
          if (doc.expiry) {
            const expDate = new Date(doc.expiry);
            const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
            if (diffDays <= warningDays) {
              newAlerts.push({
                id: `c-doc-${doc.id}`,
                type: diffDays < 0 ? 'critical' : 'warning',
                title: diffDays < 0 ? `PERIMÉ: ${doc.name}` : `Alerte Expiration: ${doc.name}`,
                subject: f.name,
                date: doc.expiry
              });
            }
          }
        });
      }
    });
  }

  currentState.alerts = newAlerts.sort((a, b) => new Date(a.date) - new Date(b.date));
  render();
}
function render() {
  // Reveal app after first successful render
  const appTarget = document.getElementById('app');
  if (appTarget && appTarget.style.opacity !== '1') {
    appTarget.style.opacity = '1';
    appTarget.style.transition = 'opacity 0.4s ease-in';
  }

  console.log('Rendering view:', currentState.currentView);
  const appContainer = document.getElementById('main-content');
  const viewFn = views[currentState.currentView];

  if (viewFn) {
    appContainer.innerHTML = viewFn();
    lucide.createIcons();
    initModernPickers();

    // Add specific listener for the Nouveau button if it exists
    const nouveauBtn = appContainer.querySelector('.section-header .btn-primary');
    if (nouveauBtn && currentState.currentView === 'fleet') {
      nouveauBtn.addEventListener('click', () => {
        const isVehicles = !currentState.showDrivers;
        if (isVehicles) {
          window.app.openAddVehicle();
        } else {
          window.app.openAddDriver();
        }
      });
    }
  }

  renderNavigation();

  const isChauffeur = currentState.userRole.id === 'driver';
  const hasProfile = currentState.activeDriverId !== null;

  // Update Role UI
  const roleLabel = document.getElementById('current-role-label');
  const avatar = document.getElementById('user-avatar');

  if (isChauffeur && hasProfile) {
    const driver = currentState.drivers.find(d => d.id === currentState.activeDriverId);
    if (roleLabel) roleLabel.textContent = `Chauffeur: ${driver?.name.split(' ')[0]}`;
    if (avatar) avatar.textContent = driver?.name.split(' ').map(n => n[0]).join('');
  } else {
    if (roleLabel) roleLabel.textContent = currentState.userRole.label;
    if (avatar) avatar.textContent = 'AD';
  }

  if (avatar) {
    avatar.style.borderColor = currentState.userRole.color;
    avatar.style.color = currentState.userRole.color;
  }

  // Update Profile Modal UI
  const roleModal = document.getElementById('role-modal');
  if (roleModal) {
    const modalAvatar = document.getElementById('modal-user-avatar');
    const modalName = document.getElementById('modal-user-name');
    const modalRole = document.getElementById('modal-user-role');
    const modalEmail = document.getElementById('modal-user-email');
    const roleSwitcher = document.getElementById('role-switcher-section');

    const driver = isChauffeur && hasProfile ? currentState.drivers.find(d => d.id === currentState.activeDriverId) : null;

    if (modalName) modalName.textContent = isChauffeur ? (driver?.name || 'Chauffeur') : 'Admin Patron';
    if (modalRole) modalRole.textContent = currentState.userRole.label;
    if (modalEmail) modalEmail.textContent = currentState.currentUser?.email || '';
    if (modalAvatar) {
      modalAvatar.textContent = isChauffeur ? (driver?.name.split(' ').map(n => n[0]).join('')) : 'AD';
      modalAvatar.style.borderColor = currentState.userRole.color;
      modalAvatar.style.color = currentState.userRole.color;
    }

    // Hide role switcher for drivers
    if (roleSwitcher) {
      roleSwitcher.style.display = isChauffeur ? 'none' : 'block';
    }
  }

  // Handle Visibility of Shell Elements
  const header = document.getElementById('main-header');
  const bottomNav = document.getElementById('bottom-nav');
  const isAuthView = currentState.currentView === 'login' || currentState.currentView === 'signup';

  if (isAuthView) {
    header?.classList.add('hidden');
    bottomNav?.classList.add('hidden');
  } else {
    header?.classList.remove('hidden');
    bottomNav?.classList.remove('hidden');
  }

  // Attach login/signup handlers if views were just rendered
  if (currentState.currentView === 'login') {
    const emailInput = document.getElementById('login-email');
    const rememberMe = document.getElementById('remember-me');

    // Load saved email
    const savedEmail = localStorage.getItem('4essieux_remembered_email');
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
      if (rememberMe) rememberMe.checked = true;
    }

    // Toggle Password Visibility
    const toggleBtn = document.getElementById('toggle-password');
    const passInput = document.getElementById('login-password');
    if (toggleBtn && passInput) {
      toggleBtn.addEventListener('click', () => {
        const type = passInput.type === 'password' ? 'text' : 'password';
        passInput.type = type;
        const icon = toggleBtn.querySelector('i');
        if (icon) {
          icon.setAttribute('data-lucide', type === 'password' ? 'eye' : 'eye-off');
          lucide.createIcons();
        }
      });
    }

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const pass = document.getElementById('login-password').value;
      const remember = document.getElementById('remember-me')?.checked;

      // Handle persistence
      if (remember) {
        localStorage.setItem('4essieux_remembered_email', email);
      } else {
        localStorage.removeItem('4essieux_remembered_email');
      }

      try {
        const user = await signIn(email, pass);
        // The authCallback in initAuth will handle redirection based on role
        showToast('Connexion réussie', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (currentState.currentView === 'signup') {
    const inviteInput = document.getElementById('signup-invite');
    const coreFields = document.getElementById('signup-core-fields');
    const statusDiv = document.getElementById('invite-status');
    const roleBadge = document.getElementById('signup-role-badge');
    const roleHidden = document.getElementById('signup-role-hidden');
    const nameInput = document.getElementById('signup-name');
    const inputsToEnable = coreFields?.querySelectorAll('input');

    inviteInput?.addEventListener('input', async (e) => {
      const code = e.target.value.toUpperCase();
      if (code.length >= 7) {
        statusDiv.innerHTML = '<span style="color:var(--text-muted)">Vérification...</span>';
        const result = await validateInviteCode(code);
        if (result.valid) {
          statusDiv.innerHTML = `<i data-lucide="check-circle" style="width:14px;color:var(--success-color)"></i> <span style="color:var(--success-color)">Code Valide : ${result.data.target_name}</span>`;
          coreFields.classList.remove('opacity-50', 'pointer-events-none');
          roleBadge.textContent = ROLES[result.data.role.toUpperCase()]?.label || result.data.role;
          roleBadge.style.color = ROLES[result.data.role.toUpperCase()]?.color || 'white';
          roleHidden.value = result.data.role;
          nameInput.value = result.data.target_name || '';
          inputsToEnable?.forEach(i => i.disabled = false);
          lucide.createIcons();
        } else {
          statusDiv.innerHTML = `<i data-lucide="x-circle" style="width:14px;color:var(--error-color)"></i> <span style="color:var(--error-color)">${result.error}</span>`;
          coreFields.classList.add('opacity-50', 'pointer-events-none');
          inputsToEnable?.forEach(i => i.disabled = true);
          lucide.createIcons();
        }
      }
    });

    document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isOwner = currentState.signupOwnerMode;
      const code = !isOwner ? document.getElementById('signup-invite').value.trim().toUpperCase() : null;
      const orgName = isOwner ? document.getElementById('signup-org-name').value : null;
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const pass = document.getElementById('signup-password').value;
      const role = document.getElementById('signup-role-hidden').value;

      try {
        await signUp(email, pass, {
          full_name: name,
          role: role || 'driver',
          invite_code: code,
          org_name: orgName
        });
        showToast(isOwner ? 'Cellule créée ! Bienvenue Patron.' : 'Compte créé ! Bienvenue dans l\'équipe.', 'success');

        // Wait a bit for the trigger to finish before redirecting if possible
        // but Supabase auth state change will handle it.
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Persist state to IndexedDB after every render/change
  db.saveState(currentState).catch(err => console.error('Error saving state:', err));
}

function handleNavigation(view) {
  console.log('🚀 Navigating to:', view);

  if (view === 'scan' || view === 'tacho' && currentState.userRole.id === 'admin') {
    // If it's the central button, we might want the scan module
    if (view === 'scan') {
      openScanModule();
      return;
    }
  }

  if (view === 'documents' || view === 'driverDocs') {
    currentState.currentDocFolder = null;
    currentState.currentDocSubFolder = null;
    currentState.currentDocEntity = null;
  }

  currentState.currentView = view;
  if (view === 'team') app.loadTeamData();
  render();
}
// Expose to window for HTML onclicks
window.handleNavigation = handleNavigation;

function renderNavigation() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;

  const isChauffeur = currentState.userRole.id === 'driver';
  const hasProfile = currentState.activeDriverId !== null;

  if (isChauffeur && !hasProfile) {
    nav.classList.add('hidden');
    return;
  } else {
    nav.classList.remove('hidden');
  }

  const isMechanic = currentState.userRole.id === 'mechanic';

  let items = [];

  if (isChauffeur) {
    items = [
      { view: 'driverDashboard', icon: 'layout-dashboard', label: 'Espace' },
      { view: 'driverMissions', icon: 'briefcase', label: 'Boulot' },
      { view: 'driverDocs', icon: 'folder', label: 'Documents' }
    ];
  } else if (isMechanic) {
    items = [
      { view: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
      { view: 'fleet', icon: 'truck', label: 'Véhicules' }, // Label changed to reflect forced vehicle view
      { view: 'tacho', icon: 'gauge', label: 'Tacho', isScan: true }
    ];
  } else {
    items = [
      { view: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
      { view: 'documents', icon: 'folder', label: 'Documents' },
      { view: 'fleet', icon: 'truck', label: 'Parc' },
      { view: 'tacho', icon: 'gauge', label: 'Tacho', isScan: true },
      { view: 'payroll', icon: 'calendar-check', label: 'Présences' },
      { view: 'tasks', icon: 'list-todo', label: 'Tâches' },
      { view: 'team', icon: 'users', label: 'Équipe' }
    ];
  }

  nav.innerHTML = items.map(item => `
    <button class="nav-item ${currentState.currentView === item.view ? 'active' : ''} ${item.isScan ? 'scan-btn' : ''}" data-view="${item.view}">
      ${item.isScan ? `<div class="scan-icon-wrapper"><i data-lucide="${item.icon}"></i></div>` : `<i data-lucide="${item.icon}"></i>`}
      <span>${item.label}</span>
    </button>
  `).join('');

  nav.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) handleNavigation(view);
    });
  });

  lucide.createIcons();
}

function openScanModule() {
  console.log('📸 Opening scan module...');
  showToast('Démarrage de la caméra...', 'info');

  const main = document.getElementById('main-content');
  if (!main) {
    console.error('❌ main-content not found for scan module');
    return;
  }

  main.innerHTML = views.scan();
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  const closeBtn = document.getElementById('close-scan');
  if (closeBtn) {
    closeBtn.onclick = () => {
      console.log('✖️ Closing scan module');
      render();
    };
  } else {
    console.warn('⚠️ Close button not found in scan view');
  }
}

// --- Event Listeners ---
const initModernPickers = () => {
  if (typeof flatpickr === 'undefined') return;

  const inputs = document.querySelectorAll("input[type='date']");
  inputs.forEach(input => {
    // Avoid double init if already done (optional but safer)
    if (input._flatpickr) return;

    const config = {
      locale: "fr",
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "j F Y",
      allowInput: true,
      theme: "dark",
      disableMobile: "true",
      onOpen: function (selectedDates, dateStr, instance) {
        if (instance.calendarContainer) instance.calendarContainer.style.zIndex = "99999";
      }
    };

    // Priority: Existing Value > Today
    const defaultDate = input.dataset.defaultDate || input.getAttribute('value') || input.value;
    if (defaultDate) {
      config.defaultDate = defaultDate;
    } else {
      config.defaultDate = "today";
    }

    flatpickr(input, config);
  });
};

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App Initializing...');
  window.app = app;
  initModernPickers();

  // Try to load state from IndexedDB
  try {
    const savedState = await db.loadState();
    if (savedState) {
      console.log('📦 Loaded state from IndexedDB');
      currentState = { ...currentState, ...savedState };
    }
  } catch (err) {
    console.warn('Could not load local state:', err);
  }

  // Handle messages from Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SYNC_RETRY') {
        processOfflineQueue();
      }
    });
  }

  // Auth Callback
  const authCallback = (user) => {
    console.log('👤 Auth state change:', user);
    currentState.currentUser = user;

    if (user) {
      let roleId = (user.user_metadata?.role || 'driver').trim().toLowerCase();

      // HOTFIX: Force Admin for Omar if metadata is corrupted
      if (user.email === 'omar.biddiche@gmail.com') {
        roleId = 'admin';
        console.log('🔒 Forced ADMIN role for omar.biddiche@gmail.com');
      }

      // Robust lookup handling uppercase/lowercase variants and French fallbacks
      const roleKey = roleId.toUpperCase();
      const mappedKey = roleKey === 'COLLABORATEUR' ? 'COLLABORATOR' :
        (roleKey === 'MECANICIEN' ? 'MECHANIC' : roleKey);

      currentState.userRole = ROLES[mappedKey] || ROLES.DRIVER;

      console.log(`🔐 Role Resolution: Metadata='${user.user_metadata?.role}' -> ID='${roleId}' -> Key='${mappedKey}' -> Found=${!!ROLES[mappedKey]}`);

      if (roleId === 'driver') {
        const driver = currentState.drivers.find(d => d.email === user.email);
        if (driver) {
          currentState.activeDriverId = driver.id;
        } else {
          currentState.activeDriverId = user.id;
        }
        currentState.currentView = 'driverDashboard';
      } else {
        // Ensure Admin/Manager is on the main dashboard
        const invalidViews = ['login', 'signup', 'driverDashboard', 'driverMissions', 'driverDocs'];
        if (invalidViews.includes(currentState.currentView)) {
          currentState.currentView = 'dashboard';
        }
        // Clear driver-specific state to avoid UI confusion
        currentState.activeDriverId = null;
      }

      if (window.app && typeof window.app.loadAllData === 'function') {
        window.app.loadAllData();
      }
    } else {
      currentState.currentView = 'login';
    }
    render();
  };

  // Initialize Auth
  initAuth(authCallback);

  // Initial Render fallback: Show spinner while Auth loads
  setTimeout(() => {
    // Only reveal the app container (showing the spinner) 
    // Do NOT force render() here to avoid Flash of Login Screen for logged-in users
    revealApp();
  }, 100);

  // Initialize Forms & Handlers
  const init = (fn) => {
    try { fn(); } catch (e) { console.warn(`Init error in ${fn.name}:`, e); }
  };

  init(initVehicleForm);
  init(initDriverForm);
  init(initEditVehicleForm);
  init(initEditDriverForm);
  init(initDocHandlers);
  init(initTaskForm);
  init(initCustomBonusForm);
  init(initMaintenanceForm);
  init(initLicenseSelectors);

  document.getElementById('global-scan-btn')?.addEventListener('click', () => {
    handleNavigation('scan');
  });

  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const roleId = btn.dataset.role;
      currentState.userRole = ROLES[roleId.toUpperCase()];
      if (roleId === 'driver') {
        currentState.activeDriverId = null;
        currentState.currentView = 'driverSelection';
      } else {
        currentState.currentView = 'dashboard';
      }
      app.toggleRoleModal();
      render();
    });
  });

  // Close modals on background click
  const modalIds = [
    'role-modal', 'add-vehicle-modal', 'add-driver-modal', 'edit-vehicle-modal',
    'edit-driver-modal', 'document-modal', 'edit-doc-modal', 'add-task-modal',
    'driver-doc-type-modal', 'bonus-modal', 'maintenance-modal', 'mission-detail-modal'
  ];

  // Initialize Mission Detail Tabs & Close
  document.getElementById('close-mission-detail')?.addEventListener('click', () => {
    document.getElementById('mission-detail-modal').classList.add('hidden');
    render(); // Refresh main list to show counts
  });

  document.getElementById('tab-todo')?.addEventListener('click', () => window.app.setMissionDetailTab('todo'));
  document.getElementById('tab-files')?.addEventListener('click', () => window.app.setMissionDetailTab('files'));
  document.getElementById('tab-chat')?.addEventListener('click', () => window.app.setMissionDetailTab('chat'));

  modalIds.forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      if (e.target.id === id) document.getElementById(id).classList.add('hidden');
    });
  });

  document.getElementById('edit-doc-file')?.addEventListener('change', (e) => {
    const fileName = e.target.files[0]?.name;
    const display = document.getElementById('edit-doc-file-name');
    if (display) display.textContent = fileName ? `Nouveau fichier : ${fileName}` : '';
  });

  document.getElementById('close-bonus-modal')?.addEventListener('click', () => {
    document.getElementById('bonus-modal').classList.add('hidden');
  });

  document.getElementById('close-maintenance-modal')?.addEventListener('click', () => {
    document.getElementById('maintenance-modal').classList.add('hidden');
  });

  document.getElementById('close-doc-modal')?.addEventListener('click', () => {
    document.getElementById('document-modal').classList.add('hidden');
  });

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW Registered:', reg);
      }).catch(err => {
        console.log('SW Registration failed:', err);
      });
    });
  }

  // Load WASM exec script
  const wasmScript = document.createElement('script');
  wasmScript.src = '/wasm_exec.js';
  document.head.appendChild(wasmScript);
});

// Custom Confirmation Modal
function showConfirm(message) {
  return new Promise((resolve) => {
    try {
      console.log('👀 showConfirm called with:', message);
      const modal = document.getElementById('confirmation-modal');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      // Fallback if DOM elements are missing
      if (!modal || !msgEl || !okBtn || !cancelBtn) {
        console.error("⚠️ showConfirm: Elements modal introuvables via ID.");
        // Try searching by class just in case
        const backupModal = document.querySelector('#confirmation-modal');
        if (!backupModal) {
          console.error("⚠️ showConfirm: Vraiment introuvable. Fallback native.");
          resolve(window.confirm(message));
          return;
        }
      }

      console.log('✅ Modal found:', modal);
      msgEl.textContent = message;

      // MOUNT TO BODY to escape #app stacking context
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
        console.log('🏗️ Modal moved to document.body');
      }

      // FORCE VISIBILITY
      modal.classList.remove('hidden');
      modal.style.display = 'flex'; // FORCE FLEX
      modal.style.opacity = '1';    // FORCE OPACITY
      modal.style.zIndex = '9999999'; // FORCE TOP Z-INDEX
      modal.style.visibility = 'visible'; // FORCE VISIBILITY

      console.log('🔓 Modal styles applied. Display:', modal.style.display);

      // Safe lucide call
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
      }

      // Reset old listeners by cloning
      const newOk = okBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOk, okBtn);

      const newCancel = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

      newOk.addEventListener('click', () => {
        console.log('👍 Modal OK clicked');
        modal.classList.add('hidden');
        modal.style.display = 'none'; // Force hide
        resolve(true);
      });

      newCancel.addEventListener('click', () => {
        console.log('👎 Modal Cancel clicked');
        modal.classList.add('hidden');
        modal.style.display = 'none'; // Force hide
        resolve(false);
      });

      console.log('👂 Event listeners attached to OK/Cancel');

    } catch (e) {
      console.error("❌ Erreur showConfirm:", e);
      resolve(window.confirm(message)); // Ultimate fallback
    }
  });
}



// Toast notification system
function showToast(message, type = 'info', options = {}) {
  // options: { duration: number(ms), persistent: boolean }
  const duration = typeof options.duration === 'number' ? options.duration : 4000;
  const persistent = !!options.persistent;

  // Create / reuse container so toasts don't overlap
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');

  const colors = {
    success: { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', icon: 'check-circle' },
    error: { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', icon: 'alert-circle' },
    warning: { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', icon: 'alert-triangle' },
    info: { bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', icon: 'info' }
  };

  const theme = colors[type] || colors.info;

  toast.className = `toast toast-${type} glass-effect`;
  toast.style.cssText = `
    position: relative;
    width: 320px;
    padding: 12px 14px;
    border-radius: 16px;
    border: 1px solid ${theme.border};
    background: ${theme.bg};
    backdrop-filter: blur(18px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    animation: slideInRight 0.35s ease-out;
    pointer-events: auto;
  `;

  toast.innerHTML = `
    <div style="margin-top: 2px;">
      <i data-lucide="${theme.icon}" style="width: 18px; height: 18px;"></i>
    </div>
    <div style="flex: 1; font-size: 0.9rem; line-height: 1.25rem;">${message}</div>
    <button class="btn-ghost" style="padding: 2px 6px; opacity: 0.7;" aria-label="Fermer">×</button>
  `;

  const closeBtn = toast.querySelector('button');
  const removeToast = () => {
    if (!toast.isConnected) return;
    toast.style.animation = 'slideOutRight 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  };

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeToast();
  });

  container.appendChild(toast);
  lucide.createIcons();

  if (!persistent) {
    setTimeout(removeToast, duration);
  }

  // Return element so callers can remove it manually
  toast.removeToast = removeToast;
  return toast;
}
// --- Global Exposure ---
window.app = app;
// Expose Internal State via Getter (Live Reference)
Object.defineProperty(window.app, 'state', {
  get: () => currentState
});
console.log("✅ APP OBJECT EXPOSED TO WINDOW:", window.app);
// alert("DEBUG: FIN DU FICHIER ATTEINTE. L'application est prête.");
