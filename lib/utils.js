class TokenCache {
    constructor() {
        this.token = null;
        this.expiresAt = null;
    }

    setToken(token, expiresIn) {
        this.token = token;
        // Set expiration 5 minutes before actual expiry to be safe
        this.expiresAt = Date.now() + (expiresIn - 300) * 1000;
    }

    getToken() {
        if (!this.token || !this.expiresAt || Date.now() >= this.expiresAt) {
            return null;
        }
        return this.token;
    }

    isValid() {
        return this.token && this.expiresAt && Date.now() < this.expiresAt;
    }

    clear() {
        this.token = null;
        this.expiresAt = null;
    }
}

class RateLimiter {
    constructor(maxRequests = 10, timeWindow = 1000) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }

    async throttle() {
        const now = Date.now();
        this.requests = this.requests.filter(time => time > now - this.timeWindow);
        
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = oldestRequest - (now - this.timeWindow);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.requests.push(now);
    }
}

async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1) throw error;

            const delay = initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

module.exports = {
    TokenCache,
    RateLimiter,
    retryWithBackoff
};
