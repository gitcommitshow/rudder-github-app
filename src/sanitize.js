/**
 * Sanitizes input by removing any HTML tags.
 * @param {string} input - The user-provided input string.
 * @returns {string} - The sanitized string with HTML tags removed.
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return input;
    }
    if(input.length > 30){
        input = input.substring(0, 30);
    }
    return input.replace(/<\/?[^>]+(>|$)/g, "");
}