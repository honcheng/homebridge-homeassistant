var Service;
var Characteristic;
var communicationError;

function HomeAssistantClimate(log, data, client) {
  // device info

  this.domain = 'climate';
  this.data = data;
  this.entity_id = data.entity_id;
  this.uuid_base = data.entity_id;
  if (data.attributes && data.attributes.friendly_name) {
    this.name = data.attributes.friendly_name;
  } else {
    this.name = data.entity_id.split('.').pop().replace(/_/g, ' ');
  }
  if (data.attributes && data.attributes.homebridge_mfg) {
    this.mfg = String(data.attributes.homebridge_mfg);
  } else {
    this.mfg = 'Home Assistant';
  }
  if (data.attributes && data.attributes.homebridge_model) {
    this.model = String(data.attributes.homebridge_model);
  } else {
    this.model = 'Climate';
  }
  if (data.attributes && data.attributes.homebridge_serial) {
    this.serial = String(data.attributes.homebridge_serial);
  } else {
    this.serial = data.entity_id;
  }
  this.client = client;
  this.log = log;
}
HomeAssistantClimate.prototype = {
  onEvent: function (oldState, newState) {
    this.ThermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .setValue(newState.attributes.current_temperature || newState.attributes.temperature, null, 'internal');
    this.ThermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .setValue(newState.attributes.temperature, null, 'internal');
  },
  getCurrentTemp: function (callback) {
    this.client.fetchState(this.entity_id, function (data) {
      if (data) {
        callback(null, data.attributes.current_temperature);
      } else {
        callback(communicationError);
      }
    });
  },
  getTargetTemp: function (callback) {
    this.client.fetchState(this.entity_id, function (data) {
      if (data) {
        callback(null, data.attributes.temperature);
      } else {
        callback(communicationError);
      }
    });
  },
  setTargetTemp: function (value, callback, context) {
    if (context === 'internal') {
      callback();
      return;
    }

    var that = this;
    var serviceData = {};
    serviceData.entity_id = this.entity_id;
    serviceData.temperature = value;

    this.log(`Setting temperature on the '${this.name}' to ${serviceData.temperature}`);

    this.client.callService(this.domain, 'set_temperature', serviceData, function (data) {
      if (data) {
        that.log(`Successfully set temperature of '${that.name}'`);
        callback();
      } else {
        callback(communicationError);
      }
    });
  },
  getTargetHeatingCoolingState: function (callback) {
    this.log('fetching Current Heating Cooling state for: ' + this.name);

    this.client.fetchState(this.entity_id, function (data) {
      if (data && data.attributes && data.attributes.operation_mode) {
        var state;
        switch (data.attributes.operation_mode) {
          case 'auto':
            state = Characteristic.TargetHeatingCoolingState.AUTO;
            break;
          case 'cool':
            state = Characteristic.TargetHeatingCoolingState.COOL;
            break;
          case 'heat':
            state = Characteristic.TargetHeatingCoolingState.HEAT;
            break;
          case 'idle':
          default:
            state = Characteristic.TargetHeatingCoolingState.OFF;
            break;
        }
        callback(null, state);
      } else {
        callback(communicationError);
      }
    });
  },

  setTargetHeatingCoolingState: function (value, callback, context) {
    if (context === 'internal') {
      callback();
      return;
    }
    var serviceData = {};
    serviceData.entity_id = this.entity_id;

    var mode = '';
    switch (value) {
      case Characteristic.TargetHeatingCoolingState.AUTO:
        mode = 'auto';
        break;
      case Characteristic.TargetHeatingCoolingState.COOL:
        mode = 'cool';
        break;
      case Characteristic.TargetHeatingCoolingState.HEAT:
        mode = 'heat';
        break;
      case Characteristic.TargetHeatingCoolingState.OFF:
      default:
        mode = 'idle';
        break;
    }

    serviceData.operation_mode = mode;
    this.log(`Setting Current Heating Cooling state on the '${this.name}' to ${mode}`);

    var that = this;

    this.client.callService(this.domain, 'set_operation_mode', serviceData, function (data) {
      if (data) {
        that.log(`Successfully set current heating cooling state of '${that.name}'`);
        callback();
      } else {
        callback(communicationError);
      }
    });
  },

  getRotationSpeed(callback) {
    this.client.fetchState(this.entity_id, (data) => {
      if (data) {
        if (data.attributes.operation_mode === 'idle') {
          callback(null, 0);
        } else {
          switch (data.attributes.current_fan_mode) {
            case 'low':
              callback(null, 25);
              break;
            case 'mid':
              callback(null, 50);
              break;
            case 'high':
              callback(null, 75);
              break;
            case 'highest':
              callback(null, 100);
              break;
            default:
              callback(null, 0);
          }
        }
      } else {
        callback(communicationError);
      }
    });
  },
  setRotationSpeed(speed, callback, context) {
    if (context === 'internal') {
      callback();
      return;
    }

    const that = this;
    const serviceData = {};
    serviceData.entity_id = this.entity_id;

    if (speed <= 25) {
      serviceData.fan_mode = 'low';
    } else if (speed <= 50) {
      serviceData.fan_mode = 'mid';
    } else if (speed <= 75) {
      serviceData.fan_mode = 'high';
    } else if (speed <= 100) {
      serviceData.fan_mode = 'highest';
    }

    this.log(`Setting fan mode on the '${this.name}' to ${serviceData.fan_mode}`);

    this.client.callService(this.domain, 'set_fan_mode', serviceData, (data) => {
      if (data) {
        that.log(`Successfully set fan mode on the '${that.name}' to ${serviceData.fan_mode}`);
        callback();
      } else {
        callback(communicationError);
      }
    });
  },

  getServices: function () {
    this.ThermostatService = new Service.Thermostat();
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.mfg)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial);

    this.ThermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemp.bind(this));

    var minTemp = 7.0;
    var maxTemp = 35.0;
    var tempStep = 0.5;

    if (this.data && this.data.attributes) {
      if (this.data.attributes.min_temp) {
        minTemp = this.data.attributes.min_temp;
      }
      if (this.data.attributes.max_temp) {
        maxTemp = this.data.attributes.max_temp;
      }
      if (this.data.attributes.target_temp_step) {
        tempStep = this.data.attributes.target_temp_step;
      }
    }

    this.ThermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: minTemp, maxValue: maxTemp, minStep: tempStep })
      .on('get', this.getTargetTemp.bind(this))
      .on('set', this.setTargetTemp.bind(this));

    this.ThermostatService
      .getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .on('get', this.getTargetHeatingCoolingState.bind(this))
      .on('set', this.setTargetHeatingCoolingState.bind(this));

    if (this.data && this.data.attributes && this.data.attributes.unit_of_measurement) {
      var units = (this.data.attributes.unit_of_measurement === '°F') ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS;
      this.ThermostatService
        .setCharacteristic(Characteristic.TemperatureDisplayUnits, units);
    }

    this.fanService = new Service.Fan();
    this.fanService
      .getCharacteristic(Characteristic.RotationSpeed)
      .on('get', this.getRotationSpeed.bind(this))
      .on('set', this.setRotationSpeed.bind(this));

    return [informationService, this.ThermostatService, this.fanService];
  }


};

function HomeAssistantClimatePlatform(oService, oCharacteristic, oCommunicationError) {
  Service = oService;
  Characteristic = oCharacteristic;
  communicationError = oCommunicationError;

  return HomeAssistantClimate;
}

module.exports = HomeAssistantClimatePlatform;
module.exports.HomeAssistantClimate = HomeAssistantClimate;
