// ===============================================
// CRYPTO UTILITIES
// V.V.S Rotselaar
// Wachtwoord encryptie voor account aanvragen
// ===============================================

// Eenvoudige encryptie met AES-GCM voor wachtwoord opslag tijdens pending status
// Deze sleutel moet ook in admin.js gebruikt worden voor decryptie

const ENCRYPTION_KEY = 'vvs-rotselaar-2024-secure-key-32b'; // 32 bytes voor AES-256

// Convert string to Uint8Array
function stringToUint8Array(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

// Convert Uint8Array to hex string
function uint8ArrayToHex(arr) {
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Convert hex string to Uint8Array
function hexToUint8Array(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

// Derive encryption key from passphrase
async function deriveKey(passphrase) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode('vvs-rotselaar-salt'),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Encrypt password
export async function encryptPassword(password) {
    try {
        const key = await deriveKey(ENCRYPTION_KEY);
        const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV for AES-GCM
        
        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            stringToUint8Array(password)
        );
        
        // Combine IV and encrypted data
        const encryptedArray = new Uint8Array(encrypted);
        const combined = new Uint8Array(iv.length + encryptedArray.length);
        combined.set(iv, 0);
        combined.set(encryptedArray, iv.length);
        
        // Return as hex string
        return uint8ArrayToHex(combined);
        
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Wachtwoord encryptie mislukt');
    }
}

// Decrypt password
export async function decryptPassword(encryptedHex) {
    try {
        const key = await deriveKey(ENCRYPTION_KEY);
        const combined = hexToUint8Array(encryptedHex);
        
        // Extract IV and encrypted data
        const iv = combined.slice(0, 12);
        const encrypted = combined.slice(12);
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            key,
            encrypted
        );
        
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
        
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Wachtwoord decryptie mislukt');
    }
}
