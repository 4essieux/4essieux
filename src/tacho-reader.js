// tacho-reader.js - Chronotachygraph File Reader Module
// Integrates with tachoparser WASM for reading .ddd files

import { tachoAnalyzer } from './tacho-analyzer.js';

/**
 * TachoReader Class
 * Handles reading and parsing of tachograph files (.ddd)
 */
class TachoReader {
    constructor() {
        this.wasmReady = false;
        this.wasmInstance = null;
        this.initWasm();
    }

    /**
     * Initialize WASM module
     */
    async initWasm() {
        try {
            // Check if WASM file exists
            const wasmPath = 'tachoparser.wasm';

            // Load the WASM Go runtime
            const go = new Go();
            const result = await WebAssembly.instantiateStreaming(
                fetch(wasmPath),
                go.importObject
            );

            // Run the WASM module
            go.run(result.instance);

            this.wasmReady = true;
            this.wasmInstance = result.instance;
            console.log('✅ TachoParser WASM initialized successfully');

            return true;
        } catch (error) {
            console.warn('⚠️ WASM not available, using fallback parser:', error);
            this.wasmReady = false;
            return false;
        }
    }

    /**
     * Read and parse a tachograph file
     * @param {File} file - The .ddd file to parse
     * @param {boolean} isCard - true for driver card, false for VU data
     * @returns {Promise<Object>} Parsed tachograph data
     */
    async parseFile(file, isCard = false) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    let parsedData;
                    let analyzed = null;

                    if (this.wasmReady && typeof window.parseTachoData === 'function') {
                        // Use WASM parser
                        const result = window.parseTachoData(uint8Array, isCard);

                        if (typeof result === 'string' && result.startsWith('Error:')) {
                            throw new Error(result);
                        }

                        parsedData = typeof result === 'string' ? JSON.parse(result) : result;

                        // Analyze the parsed data if it's a driver card
                        if (isCard && parsedData && !parsedData._fallback) {
                            try {
                                analyzed = tachoAnalyzer.generateReport(parsedData);
                                console.log('📊 Analyse complète générée:', analyzed);
                            } catch (analyzeError) {
                                console.warn('⚠️ Erreur lors de l\'analyse:', analyzeError);
                            }
                        }
                    } else {
                        // Fallback: Basic file info extraction
                        parsedData = this.fallbackParser(uint8Array, file.name, isCard);
                    }

                    resolve({
                        success: true,
                        data: parsedData,
                        analyzed: analyzed, // Données analysées (nom, infractions, etc.)
                        fileName: file.name,
                        fileSize: file.size,
                        fileType: isCard ? 'Driver Card' : 'Vehicle Unit',
                        parsedAt: new Date().toISOString()
                    });

                } catch (error) {
                    reject({
                        success: false,
                        error: error.message,
                        fileName: file.name
                    });
                }
            };

            reader.onerror = () => {
                reject({
                    success: false,
                    error: 'Failed to read file',
                    fileName: file.name
                });
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Fallback parser when WASM is not available
     * Extracts basic information from the file
     */
    fallbackParser(data, fileName, isCard) {
        // Basic extraction without full parsing
        return {
            _fallback: true,
            fileName: fileName,
            fileSize: data.length,
            fileType: isCard ? 'card' : 'vu',
            rawDataPreview: Array.from(data.slice(0, 100)),
            message: 'WASM parser not available. Showing basic file info only.',
            recommendation: 'For full parsing, ensure tachoparser.wasm is in the public folder.'
        };
    }

    /**
     * Extract driver activities from parsed data
     */
    extractActivities(parsedData) {
        if (!parsedData || parsedData._fallback) {
            return [];
        }

        try {
            // Navigate the parsed structure to find activities
            // Structure varies between Card and VU data
            const activities = [];

            // For driver card data
            if (parsedData.CardActivitiesDailyData) {
                const dailyData = parsedData.CardActivitiesDailyData;
                // Extract daily activities
                // This is a simplified extraction - full implementation depends on data structure
            }

            // For VU data
            if (parsedData.VuActivitiesData) {
                const vuActivities = parsedData.VuActivitiesData;
                // Extract VU activities
            }

            return activities;
        } catch (error) {
            console.error('Error extracting activities:', error);
            return [];
        }
    }

    /**
     * Extract driver information from card data
     */
    extractDriverInfo(parsedData) {
        if (!parsedData || parsedData._fallback) {
            return null;
        }

        try {
            return {
                name: parsedData.CardIdentification?.CardHolderName || 'Unknown',
                cardNumber: parsedData.CardIdentification?.CardNumber || 'N/A',
                issueDate: parsedData.CardIdentification?.CardIssuingMemberState || 'N/A',
                expiryDate: parsedData.CardIdentification?.CardExpiryDate || 'N/A'
            };
        } catch (error) {
            console.error('Error extracting driver info:', error);
            return null;
        }
    }

    /**
     * Validate file format
     */
    isValidTachoFile(file) {
        const validExtensions = ['.ddd', '.tgd', '.c1b', '.v1b'];
        const fileName = file.name.toLowerCase();
        return validExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * Get file type from extension
     */
    detectFileType(fileName) {
        const lower = fileName.toLowerCase();
        if (lower.endsWith('.c1b') || lower.includes('card')) {
            return 'card';
        }
        if (lower.endsWith('.v1b') || lower.includes('vu')) {
            return 'vu';
        }
        // Default to VU if uncertain
        return 'vu';
    }
}

// Export singleton instance
export const tachoReader = new TachoReader();

/**
 * Utility function to format tachograph data for display
 */
export function formatTachoDataForDisplay(parsedResult) {
    if (!parsedResult.success) {
        return {
            error: true,
            message: parsedResult.error
        };
    }

    const { data, fileName, fileType, parsedAt } = parsedResult;

    if (data._fallback) {
        return {
            fallback: true,
            fileName,
            fileType,
            message: data.message,
            recommendation: data.recommendation
        };
    }

    // Format for display
    return {
        fileName,
        fileType,
        parsedAt,
        driverInfo: tachoReader.extractDriverInfo(data),
        activities: tachoReader.extractActivities(data),
        rawData: data
    };
}
