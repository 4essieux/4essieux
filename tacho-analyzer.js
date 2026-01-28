// tacho-analyzer.js - Analyseur de données chronotachygraphe
// Extrait les informations importantes et détecte les infractions RSE

/**
 * Règlement Social Européen (RSE) - Limites (Règlement 561/2006)
 */
const RSE_LIMITS = {
    DRIVING_CONTINUOUS_MAX: 4.5 * 60, // 4h30
    DRIVING_DAILY_MAX: 9 * 60,        // 9h (10h max 2x/semaine)
    DRIVING_WEEKLY_MAX: 56 * 60,      // 56h
    DRIVING_BIWEEKLY_MAX: 90 * 60,    // 90h sur 2 semaines

    BREAK_MIN: 45,                   // 45 min
    BREAK_SPLIT_1: 15,               // 1ère partie pause fractionnée
    BREAK_SPLIT_2: 30,               // 2ème partie pause fractionnée

    REST_DAILY_NORMAL: 11 * 60,      // 11h
    REST_DAILY_REDUCED: 9 * 60,      // 9h (3x max entre deux repos hebdo)
    REST_WEEK_NORMAL: 45 * 60,
    REST_WEEK_REDUCED: 24 * 60
};

/**
 * Code du Travail (Spécificités Transport Routier France)
 */
const LABOR_LIMITS = {
    AMPLITUDE_MAX: 12 * 60,          // 12h standard (peut aller à 15h selon repos réduit)
    SERVICE_DAILY_MAX: 12 * 60,       // Temps de service (Conduite + Travail)
    NIGHT_WORK_SHIFT_MAX: 10 * 60,    // Si travail entre 0h et 5h, service max 10h
    NIGHT_ZONE_START: 0,              // 00h00
    NIGHT_ZONE_END: 5 * 60            // 05h00 (Zone de restriction pour durée de service)
};

/**
 * Types d'activités (Mapping WASM)
 */
const ACTIVITY_CODES = {
    0: 'REPOS',
    1: 'DISPONIBILITE',
    2: 'TRAVAIL',
    3: 'CONDUITE'
};

/**
 * Classe principale d'analyse
 */
export class TachoAnalyzer {

    /**
     * Extrait les informations du conducteur depuis une carte
     */
    extractDriverInfo(cardData) {
        try {
            const info = {
                nom: null,
                prenom: null,
                numeroPermis: null,
                numeroCarte: null,
                dateNaissance: null,
                dateDelivrance: null,
                dateExpiration: null,
                paysEmission: null,
                raw: cardData
            };

            // Chercher dans CardIdentification (Gen 1 ou Gen 2)
            // Note: Le module WASM utilise des noms en snake_case basés sur les tags JSON du code Go
            const identification = cardData.card_identification_and_driver_card_holder_identification_1 ||
                cardData.card_identification_and_driver_card_holder_identification_2;

            if (identification) {
                const id = identification.card_identification;
                const holder = identification.card_holder_name || identification.driver_card_holder_identification?.card_holder_name;

                if (holder) {
                    info.nom = this.cleanString(holder.holder_surname);
                    info.prenom = this.cleanString(holder.holder_first_names);
                }

                if (id) {
                    info.numeroCarte = id.card_number;
                    info.dateDelivrance = this.parseDate(id.card_issue_date);
                    info.dateExpiration = this.parseDate(id.card_expiry_date);
                }

                if (identification.driver_card_holder_identification) {
                    info.dateNaissance = this.parseDate(identification.driver_card_holder_identification.card_holder_birth_date);
                }
            }

            // Permis de conduire
            const license = cardData.card_driving_licence_information_1 || cardData.card_driving_licence_information_2;
            if (license) {
                info.numeroPermis = license.driving_licence_number;
            }

            return info;
        } catch (error) {
            console.error('Erreur extraction info conducteur:', error);
            return null;
        }
    }

