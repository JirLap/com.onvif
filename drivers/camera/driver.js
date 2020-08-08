'use strict';

const Homey = require('homey');

class CameraDriver extends Homey.Driver {

	onInit() {
		this.log('CameraDriver has been inited');
		this.lastUsername = '';
		this.lastPassword = '';
		this.lastHostName = '';
		this.lastPort = 0;
		this.lastURN = "";

		this.motionCondition = new Homey.FlowCardCondition('motionEnabledCondition');
		this.motionCondition
			.register()
			.registerRunListener(async (args, state) => {

				return await args.device.getCapabilityValue('motion_enabled'); // Promise<boolean>
			});

		this.motionReadyCondition = new Homey.FlowCardCondition('motionReadyCondition');
		this.motionReadyCondition
			.register()
			.registerRunListener(async (args, state) => {

				let remainingTime = args.waitTime * 10;
				while ((remainingTime > 0) && args.device.updatingEventImage) {
					// Wait for image to update
					await new Promise(resolve => setTimeout(resolve, 100));
					remainingTime--;
				}
				return !args.device.updatingEventImage;
			});

		this.motionEnabledAction = new Homey.FlowCardAction('motionEnableAction');
		this.motionEnabledAction
			.register()
			.registerRunListener(async (args, state) => {
				console.log("motionEnabledAction");
				// args.device.onCapabilityMotionEnable(true, null);
				// return await args.device.setCapabilityValue('motion_enabled', true); // Promise<void>
			})

		this.motionDisabledAction = new Homey.FlowCardAction('motionDisableAction');
		this.motionDisabledAction
			.register()
			.registerRunListener(async (args, state) => {

				console.log("motionDisabledAction");
				// args.device.onCapabilityMotionEnable(false, null);
				// return await args.device.setCapabilityValue('motion_enabled', false); // Promise<void>
			})

		this.snapshotAction = new Homey.FlowCardAction('snapshotAction');
		this.snapshotAction
			.register()
			.registerRunListener(async (args, state) => {

				let err = await args.device.nowImage.update();
				if (!err) {
					let tokens = {
						'image': args.device.nowImage
					}

					args.device.snapshotReadyTrigger
						.trigger(args.device, tokens)
						.catch(args.device.error)
						.then(args.device.log("Now Snapshot ready (" + args.device.id + ")"))
				}
				return err;
			})

		this.motionUpdateAction = new Homey.FlowCardAction('updateMotionImageAction');
		this.motionUpdateAction
			.register()
			.registerRunListener(async (args, state) => {

				return args.device.updateMotionImage(0);
			})
	}

	async getLastCredentials(device) {
		await device.setSettings({
			'username': this.lastUsername,
			'password': this.lastPassword
		});
		await device.setStoreValue('initialised', true);
		Homey.app.updateLog("Saved Credentials");
	}

	onPair(socket) {
		let listDevices = 1;
		let tempCam = null;

		socket.on('list_devices', (data, callback) => {
			if (listDevices == 1) {
				listDevices = 2;
				Homey.app.discoverCameras().then(devices => {
					Homey.app.updateLog("Discovered: " + Homey.app.varToString(devices, null, 2));
					callback(null, devices);
				}).catch((err) => {
					callback(new Error("Connection Failed" + err), []);
				});
			} else {
				if (tempCam) {
					Homey.app.updateLog("list_devices2: Multiple Sources ", cam.videoSources);

					let devices = [];
					for (const source in cam.videoSources) {
						// There is more tha 1 video source so add a device for each
						Homey.app.updateLog("Adding source " + source + " to list");
						let token = "";
						if (source["$"]) {
							token = source["$"].token;
						}
						let channelSuf = " (Ch" + (devices.length + 1) + ")";
						var data = {
							"id": this.lastURN + channelSuf,
							"port": this.lastPort
						};
						devices.push({
							"name": this.lastHostName + channelSuf,
							data,
							settings: {
								// Store username & password in settings
								// so the user can change them later
								"username": this.lastUsername,
								"password": this.lastPassword,
								"ip": this.lastHostName,
								"port": this.lastPort,
								"urn": this.lastURN,
								"channel": devices.length + 1,
								"token": token
							}
						})
					}
					Homey.app.updateLog("list_devices2: Listing ", devices);
					callback(null, devices);
				} else {
					Homey.app.updateLog("list_devices2: Single Sources ", cam.videoSources);
					socket.nextView();
				}
			}
		});

		socket.on('list_devices_selection', (data, callback) => {
			// User selected a device so cache the information required to validate it when the credentials are set
			console.log("list_devices_selection: ", data);
			this.lastHostName = data[0].settings.ip;
			this.lastPort = data[0].settings.port;
			this.lastURN = data[0].settings.urn;
			callback();
		});

		socket.on('login', (data, callback) => {
			this.lastUsername = data.username;
			this.lastPassword = data.password;

			// Homey.app.updateLog("Testing connection credentials");
			Homey.app.updateLog("Login-----");

			Homey.app.connectCamera(
					this.lastHostName,
					this.lastPort,
					this.lastUsername,
					this.lastPassword
				)
				.then(cam => {
					Homey.app.updateLog("Credentials OK. Adding " + Homey.app.varToString(cam.videoSources));
					if (cam.videoSources.length > 1) {
						// There is more tha 1 video source so add a device for each
						Homey.app.updateLog("Multiple source found. Adding " + cam.videoSources.length + " more devices");
						tempCam = cam;
					}
					callback(null, true);
				})
				.catch(err => {
					Homey.app.updateLog("Failed: " + err.stack, true);
					callback(err);
				});
		});

		// Received when a view has changed
		socket.on('showView', (viewId, callback) => {
			callback();
			console.log('View: ' + viewId);
		});
	}

	async onRepair(socket, device) {
		// Argument socket is an EventEmitter, similar to Driver.onPair
		// Argument device is a Homey.Device that's being repaired

		device.repairing = true;

		socket.on('login', async (data, callback) => {
			await device.setSettings({
				'username': data.username,
				'password': data.password
			});

			let settings = device.getSettings();
			let devices = await Homey.app.discoverCameras();

			console.log("Discovered devices: ", devices);

			devices.forEach(async function (discoveredDevice) {
				try {
					let cam = await Homey.app.connectCamera(
						discoveredDevice.settings.ip,
						discoveredDevice.settings.port,
						settings.username,
						settings.password
					);

					let info = {};
					try {
						info = await Homey.app.getDeviceInformation(cam);
						Homey.app.updateLog("Camera Information: " + Homey.app.varToString(info));
					} catch (err) {
						Homey.app.updateLog("Get camera info error: " + err.stack, true);
						return;
					}

					if ((info.serialNumber === settings.serialNumber) && (info.model === settings.model)) {
						// found it
						await device.setSettings({
							'ip': discoveredDevice.settings.ip,
							'port': discoveredDevice.settings.port
						});
						device.cam = cam;
						device.setupImages()

						Homey.app.updateLog("Found the camera: " + Homey.app.varToString(info));
					}

				} catch (err) {
					Homey.app.updateLog("Get camera info error: " + err.stack, true);
				}
			});
			callback(null, true);
		});

		socket.on('disconnect', () => {
			// Cleanup
			device.repairing = false;
		})

	}
}

module.exports = CameraDriver;