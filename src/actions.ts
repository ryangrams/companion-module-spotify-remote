import {
	CompanionActionDefinitions,
	CompanionActionDefinition,
	SomeCompanionActionInputField,
	DropdownChoice,
} from '@companion-module/base'
import { SpotifyInstanceBase } from './types.js'
import { SpotifyPlaylistInfo } from './state.js'
import { MAX_PLAYLIST_SLOTS } from './config.js'
import {
	ChangePlayState,
	ChangeRepeatState,
	ChangeShuffleState,
	ChangeVolume,
	FadeVolume,
	PlaySpecificList,
	PlaySpecificTracks,
	PreviousSong,
	QueueItem,
	SeekPosition,
	SkipSong,
	StartPlaylist,
	StartPlaylistOptions,
	TransferPlayback,
} from './helpers.js'
import { getMyDevices } from './api/device.js'
import { formatApiError } from './api/util.js'

export enum ActionId {
	PlayPause = 'play/pause',
	Play = 'play',
	PlaySpecificList = 'playSpecificList',
	PlaySpecificTracks = 'playSpecificTracks',
	Pause = 'pause',
	QueueItem = 'queueItem',
	VolumeUp = 'volumeUp',
	VolumeDown = 'volumeDown',
	VolumeSpecific = 'volumeSpecific',
	FadeVolume = 'fadeVolume',
	SeekPosition = 'seekPosition',
	SeekPositionBack = 'seekPositionBack',
	SeekPositionForward = 'seekPositionForward',
	Skip = 'skip',
	Previous = 'previous',
	ShuffleToggle = 'shuffleToggle',
	ShuffleOn = 'shuffleOn',
	ShuffleOff = 'shuffleOff',
	RepeatState = 'repeatState',
	ActiveDeviceToConfig = 'activeDeviceToConfig',
	SwitchActiveDevice = 'switchActiveDevice',
	Mute = 'mute',
	Unmute = 'unmute',
	MuteToggle = 'muteToggle',
	PlayPlaylist = 'playPlaylist',
	PlayPlaylistSlot = 'playPlaylistSlot',
	PlaylistPage = 'playlistPage',
	RefreshPlaylists = 'refreshPlaylists',
	TransferToPlaybackDevice = 'transferToPlaybackDevice',
}

export type DoAction = (instance: SpotifyInstanceBase, deviceId: string | null) => Promise<void>

/** Options shared by the actions that start a playlist */
function playlistStartOptions(): SomeCompanionActionInputField[] {
	return [
		{
			type: 'dropdown',
			default: 'return',
			label: 'If This Playlist Is Already Playing',
			id: 'behavior',
			choices: [
				{ id: 'return', label: 'Do Nothing' },
				{ id: 'resume', label: 'Play (if paused)' },
				{ id: 'force', label: 'Start Again From the Top' },
			],
		},
		{
			type: 'dropdown',
			default: 'leave',
			label: 'Shuffle',
			id: 'shuffle',
			choices: [
				{ id: 'leave', label: 'Leave As It Is' },
				{ id: 'on', label: 'On, Starting on a Random Track' },
				{ id: 'off', label: 'Off, Starting on the First Track' },
			],
		},
		{
			type: 'checkbox',
			label: 'Fade In Volume',
			id: 'fadeIn',
			default: false,
		},
		{
			type: 'number',
			label: 'Start Volume',
			id: 'startVolume',
			default: 0,
			min: 0,
			max: 100,
			step: 1,
			isVisible: (options) => options.fadeIn === true,
		},
		{
			type: 'number',
			label: 'Target Volume',
			id: 'targetVolume',
			default: 85,
			min: 0,
			max: 100,
			step: 1,
			isVisible: (options) => options.fadeIn === true,
		},
		{
			type: 'number',
			label: 'Fade Duration (milliseconds)',
			id: 'fadeDurationMs',
			default: 5000,
			min: 500,
			max: 300000,
			step: 500,
			isVisible: (options) => options.fadeIn === true,
		},
	]
}

