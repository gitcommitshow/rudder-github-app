const loginAttempts = {};

export function isPasswordValid(username, password){
    // Check if user has exceeded max attempts
    if (loginAttempts[username] >= 3) {
        console.error("Account locked! Too many attempts.")
        return false
    }
    // Check credentials
    if (process.env.LOGIN_USER === username && process.env.LOGIN_PASSWORD === password) {
        // Successful login
        loginAttempts[username] = 0; // Reset attempts on successful login
        return true
    }
    loginAttempts[username] = (loginAttempts[username] || 0) + 1;
    return false
}

export function validateApiKey(req) {
    // Check if API_KEY environment variable is set
    if (!process.env.API_KEY) {
        console.error("API_KEY environment variable not configured");
        return false;
    }
    
    // Check for X-API-Key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (apiKeyHeader && apiKeyHeader === process.env.API_KEY) {
        return true;
    }
    
    // Check for Authorization: Bearer <key> header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        if (token === process.env.API_KEY) {
            return true;
        }
    }
    
    return false;
}