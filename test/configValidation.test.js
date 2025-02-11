const fs = require('fs');
const Ajv = require('ajv');

test('Validate powerDeliveryState capability config', () => {
    const ajv = new Ajv();
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
    const powerDeliveryState = JSON.parse(fs.readFileSync('./.homeycompose/capabilities/powerDeliveryState.json', 'utf8'));
    const validate = ajv.compile(schema);
    const valid = validate(powerDeliveryState);
    expect(valid).toBe(true);
});
