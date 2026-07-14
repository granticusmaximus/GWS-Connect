let dataSyncInProgress = false;

export const setDataSyncInProgress = (value) => {
	dataSyncInProgress = Boolean(value);
};

export const isDataSyncInProgress = () => dataSyncInProgress;
