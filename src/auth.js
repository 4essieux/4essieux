// auth.js - Supabase Authentication & Role Management for 4ESSIEUX V3

const SUPABASE_URL = 'https://krqddipyrdlezwxeqvdh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_x1z-Czrs53yBpVv9SCWxPA_uok6AfNn';
export const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export const ROLES = {
    ADMIN: { id: 'admin', label: 'Admin (Patron)', color: '#42c1a6' },
    COLLABORATOR: { id: 'collaborator', label: 'Collaborateur (RH)', color: '#10b981' },
    DRIVER: { id: 'driver', label: 'Chauffeur', color: '#f59e0b' },
    MECHANIC: { id: 'mechanic', label: 'Mécanicien', color: '#ef4444' }
};

export const PERMISSIONS = {
    admin: ['*'],
    collaborator: ['view_dashboard', 'view_fleet', 'view_drivers', 'manage_payroll', 'manage_tasks'],
    driver: ['view_dashboard', 'view_own_data', 'submit_documents'],
    mechanic: ['view_dashboard', 'view_fleet', 'manage_maintenance']
};

export async function signUp(email, password, metadata = {}) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                role: metadata.role || 'driver',
                full_name: metadata.full_name || '',
                invite_code: metadata.invite_code || null,
                org_name: metadata.org_name || null // Added for V4 Cellule
            }
        }
    });
    if (error) throw error;
    return data.user;
}

export async function validateInviteCode(code) {
    if (!supabase) return { valid: false, error: 'Supabase not initialized' };

    const normalizedCode = code.trim().toUpperCase();
    const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', normalizedCode)
        .eq('is_used', false)
        .single();

    if (error || !data) {
        return { valid: false, error: 'Code invalide ou déjà utilisé' };
    }

    // Normalize role data to avoid issues downstream
    if (data && data.role) {
        data.role = data.role.trim();
        // Map French role names to IDs if necessary
        const r = data.role.toUpperCase();
        if (r === 'COLLABORATEUR') data.role = 'collaborator';
        if (r === 'MECANICIEN') data.role = 'mechanic';
        if (r === 'CHAUFFEUR') data.role = 'driver';
        if (r === 'ADMINISTRATEUR' || r === 'PATRON') data.role = 'admin';
    }

    return { valid: true, data };
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    if (error) throw error;
    return data.user;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
}

export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export function hasPermission(user, permission) {
    if (!user || !user.user_metadata) return false;
    const role = user.user_metadata.role || 'driver';
    const userPermissions = PERMISSIONS[role] || [];
    return userPermissions.includes('*') || userPermissions.includes(permission);
}

export async function initAuth(onAuthStateChange) {
    if (supabase) {
        supabase.auth.onAuthStateChange((event, session) => {
            onAuthStateChange(session?.user || null);
        });
    }
}