    /**
     * Extrait les activités journalières
     */
    extractDailyActivities(cardData) {
        try {
            const activities = [];

            // Les activités sont dans card_driver_activity_1 ou _2.decoded_activity_daily_records
            const activityBlock = cardData.card_driver_activity_1 || cardData.card_driver_activity_2;

            if (activityBlock && Array.isArray(activityBlock.decoded_activity_daily_records)) {
                activityBlock.decoded_activity_daily_records.forEach(dayRecord => {
                    const day = this.parseDayRecord(dayRecord);
                    if (day) {
                        activities.push(day);
                    }
                });
            }

            return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (error) {
            console.error('Erreur extraction activités:', error);
            return [];
        }
    }

    /**
     * Parse un enregistrement journalier de la carte
     */
    parseDayRecord(record) {
        try {
            const day = {
                date: this.parseDate(record.activity_record_date),
                activities: [],
                totalDriving: 0,
                totalWork: 0,
                totalRest: 0,
                totalAvailable: 0,
                infractions: []
            };

            if (!day.date) return null;

            let firstMinute = 1440;
            let lastMinute = 0;

            if (Array.isArray(record.activity_change_info)) {
                record.activity_change_info.forEach((change, index) => {
                    const nextChange = record.activity_change_info[index + 1];

                    const activity = {
                        type: this.getActivityType(change.work_type),
                        debut: change.minutes, // minutes depuis minuit
                        fin: nextChange ? nextChange.minutes : 1440, // 1440 = 24h * 60
                        duree: 0
                    };

                    activity.duree = activity.fin - activity.debut;
                    if (activity.duree < 0) activity.duree = 0;

                    // Déterminer l'amplitude réelle pour calculer le repos journalier restant
                    if (activity.type !== 'REPOS') {
                        if (activity.debut < firstMinute) firstMinute = activity.debut;
                        if (activity.fin > lastMinute) lastMinute = activity.fin;
                    }

                    // Accumuler les totaux
                    switch (activity.type) {
                        case 'CONDUITE':
                            day.totalDriving += activity.duree;
                            break;
                        case 'TRAVAIL':
                            day.totalWork += activity.duree;
                            break;
                        case 'REPOS':
                            day.totalRest += activity.duree;
                            break;
                        case 'DISPONIBILITE':
                            day.totalAvailable += activity.duree;
                            break;
                    }

                    day.activities.push(activity);
                });
            }

            // Calcul intelligent du repos journalier : 
            // Dans le transport, le repos journalier est ce qui reste dans un bloc de 24h après le service.
            // Si l'amplitude est de 13h, le repos est de 11h.
            const amplitude = lastMinute - firstMinute;
            if (amplitude > 0) {
                // Le repos effectif rattaché à cette journée de service est de 24h - amplitude
                day.totalRest = Math.max(0, 1440 - amplitude);
            }

            // Filtrer les journées sans activités réelles
            if (day.activities.length === 0 && day.totalDriving === 0) {
                return null;
            }

            return day;
        } catch (error) {
            console.error('Erreur parse journée:', error);
            return null;
        }
    }

    /**
     * Détecte les infractions RSE et Code du Travail
     */
    detectInfractions(activities) {
        const infractions = [];

        activities.forEach((day, dayIndex) => {
            const serviceTime = day.totalDriving + day.totalWork;
            const hasNightWork = day.activities.some(act =>
                (act.type === 'CONDUITE' || act.type === 'TRAVAIL') &&
                ((act.debut >= LABOR_LIMITS.NIGHT_ZONE_START && act.debut < LABOR_LIMITS.NIGHT_ZONE_END) ||
                    (act.fin > LABOR_LIMITS.NIGHT_ZONE_START && act.fin <= LABOR_LIMITS.NIGHT_ZONE_END))
            );

            // 1. Conduite journaliere (RSE)
            if (day.totalDriving > RSE_LIMITS.DRIVING_DAILY_MAX) {
                // On log seulement si ça dépasse 10h car on ne sait pas si c'est un des 2 joker/semaine
                if (day.totalDriving > 10 * 60) {
                    infractions.push({
                        date: day.date,
                        type: 'CONDUITE_JOURNALIERE_CRITIQUE',
                        gravite: 'CRITIQUE',
                        description: `Conduite journalière excessive: ${this.formatDuration(day.totalDriving)} (max absolu 10h)`,
                        valeur: day.totalDriving,
                        limite: 600
                    });
                } else {
                    infractions.push({
                        date: day.date,
                        type: 'CONDUITE_JOURNALIERE_ALERTE',
                        gravite: 'INFO',
                        description: `Conduite > 9h (${this.formatDuration(day.totalDriving)}). Vérifiez s'il reste des jokers (2/semaine).`,
                        valeur: day.totalDriving,
                        limite: 540
                    });
                }
            }

            // 2. Conduite continue et Pauses fractionnées (RSE)
            let drivingBlock = 0;
            let pauseAccumulated = 0;
            let hasFirstPart = false;

            day.activities.forEach(act => {
                if (act.type === 'CONDUITE') {
                    drivingBlock += act.duree;
                    if (drivingBlock > RSE_LIMITS.DRIVING_CONTINUOUS_MAX) {
                        infractions.push({
                            date: day.date,
                            type: 'CONDUITE_CONTINUE_DEPASSEE',
                            gravite: 'MAJEURE',
                            description: `Conduite continue sans pause suffisante: ${this.formatDuration(drivingBlock)} (max 4h30)`,
                            valeur: drivingBlock,
                            limite: 270
                        });
                        drivingBlock = 0; // Reset après infraction pour détecter la suivante
                    }
                } else if (act.type === 'REPOS') {
                    if (act.duree >= 45) {
                        drivingBlock = 0;
                        hasFirstPart = false;
                    } else if (act.duree >= 30 && hasFirstPart) {
                        drivingBlock = 0;
                        hasFirstPart = false;
                    } else if (act.duree >= 15 && !hasFirstPart) {
                        hasFirstPart = true;
                    }
                }
            });

            // 3. Temps de Service et Travail de Nuit (Code du Travail)
            if (hasNightWork && serviceTime > LABOR_LIMITS.NIGHT_WORK_SHIFT_MAX) {
                infractions.push({
                    date: day.date,
                    type: 'TRAVAIL_NUIT_DEPASSE',
                    gravite: 'MAJEURE',
                    description: `Temps de service de nuit excédé: ${this.formatDuration(serviceTime)} (max 10h car travail entre 0h et 5h)`,
                    valeur: serviceTime,
                    limite: 600
                });
            } else if (serviceTime > LABOR_LIMITS.SERVICE_DAILY_MAX) {
                infractions.push({
                    date: day.date,
                    type: 'TEMPS_SERVICE_EXCESSIF',
                    gravite: 'MAJEURE',
                    description: `Temps de service quotidien excessif: ${this.formatDuration(serviceTime)} (max 12h)`,
                    valeur: serviceTime,
                    limite: 720
                });
            }

            // 4. Amplitude (Code du Travail)
            if (day.activities.length > 0) {
                const firstAct = day.activities[0];
                const lastAct = day.activities[day.activities.length - 1];
                const amplitude = lastAct.fin - firstAct.debut;
                if (amplitude > 15 * 60) { // 15h est le max absolu avec repos réduit
                    infractions.push({
                        date: day.date,
                        type: 'AMPLITUDE_EXCESSIVE',
                        gravite: 'CRITIQUE',
                        description: `Amplitude journalière excessive: ${this.formatDuration(amplitude)} (max 15h)`,
                        valeur: amplitude,
                        limite: 900
                    });
                } else if (amplitude > 12 * 60) {
                    infractions.push({
                        date: day.date,
                        type: 'AMPLITUDE_ALERTE',
                        gravite: 'WARNING',
                        description: `Amplitude élevée: ${this.formatDuration(amplitude)} (standard 12h, max 15h avec repos réduit)`,
                        valeur: amplitude,
                        limite: 720
                    });
                }
            }

            // 5. Repos journalier (RSE)
            if (day.totalRest < RSE_LIMITS.REST_DAILY_REDUCED) {
                infractions.push({
                    date: day.date,
                    type: 'REPOS_JOURNALIER_INSUFFISANT',
                    gravite: 'CRITIQUE',
                    description: `Repos journalier insuffisant: ${this.formatDuration(day.totalRest)} (min absolu 9h)`,
                    valeur: day.totalRest,
                    limite: 540
                });
            }
        });

        return infractions;
    }

    /**
     * Génère un rapport complet
     */
    generateReport(cardData) {
        const driverInfo = this.extractDriverInfo(cardData);
        const activities = this.extractDailyActivities(cardData);
        const infractions = this.detectInfractions(activities);

        // Statistiques globales
        const stats = {
            totalJours: activities.length,
            totalConduiteMinutes: activities.reduce((sum, d) => sum + d.totalDriving, 0),
            totalTravailMinutes: activities.reduce((sum, d) => sum + d.totalWork, 0),
            totalReposMinutes: activities.reduce((sum, d) => sum + d.totalRest, 0),
            totalAvailableMinutes: activities.reduce((sum, d) => sum + (d.totalAvailable || 0), 0),
            moyenneConduiteJour: 0,
            joursAvecInfractions: new Set(infractions.map(i => i.date)).size,
            totalInfractions: infractions.length
        };

        if (activities.length > 0) {
            stats.moyenneConduiteJour = stats.totalConduiteMinutes / activities.length;
        }

        return {
            conducteur: driverInfo,
            activites: activities,
            infractions: infractions,
            statistiques: stats,
            dateAnalyse: new Date().toISOString()
        };
    }

    // === Fonctions utilitaires ===

    cleanString(str) {
        if (!str) return '';
        return str.toString().trim().replace(/\0/g, '');
    }

    parseDate(dateStr) {
        try {
            if (!dateStr) return null;
            // Gère le format ISO retourné par time.Time en Go
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return null;
            return date.toISOString().split('T')[0];
        } catch (error) {
            return null;
        }
    }

    formatMinutesToTime(minutes) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    formatDuration(minutes) {
        if (minutes === undefined || minutes === null || isNaN(minutes)) return '0h00';
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours}h${String(mins).padStart(2, '0')}`;
    }

    getActivityType(code) {
        // Mapping basé sur le code Go:
        // 0: break/rest, 1: availability, 2: work/other task, 3: driving
        return ACTIVITY_CODES[code] || 'INCONNU';
    }
}

// Export singleton
export const tachoAnalyzer = new TachoAnalyzer();
