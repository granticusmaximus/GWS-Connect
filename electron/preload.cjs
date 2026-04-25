const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('gwsDesktop', {
	isElectron: true,
	platform: process.platform,
});
