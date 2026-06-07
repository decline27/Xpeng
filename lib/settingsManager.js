'use strict';

module.exports = {
  /**
   * Initializes the Homey settings if not already set.
   * @param {object} homey - The Homey instance.
   * @param {object} logger - Logger instance for logging information.
   */
  async initializeSettings(homey, logger) {
    try {
      const currentClientId = homey.settings.get('enode_client_id');
      const currentClientSecret = homey.settings.get('enode_client_secret');

      if (currentClientId === null) {
        logger.log('Initializing enode_client_id setting');
        await homey.settings.set('enode_client_id', '');
      }
      if (currentClientSecret === null) {
        logger.log('Initializing enode_client_secret setting');
        await homey.settings.set('enode_client_secret', '');
      }

      // Auto-reap duplicate Enode links on connect — default ON. Set to false to disable.
      if (homey.settings.get('auto_reap_enabled') === null) {
        logger.log('Initializing auto_reap_enabled setting (default true)');
        await homey.settings.set('auto_reap_enabled', true);
      }

      logger.log('Settings verification:', {
        clientIdInitialized: homey.settings.get('enode_client_id') !== null,
        clientSecretInitialized: homey.settings.get('enode_client_secret') !== null
      });
    } catch (error) {
      logger.error('Error initializing settings:', error);
      throw error;
    }
  }
};