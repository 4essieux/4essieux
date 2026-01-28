// src/db.js - Local Persistence Layer using IndexedDB
// Handles offline storage of fleet data, tasks, and tacho files

const DB_NAME = '4essieux_db';
const DB_VERSION = 1;
const STORES = {
    STATE: 'state',
    OFFLINE_QUEUE: 'offline_queue' // For background sync
};

class OfflineDB {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORES.STATE)) {
                    db.createObjectStore(STORES.STATE);
                }
                if (!db.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
                    db.createObjectStore(STORES.OFFLINE_QUEUE, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async saveState(state) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.STATE], 'readwrite');
            const store = transaction.objectStore(STORES.STATE);

            // We store the whole state under a single key 'current'
            // In a larger app, we would split by collection
            const request = store.put(state, 'current');

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadState() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.STATE], 'readonly');
            const store = transaction.objectStore(STORES.STATE);
            const request = store.get('current');

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async addToQueue(action, table, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.OFFLINE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.OFFLINE_QUEUE);
            const entry = {
                action, // 'INSERT', 'UPDATE', 'DELETE'
                table,
                data,
                timestamp: Date.now()
            };
            const request = store.add(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getQueue() {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.OFFLINE_QUEUE], 'readonly');
            const store = transaction.objectStore(STORES.OFFLINE_QUEUE);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async clearQueueItem(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORES.OFFLINE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.OFFLINE_QUEUE);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

export const db = new OfflineDB();
