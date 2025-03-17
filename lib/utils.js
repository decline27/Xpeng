class TokenCache {
    constructor() {
        this.token = null;
        this.expiresAt = null;
    }

    setToken(token, expiresIn) {
        this.token = token;
        // Set expiration 60 seconds before actual expiry - more reasonable buffer
        const bufferTimeSeconds = 60; 
        const expiryTimeMs = (expiresIn - bufferTimeSeconds) * 1000;
        this.expiresAt = Date.now() + expiryTimeMs;
    }

    getToken() {
        if (!this.token || !this.expiresAt || Date.now() >= this.expiresAt) {
            return null;
        }
        return this.token;
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

class RequestCache {
    constructor(maxSize = 1000, defaultTTL = 60000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
        
        // Create interval for cleanup and use unref to prevent it from keeping the process alive
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
        
        // Use unref() to allow the process to exit even if this interval is still active
        // This is especially important for testing environments
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    set(key, value, ttl = this.defaultTTL) {
        if (this.cache.size >= this.maxSize) {
            this.cleanup(true); // Force cleanup if at max size
        }

        this.cache.set(key, {
            data: value,
            timestamp: Date.now(),
            ttl
        });
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    cleanup(force = false) {
        const now = Date.now();
        // Only need to clean if we're at capacity or it's a forced cleanup
        if (force || this.cache.size >= this.maxSize) {
            // Create array of entries to allow sorting
            const entries = [...this.cache.entries()];
            
            // Sort by oldest first if we need to reduce size
            if (this.cache.size >= this.maxSize) {
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            }
            
            // Remove expired entries and oldest entries if above maxSize
            for (const [key, entry] of entries) {
                const isExpired = now - entry.timestamp > entry.ttl;
                const isOverCapacity = this.cache.size > this.maxSize * 0.8; // 80% threshold
                
                if (force || isExpired || (isOverCapacity && !force)) {
                    this.cache.delete(key);
                }
                
                // Stop if we're well below capacity and not doing forced cleanup
                if (!force && this.cache.size < this.maxSize * 0.8) break;
            }
        }
    }

    clear(key) {
        // If a key is provided, only clear that specific entry
        if (key) {
            this.cache.delete(key);
        } else {
            // Otherwise clear the entire cache
            this.cache.clear();
        }
    }

    destroy() {
        // Clear the interval first
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Clear all cache data
        this.clear();
        
        // Release references for garbage collection
        this.cache = null;
    }
    
    /**
     * Get cache statistics
     * @returns {Object} Statistics about the cache
     */
    getStats() {
        return {
            size: this.cache ? this.cache.size : 0,
            maxSize: this.maxSize,
            defaultTTL: this.defaultTTL,
            keys: this.cache ? Array.from(this.cache.keys()) : []
        };
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
    RequestCache,
    retryWithBackoff
};
