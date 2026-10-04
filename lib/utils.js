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

    /**
     * Wait until a request slot is free. Slots are reserved synchronously, so concurrent
     * callers queue up instead of all waking at the same moment.
     */
    async throttle() {
        const now = Date.now();
        this.requests = this.requests.filter(time => time > now - this.timeWindow);

        let start = now;
        if (this.requests.length >= this.maxRequests) {
            start = this.requests[this.requests.length - this.maxRequests] + this.timeWindow;
        }
        this.requests.push(start);

        const waitTime = start - now;
        if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
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
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.cleanup();
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

    /**
     * Remove expired entries; if the cache is still full, evict the oldest down to 80%.
     */
    cleanup() {
        if (!this.cache) return;
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }

        if (this.cache.size >= this.maxSize) {
            const target = Math.floor(this.maxSize * 0.8);
            const oldestFirst = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
            for (const [key] of oldestFirst) {
                if (this.cache.size <= target) break;
                this.cache.delete(key);
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

/**
 * Error for a non-2xx HTTP response. Keeps the status so callers can branch on it.
 */
class HttpError extends Error {
    /**
     * @param {number} status - HTTP status code
     * @param {string} url - request URL
     * @param {string} body - response body text
     * @param {number|null} retryAfterMs - parsed Retry-After header, if any
     */
    constructor(status, url, body, retryAfterMs = null) {
        super(`HTTP error! status: ${status}, url: ${url}, body: ${body}`);
        this.name = 'HttpError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * Parse a Retry-After header (seconds or HTTP date) into milliseconds.
 * @param {string|null} value
 * @returns {number|null}
 */
function parseRetryAfter(value) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Retry an async operation with exponential backoff.
 * @param {Function} operation - async function to run
 * @param {number} [maxRetries=3] - total attempts
 * @param {number} [initialDelay=1000] - first backoff delay in ms
 * @param {Function} [shouldRetry] - (error) => boolean; errors it rejects are thrown at once
 * @param {Function} [getDelay] - (error, attempt) => ms|null; overrides the backoff delay
 * @returns {Promise<*>}
 */
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000, shouldRetry = () => true, getDelay = null) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries - 1 || !shouldRetry(error)) throw error;

            const override = getDelay ? getDelay(error, attempt) : null;
            const delay = override != null ? override : initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

module.exports = {
    TokenCache,
    RateLimiter,
    RequestCache,
    HttpError,
    parseRetryAfter,
    retryWithBackoff
};
