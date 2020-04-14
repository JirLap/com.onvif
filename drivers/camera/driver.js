'use strict';

const Homey = require('homey');

class CameraDriver extends Homey.Driver {

	onInit() {
		this.log('CameraDriver has been inited');
		this.lastUsername = '';
		this.lastPassword = '';
		this.lastHostName = '';
		this.lastPort = 0;

		this.motionCondition = new Homey.FlowCardCondition('motionEnabledCondition');
		this.motionCondition
			.register()
			.registerRunListener(async (args, state) => {

				return await args.device.getCapabilityValue('motion_enabled'); // Promise<boolean>
			});

		this.motionEnabledAction = new Homey.FlowCardAction('motionEnableAction');
		this.motionEnabledAction
			.register()
			.registerRunListener(async (args, state) => {

				args.device.onCapabilityMotionEnable( true, null);
				return await args.device.setCapabilityValue('motion_enabled', true); // Promise<void>
			})

		this.motionDisabledAction = new Homey.FlowCardAction('motionDisableAction');
		this.motionDisabledAction
			.register()
			.registerRunListener(async (args, state) => {

				args.device.onCapabilityMotionEnable( false, null);
				return await args.device.setCapabilityValue('motion_enabled', false); // Promise<void>
			})
	}

	async getLastCredentials(device) {
		await device.setSettings({
			username: this.lastUsername,
			password: this.lastPassword
		});
		await device.setStoreValue('initialised', true);
	}

	onPair(socket) {
		socket.on('list_devices', (data, callback) => {
			Homey.app.discoverCameras().then(devices => {
				callback(null, devices);
			}).catch(function (err) {
				callback(new Error("Connection Failed" + err), []);
			});
		});

		socket.on('list_devices_selection', (data, callback) => {
			// User selected a device so cache the information required to validate it when the credentials are set
			this.lastHostName = data[0].data.id;
			this.lastPort = data[0].data.port;
			callback();
		});

		socket.on('login', (data, callback) => {
			this.lastUsername = data.username;
			this.lastPassword = data.password;

			Homey.app.connectCamera(
					this.lastHostName,
					this.lastPort,
					this.lastUsername,
					this.lastPassword
				)
				.then(res => {
					this.log("Valid");
					callback(null, true);
				})
				.catch(err => {
					this.log("Failed");
					callback(err);
				});
		});
	}
}

module.exports = CameraDriver;