function readPlaylistStartOptions(
	options: Record<string, unknown>,
	playlist: SpotifyPlaylistInfo | null,
): StartPlaylistOptions {
	const behavior = options.behavior === 'resume' || options.behavior === 'force' ? options.behavior : 'return'
	const shuffle = options.shuffle === 'on' || options.shuffle === 'off' ? options.shuffle : 'leave'
	return {
		behavior,
		shuffle,
		trackCount: playlist?.trackCount ?? null,
		fadeIn: options.fadeIn === true,
		startVolume: Number(options.startVolume),
		targetVolume: Number(options.targetVolume),
		fadeDurationMs: Number(options.fadeDurationMs),
	}
}

/** Dropdown choices for every playlist the module knows about */
export function playlistChoices(playlists: SpotifyPlaylistInfo[] | null): DropdownChoice[] {
	return (playlists ?? []).map((p) => ({
		id: p.id,
		label: p.ownerName ? `${p.name} (${p.ownerName})` : p.name,
	}))
}

/** Accepts a bare playlist id, a spotify:playlist: uri or an open.spotify.com link */
export function normalisePlaylistId(value: string): string {
	const trimmed = value.trim()
	const linkMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/)
	if (linkMatch) return linkMatch[1]
	if (trimmed.startsWith('spotify:')) return trimmed.substring(trimmed.lastIndexOf(':') + 1)
	return trimmed
}

