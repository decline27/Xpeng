'use strict';

const Homey = require('homey');

module.exports = class XPengApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('XPeng Car Manager is running...');

    // Log current settings
    const currentClientId = this.homey.settings.get('enode_client_id');
    const currentClientSecret = this.homey.settings.get('enode_client_secret');
    
    this.log('Current settings status:', {
      hasClientId: !!currentClientId,
      hasClientSecret: !!currentClientSecret
    });

    // Initialize or update settings
    try {
      // Only set if not already set
      if (currentClientId === null || currentClientId === undefined) {
        this.log('Initializing enode_client_id setting');
        await this.homey.settings.set('enode_client_id', '');
      }
      
      if (currentClientSecret === null || currentClientSecret === undefined) {
        this.log('Initializing enode_client_secret setting');
        await this.homey.settings.set('enode_client_secret', '');
      }

      // Verify settings after initialization
      const verifyClientId = this.homey.settings.get('enode_client_id');
      const verifyClientSecret = this.homey.settings.get('enode_client_secret');
      
      this.log('Settings verification:', {
        clientIdInitialized: verifyClientId !== null && verifyClientId !== undefined,
        clientSecretInitialized: verifyClientSecret !== null && verifyClientSecret !== undefined
      });
    } catch (error) {
      this.error('Error initializing settings:', error);
    }
  }
};
