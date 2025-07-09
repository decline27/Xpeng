# Xpeng Widget Optimization Plan

This document outlines the implementation plan for optimizing the Xpeng dashboard widget. Each task includes implementation steps and code examples.

## Tasks

### 1. Enhance Loading States
- [ ] Add CSS classes for loading states
- [ ] Create loading indicator functions
- [ ] Apply loading indicators to each data section
- [ ] Ensure smooth transitions between loading and loaded states

```javascript
// CSS to add to index.html
.loading {
  opacity: 0.6;
  position: relative;
}

.loading::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border: 2px solid rgba(0,0,0,0.2);
  border-top-color: #007aff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// JavaScript functions to add
function showLoading(elementId) {
  const element = document.getElementById(elementId);
  if (element) element.classList.add('loading');
}

function hideLoading(elementId) {
  const element = document.getElementById(elementId);
  if (element) element.classList.remove('loading');
}
```

### 2. Optimize Caching Strategy
- [ ] Modify `api.js` to implement differentiated TTLs
- [ ] Add separate caching for static and dynamic data
- [ ] Implement cache invalidation based on data type

```javascript
// Updates to api.js caching configuration
const CACHE = {
  staticData: null,  // Brand, model, VIN, battery capacity
  dynamicData: null, // Battery level, range, charging status
  locationData: null, // Location and address information
  staticTimestamp: 0,
  dynamicTimestamp: 0,
  locationTimestamp: 0
};

// Different TTLs for different data types
const STATIC_TTL = 24 * 60 * 60 * 1000; // 24 hours for static data
const DYNAMIC_TTL = 7 * 60 * 1000;      // 7 minutes for dynamic data
const LOCATION_TTL = 30 * 60 * 1000;    // 30 minutes for location data

// Updated cache validation functions
function isStaticCacheValid() {
  return CACHE.staticData && (Date.now() - CACHE.staticTimestamp < STATIC_TTL);
}

function isDynamicCacheValid() {
  return CACHE.dynamicData && (Date.now() - CACHE.dynamicTimestamp < DYNAMIC_TTL);
}

function isLocationCacheValid() {
  return CACHE.locationData && (Date.now() - CACHE.locationTimestamp < LOCATION_TTL);
}
```

### 3. Optimize Address Lookup
- [ ] Implement address caching in `api.js`
- [ ] Add asynchronous loading for address data
- [ ] Create a separate address cache with longer TTL

```javascript
// Address cache implementation
const ADDRESS_CACHE = {};
const ADDRESS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function getAddressFromCoordinates(lat, lon) {
  const cacheKey = `${lat},${lon}`;
  
  // Check if we have a cached address
  if (ADDRESS_CACHE[cacheKey] && 
      (Date.now() - ADDRESS_CACHE[cacheKey].timestamp < ADDRESS_TTL)) {
    console.log('Using cached address for coordinates:', { lat, lon });
    return ADDRESS_CACHE[cacheKey].address;
  }
  
  try {
    // Existing implementation...
    
    // Cache the result
    if (parts.length > 0) {
      ADDRESS_CACHE[cacheKey] = {
        address: parts.join(', '),
        timestamp: Date.now()
      };
    }
    
    return parts.join(', ');
  } catch (error) {
    console.error('Error getting address:', error);
    return null;
  }
}
```

### 4. Optimize DOM Updates
- [ ] Modify `updateVehicleData` function in `index.html`
- [ ] Implement batch DOM updates using DocumentFragment
- [ ] Add debouncing for frequent updates

```javascript
// Optimized DOM update function
function updateVehicleData() {
  // Show loading state for all elements
  const elements = ['battery-percentage', 'range', 'charging-status', 
                    'plugged-status', 'last-seen', 'charging-power', 'address'];
  elements.forEach(id => showLoading(id));
  
  Homey.api('GET', '/vehicle-data')
    .then(data => {
      if (data.error) {
        showError(data.error);
        return;
      }
      hideError();

      // Create a document fragment for batch DOM updates
      const fragment = document.createDocumentFragment();
      const updates = {};
      
      // Prepare all updates
      if (data.batteryLevel) {
        const batteryLevel = parseFloat(data.batteryLevel) || 0;
        updates['battery-percentage'] = `${Math.round(batteryLevel)}%`;
        document.getElementById('battery-level-fill').style.width = `${batteryLevel}%`;
      }
      
      if (data.range) {
        updates['range'] = `${Math.round(parseFloat(data.range) || 0)} km`;
      }
      
      // Apply all updates at once
      Object.keys(updates).forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = updates[id];
          hideLoading(id);
        }
      });
      
      // Update charging buttons based on status
      const startChargingButton = document.getElementById('startCharging');
      const stopChargingButton = document.getElementById('stopCharging');
      const chargingActive = data.chargingStatus === 'charging' || data.chargingStatus === 'active';
      startChargingButton.disabled = chargingActive || !data.pluggedInStatus;
      stopChargingButton.disabled = !chargingActive;

      // Update location info asynchronously
      createLocationDisplay(data.location, data.address);
    })
    .catch(error => {
      showError(error.message || 'Failed to fetch vehicle data');
      elements.forEach(id => hideLoading(id));
    });
}
```

### 5. Implement Error Handling & Resilience
- [ ] Enhance error handling in `api.js`
- [ ] Add more detailed error messages
- [ ] Implement retry mechanism for transient errors

```javascript
// Enhanced error handling in api.js
async function getVehicleData({ homey }) {
  let retries = 3;
  while (retries > 0) {
    try {
      // Existing implementation...
      return finalData;
    } catch (error) {
      retries--;
      if (retries === 0 || error.message.includes('429')) {
        // Don't retry rate limit errors or if we're out of retries
        console.error('Error in getVehicleData:', error);
        return lastSuccessfulData || { 
          error: error.message,
          errorCode: error.code || 'UNKNOWN_ERROR'
        };
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

## Implementation Timeline

1. **Phase 1**: Implement loading states and DOM optimization
2. **Phase 2**: Enhance caching strategy with differentiated TTLs
3. **Phase 3**: Optimize address lookup and implement address caching
4. **Phase 4**: Enhance error handling and resilience
5. **Phase 5**: Testing and refinement

## Testing Strategy

- [ ] Test widget performance with slow network connections
- [ ] Verify caching behavior with different data types
- [ ] Test error scenarios and recovery
- [ ] Measure and compare loading times before and after optimization