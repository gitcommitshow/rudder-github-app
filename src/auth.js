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