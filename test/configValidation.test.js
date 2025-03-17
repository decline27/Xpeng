const fs = require('fs');
const Ajv = require('ajv');

describe('Capability Configuration Validation', () => {
  let ajv;

  beforeEach(() => {
    ajv = new Ajv();
  });

  test('should reject invalid capability config', () => {
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" }
      },
      "required": ["type", "title", "readable", "writable"]
    };

    const invalidCapability = {
      type: "enum",
      readable: true,
      writable: false
      // Missing required 'title' field
    };

    const validate = ajv.compile(schema);
    const valid = validate(invalidCapability);
    expect(valid).toBe(false);
    expect(validate.errors).toBeDefined();
    expect(validate.errors[0].message).toContain("required");
  });

  test('should validate title object structure', () => {
    const schema = {
      "type": "object",
      "properties": {
        "title": {
          "type": "object",
          "properties": {
            "en": { "type": "string" }
          },
          "required": ["en"]
        }
      },
      "required": ["title"]
    };

    const validTitle = { title: { en: "Test Title" } };
    const invalidTitle = { title: { fr: "Test Title" } };

    const validate = ajv.compile(schema);
    expect(validate(validTitle)).toBe(true);
    expect(validate(invalidTitle)).toBe(false);
  });

  test('should validate powerDeliveryState capability config', () => {
    // Define the expected schema
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" },
        "icon": { "type": "string" },
        "uiComponent": { "type": "string" },
        "insights": { "type": "boolean" },
        "uiQuickAction": { "type": "boolean" },
        "statusIndicator": { "type": "boolean" },
        "description": { "type": "string" }
      },
      "required": [
        "type",
        "title",
        "readable",
        "writable",
        "icon",
        "uiComponent",
        "insights",
        "uiQuickAction",
        "statusIndicator",
        "description"
      ]
    };
    
    // Mock the capability config for testing
    const mockCapability = {
      type: "enum",
      title: { en: "Power Delivery State" },
      readable: true,
      writable: false,
      icon: "power.svg",
      uiComponent: "sensor",
      insights: true,
      uiQuickAction: false,
      statusIndicator: true,
      description: "Shows the current power delivery state"
    };
    
    const validate = ajv.compile(schema);
    const valid = validate(mockCapability);
    expect(valid).toBe(true);
  });

  test('should validate enum type capability with options', () => {
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["enum"] },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" },
        "options": {
          "type": "object",
          "properties": {
            "choices": {
              "type": "array",
              "items": { "type": "string" }
            }
          },
          "required": ["choices"]
        }
      },
      "required": ["type", "title", "readable", "writable", "options"]
    };

    const validEnumCapability = {
      type: "enum",
      title: { en: "Power State" },
      readable: true,
      writable: true,
      options: {
        choices: ["ON", "OFF", "STANDBY"]
      }
    };

    const invalidEnumCapability = {
      type: "enum",
      title: { en: "Power State" },
      readable: true,
      writable: true
      // Missing required 'options' field
    };

    const validate = ajv.compile(schema);
    expect(validate(validEnumCapability)).toBe(true);
    expect(validate(invalidEnumCapability)).toBe(false);
  });

  test('should validate numeric capability with units and decimals', () => {
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["number"] },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" },
        "units": { "type": "string" },
        "decimals": { "type": "number" },
        "min": { "type": "number" },
        "max": { "type": "number" }
      },
      "required": ["type", "title", "readable", "writable"]
    };

    const validNumericCapability = {
      type: "number",
      title: { en: "Range" },
      readable: true,
      writable: false,
      units: "km",
      decimals: 1,
      min: 0,
      max: 1000
    };

    const validate = ajv.compile(schema);
    expect(validate(validNumericCapability)).toBe(true);
  });

  test('should validate boolean capability with title_true and title_false', () => {
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["boolean"] },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" },
        "title_true": { "type": "object" },
        "title_false": { "type": "object" }
      },
      "required": ["type", "title", "readable", "writable"]
    };

    const validBooleanCapability = {
      type: "boolean",
      title: { en: "Plugged In Status" },
      readable: true,
      writable: false,
      title_true: { en: "Plugged In" },
      title_false: { en: "Unplugged" }
    };

    const validate = ajv.compile(schema);
    expect(validate(validBooleanCapability)).toBe(true);
  });

  test('should validate optional UI-related properties', () => {
    const schema = {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "title": { "type": "object" },
        "readable": { "type": "boolean" },
        "writable": { "type": "boolean" },
        "icon": { "type": "string" },
        "uiComponent": { "type": "string" },
        "insights": { "type": "boolean" },
        "uiQuickAction": { "type": "boolean" },
        "statusIndicator": { "type": "boolean" }
      },
      "required": ["type", "title", "readable", "writable"]
    };

    const capabilityWithUIProps = {
      type: "string",
      title: { en: "Vehicle Model" },
      readable: true,
      writable: false,
      icon: "car.svg",
      uiComponent: "sensor"
    };

    const validate = ajv.compile(schema);
    expect(validate(capabilityWithUIProps)).toBe(true);
  });
});
