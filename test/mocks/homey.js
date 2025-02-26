'use strict';

// Mock Homey module for testing
module.exports = {
  Device: class MockDevice {
    constructor() {
      this.data = {};
      this.settings = {};
      this.capabilities = {};
      this.storeValues = {};
      this.triggerFlowCallbacks = {};
      this.deviceName = 'Test XPENG Car';
    }
    
    getCapabilityValue(capability) {
      return this.capabilities[capability];
    }
    
    setCapabilityValue(capability, value) {
      const oldValue = this.capabilities[capability];
      this.capabilities[capability] = value;
      
      // Trigger any registered capability listeners
      if (this.triggerFlowCallbacks[capability] && oldValue !== value) {
        this.triggerFlowCallbacks[capability](this, { oldValue, newValue: value });
      }
      
      return Promise.resolve();
    }
    
    setSettings(settings) {
      Object.assign(this.settings, settings);
      return Promise.resolve();
    }
    
    getSettings() {
      return this.settings;
    }
    
    getData() {
      return this.data;
    }
    
    getName() {
      return this.deviceName;
    }
    
    log() {}
    error() {}
    
    setUnavailable() {
      return Promise.resolve();
    }
    
    setAvailable() {
      return Promise.resolve();
    }
    
    hasCapability() {
      return true;
    }
    
    addCapability() {
      return Promise.resolve();
    }
    
    setStoreValue(key, value) {
      this.storeValues[key] = value;
      return Promise.resolve();
    }
    
    getStoreValue(key) {
      return this.storeValues[key];
    }
    
    // Register a capability listener for flow triggers
    registerCapabilityListener(capability, callback) {
      this.triggerFlowCallbacks[capability] = callback;
      return Promise.resolve();
    }

    // Simulate triggering a flow
    triggerFlow(flowId, tokens = {}, state = {}) {
      // In a test, we'd just return that this was called
      return Promise.resolve(true);
    }
  },
  
  Driver: class MockDriver {
    constructor() {
      this.triggers = {};
      this.flowCardActions = {};
      this.flowCardConditions = {};
    }
    
    log() {}
    error() {}
    
    getStoredCredentials() {
      return {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret'
      };
    }
    
    // For testing flow triggers
    registerFlowCardTrigger(triggerId) {
      this.triggers[triggerId] = {
        registerRunListener: (callback) => {
          this.triggers[triggerId].runListener = callback;
          return this.triggers[triggerId];
        },
        getArgument: () => {
          return { 
            registerAutocompleteListener: jest.fn()
          };
        }
      };
      return this.triggers[triggerId];
    }
    
    // For testing flow actions
    registerFlowCardAction(actionId) {
      this.flowCardActions[actionId] = {
        registerRunListener: (callback) => {
          this.flowCardActions[actionId].runListener = callback;
          return this.flowCardActions[actionId];
        },
        getArgument: () => {
          return { 
            registerAutocompleteListener: jest.fn()
          };
        }
      };
      return this.flowCardActions[actionId];
    }
    
    // For testing flow conditions
    registerFlowCardCondition(conditionId) {
      this.flowCardConditions[conditionId] = {
        registerRunListener: (callback) => {
          this.flowCardConditions[conditionId].runListener = callback;
          return this.flowCardConditions[conditionId];
        },
        getArgument: () => {
          return { 
            registerAutocompleteListener: jest.fn()
          };
        }
      };
      return this.flowCardConditions[conditionId];
    }
  },
  
  App: class MockApp {
    constructor() {
      this.settings = {
        get: jest.fn(),
        set: jest.fn()
      };
      this.homey = {
        settings: this.settings,
        api: {
          getDevices: jest.fn().mockResolvedValue([]),
          getDevice: jest.fn().mockResolvedValue(null)
        },
        flow: {
          getTriggerCard: (id) => ({
            trigger: jest.fn().mockResolvedValue(true)
          }),
          getActionCard: (id) => ({
            registerRunListener: jest.fn()
          }),
          getConditionCard: (id) => ({
            registerRunListener: jest.fn()
          })
        },
        notifications: {
          createNotification: jest.fn()
        },
        setTimeout: (fn, delay) => setTimeout(fn, delay),
        setInterval: (fn, delay) => setInterval(fn, delay),
        clearTimeout: (id) => clearTimeout(id),
        clearInterval: (id) => clearInterval(id)
      };
    }
    
    log() {}
    error() {}
  }
};