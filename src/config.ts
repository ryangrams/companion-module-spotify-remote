import type { DropdownChoice, SomeCompanionConfigField } from '@companion-module/base'
import type { SpotifyDeviceSummary } from './state.js'

export const DEFAULT_CONFIG: DeviceConfig = { pollInterval: 3, playlistSlots: 8 }

/** The largest playlist browser the module will build variables and presets for */
export const MAX_PLAYLIST_SLOTS = 32

export interface DeviceConfig {
	clientId?: string
	clientSecret?: string
	redirectUri?: string
	code?: string
	refreshToken?: string
	deviceId?: string
	authURL?: string
	pollInterval: number
	playlistSlots: number
}

export function GetConfigFields(
	activeDeviceId: string | null | undefined,
	devices: SpotifyDeviceSummary[] | null,
	currentDeviceId: string | undefined,
): SomeCompanionConfigField[] {
	const deviceChoices: DropdownChoice[] = (devices ?? []).map((d) => ({
		id: d.id,
		label: `${d.name} (${d.type})${d.isActive ? ', playing now' : ''}`,
	}))
	if (currentDeviceId && !deviceChoices.find((c) => c.id === currentDeviceId)) {
		deviceChoices.unshift({ id: currentDeviceId, label: `Saved device, not online right now (${currentDeviceId})` })
	}

	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Setup Information',
			value: '<strong>PLEASE READ THE HELP FILE.</strong> (Question mark in the top right)',
		},
		{ type: 'textinput', id: 'clientId', width: 6, label: 'Client ID' },
		{ type: 'textinput', id: 'clientSecret', width: 6, label: 'Client Secret' },
		{
			type: 'static-text',
			id: '_redirect_info_',
			width: 12,
			label: '',
			value:
				'You may need to update the Redirect URL both here and in the spotify api settings, as the previously recommended location is no longer available.<br/>We now recommend https://bitfocus.github.io/companion-module-spotify-remote/',
		},
		{ type: 'textinput', id: 'redirectUri', width: 12, label: 'Redirect URL' },
		{ type: 'textinput', id: 'code', width: 12, label: 'Approval Code' },
		{ type: 'textinput', id: 'refreshToken', width: 12, label: 'Refresh Token' },
		{
			type: 'dropdown',
			id: 'deviceId',
			width: 12,
			label: 'Playback Device',
			tooltip:
				'Every action plays on this device. Open Spotify on the computer or speaker you want, then reopen this panel to see it in the list. You can also paste a device ID.',
			choices: deviceChoices,
			default: '',
			allowCustom: true,
		},
		{
			type: 'static-text',
			id: 'deviceId_current',
			width: 12,
			label: 'Active Device ID',
			value: activeDeviceId
				? `The active device ID when this panel was opened is: ${activeDeviceId}`
				: 'No device was active when this panel was opened',
		},
		{ type: 'textinput', id: 'authURL', width: 12, label: 'Auth URL' },
		{ type: 'textinput', id: 'pollInterval', width: 6, label: 'API Poll Interval (seconds)' },
		{
			type: 'static-text',
			id: '_poll_info_',
			width: 6,
			label: '',
			value:
				'This is how often the module will poll the Spotify API for updates. Default is 3 seconds. This may need to be increased if reaching the api rate limit.',
		},
		{
			type: 'number',
			id: 'playlistSlots',
			width: 6,
			label: 'Playlist Browser Buttons',
			tooltip: 'How many playlists the browser shows per page. Match it to the buttons you give the browser.',
			default: DEFAULT_CONFIG.playlistSlots,
			min: 1,
			max: MAX_PLAYLIST_SLOTS,
		},
	]
}

export function ensureRequiredConfigIsDefined(config: DeviceConfig): boolean {
	let changed = false

	if (!config.pollInterval || config.pollInterval < 0) {
		config.pollInterval = DEFAULT_CONFIG.pollInterval
		changed = true
	}

	const slots = Number(config.playlistSlots)
	if (!slots || slots < 1 || slots > MAX_PLAYLIST_SLOTS || !Number.isInteger(slots)) {
		config.playlistSlots = DEFAULT_CONFIG.playlistSlots
		changed = true
	}

	return changed
}