export function GetActionsList(
	executeAction: (fcn: DoAction) => Promise<void>,
	playlists: SpotifyPlaylistInfo[] | null,
): CompanionActionDefinitions {
	const choices = playlistChoices(playlists)

	const executeActionIfHasDeviceId = async (
		actionName: string,
		action: (instance: SpotifyInstanceBase, deviceId: string) => Promise<void>,
	) => {
		return executeAction(async (instance, deviceId) => {
			if (!deviceId) {
				instance.log('warn', `Skipping "${actionName}" action, no deviceId is configured`)
				return
			}

			await action(instance, deviceId)
		})
	}

	// getState: () => SpotifyState
	// const initialState = getState()
	const actions: { [id in ActionId]: CompanionActionDefinition | undefined } = {
		[ActionId.PlayPause]: {
			name: 'Toggle Play/Pause',
			options: [
				{
					type: 'checkbox',
					label: 'Fade Out Volume on Pause',
					id: 'fadeOut',
					default: false,
				},
				{
					type: 'checkbox',
					label: 'Fade In Volume on Play',
					id: 'fadeIn',
					default: false,
				},
				{
					type: 'number',
					label: 'Start Volume for Fade In',
					id: 'startVolume',
					default: 0,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Target Volume for Fade In',
					id: 'targetVolume',
					default: 85,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
					isVisible: (options) => options.fadeIn === true || options.fadeOut === true,
				},
			],
			callback: async (action) => {
				await executeActionIfHasDeviceId('play/pause', async (instance, deviceId) => {
					ChangePlayState(
						instance,
						deviceId,
						'toggle',
						action.options.fadeOut as boolean,
						action.options.fadeIn as boolean,
						Number(action.options.startVolume),
						Number(action.options.targetVolume),
						Number(action.options.fadeDurationMs),
					).catch((err) => instance.log('warn', `Play Toggle failed: ${formatApiError(err)}`))
				})
			},
		},
		[ActionId.Play]: {
			name: 'Play',
			options: [
				{
					type: 'checkbox',
					label: 'Fade In Volume',
					id: 'fadeIn',
					default: false,
				},
				{
					type: 'number',
					label: 'Start Volume',
					id: 'startVolume',
					default: 0,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Target Volume',
					id: 'targetVolume',
					default: 85,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
					isVisible: (options) => options.fadeIn === true,
				},
			],
			callback: async (action) => {
				await executeActionIfHasDeviceId('play', async (instance, deviceId) => {
					ChangePlayState(
						instance,
						deviceId,
						'play',
						false,
						action.options.fadeIn as boolean,
						Number(action.options.startVolume),
						Number(action.options.targetVolume),
						Number(action.options.fadeDurationMs),
					).catch((err) => instance.log('warn', `Play failed: ${formatApiError(err)}`))
				})
			},
		},
		[ActionId.PlaySpecificList]: {
			name: 'Start Specific Album / Artist / Playlist',
			options: [
				{
					id: 'type',
					type: 'dropdown',
					label: 'Type',
					choices: [
						{ id: 'album', label: 'Album' },
						{ id: 'artist', label: 'Artist' },
						{ id: 'playlist', label: 'Playlist' },
					],
					default: 'album',
				},
				{
					tooltip: 'Provide the ID for the item',
					required: true,
					type: 'textinput',
					label: 'Item ID',
					id: 'context_uri',
					useVariables: true,
				},
				{
					type: 'dropdown',
					default: 'return',
					label: 'Action Behavior if Provided Item is Currently Playing',
					id: 'behavior',
					choices: [
						{ id: 'return', label: 'Do Nothing' },
						{ id: 'resume', label: 'Play (if paused)' },
						{ id: 'force', label: 'Force Play (from start)' },
					],
				},
				{
					type: 'checkbox',
					label: 'Fade In Volume',
					id: 'fadeIn',
					default: false,
				},
				{
					type: 'number',
					label: 'Start Volume',
					id: 'startVolume',
					default: 0,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Target Volume',
					id: 'targetVolume',
					default: 85,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
					isVisible: (options) => options.fadeIn === true,
				},
			],
			callback: async (action, context) => {
				if (action.options.type && action.options.context_uri && typeof action.options.behavior === 'string') {
					const behavior = action.options.behavior as any // TODO - type

					await executeActionIfHasDeviceId('start album/artist/playlist', async (instance, deviceId) => {
						const context_uri_portion = await context.parseVariablesInString(String(action.options.context_uri))
						const context_uri = context_uri_portion.startsWith('spotify:')
							? context_uri_portion
							: `spotify:${action.options.type}:${context_uri_portion}`

						PlaySpecificList(
							instance,
							deviceId,
							context_uri,
							behavior,
							action.options.fadeIn as boolean,
							Number(action.options.startVolume),
							Number(action.options.targetVolume),
							Number(action.options.fadeDurationMs),
						).catch((err) => instance.log('warn', `PlaySpecificList failed: ${formatApiError(err)}`))
					})
				}
			},
		},
		[ActionId.PlaySpecificTracks]: {
			name: 'Start Specific Track(s)',
			options: [
				{
					id: 'tracks',
					type: 'textinput',
					required: true,
					label: 'Input Specific Track IDs',
					tooltip: 'IDs should be comma separated (ie. 4ByEFOBuLXpCqvO1kw8Wdm,7BaEFOBuLXpDqvO1kw8Wem)',
				},
				{
					id: 'positionMs',
					type: 'number',
					label: 'Start Position of First Track in Milliseconds',
					default: 0,
					required: false,
					min: 0,
					max: 1000000,
				},
				{
					type: 'checkbox',
					label: 'Fade In Volume',
					id: 'fadeIn',
					default: false,
				},
				{
					type: 'number',
					label: 'Start Volume',
					id: 'startVolume',
					default: 0,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Target Volume',
					id: 'targetVolume',
					default: 85,
					min: 0,
					max: 100,
					step: 1,
					isVisible: (options) => options.fadeIn === true,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
					isVisible: (options) => options.fadeIn === true,
				},
			],
			callback: async (action) => {
				if (typeof action.options.tracks === 'string') {
					const tracks = action.options.tracks.split(',').map((track) => {
						const value = track.trim()
						return value.startsWith('spotify:track') ? value : `spotify:track:${value}`
					})

					await executeActionIfHasDeviceId('start track', async (instance, deviceId) => {
						PlaySpecificTracks(
							instance,
							deviceId,
							tracks,
							Number(action.options.positionMs) || 0,
							action.options.fadeIn as boolean,
							Number(action.options.startVolume),
							Number(action.options.targetVolume),
							Number(action.options.fadeDurationMs),
						).catch((err) => instance.log('warn', `PlaySpecificTracks failed: ${formatApiError(err)}`))
					})
				}
			},
		},
		[ActionId.Pause]: {
			name: 'Pause Playback',
			options: [
				{
					type: 'checkbox',
					label: 'Fade Out Volume',
					id: 'fadeOut',
					default: false,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
					isVisible: (options) => options.fadeOut === true,
				},
			],
			callback: async (action) => {
				await executeActionIfHasDeviceId('pause', async (instance, deviceId) => {
					ChangePlayState(
						instance,
						deviceId,
						'pause',
						action.options.fadeOut as boolean,
						false,
						0,
						0,
						Number(action.options.fadeDurationMs),
					).catch((err) => instance.log('warn', `Pause failed: ${formatApiError(err)}`))
				})
			},
		},
		[ActionId.VolumeUp]: {
			name: 'Volume Up',
			options: [{ type: 'number', label: 'Volume', id: 'volumeUpAmount', default: 5, min: 0, max: 100, step: 1 }],
			callback: async (action) => {
				await executeActionIfHasDeviceId('volume up', async (instance, deviceId) => {
					await ChangeVolume(instance, deviceId, false, Number(action.options.volumeUpAmount))
				})
			},
		},
		[ActionId.VolumeDown]: {
			name: 'Volume Down',
			options: [{ type: 'number', label: 'Volume', id: 'volumeDownAmount', default: 5, min: 0, max: 100, step: 1 }],
			callback: async (action) => {
				await executeActionIfHasDeviceId('volume down', async (instance, deviceId) => {
					await ChangeVolume(instance, deviceId, false, -Number(action.options.volumeDownAmount))
				})
			},
		},
		[ActionId.VolumeSpecific]: {
			name: 'Set Volume to Specific Value',
			options: [{ type: 'number', label: 'Volume', id: 'value', default: 50, min: 0, max: 100, step: 1 }],
			callback: async (action) => {
				await executeActionIfHasDeviceId('volume', async (instance, deviceId) => {
					await ChangeVolume(instance, deviceId, true, Number(action.options.value))
				})
			},
		},
		[ActionId.FadeVolume]: {
			name: 'Fade Volume',
			options: [
				{
					type: 'number',
					label: 'Target Volume',
					id: 'targetVolume',
					default: 50,
					min: 0,
					max: 100,
					step: 1,
				},
				{
					type: 'number',
					label: 'Fade Duration (milliseconds)',
					id: 'fadeDurationMs',
					default: 5000,
					min: 500,
					max: 300000,
					step: 500,
				},
			],
			callback: async (action) => {
				await executeActionIfHasDeviceId('fade volume', async (instance, deviceId) => {
					FadeVolume(
						instance,
						deviceId,
						Number(action.options.targetVolume),
						Number(action.options.fadeDurationMs),
					).catch((err) => instance.log('warn', `FadeVolume failed: ${formatApiError(err)}`))
				})
			},
		},
		[ActionId.SeekPositionBack]: {
			name: 'Go Backwards X Milliseconds In Currently Playing Track',
			options: [{ type: 'textinput', label: 'Position (milliseconds)', id: 'position', default: '' }],
			callback: async (action) => {
				const positionMs = Number(action.options.position)
				if (!isNaN(positionMs)) {
					await executeActionIfHasDeviceId('seek', async (instance, deviceId) => {
						const currentPositionVariable = instance.getVariableValue('songProgressSeconds')
						const currentPosition = !isNaN(Number(currentPositionVariable)) ? Number(currentPositionVariable) * 1000 : 0
						const seekToPosition = Math.max(0, currentPosition - positionMs)
						await SeekPosition(instance, deviceId, seekToPosition)
					})
				}
			},
		},
		[ActionId.SeekPositionForward]: {
			name: 'Go Forward X Milliseconds In Currently Playing Track',
			options: [{ type: 'textinput', label: 'Position (milliseconds)', id: 'position', default: '' }],
			callback: async (action) => {
				const positionMs = Number(action.options.position)
				if (!isNaN(positionMs)) {
					await executeActionIfHasDeviceId('seek', async (instance, deviceId) => {
						const currentPositionVariable = instance.getVariableValue('songProgressSeconds')
						const currentPosition = !isNaN(Number(currentPositionVariable)) ? Number(currentPositionVariable) * 1000 : 0
						const seekToPosition = Math.max(0, currentPosition + positionMs)
						await SeekPosition(instance, deviceId, seekToPosition)
					})
				}
			},
		},
		[ActionId.SeekPosition]: {
			name: 'Seek To Position In Currently Playing Track',
			options: [{ type: 'textinput', label: 'Position (milliseconds)', id: 'position', default: '' }],
			callback: async (action) => {
				const positionMs = Number(action.options.position)
				if (!isNaN(positionMs)) {
					await executeActionIfHasDeviceId('seek', async (instance, deviceId) => {
						await SeekPosition(instance, deviceId, positionMs)
					})
				}
			},
		},
		[ActionId.Skip]: {
			name: 'Skip Track',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('skip track', async (instance, deviceId) => {
					await SkipSong(instance, deviceId)
				})
			},
		},
		[ActionId.Previous]: {
			name: 'Previous Track',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('previous track', async (instance, deviceId) => {
					await PreviousSong(instance, deviceId)
				})
			},
		},
		[ActionId.ShuffleToggle]: {
			name: 'Toggle Shuffle',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('toggle shuffle', async (instance, deviceId) => {
					await ChangeShuffleState(instance, deviceId, 'toggle')
				})
			},
		},
		[ActionId.ShuffleOn]: {
			name: 'Turn Shuffle On',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('shuffle on', async (instance, deviceId) => {
					await ChangeShuffleState(instance, deviceId, true)
				})
			},
		},
		[ActionId.ShuffleOff]: {
			name: 'Turn Shuffle Off',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('shuffle off', async (instance, deviceId) => {
					await ChangeShuffleState(instance, deviceId, false)
				})
			},
		},
		[ActionId.RepeatState]: {
			name: 'Set Repeat State',
			options: [
				{
					type: 'dropdown',
					label: 'State',
					id: 'state',
					default: 'off',
					choices: [
						{ id: 'off', label: 'off' },
						{ id: 'context', label: 'context' },
						{ id: 'track', label: 'track' },
					],
				},
			],
			callback: async (action) => {
				if (typeof action.options.state === 'string') {
					const target = action.options.state as any // TODO - typings
					await executeActionIfHasDeviceId('rpeat', async (instance, deviceId) => {
						await ChangeRepeatState(instance, deviceId, target)
					})
				}
			},
		},
		[ActionId.ActiveDeviceToConfig]: {
			name: 'Write the ID of the current Active Device to config',
			options: [],
			callback: async () => {
				await executeAction(async (instance) => {
					const reqOptions = instance.getRequestOptionsBase()
					if (!reqOptions) return

					const data = await getMyDevices(reqOptions)
					const activeDevice = data.body?.devices?.find((d) => d.is_active)
					if (activeDevice?.id) {
						// Store the id
						instance.config.deviceId = activeDevice.id
						instance.saveConfig(instance.config)

						// Invalidate all feedbacks, some of them have probably changed
						instance.checkFeedbacks()
					} else {
						instance.log('warn', 'No active device found')
					}
				})
			},
		},
		[ActionId.SwitchActiveDevice]: {
			name: 'Change Active Device',
			options: [{ type: 'textinput', label: 'Device ID', id: 'deviceId', default: '' }],
			callback: async (action) => {
				await executeAction(async (instance) => {
					const targetId = action.options.deviceId
					if (targetId && typeof targetId === 'string') {
						// Store the id
						instance.config.deviceId = targetId
						instance.saveConfig(instance.config)

						// Invalidate all feedbacks, some of them have probably changed
						instance.checkFeedbacks()

						await TransferPlayback(instance, targetId)
					}
				})
			},
		},
		[ActionId.QueueItem]: {
			name: 'Add Track to Queue',
			options: [
				{
					tooltip: 'Provide the ID for the track',
					required: true,
					type: 'textinput',
					label: 'Track ID',
					id: 'context_uri',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				if (typeof action.options.context_uri === 'string') {
					const context_uri_portion = await context.parseVariablesInString(String(action.options.context_uri))
					const context_uri = context_uri_portion.startsWith('spotify:track')
						? context_uri_portion
						: `spotify:track:${context_uri_portion}`

					await executeActionIfHasDeviceId('queue track', async (instance, deviceId) => {
						await QueueItem(instance, deviceId, context_uri)
					})
				}
			},
		},
		[ActionId.Mute]: {
			name: 'Mute Volume',
			description: 'Mute the volume, saving the current volume to restore on unmute',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('mute', async (instance, deviceId) => {
					const currentVolume = Number(instance.getVariableValue('volume'))
					instance.premuteVolume = !isNaN(currentVolume) ? currentVolume : instance.premuteVolume
					instance.setVariableValues({ premuteVolume: instance.premuteVolume })
					await ChangeVolume(instance, deviceId, true, 0)
				})
			},
		},
		[ActionId.Unmute]: {
			name: 'Unmute Volume',
			description: 'Unmute the volume, restoring the volume to the value before mute',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('unmute', async (instance, deviceId) => {
					const premuteVolume = instance.premuteVolume
					await ChangeVolume(instance, deviceId, true, premuteVolume)
				})
			},
		},
		[ActionId.MuteToggle]: {
			name: 'Toggle Mute Volume',
			description: 'Toggle mute/unmute the volume, saving/restoring the current volume',
			options: [],
			callback: async () => {
				await executeActionIfHasDeviceId('mute toggle', async (instance, deviceId) => {
					const currentVolume = Number(instance.getVariableValue('volume'))
					if (!isNaN(currentVolume) && currentVolume > 0) {
						instance.premuteVolume = currentVolume
						instance.setVariableValues({ premuteVolume: instance.premuteVolume })
						await ChangeVolume(instance, deviceId, true, 0)
					} else {
						await ChangeVolume(instance, deviceId, true, instance.premuteVolume)
					}
				})
			},
		},
		[ActionId.PlayPlaylist]: {
			name: 'Play One of My Playlists',
			description: 'Pick from the playlists in your Spotify library, or paste a playlist link or ID',
			options: [
				{
					type: 'dropdown',
					label: 'Playlist',
					id: 'playlist',
					choices,
					default: choices[0]?.id ?? '',
					allowCustom: true,
					tooltip: 'If your playlist is missing, run "Refresh My Playlists" or paste its link',
				},
				...playlistStartOptions(),
			],
			callback: async (action, context) => {
				const raw = await context.parseVariablesInString(String(action.options.playlist ?? ''))
				const playlistId = normalisePlaylistId(raw)
				if (!playlistId) return

				await executeActionIfHasDeviceId('play playlist', async (instance, deviceId) => {
					const playlist = instance.findPlaylist(playlistId)
					StartPlaylist(
						instance,
						deviceId,
						`spotify:playlist:${playlistId}`,
						readPlaylistStartOptions(action.options, playlist),
					).catch((err) => instance.log('warn', `Play playlist failed: ${formatApiError(err)}`))
				})
			},
		},
		[ActionId.PlayPlaylistSlot]: {
			name: 'Playlist Browser: Play the Playlist in a Slot',
			description: 'Plays whichever playlist the browser currently shows in this slot',
			options: [
				{
					type: 'number',
					label: 'Slot',
					id: 'slot',
					default: 1,
					min: 1,
					max: MAX_PLAYLIST_SLOTS,
					step: 1,
				},
				...playlistStartOptions(),
			],
			callback: async (action) => {
				const slot = Number(action.options.slot)
				await executeActionIfHasDeviceId('play playlist slot', async (instance, deviceId) => {
					const playlist = instance.getPlaylistInSlot(slot)
					if (!playlist) {
						instance.log('info', `Playlist browser slot ${slot} is empty`)
						return
					}
					StartPlaylist(instance, deviceId, playlist.uri, readPlaylistStartOptions(action.options, playlist)).catch(
						(err) => instance.log('warn', `Play playlist failed: ${formatApiError(err)}`),
					)
				})
			},
		},
		[ActionId.PlaylistPage]: {
			name: 'Playlist Browser: Change Page',
			options: [
				{
					type: 'dropdown',
					label: 'Page',
					id: 'direction',
					default: 'next',
					choices: [
						{ id: 'next', label: 'Next Page' },
						{ id: 'previous', label: 'Previous Page' },
						{ id: 'first', label: 'First Page' },
					],
				},
			],
			callback: async (action) => {
				await executeAction(async (instance) => {
					const direction = action.options.direction
					instance.changePlaylistPage(direction === 'first' ? 'first' : direction === 'previous' ? -1 : 1)
				})
			},
		},
		[ActionId.RefreshPlaylists]: {
			name: 'Refresh My Playlists',
			description: 'Fetch your playlists from Spotify now. They also refresh on their own every few minutes.',
			options: [],
			callback: async () => {
				await executeAction(async (instance) => {
					await instance.refreshPlaylists()
				})
			},
		},
		[ActionId.TransferToPlaybackDevice]: {
			name: 'Bring Playback to the Playback Device',
			description:
				'Moves whatever is playing back to the device chosen in the connection settings, for when someone started music on a phone',
			options: [
				{
					type: 'checkbox',
					label: 'Start Playing If Paused',
					id: 'play',
					default: false,
				},
			],
			callback: async (action) => {
				await executeActionIfHasDeviceId('bring playback to the playback device', async (instance, deviceId) => {
					await TransferPlayback(instance, deviceId, action.options.play === true)
				})
			},
		},
	}

	return actions
}
